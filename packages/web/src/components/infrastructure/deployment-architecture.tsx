'use client';

import { useId, useMemo, useState } from 'react';
import { buildDeploymentTopology, deploymentCountSummary, isSteadyWorkload } from '@launchpilot/core/deployment-topology';
import type { DeploymentNode, DeploymentTopology, RepositoryArchitecture, GroundedArchitecturePlan, ArchitectureDesign, DesignEdit, DesignIssue } from '@launchpilot/core';
import { ArchitectureEditor } from './architecture-editor';
import { deploymentPresentation, type DeploymentCard } from './deployment-presentation';
import { Globe, ShieldCheck, Container, Database, Zap, Archive, BrainCircuit, KeyRound, Boxes, Radio, ArrowRight, X, Settings2 } from 'lucide-react';

const columns = [
  { id: 'edge', label: 'Public entry', width: 144, color: '#0f766e' },
  { id: 'routing', label: 'Routing', width: 144, color: '#0369a1' },
  { id: 'runtime', label: 'Application pods', width: 300, color: '#2563eb' },
  { id: 'data', label: 'Data & caching', width: 184, color: '#7c3aed' },
  { id: 'integration', label: 'AI & messaging', width: 184, color: '#b45309' },
  { id: 'operations', label: 'Secrets & platform', width: 184, color: '#475569' },
] as const;
const icon = (node: DeploymentNode) => node.kind === 'application' ? Container : node.kind === 'database' ? Database : node.kind === 'cache' ? Zap : node.kind === 'storage' ? Archive : /vault|secret/.test(node.kind) ? KeyRound : node.kind === 'network' ? /Front Door/.test(node.technology) ? ShieldCheck : Globe : /queue|streaming/.test(node.kind) ? Radio : node.kind === 'configuration' ? Settings2 : /^AI services$|cognitive|openai|search|speech|translator|intelligence/i.test(node.technology) ? BrainCircuit : Boxes;
const label = (basis: string) => basis === 'repository' ? 'Declared' : basis === 'recommendation' ? 'Proposed' : basis === 'user' ? 'Edited' : 'Existing dependency';
function Sources({ ids, graph }: { ids: string[]; graph: RepositoryArchitecture }) {
  const evidence = graph.evidence.filter(e => ids.includes(e.id));
  return <details className="mt-3 text-xs"><summary className="cursor-pointer font-medium">Evidence ({evidence.length})</summary><div className="mt-2 max-h-52 space-y-2 overflow-auto">{evidence.map(e => <div key={e.id} className="rounded bg-slate-50 p-2"><p className="break-all font-mono">{e.file}:{e.line}–{e.endLine}</p><p className="mt-1 text-slate-500">{e.summary}</p>{e.derivedFrom && <p className="mt-2">Rendered from: {e.derivedFrom.map(file=><a key={file} className="mt-1 block break-all text-blue-700 underline" target="_blank" rel="noreferrer" href={`${e.repoUrl}/blob/${e.revision}/${file}`}>{file}</a>)}</p>}</div>)}</div></details>;
}
export function DeploymentArchitecture({ graph, plan, unitIds, topologyOverride, design, onEdit, saving, issues = [] }: { graph: RepositoryArchitecture; plan: GroundedArchitecturePlan | null; unitIds: string[]; topologyOverride?: DeploymentTopology; design?: ArchitectureDesign; onEdit?: (edit: DesignEdit | 'undo' | 'reset') => Promise<void>; saving?: boolean; issues?: DesignIssue[] }) {
  const topology = useMemo(() => topologyOverride ?? buildDeploymentTopology(graph, unitIds, plan ?? undefined), [graph, plan, unitIds, topologyOverride]);
  const diagram = useMemo(() => deploymentPresentation(topology, graph), [topology, graph]);
  const counts = deploymentCountSummary(topology);
  const [selected, setSelected] = useState<string | null>(null), [expanded, setExpanded] = useState(false), [search, setSearch] = useState('');
  const [flow, setFlow] = useState<'traffic' | 'all'>('traffic');
  const marker = useId().replace(/:/g, '');
  const selectedCard = diagram.cards.find(n => n.id === selected || n.memberIds.includes(selected ?? ''));
  const selectedPhysical = topology.nodes.find(n => n.id === selected);
  const selectedNode = selectedPhysical ?? selectedCard;
  const workload = topology.workloads.find(w => w.id === selected);
  const members = selectedCard?.memberIds ?? [];
  const cardEdges = diagram.connections.filter(e => flow === 'all' || ![e.from, e.to].some(id => diagram.cards.find(n => n.id === id)?.layer === 'operations'));
  const edges = selectedCard ? diagram.connections.filter(e => e.from === selectedCard.id || e.to === selectedCard.id) : cardEdges;
  const neighbors = new Set([selectedCard?.id, ...edges.flatMap(e => [e.from, e.to])]);
  const physicalEdges = topology.connections.filter(e => selectedPhysical ? e.from === selected || e.to === selected : members.includes(e.from) || members.includes(e.to));
  const bundles = new Map<string, { from: string; to: string; count: number }>();
  for (const edge of cardEdges) {
    const from = diagram.cards.find(n => n.id === edge.from)?.layer, to = diagram.cards.find(n => n.id === edge.to)?.layer;
    if (!from || !to || from === to) continue;
    const key = `${from}:${to}`, bundle = bundles.get(key) ?? { from, to, count: 0 };
    bundle.count += edge.connectionIds.length; bundles.set(key, bundle);
  }
  const cardTop = 78 + bundles.size * 18;
  const positions = columns.map((c, i) => ({ ...c, x: 20 + columns.slice(0, i).reduce((n, c) => n + c.width + 24, 0) }));
  const width = positions.at(-1)!.x + positions.at(-1)!.width + 20;
  const boxes = new Map<string, { x: number; y: number; width: number; height: number }>();
  for (const column of positions) diagram.cards.filter(n => n.layer === column.id).forEach((node, i) => {
    const lanes = column.id === 'runtime' ? 2 : 1, boxWidth = (column.width - (lanes - 1) * 10);
    boxes.set(node.id, { x: column.x + (i % lanes) * (boxWidth / lanes + 10), y: cardTop + Math.floor(i / lanes) * 124, width: boxWidth / lanes, height: 110 });
  });
  const height = Math.max(510, ...[...boxes.values()].map(p => p.y + p.height + 24));
  function renderNode(node: DeploymentCard) {
    const Icon = icon(node), w = topology.workloads.find(w => w.id === node.id), box = boxes.get(node.id)!;
    const matching = `${node.name} ${node.technology} ${node.memberIds.map(id => topology.nodes.find(n => n.id === id)?.name).join(' ')}`.toLowerCase().includes(search.toLowerCase());
    const batch = w && !isSteadyWorkload(w);
    return <button key={node.id} aria-label={`Inspect ${node.name}`} onClick={() => setSelected(selected === node.id ? null : node.id)} style={{ position: 'absolute', left: box.x, top: box.y, width: box.width, height: box.height }} className={`overflow-hidden rounded-lg border bg-white p-2.5 text-left shadow-sm transition ${node.basis === 'recommendation' ? 'border-dashed border-amber-400' : 'border-slate-200'} ${selectedCard?.id === node.id ? 'ring-2 ring-blue-600' : ''} ${!matching || selectedCard && !neighbors.has(node.id) ? 'opacity-25' : ''}`}>
      <div className="flex items-start gap-2"><Icon size={19} className={`mt-0.5 shrink-0 ${node.basis === 'recommendation' ? 'text-amber-600' : 'text-blue-700'}`} /><span className="min-w-0 flex-1"><span className="line-clamp-2 block text-xs font-semibold text-slate-900">{w && node.basis !== 'user' ? w.containers.find(c => c.role === 'application')?.name ?? node.name : node.name}</span></span></div>
      {w ? <><p className="mt-2 text-[11px] font-semibold text-blue-800">{batch ? `${w.controller} · ${w.jobParallelism ?? '?'} parallel` : w.replicas === null ? 'Node count required' : `${w.replicas} pod${w.replicas === 1 ? '' : 's'}${w.maxReplicas !== undefined ? ` · HPA ${w.minReplicas}–${w.maxReplicas}` : ''}`}</p><p className="mt-1 text-[10px] text-slate-500">{w.containers.filter(c => c.role === 'application').length} container(s) / pod{w.containers.some(c => c.role === 'init') ? ' + init' : ''}</p></> : <><p className="mt-2 line-clamp-2 text-[10px] leading-4 text-slate-600">{node.details.join(' · ') || node.technology}</p><p className="mt-1 text-[9px] text-slate-500">{label(node.basis)}{node.memberIds.length > 1 ? ` · ${node.memberIds.length} resources` : ''}</p></>}
    </button>;
  }
  return <div className={expanded ? 'fixed inset-3 z-50 overflow-auto rounded-xl border bg-white p-5 shadow-2xl' : 'space-y-3'}>
    <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-sm font-semibold">{counts.applicationPods}{counts.unspecifiedWorkloads ? '+' : ''} steady-state pods · {counts.steadyWorkloads} workloads{counts.batchJobs ? ` · ${counts.batchJobs} batch jobs` : ''}</p><p className="mt-1 text-xs text-slate-500">{counts.autoscaled ? `Autoscaling range: ${counts.minPods}–${counts.maxPods}${counts.unspecifiedWorkloads ? ' known' : ''} pods. ` : ''}Counts follow the selected manifests and your saved edits.</p></div><button onClick={() => setExpanded(!expanded)} className="rounded border px-3 py-2 text-xs">{expanded ? 'Close expanded view' : 'Expand diagram'}</button></div>

    <div className="flex flex-wrap items-center gap-3 text-xs"><details className="relative"><summary className="cursor-pointer rounded border bg-white px-3 py-2 font-medium">Edit architecture</summary><div className="absolute left-0 top-10 z-20 w-[650px] max-w-[80vw] rounded-lg border bg-white p-3 shadow-lg"><ArchitectureEditor graph={graph} design={design} topology={topology} selected={selectedPhysical?.id ?? null} onEdit={onEdit} saving={saving} /></div></details><label>Connections<select aria-label="Deployment connection view" className="ml-2 rounded border bg-white p-2" value={flow} onChange={e => setFlow(e.target.value as typeof flow)}><option value="traffic">Request & data flows</option><option value="all">Include configuration flows</option></select></label>{selected && <button onClick={() => setSelected(null)} className="text-blue-700">Clear selection</button>}<input aria-label="Find deployment component" value={search} onChange={e => setSearch(e.target.value)} placeholder="Find a component" className="ml-auto w-48 rounded border px-3 py-2" /></div>
    <div className="max-h-[740px] overflow-auto rounded-xl border bg-slate-50/60" aria-label="Deployment diagram"><div style={{ width, height }} className="relative">
      {positions.map(c => <section key={c.id} style={{ position: 'absolute', left: c.x - 8, top: 12, width: c.width + 16, height: height - 24, borderTopColor: c.color }} className="rounded-xl border border-t-[3px] bg-white/40"><h3 className="px-3 py-3 text-xs font-semibold" style={{ color: c.color }}>{c.label}</h3></section>)}
      <svg width={width} height={height} className="pointer-events-none absolute inset-0" aria-label="Component connections"><defs><marker id={marker} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="#64748b" /></marker></defs>{!selectedCard && [...bundles.values()].map((bundle, i) => {
        const a = positions.find(c => c.id === bundle.from)!, b = positions.find(c => c.id === bundle.to)!, x1 = a.x+a.width/2, x2 = b.x+b.width/2, y = 60+i*18;
        return <g key={`${bundle.from}:${bundle.to}`}><title>{a.label} → {b.label}: {bundle.count} evidenced connections</title><path d={`M${x1},48 V${y} H${x2} V48`} stroke="#64748b" strokeWidth="1.2" opacity=".6" fill="none" markerEnd={`url(#${marker})`} /><rect x={(x1+x2)/2-14} y={y-8} width="28" height="16" rx="5" fill="white" /><text x={(x1+x2)/2} y={y+3} textAnchor="middle" fontSize="10" fill="#475569">{bundle.count}</text></g>;
      })}{selectedCard && edges.map(e => { const a = boxes.get(e.from), b = boxes.get(e.to); if (!a || !b) return null; const right = a.x <= b.x, x1 = right ? a.x+a.width : a.x, x2 = right ? b.x : b.x+b.width, y1=a.y+a.height/2, y2=b.y+b.height/2, bend = right ? 24 : -24; return <path key={e.id} d={`M${x1},${y1} C${x1+bend},${y1} ${x2-bend},${y2} ${x2},${y2}`} fill="none" stroke={selectedCard ? '#2563eb' : '#94a3b8'} strokeWidth={selectedCard ? 1.6 : 1} opacity={selectedCard ? .85 : .32} markerEnd={`url(#${marker})`} />; })}</svg>
      {diagram.cards.map(renderNode)}
    </div></div>
    <p className="text-xs text-slate-500">Overview arrows summarize evidenced paths between layers. Select a component to trace its exact connections, inspect sizing and edit it. Services share their workload card; supporting resources remain inside the component inspector.</p>
    {selectedNode && <aside className="fixed bottom-4 right-4 top-20 z-[60] w-[420px] max-w-[calc(100vw-32px)] overflow-auto rounded-xl border bg-white p-4 shadow-2xl" aria-label="Deployment component details"><div className="sticky -top-4 z-10 -mx-4 -mt-4 mb-4 flex items-center justify-between gap-3 border-b bg-white p-4"><h4 className="break-words font-semibold">{selectedNode.name}</h4><button onClick={() => setSelected(null)} aria-label="Close deployment details"><X size={16} /></button></div>
      <p className="text-xs text-slate-500">{label(selectedNode.basis)} · {selectedNode.owner}</p><p className="mt-2 text-sm">{selectedNode.details.join(' · ')}</p>
      {selectedPhysical && <div className="mt-3"><ArchitectureEditor graph={graph} design={design} topology={topology} selected={selectedPhysical.id} onEdit={onEdit} saving={saving} /></div>}
      {workload && <><p className="mt-3 text-xs">{workload.controller} · {isSteadyWorkload(workload) ? `${workload.replicas ?? 'Unspecified'} initial pods` : `${workload.jobParallelism ?? '?'} parallel job pods`}{workload.maxReplicas !== undefined ? ` · HPA ${workload.minReplicas}–${workload.maxReplicas}` : ''}</p><p className="mt-1 text-xs text-slate-500">{workload.countNote} · Namespace: {workload.namespace}</p><div className="mt-3 space-y-2">{workload.containers.map((c,i) => <div key={`${c.name}:${i}`} className="rounded border p-3 text-xs"><strong>{c.name}</strong> · {c.role === 'init' ? 'Init container' : 'Application container'}<p className="mt-1 break-all font-mono">{c.image}</p><p className="mt-2">Requests: {Object.entries(c.requests).map(([k,v]) => `${k} ${v}`).join(' · ') || 'Not declared'}</p><p className="mt-1">Limits: {Object.entries(c.limits).map(([k,v]) => `${k} ${v}`).join(' · ') || 'Not declared'}</p></div>)}</div></>}
      {members.length > 1 && <details className="mt-4 text-xs" open={!selectedPhysical}><summary className="cursor-pointer font-medium">Resources in this component ({members.length})</summary><div className="mt-2 space-y-1">{members.map(id => { const n=topology.nodes.find(n => n.id === id)!; return <button key={id} className="block w-full rounded border p-2 text-left" onClick={() => setSelected(id)}>{n.name}<span className="mt-1 block text-slate-500">{n.technology}</span></button>; })}</div></details>}
      <details className="mt-4 text-xs" open><summary className="cursor-pointer font-medium">Connections ({physicalEdges.length})</summary><div className="mt-2 max-h-72 space-y-2 overflow-auto">{physicalEdges.map(e => <details key={e.id} className="rounded border p-2"><summary className="cursor-pointer">{topology.nodes.find(n=>n.id===e.from)?.name} <ArrowRight size={12} className="inline" /> {topology.nodes.find(n=>n.id===e.to)?.name}</summary><p className="mt-1">{e.purpose}</p><Sources ids={e.evidenceIds} graph={graph} /></details>)}</div></details>
      <Sources ids={selectedNode.evidenceIds} graph={graph} />
    </aside>}
    <details className="text-xs"><summary className="cursor-pointer text-slate-600">Deployment inventory and coverage</summary><div className="mt-3 space-y-3">
      <p>{topology.owner}. {topology.nodes.length} resource declarations represented by {diagram.cards.length} diagram cards. Grouping does not change resource or pod counts.</p>
      <div className="overflow-x-auto"><table className="w-full text-left"><thead><tr className="border-b"><th className="p-2">Workload</th><th className="p-2">Pods / execution</th><th className="p-2">Containers per pod</th><th className="p-2">Source</th></tr></thead><tbody>{topology.workloads.map(w => <tr key={w.id} className="border-b"><td className="p-2"><button className="text-blue-700 underline" onClick={()=>setSelected(w.id)}>{w.name}</button></td><td className="p-2">{isSteadyWorkload(w) ? w.replicas ?? 'Node count needed' : `${w.controller}: ${w.jobParallelism ?? '?'} parallel`}{w.maxReplicas !== undefined ? ` (HPA ${w.minReplicas}–${w.maxReplicas})` : ''}</td><td className="p-2">{w.containers.filter(c=>c.role==='application').length} app · {w.containers.filter(c=>c.role==='init').length} init</td><td className="break-all p-2 font-mono">{w.file}</td></tr>)}</tbody></table></div>
      {[...topology.limitations, ...issues.map(i=>i.message)].map((note,i)=><p key={i} className="text-slate-500">{note}</p>)}
      <details><summary className="cursor-pointer">Platform ownership and recommendations</summary><div className="mt-3 space-y-3">{topology.controls.map(c=><details key={c.id}><summary className="cursor-pointer font-medium">{c.name} · {c.decision}</summary><p className="mt-2">{c.recommendation}</p><p className="mt-1 text-slate-500">{c.rationale}</p><Sources ids={c.evidenceIds} graph={graph} /></details>)}</div></details>
    </div></details>
  </div>;
}
