/** Fixed deployment columns with orthogonal routes that avoid component cards. */
export type DiagramFlow = 'traffic' | 'configuration' | 'identity' | 'platform';
export type DiagramPoint = { x: number; y: number };
export interface LayoutItem { id: string; stage: number; row: number }
export interface LayoutLink { id: string; from: string; to: string; flow: DiagramFlow; label: string }
export interface DiagramPort { id: string; side: 'left' | 'right'; y: number; type: 'source' | 'target' }
export const CARD_WIDTH = 240;
export const CARD_HEIGHT = 160;
const STEP = 20, COLUMN = 360, ROW = 220, TOP = 140;
const key = (p: DiagramPoint) => `${p.x},${p.y}`;
const segmentKey = (a: DiagramPoint, b: DiagramPoint) => [key(a), key(b)].sort().join(':');

/** A focused trace is a one-hop neighborhood; spread fan-out instead of stacking every app. */
export function traceArchitectureColumns(items: Array<{ id: string; kind: string }>, links: Array<{ from: string; to: string }>, focusId: string) {
  const outward = new Set(links.filter(e => e.from === focusId).map(e => e.to));
  const incoming = new Set(links.filter(e => e.to === focusId && !outward.has(e.from)).map(e => e.from));
  const peers = items.filter(item => item.id !== focusId && !incoming.has(item.id));
  const buckets = [
    { name: 'Callers & providers', detail: 'Connections into the selected component', color: '#0f766e', items: items.filter(item => incoming.has(item.id)) },
    { name: 'Selected component', detail: 'Follow its incoming and outgoing paths', color: '#2563eb', items: items.filter(item => item.id === focusId) },
    { name: 'Connected workloads', detail: 'Direct application dependencies', color: '#2563eb', items: peers.filter(item => item.kind === 'application') },
    { name: 'Data services', detail: 'Databases · caches · storage', color: '#7c3aed', items: peers.filter(item => ['database', 'cache', 'storage'].includes(item.kind)) },
    { name: 'Connected services', detail: 'Capabilities · configuration · access', color: '#b45309', items: peers.filter(item => !['application', 'database', 'cache', 'storage'].includes(item.kind)) },
  ];
  const columns = buckets.flatMap(bucket => Array.from({ length: Math.ceil(bucket.items.length / 3) }, (_, i) => ({ ...bucket, items: bucket.items.slice(i * 3, i * 3 + 3) })));
  return { columns, items: columns.flatMap((column, stage) => column.items.map((item, row) => ({ id: item.id, stage, row }))) };
}

export function layoutArchitecture(items: LayoutItem[], links: LayoutLink[]) {
  const stages = [...new Set(items.map(n => n.stage))].sort((a, b) => a - b);
  const nodes = stages.flatMap(stage => {
    const column = stages.indexOf(stage);
    const members = items.filter(n => n.stage === stage);
    const firstRow = Math.min(...members.map(n => n.row));
    let lastRow = -1;
    return members.sort((a, b) => a.row - b.row || a.id.localeCompare(b.id)).map(n => {
      const row = Math.max(lastRow + 1, n.row - firstRow); lastRow = row;
      return { ...n, column, x: 60 + column * COLUMN, y: TOP + row * ROW, width: CARD_WIDTH, height: CARD_HEIGHT, ports: [] as DiagramPort[] };
    });
  });
  const byId = new Map(nodes.map(n => [n.id, n]));
  const height = Math.max(600, ...nodes.map(n => n.y + CARD_HEIGHT + 100));
  const width = Math.max(420, stages.length * COLUMN);
  const used = new Set<string>();
  const reservedLabels: { x: number; y: number; width: number }[] = [];
  const validLinks = links.filter(e => byId.has(e.from) && byId.has(e.to) && e.from !== e.to);
  // Stable ordering puts the request/data path first and keeps shared-node ports distinct.
  const order: Record<DiagramFlow, number> = { traffic: 0, configuration: 1, identity: 2, platform: 3 };
  validLinks.sort((a, b) => order[a.flow] - order[b.flow] || a.id.localeCompare(b.id));
  const sideCounts = new Map<string, number>();
  const ports = new Map<string, { start: DiagramPoint; end: DiagramPoint; startSide: 'left' | 'right'; endSide: 'left' | 'right' }>();
  for (const e of validLinks) {
    const from = byId.get(e.from)!, to = byId.get(e.to)!;
    const startSide = from.column <= to.column ? 'right' : 'left';
    const endSide = from.column < to.column ? 'left' : 'right';
    const port = (n: typeof from, side: 'left' | 'right', type: 'source' | 'target') => {
      const countKey = n.id + side;
      const index = sideCounts.get(countKey) ?? 0; sideCounts.set(countKey, index + 1);
      const y = 60 + (index % 5) * STEP;
      n.ports.push({ id: `${e.id}-${type}`, side, y, type });
      return { x: n.x + (side === 'right' ? CARD_WIDTH : 0), y: n.y + y };
    };
    ports.set(e.id, { start: port(from, startSide, 'source'), end: port(to, endSide, 'target'), startSide, endSide });
  }
  const blocked = (p: DiagramPoint) => nodes.some(n => p.x >= n.x - 8 && p.x <= n.x + CARD_WIDTH + 8 && p.y >= n.y - 12 && p.y <= n.y + CARD_HEIGHT + 12);
  const edges = validLinks.map(e => {
    const { start, end, startSide, endSide } = ports.get(e.id)!;
    const a = { x: start.x + (startSide === 'right' ? STEP : -STEP), y: start.y };
    const b = { x: end.x + (endSide === 'right' ? STEP : -STEP), y: end.y };
    const points = findRoute(a, b, width, height, blocked, used);
    for (let i = 1; i < points.length; i++) used.add(segmentKey(points[i - 1], points[i]));
    const simplified = [start, ...points, end].filter((p, i, all) => i === 0 || i === all.length - 1 || !((all[i - 1].x === p.x && p.x === all[i + 1].x) || (all[i - 1].y === p.y && p.y === all[i + 1].y)));
    const labelWidth = Math.min(155, e.label.length * 6.5 + 16);
    const segments = simplified.slice(1).map((p, i) => ({ a: simplified[i], b: p, length: Math.abs(p.x - simplified[i].x) + Math.abs(p.y - simplified[i].y) })).sort((a, b) => Number(b.a.y === b.b.y) - Number(a.a.y === a.b.y) || b.length - a.length);
    const candidates = segments.map(s => ({ x: (s.a.x + s.b.x) / 2, y: (s.a.y + s.b.y) / 2 - 12, width: labelWidth }));
    const label = candidates.find(l => !nodes.some(n => l.x + l.width / 2 > n.x - 8 && l.x - l.width / 2 < n.x + CARD_WIDTH + 8 && l.y + 12 > n.y - 8 && l.y - 12 < n.y + CARD_HEIGHT + 8) && !reservedLabels.some(r => Math.abs(r.x - l.x) < (r.width + l.width) / 2 + 8 && Math.abs(r.y - l.y) < 30));
    if (label) reservedLabels.push(label);
    return { ...e, points: simplified, labelPosition: label, sourceHandle: `${e.id}-source`, targetHandle: `${e.id}-target` };
  });
  return { nodes, edges, width, height, stages: stages.map((stage, order) => ({ stage, order, x: 38 + order * COLUMN, y: 28, width: CARD_WIDTH + 44, height: height - 50 })) };
}

function findRoute(start: DiagramPoint, end: DiagramPoint, width: number, height: number, blocked: (p: DiagramPoint) => boolean, used: Set<string>): DiagramPoint[] {
  type Search = DiagramPoint & { dir: number; g: number; f: number; previous?: Search };
  const heap: Search[] = [];
  const push = (item: Search) => { heap.push(item); let i = heap.length - 1; while (i > 0) { const parent = (i - 1) >> 1; if (heap[parent].f <= item.f) break; heap[i] = heap[parent]; i = parent; } heap[i] = item; };
  const pop = () => { const root = heap[0], tail = heap.pop()!; if (heap.length) { let i = 0; while (i * 2 + 1 < heap.length) { let child = i * 2 + 1; if (child + 1 < heap.length && heap[child + 1].f < heap[child].f) child++; if (tail.f <= heap[child].f) break; heap[i] = heap[child]; i = child; } heap[i] = tail; } return root; };
  const best = new Map<string, number>();
  const heuristic = (p: DiagramPoint) => (Math.abs(end.x - p.x) + Math.abs(end.y - p.y)) / STEP;
  push({ ...start, dir: -1, g: 0, f: heuristic(start) });
  while (heap.length) {
    const p = pop();
    if (p.x === end.x && p.y === end.y) { const path: DiagramPoint[] = []; let current: Search | undefined = p; while (current) { path.unshift({ x: current.x, y: current.y }); current = current.previous; } return path; }
    for (const [dir, [dx, dy]] of [[STEP, 0], [0, STEP], [-STEP, 0], [0, -STEP]].entries()) {
      const n = { x: p.x + dx, y: p.y + dy };
      if (n.x < 0 || n.x > width || n.y < 120 || n.y > height || blocked(n)) continue;
      const cost = p.g + 1 + (p.dir !== -1 && p.dir !== dir ? 2.5 : 0) + (used.has(segmentKey(p, n)) ? 30 : 0);
      const stateKey = key(n) + ',' + dir;
      if (cost >= (best.get(stateKey) ?? Infinity)) continue;
      best.set(stateKey, cost); push({ ...n, dir, g: cost, f: cost + heuristic(n), previous: p });
    }
  }
  throw new Error('Could not route the selected architecture');
}
