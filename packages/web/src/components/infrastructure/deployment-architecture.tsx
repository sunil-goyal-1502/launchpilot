'use client';

import { useMemo, useState } from 'react';
import { buildDeploymentTopology } from '@launchpilot/core/deployment-topology';
import type { DeploymentNode, DeploymentTopology, RepositoryArchitecture, GroundedArchitecturePlan, ArchitectureDesign, DesignEdit, DesignIssue } from '@launchpilot/core';
import { ArchitectureEditor } from './architecture-editor';
import { Globe, ShieldCheck, Network, Container, Database, Zap, Archive, BrainCircuit, KeyRound, Boxes, GitBranch, Radio, ArrowRight, X, Settings2 } from 'lucide-react';

const columns = [
  { id: 'edge', label: 'Public entry', detail: 'Edge protection', width: 192, color: '#0f766e' },
  { id: 'routing', label: 'Gateway & routing', detail: 'Traffic into the cluster', width: 208, color: '#0369a1' },
  { id: 'runtime', label: 'Application pods', detail: 'Separate deployment units', width: 356, color: '#2563eb' },
  { id: 'data', label: 'Data & caching', detail: 'State and persistence', width: 232, color: '#7c3aed' },
  { id: 'integration', label: 'AI & messaging', detail: 'Managed capabilities', width: 232, color: '#b45309' },
  { id: 'operations', label: 'Secrets & platform', detail: 'Configuration delivery', width: 250, color: '#475569' },
] as const;
const icon = (node: DeploymentNode) => node.kind === 'application' ? Container : node.kind === 'database' ? Database : node.kind === 'cache' ? Zap : node.kind === 'storage' ? Archive : /vault|secret/.test(node.kind) ? KeyRound : node.kind === 'network' ? /Front Door/.test(node.technology) ? ShieldCheck : Globe : /queue|streaming/.test(node.kind) ? Radio : node.kind === 'configuration' ? Settings2 : /openai|search|speech|translator|intelligence/.test(node.technology) ? BrainCircuit : Boxes;
const label = (basis: string) => basis === 'repository' ? 'Declared' : basis === 'recommendation' ? 'Proposed' : basis === 'user' ? 'Edited by you' : 'External';

function Sources({ ids, graph }: { ids: string[]; graph: RepositoryArchitecture }) {
  const evidence = graph.evidence.filter(e => ids.includes(e.id));
  return <details className="mt-3 text-xs"><summary className="cursor-pointer font-medium">Repository evidence ({evidence.length})</summary><div className="mt-2 max-h-52 space-y-2 overflow-auto">{evidence.map(e => <div key={e.id} className="rounded bg-slate-50 p-2"><p className="break-all font-mono">{e.file}:{e.line}–{e.endLine}</p><p className="mt-1 text-slate-500">{e.summary}</p></div>)}</div></details>;
}

export function DeploymentArchitecture({ graph, plan, unitIds, topologyOverride, design, onEdit, saving, issues = [] }: { graph: RepositoryArchitecture; plan: GroundedArchitecturePlan | null; unitIds: string[]; topologyOverride?: DeploymentTopology; design?: ArchitectureDesign; onEdit?: (edit: DesignEdit | 'undo' | 'reset') => Promise<void>; saving?: boolean; issues?: DesignIssue[] }) {
  const topology = useMemo(() => topologyOverride ?? buildDeploymentTopology(graph, unitIds, plan ?? undefined), [graph, plan, unitIds, topologyOverride]);
  const [selected, setSelected] = useState<string | null>(null);
  const [flow, setFlow] = useState<'traffic' | 'configuration' | 'all'>('traffic');
  const [expanded, setExpanded] = useState(false);
  const [search, setSearch] = useState('');
  const selectedNode = topology.nodes.find(n => n.id === selected);
  const workload = topology.workloads.find(w => w.id === selected);
  const category = (edge: DeploymentTopology['connections'][number]) => /secret|configuration|supplies|mounts|publishes/i.test(edge.purpose) ? 'configuration' : 'traffic';
  const relevant = topology.connections.filter(e => (flow === 'all' || category(e) === flow) && (!selectedNode || e.from === selected || e.to === selected));
  const neighbors = new Set([selected, ...relevant.flatMap(e => [e.from, e.to])]);
  const positions = columns.map((column, index) => ({ ...column, x: 20 + columns.slice(0, index).reduce((n, c) => n + c.width + 26, 0) }));
  const width = positions.at(-1)!.x + positions.at(-1)!.width + 20;
  const bundles = new Map<string, { from: number; to: number; edges: typeof relevant }>();
  for (const edge of relevant) {
    const from = columns.findIndex(c => c.id === topology.nodes.find(n => n.id === edge.from)?.layer);
    const to = columns.findIndex(c => c.id === topology.nodes.find(n => n.id === edge.to)?.layer);
    if (from < 0 || to < 0 || from === to) continue;
    const key = `${from}:${to}:${category(edge)}`;
    const bundle = bundles.get(key) ?? { from, to, edges: [] }; bundle.edges.push(edge); bundles.set(key, bundle);
  }
  const selectedBundle = selected?.startsWith('bundle:') ? bundles.get(selected.slice(7)) : undefined;
  const connectors = [...bundles.entries()];
  const railHeight = Math.max(116, connectors.length * 23 + 28);
  const renderNode = (node: DeploymentNode) => {
    const Icon = icon(node), w = topology.workloads.find(w => w.id === node.id);
    const matches = `${node.name} ${node.technology}`.toLowerCase().includes(search.toLowerCase());
    return <button key={node.id} aria-label={`Inspect ${node.name}`} onClick={() => setSelected(selected === node.id ? null : node.id)} className={`w-full min-w-0 rounded-lg border bg-white p-3 text-left transition ${node.basis === 'recommendation' ? 'border-dashed border-amber-400' : 'border-slate-200'} ${selected === node.id ? 'ring-2 ring-blue-600' : ''} ${!matches || selectedNode && !neighbors.has(node.id) ? 'opacity-35' : ''}`}>
      <div className="flex items-start gap-2"><Icon size={20} className={`mt-0.5 shrink-0 ${node.basis === 'recommendation' ? 'text-amber-600' : 'text-blue-700'}`} /><div className="min-w-0 flex-1"><p className="break-words text-xs font-semibold text-slate-900">{w && node.basis !== 'user' ? w.containers.find(c => c.role === 'application')?.name ?? node.name : node.name}</p><p className="mt-1 text-[10px] leading-4 text-slate-500">{w ? `${w.containers.filter(c => c.role === 'application').length} app container${w.containers.filter(c => c.role === 'application').length === 1 ? '' : 's'} per pod` : node.technology}</p></div></div>
      {w ? <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px]"><span className="rounded bg-blue-50 px-1.5 py-0.5 font-semibold text-blue-800">{w.replicas === null ? 'Count unspecified' : `${w.replicas} replicas`}</span>{w.containers.some(c => c.role === 'init') && <span className="rounded bg-violet-50 px-1.5 py-0.5 text-violet-800">+ init container</span>}<span className="text-slate-500">{w.servicePort ? `:${w.servicePort}` : ''}</span></div> : node.details.length > 0 && <p className="mt-2 text-[10px] leading-4 text-slate-600">{node.details.join(' · ')}</p>}
      {!w && <p className={`mt-2 text-[9px] font-medium uppercase tracking-wide ${node.basis === 'recommendation' ? 'text-amber-700' : node.basis === 'user' ? 'text-emerald-700' : 'text-slate-400'}`}>{label(node.basis)}</p>}
    </button>;
  };
  return <div className={expanded ? 'fixed inset-3 z-50 overflow-auto rounded-xl border bg-white p-5 shadow-2xl' : 'space-y-4'}>
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-lg font-semibold">Proposed deployment architecture</h3><p className="mt-1 text-xs text-slate-500">{topology.owner}</p></div><button onClick={() => setExpanded(!expanded)} className="rounded-md border px-3 py-2 text-xs">{expanded ? 'Close expanded view' : 'Expand deployment diagram'}</button></div>
    <details className="mb-3 rounded-lg border bg-slate-50/50 p-3"><summary className="cursor-pointer text-sm font-medium">Edit components and connections</summary><div className="mt-3"><ArchitectureEditor graph={graph} design={design} topology={topology} selected={selected} onEdit={onEdit} saving={saving} /></div></details>
    {issues.length > 0 && <details className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs"><summary className="cursor-pointer font-semibold">{issues.filter(i => i.severity === 'blocker').length} implementation requirements · {issues.filter(i => i.severity === 'warning').length} design checks</summary><ul className="mt-2 space-y-2">{issues.map(issue => <li key={issue.id}>{issue.message}</li>)}</ul></details>}
    <p className="mb-3 text-xs text-slate-500">{topology.totals.workloads} workloads · {topology.totals.applicationPods} known pod replicas · {topology.totals.initContainers} init-container definitions{topology.totals.unspecifiedWorkloads ? ` · ${topology.totals.unspecifiedWorkloads} replica counts need input` : ''}</p>
    <div className="mb-3 flex flex-wrap items-center gap-2">{(['traffic', 'configuration', 'all'] as const).map(f => <button key={f} onClick={() => { setFlow(f); if (selected?.startsWith('bundle:')) setSelected(null); }} className={`rounded-md px-3 py-2 text-xs ${f === flow ? 'bg-slate-900 text-white' : 'border bg-white text-slate-600'}`}>{f === 'traffic' ? 'Request & data flows' : f === 'configuration' ? 'Secret & configuration flows' : 'All flows'}</button>)}{selected && <button onClick={() => setSelected(null)} className="px-2 text-xs text-blue-700">Clear selection</button>}<input aria-label="Find deployment component" value={search} onChange={e => setSearch(e.target.value)} placeholder="Find a deployment component" className="ml-auto w-60 rounded-md border px-3 py-2 text-xs" /></div>
    <div className="overflow-x-auto rounded-xl border bg-slate-50/60" aria-label="Deployment diagram">
      <div style={{ width, minHeight: 600 }} className="relative pb-5">
        <svg width={width} height={railHeight + 8} role="img" aria-label="Connections between deployment layers" className="block overflow-visible"><defs><marker id="deploy-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill={flow === 'configuration' ? '#b45309' : '#2563eb'} /></marker></defs>
          {connectors.map(([key, bundle], index) => {
            const start = positions[bundle.from], end = positions[bundle.to];
            const x1 = start.x + start.width / 2 + index * 3, x2 = end.x + end.width / 2 + index * 3, y = 22 + index * 23;
            return <g key={key} role="button" tabIndex={0} aria-label={`${columns[bundle.from].label} to ${columns[bundle.to].label}: ${bundle.edges.length} connections`} onClick={() => setSelected(`bundle:${key}`)} onKeyDown={event => { if (event.key === 'Enter') setSelected(`bundle:${key}`); }} className="cursor-pointer"><path d={`M${x1},${railHeight} V${y} H${x2} V${railHeight}`} fill="none" stroke={category(bundle.edges[0]) === 'configuration' ? '#b45309' : '#2563eb'} strokeWidth={selected === `bundle:${key}` ? 3 : 1.4} opacity={selectedBundle && selectedBundle !== bundle ? .2 : .6} markerEnd="url(#deploy-arrow)" /><rect x={(x1 + x2) / 2 - 99} y={y - 9} width={198} height={18} rx={5} fill="white" /><text x={(x1 + x2) / 2} y={y + 3} fontSize={10} textAnchor="middle" fill="#475569">{columns[bundle.from].label} → {columns[bundle.to].label} · {bundle.edges.length}</text></g>;
          })}
        </svg>
        <div className="flex items-start gap-[26px] px-5">{columns.map(column => {
          const members = topology.nodes.filter(n => n.layer === column.id);
          const secrets = members.filter(n => n.kind === 'secret' || n.kind === 'configuration');
          const shown = members.filter(n => !secrets.includes(n));
          return <section key={column.id} style={{ width: column.width, borderTopColor: column.color }} className="shrink-0 rounded-xl border border-t-[3px] bg-white/70 p-3"><header className="mb-3 border-b pb-3"><p className="text-xs font-semibold uppercase tracking-wide" style={{ color: column.color }}>{column.label}</p><p className="mt-1 text-[10px] text-slate-500">{column.detail}</p></header>
            {column.id === 'runtime' && <div className="mb-3 rounded-md border border-blue-200 bg-blue-50 px-2 py-2 text-[10px] text-blue-900"><p className="flex items-center gap-1 font-semibold"><Network size={14} /> Kubernetes namespace boundary</p><p className="mt-1 break-all">{topology.namespaces.join(' · ') || 'Placement not declared'}</p><p className="mt-1">Each tile is one pod template; replicas repeat that template.</p></div>}
            <div className={column.id === 'runtime' ? 'grid grid-cols-2 items-start gap-2' : 'space-y-2'}>{shown.map(renderNode)}</div>
            {secrets.length > 0 && <details className="mt-2 rounded-lg border bg-white p-3" open={!!selected && secrets.some(n => neighbors.has(n.id))}><summary className="cursor-pointer text-xs font-semibold"><KeyRound size={16} className="mr-1 inline text-amber-700" /> Configuration delivery ({secrets.length})</summary><div className="mt-2 space-y-2">{secrets.map(renderNode)}</div></details>}
            {!members.length && <p className="py-3 text-xs leading-5 text-slate-500">No resource selected in this layer. See the decisions below.</p>}
          </section>;
        })}</div>
      </div>
    </div>
    <p className="mt-2 text-xs text-slate-500">Read left to right. Connectors bundle actual dependency paths between layers; select a connector for every underlying path. Select a pod or service to trace its dependencies. Dashed borders mark proposed additions.</p>
    {(selectedNode || selectedBundle) && <aside className="fixed bottom-4 right-4 top-20 z-[60] w-[420px] max-w-[calc(100vw-32px)] overflow-auto rounded-xl border bg-white p-4 shadow-2xl" aria-label="Deployment component details"><div className="sticky -top-4 z-10 -mx-4 -mt-4 mb-4 flex items-center justify-between gap-3 border-b bg-white p-4"><h4 className="break-all font-semibold">{selectedNode?.name ?? 'Connections between deployment layers'}</h4><button onClick={() => setSelected(null)} aria-label="Close deployment details"><X size={16} /></button></div>
      {selectedNode && <><p className="mt-1 text-xs text-slate-500">{label(selectedNode.basis)} · Owner: {selectedNode.owner}</p><p className="mt-2 text-sm">{selectedNode.details.join(' · ')}</p></>}
      {workload && <><p className="mt-3 text-xs">{workload.controller} · Namespace {workload.namespace} · {workload.replicas ?? 'Unspecified'} replicas{workload.maxReplicas ? ` · HPA ${workload.minReplicas ?? '?'}–${workload.maxReplicas}` : ''}</p><div className="mt-3 grid gap-2 sm:grid-cols-2">{workload.containers.map((c, i) => <div key={`${c.name}:${i}`} className="rounded-lg border p-3 text-xs"><strong>{c.name}</strong><span className="ml-2 rounded bg-slate-100 px-2 py-1">{c.role === 'init' ? 'Init · runs before app' : 'Application container'}</span><p className="mt-2 break-all font-mono">{c.image}</p><p className="mt-2">Requests: {Object.entries(c.requests).map(([k, v]) => `${k} ${v}`).join(' · ') || 'not declared'}</p><p className="mt-1">Limits: {Object.entries(c.limits).map(([k, v]) => `${k} ${v}`).join(' · ') || 'not declared'}</p></div>)}</div></>}
      <div className="mt-4 max-h-64 space-y-2 overflow-auto">{(selectedBundle?.edges ?? relevant).map(e => <details key={e.id} className="rounded border p-2 text-xs"><summary className="cursor-pointer">{topology.nodes.find(n => n.id === e.from)?.name} <ArrowRight size={12} className="inline" /> {topology.nodes.find(n => n.id === e.to)?.name} · {e.purpose}</summary><p className="mt-2 text-slate-500">{label(e.basis)}</p><Sources ids={e.evidenceIds} graph={graph} /></details>)}</div><Sources ids={selectedNode?.evidenceIds ?? selectedBundle?.edges.flatMap(e => e.evidenceIds) ?? []} graph={graph} />
    </aside>}
    <details className="mt-5 rounded-xl border bg-white p-4"><summary className="cursor-pointer text-sm font-medium">Deployment ownership and platform prerequisites</summary><p className="mt-1 text-xs text-slate-500">These decisions distinguish what will be retained, what is proposed, and what the platform owner must supply. They are included with the exported deployment model.</p><div className="mt-3 grid gap-3 md:grid-cols-2">{topology.controls.map(control => <details key={control.id} className="rounded-lg border p-3 text-xs"><summary className="cursor-pointer font-semibold">{control.name}<span className={`ml-2 rounded px-2 py-1 text-[10px] ${control.decision === 'verify' ? 'bg-amber-50 text-amber-800' : 'bg-blue-50 text-blue-800'}`}>{({ retain: 'Retain', add: 'Proposed addition', verify: 'Platform input required', 'not-selected': 'Not selected' })[control.decision]}</span></summary><p className="mt-3 leading-5">{control.recommendation}</p><p className="mt-2 leading-5 text-slate-500">{control.rationale}</p><Sources ids={control.evidenceIds} graph={graph} /></details>)}</div></details>
    <details className="mt-4 rounded-lg border p-3 text-xs"><summary className="cursor-pointer font-medium">Exact pod and container inventory ({topology.workloads.length} workloads)</summary><div className="mt-3 overflow-x-auto"><table className="w-full text-left"><thead><tr className="border-b"><th className="p-2">Workload / namespace</th><th className="p-2">Pods</th><th className="p-2">Application containers per pod</th><th className="p-2">Init containers per pod</th><th className="p-2">Source</th></tr></thead><tbody>{topology.workloads.map(w => <tr key={w.id} className="border-b align-top"><td className="p-2"><button className="text-blue-700 underline" onClick={() => setSelected(w.id)}>{w.name}</button><p className="mt-1 text-slate-500">{w.namespace}</p></td><td className="p-2">{w.replicas ?? 'unspecified'}</td><td className="p-2">{w.containers.filter(c => c.role === 'application').map(c => c.name).join(', ')}</td><td className="p-2">{w.containers.filter(c => c.role === 'init').map(c => c.name).join(', ') || 'none declared'}</td><td className="break-all p-2 font-mono">{w.file}{w.pointer}</td></tr>)}</tbody></table></div></details>
    <details className="mt-3 text-xs text-slate-500"><summary className="cursor-pointer">Diagram coverage and limitations</summary><div className="mt-2 space-y-2">{topology.limitations.map(note => <p key={note}>{note}</p>)}</div></details>
  </div>;
}
