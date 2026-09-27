'use client';

import { useEffect, useMemo, useState } from 'react';
import { ReactFlow, Background, Controls, Handle, Position, BaseEdge, EdgeLabelRenderer, MarkerType, type Node, type Edge, type NodeProps, type EdgeProps } from '@xyflow/react';
import { layoutArchitecture, traceArchitectureColumns, type DiagramPort } from './architecture-layout';
import { connectionCategory } from './architecture-groups';
import { Database, Server, KeyRound, Fingerprint, Globe, Network, Archive, Layers, Radio, Waypoints, Settings2, Loader2, Vault, ShieldCheck, Container, LockKeyhole, Activity, Boxes, Workflow, Zap, BrainCircuit } from 'lucide-react';
import '@xyflow/react/dist/style.css';

export interface ArchitectureItem { id: string; name: string; kind: string; technology: string; basis: string; facets?: string[]; memberIds?: string[] }
export interface ArchitectureLink { id: string; from: string; to: string; relationship: string; basis: string }
type Flow = 'traffic' | 'configuration' | 'identity' | 'platform';
type Point = { x: number; y: number };
const icons: Record<string, typeof Server> = { application: Server, database: Database, cache: Layers, vault: KeyRound, secret: KeyRound, identity: Fingerprint, storage: Archive, queue: Waypoints, streaming: Radio, network: Network, configuration: Settings2, service: Server, unknown: Layers, module: Layers };
const flowColors: Record<Flow, string> = { traffic: '#2563eb', configuration: '#b45309', identity: '#0f766e', platform: '#7c3aed' };
const stages = [
  { name: 'Entry & routing', detail: 'Domains · ingress · services', color: '#0f766e' },
  { name: 'Application runtime', detail: 'Containers · application workloads', color: '#2563eb' },
  { name: 'Data services', detail: 'Databases · caches · object storage', color: '#7c3aed' },
  { name: 'AI & integration', detail: 'AI capabilities · messaging · events', color: '#b45309' },
  { name: 'Configuration & access', detail: 'Secret delivery · settings · identities', color: '#a16207' },
  { name: 'Platform & operations', detail: 'Delivery · networking · monitoring', color: '#475569' },
];

function stageFor(item: ArchitectureItem): number {
  const tech = item.technology;
  if (/\/Ingress$|ingress routing|\/Service$/i.test(tech)) return 0;
  if (item.kind === 'application') return 1;
  if (['database', 'cache', 'storage'].includes(item.kind) || /PersistentVolume/.test(tech)) return 2;
  if (['service', 'queue', 'streaming'].includes(item.kind) || /storage-event-route/.test(tech)) return 3;
  if (/ServiceAccount|SecretProviderClass|Secret$|ConfigMap|CSI-synchronized/i.test(tech) || ['configuration', 'secret', 'identity', 'vault'].includes(item.kind)) return 4;
  return 5;
}
function rowFor(item: ArchitectureItem): number {
  if (/managed identity|ServiceAccount/i.test(item.technology)) return 2;
  if (/SecretProviderClass|CSI-synchronized|Key Vault|Infrastructure pipeline/i.test(item.technology) || ['vault', 'secret', 'cache'].includes(item.kind)) return 1;
  if (item.kind === 'storage' || item.kind === 'registry') return 2;
  return 0;
}

function iconFor(item: ArchitectureItem) {
  const tech = item.technology;
  if (/\/Ingress$|ingress routing/i.test(tech)) return Globe;
  if (/\/Service$/.test(tech)) return Waypoints;
  if (/SecretProviderClass/.test(tech)) return LockKeyhole;
  if (/ServiceAccount/.test(tech)) return ShieldCheck;
  if (/CSI-synchronized|\/Secret$/.test(tech)) return KeyRound;
  if (/managed identity/i.test(tech)) return Fingerprint;
  if (/Infrastructure pipeline/i.test(tech)) return Workflow;
  if (/Key Vault/i.test(tech) || item.kind === 'vault') return Vault;
  if (/Container Registry/i.test(tech) || item.kind === 'registry') return Boxes;
  if (item.kind === 'network') return Network;
  if (/AI &|openai|speech|translator|document-intelligence|azure-search/i.test(item.name + ' ' + tech)) return BrainCircuit;
  if (/Container Apps|Deployment|StatefulSet|DaemonSet|Cortex container/.test(tech)) return Container;
  if (item.kind === 'observability') return Activity;
  if (item.kind === 'cache') return Zap;
  return icons[item.kind] ?? Layers;
}

function StageNode({ data }: NodeProps) {
  const stage = (data.column as typeof stages[number] | undefined) ?? stages[data.stage as number];
  return <div className="h-full w-full rounded-2xl border" style={{ background: stage.color + '04', borderColor: stage.color + '22' }}>
    <div className="flex h-[75px] items-center gap-3 border-b px-4" style={{ borderColor: stage.color + '16' }}>
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-bold" style={{ color: stage.color, background: stage.color + '10' }}>{String(Number(data.order) + 1).padStart(2, '0')}</span>
      <div><div className="text-[14px] font-semibold text-slate-800">{stage.name}</div><div className="mt-1 text-[10px] text-slate-500">{stage.detail}</div></div>
    </div>
  </div>;
}

function labelFor(item: ArchitectureItem): { role: string; detail: string } {
  if (/ingress routing/i.test(item.technology)) return { role: 'HTTP entry point', detail: item.technology };
  if (/components · select/.test(item.technology)) return { role: 'Component group', detail: item.technology };
  const kube = item.technology.split('/').at(-1)!;
  if (['Ingress', 'Service', 'Deployment', 'StatefulSet', 'DaemonSet', 'Pod', 'Job', 'CronJob', 'ServiceAccount', 'SecretProviderClass', 'Secret', 'ConfigMap', 'PersistentVolumeClaim'].includes(kube)) {
    const roles: Record<string, string> = { Ingress: 'HTTP entry point', Service: 'Service routing', Deployment: 'Application workload', ServiceAccount: 'Workload identity', SecretProviderClass: 'Key Vault CSI provider', Secret: 'Kubernetes Secret', ConfigMap: 'Application configuration', PersistentVolumeClaim: 'Persistent storage' };
    return { role: roles[kube] ?? kube, detail: `Kubernetes ${kube}` };
  }
  if (item.kind === 'network') return { role: 'Network & DNS', detail: /Azure/i.test(item.technology) ? 'Azure networking & private DNS' : item.technology };
  if (item.kind === 'observability') return { role: 'Monitoring & logs', detail: /Azure/i.test(item.technology) ? 'Azure Monitor & Log Analytics' : item.technology };
  if (/CSI-synchronized/.test(item.technology)) return { role: 'Kubernetes Secret', detail: 'Synced from Key Vault' };
  if (/Infrastructure pipeline/i.test(item.technology)) return { role: 'Configuration delivery', detail: 'Pipeline → Key Vault → workload' };
  if (/Azure Key Vault/i.test(item.technology)) return { role: 'Secret store', detail: 'Azure Key Vault' };
  if (/managed identity/i.test(item.technology)) return { role: 'Managed identity', detail: item.technology.replace(/ reference$/, '') };
  if (/Container Apps/i.test(item.technology)) return { role: 'Application workload', detail: 'Azure Container Apps' };
  if (/PostgreSQL/i.test(item.technology)) return { role: 'PostgreSQL database', detail: /Azure/i.test(item.technology) ? 'Azure Database for PostgreSQL' : item.technology };
  if (/Managed Redis/i.test(item.technology)) return { role: 'Redis cache', detail: 'Azure Managed Redis' };
  if (/Container Registry/i.test(item.technology)) return { role: 'Container registry', detail: 'Azure Container Registry' };
  const role = item.kind === 'application' ? 'Application workload' : item.kind === 'service' ? 'Service / client' : item.kind.replace(/-/g, ' ');
  return { role: role.charAt(0).toUpperCase() + role.slice(1), detail: item.technology };
}

function ComponentNode({ data }: NodeProps) {
  const item = data.item as ArchitectureItem;
  const selected = data.active as boolean;
  const { role, detail } = labelFor(item);
  const Icon = iconFor(item);
  const color = stages[stageFor(item)].color;
  return <div className="h-full w-full overflow-hidden rounded-xl bg-white shadow-sm" style={{ border: `${selected ? 2.5 : 1.5}px ${item.basis === 'recommendation' ? 'dashed' : 'solid'} ${selected ? '#0f172a' : '#cbd5e1'}` }}>
    {(data.ports as DiagramPort[]).map(port => <Handle key={port.id} type={port.type} position={port.side === 'left' ? Position.Left : Position.Right} id={port.id} style={{ top: port.y }} className="!h-1.5 !w-1.5 !border-white !bg-slate-400" />)}
    <div className="flex items-center gap-2.5 border-b border-slate-100 px-3 py-2.5" style={{ background: color + '08' }}>
      <div className="rounded-lg p-2" style={{ color, background: color + '12' }}><Icon size={25} strokeWidth={1.8} /></div>
      <span className="line-clamp-1 text-[12px] font-semibold tracking-wide" style={{ color }}>{role}</span>
    </div>
    <div className="px-3 pb-2.5 pt-2"><div className="truncate text-[14px] font-semibold text-slate-900" title={item.name}>{item.name}</div>
      <div className="mt-1 line-clamp-2 text-[11px] leading-4 text-slate-500" title={item.facets?.length ? item.facets.join(' · ') : detail}>{item.facets && (item.facets.length > 1 || /components · select/.test(item.technology)) ? item.facets.join(' · ') : detail}</div>
      <div className="mt-2 flex items-center gap-1.5 text-[9px] font-medium uppercase tracking-wide text-slate-400"><span className="h-1.5 w-1.5 rounded-full" style={{ background: item.basis === 'recommendation' ? '#d97706' : item.basis === 'external' ? '#64748b' : '#2563eb' }} />{item.basis === 'repository' || item.basis === 'declared' ? 'Source-backed component' : item.basis === 'recommendation' ? 'Recommended addition' : item.basis === 'code' ? 'Code observation' : 'External dependency'}</div>
    </div>
  </div>;
}
function RoutedEdge({ id, data, markerEnd, selected }: EdgeProps) {
  const points = data?.points as Point[] | undefined;
  if (!points?.length) return null;
  const path = points.map((p, i) => `${i ? 'L' : 'M'} ${p.x} ${p.y}`).join(' ');
  const color = flowColors[data?.flow as Flow] ?? '#64748b';
  const label = data?.label as { text: string; x: number; y: number } | undefined;
  return <><BaseEdge id={id} path={path} markerEnd={markerEnd} style={{ stroke: color, strokeWidth: selected ? 2.7 : 1.6, strokeLinejoin: 'round', strokeDasharray: data?.flow === 'traffic' ? undefined : '5 4', opacity: data?.dim ? .12 : .8 }} interactionWidth={18} />
    {label && !data?.dim && <EdgeLabelRenderer><button className="nodrag nopan absolute whitespace-nowrap rounded-md border bg-white px-2 py-1 text-[10px] font-medium shadow-sm" style={{ color, borderColor: color + '30', transform: `translate(-50%, -50%) translate(${label.x}px, ${label.y}px)`, pointerEvents: 'all' }} onClick={() => (data?.select as (id: string) => void)(id)}>{label.text}</button></EdgeLabelRenderer>}
  </>;
}
const nodeTypes = { component: ComponentNode, stage: StageNode };
const edgeTypes = { routed: RoutedEdge };

/** Display data-flow direction where the source observation is worded as a dependency. */
function route(link: ArchitectureLink, items: ArchitectureItem[]) {
  const text = link.relationship;
  const source = items.find(i => i.id === link.from), target = items.find(i => i.id === link.to);
  const dataCall = ['database', 'cache', 'queue', 'streaming'].includes(target?.kind ?? '') && /connect|traffic|client|using/i.test(text);
  const isIdentity = /^(uses identity|authenticates|grants|assigns|identity \()/i.test(text);
  const isPlatform = !isIdentity && (/registry|observability|network/.test(target?.kind ?? '') || /startup dependency|mounts storage/i.test(text));
  const isConfig = !dataCall && /secret|configuration|configures|supplies|environment|CSI|mounts|DATABASE_URL|REDIS_URL|KEY_VAULT_URL/i.test(text);
  const reverse = /^(loads |reads |mounts secrets|uses identity|authenticates using)/i.test(text);
  const flow: Flow = isIdentity ? 'identity' : isPlatform ? 'platform' : isConfig ? 'configuration' : connectionCategory(text);
  let label = text;
  if (/routes HTTP/.test(text)) label = 'HTTP route';
  else if (/selects pods/.test(text)) label = 'Service → pods';
  else if (/loads (\w+)/.test(text)) label = /loads (\w+)/.exec(text)![1];
  else if (/synchronizes secret/.test(text)) label = 'Secret sync';
  else if (/supplies CSI/.test(text)) label = 'Secret retrieval';
  else if (/mounts secrets/.test(text)) label = 'CSI mount';
  else if (isIdentity) label = /AcrPull/i.test(text) ? 'AcrPull' : /RBAC/i.test(text) ? 'Secret read permission' : 'Workload identity';
  else if (dataCall) label = (/postgres/i.test(text) ? 'PostgreSQL' : /redis/i.test(text) ? 'Redis' : 'Data connection') + (/TLS|rediss:/i.test(text) ? ' · TLS' : '');
  else if (/connects using/.test(text)) label = text.match(/\(([^)]+)\)/)?.[1].toUpperCase() ?? 'Connection';
  else if (/startup dependency/.test(text)) label = 'Startup order';
  else if (/mounts storage/.test(text)) label = 'Persistent volume';
  else if (label.length > 30) label = /logs|metrics|telemetry/i.test(text) ? 'Logs & telemetry' : /private|VNet/i.test(text) && isPlatform ? 'Private connectivity' : flow === 'configuration' ? 'Configuration / secrets' : /image|registry|build/i.test(label) ? 'Image delivery' : `${label.slice(0, 27)}…`;
  return { ...link, from: reverse ? link.to : link.from, to: reverse ? link.from : link.to, flow, label };
}

export function ArchitectureCanvas({ items, links, focusId, selected, onSelect, height = 640 }: { items: ArchitectureItem[]; links: ArchitectureLink[]; focusId?: string; selected: string | null; onSelect: (id: string) => void; height?: number | string }) {
  const [flow, setFlow] = useState<'all' | Flow>('traffic');
  const [layout, setLayout] = useState<{ nodes: Node[]; edges: Edge[]; key: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const topology = JSON.stringify({ items, links, focusId });
  const focusKind = items.find(item => item.id === focusId)?.kind;
  useEffect(() => { setFlow(['configuration', 'secret', 'vault'].includes(focusKind ?? '') ? 'configuration' : 'traffic'); }, [focusId, focusKind]);
  useEffect(() => {
    let cancelled = false;
    const input: { items: ArchitectureItem[]; links: ArchitectureLink[]; focusId?: string } = JSON.parse(topology);
    const ids = new Set(input.items.map(i => i.id));
    const routes = input.links.filter(e => ids.has(e.from) && ids.has(e.to) && e.from !== e.to).map(e => route(e, input.items)).filter(e => flow === 'all' || e.flow === flow);
    const visible = new Set([input.focusId, ...routes.flatMap(e => [e.from, e.to])]);
    const layoutItems = input.focusId ? input.items.filter(item => visible.has(item.id)) : input.items;
    const trace = input.focusId ? traceArchitectureColumns(layoutItems, routes, input.focusId) : undefined;
    setError(null);
    try {
      const result = layoutArchitecture(trace?.items ?? layoutItems.map(item => ({ id: item.id, stage: stageFor(item), row: rowFor(item) })), routes);
      if (!cancelled) setLayout({ key: topology,
        nodes: [
          ...result.stages.map(band => ({ id: `stage-${band.stage}`, type: 'stage', position: { x: band.x, y: band.y }, width: band.width, height: band.height, data: { stage: band.stage, order: band.order, column: trace?.columns[band.stage] }, selectable: false, draggable: false, connectable: false, focusable: false, zIndex: -10, style: { pointerEvents: 'none' as const } })),
          ...result.nodes.map(n => ({ id: n.id, type: 'component', position: { x: n.x, y: n.y }, width: n.width, height: n.height, data: { item: input.items.find(i => i.id === n.id), ports: n.ports } })),
        ],
        edges: result.edges.map(e => ({ id: e.id, source: e.from, target: e.to, sourceHandle: e.sourceHandle, targetHandle: e.targetHandle, type: 'routed', markerEnd: { type: MarkerType.ArrowClosed, color: flowColors[e.flow], width: 16, height: 16 }, data: { points: e.points, flow: e.flow, label: e.labelPosition ? { text: e.label, x: e.labelPosition.x, y: e.labelPosition.y } : undefined } })),
      });
    } catch { setError('Layout could not be calculated. Use the component list to inspect this scope.'); }
    return () => { cancelled = true; };
  }, [topology, flow]);
  const nodes = useMemo(() => layout?.nodes.map(n => ({ ...n, data: { ...n.data, active: selected === n.id } })) ?? [], [layout, selected]);
  const edges = useMemo(() => layout?.edges.map(e => ({ ...e, selected: selected === e.id, data: { ...e.data, dim: flow !== 'all' && e.data?.flow !== flow || !!selected && selected !== e.id && selected !== e.source && selected !== e.target, select: onSelect } })) ?? [], [layout, flow, selected, onSelect]);
  return <div className="flex min-w-0 flex-col bg-slate-50/50" style={{ height }}>
    <div className="flex flex-wrap items-center gap-1 border-b bg-white px-3 py-2" aria-label="Architecture connection views">{(['all', 'traffic', 'configuration', 'identity', 'platform'] as const).map(value => <button key={value} onClick={() => setFlow(value)} className={`rounded-md px-3 py-1.5 text-[11px] font-medium ${flow === value ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-100'}`}>{({ all: 'All connections', traffic: 'Service dependencies', configuration: 'Secrets & configuration', identity: 'Identity & access', platform: 'Platform & delivery' })[value]}</button>)}</div>
    <div className="relative min-h-0 flex-1">{error ? <p className="p-8 text-sm">{error}</p> : !layout || layout.key !== topology ? <div className="flex h-full items-center justify-center gap-2 text-sm text-slate-500"><Loader2 size={16} className="animate-spin" /> Arranging deployment flows…</div> : <ReactFlow key={`${layout.key}:${height}:${Boolean(selected)}`} nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} fitView fitViewOptions={{ padding: .05, minZoom: .6, maxZoom: 1.1 }} minZoom={.12} maxZoom={2} nodesDraggable={false} nodesConnectable={false} onNodeClick={(_, node) => { if (node.type === 'component') onSelect(node.id); }} onEdgeClick={(_, edge) => onSelect(edge.id)} proOptions={{ hideAttribution: true }}><Background gap={24} size={1} color="#d8e0ea" /><Controls showInteractive={false} /></ReactFlow>}</div>
    <div className="border-t bg-white px-4 py-2 text-[10px] text-slate-400">Read the layers from left to right; follow arrowheads for direction. Blue: service dependencies · Amber: secrets · Teal: identity · Purple: platform. Select a card or connector for evidence.</div>
  </div>;
}
