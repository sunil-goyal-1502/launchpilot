'use client';

import { useState } from 'react';
import { deploymentEnvironments, selectedEnvironment, cloudProfiles, type ArchitectureCloud } from '@launchpilot/core/architecture-experience';
import { buildDeploymentTopology } from '@launchpilot/core/deployment-topology';
import { ArchitectureBudget } from './architecture-budget';
import { ArchitectureGuidance } from './architecture-guidance';
import { chooseDeploymentScope } from '@launchpilot/core/architecture-design';
import { useArchitectureReview } from '@/hooks/use-architecture-review';
import type { ArchitectureReviewResponse } from '@/lib/api-client';
import { ArchitectureCanvas } from './architecture-canvas';
import { DeploymentArchitecture } from './deployment-architecture';
import { ScriptValidation } from './script-validation';
import { CortexTargetConnection } from './cortex-connection';
import { ReviewStatus } from './review-status';
import { groupArchitectureResources, overviewArchitecture } from './architecture-groups';
import { Download, FileCode2, GitBranch, Search, Maximize2, Minimize2, X } from 'lucide-react';
import type { RepositoryArchitecture, GroundedArchitecturePlan, SourceEvidence, ArchitectureValidationJob } from '@launchpilot/core';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

function download(data: Blob, filename: string) {
  const url = URL.createObjectURL(data);
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function EvidenceList({ ids, graph }: { ids: string[]; graph: RepositoryArchitecture }) {
  const refs = ids.map(id => graph.evidence.find(e => e.id === id)).filter((x): x is SourceEvidence => !!x);
  return <ul className="space-y-2">{refs.map(e => <li key={e.id} className="rounded-md bg-muted/50 p-2 text-xs">
    <p className="break-all font-mono">{e.file}:{e.line}{e.endLine > e.line ? `–${e.endLine}` : ''}</p>
    <p className="mt-1 text-muted-foreground">{e.summary}</p>
  </li>)}</ul>;
}

export function EvidenceArchitecture({ graph, initialPlan, initialUnitIds, initialReview, initialCloud = 'azure', initialEnvironment }: { initialCloud?: ArchitectureCloud; initialEnvironment?: string; graph: RepositoryArchitecture; initialPlan?: GroundedArchitecturePlan; initialUnitIds?: string[]; initialReview?: ArchitectureReviewResponse }) {
  const [unitIds, setUnitIds] = useState<string[]>(initialReview?.design.unitIds ?? initialPlan?.unitIds ?? initialUnitIds ?? chooseDeploymentScope(graph).unitIds);
  const environments = deploymentEnvironments(graph);
  const [cloudProvider, setCloudProvider] = useState<ArchitectureCloud>(initialReview?.design.cloudProvider ?? initialPlan?.provider ?? initialCloud);
  const [environment, setEnvironment] = useState(initialReview?.design.environment ?? initialEnvironment ?? selectedEnvironment(graph, unitIds)?.id ?? '');
  const sameInitialScope = initialPlan && initialPlan.provider === cloudProvider && (!initialPlan.environment || initialPlan.environment === environment) && JSON.stringify([...initialPlan.unitIds].sort()) === JSON.stringify([...unitIds].sort());
  const architecture = useArchitectureReview(graph.id, unitIds, !graph.deploymentUnits.length || unitIds.length > 0, initialReview, sameInitialScope ? initialPlan.id : undefined, cloudProvider, environment);
  const plan = architecture.review?.plan ?? (sameInitialScope ? initialPlan : null);
  const topology = architecture.review?.topology ?? buildDeploymentTopology(graph, unitIds, plan ?? undefined, cloudProvider, environment);
  const [view, setView] = useState<'repository' | 'target'>('target');
  const [validationJob,setValidationJob]=useState<ArchitectureValidationJob|null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [showCode, setShowCode] = useState(!graph.resources.some(r => r.origin === 'declared'));
  const [combineResources, setCombineResources] = useState(true);
  const [detail, setDetail] = useState(false);
  const [focus, setFocus] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const activeUnits = graph.deploymentUnits.filter(u => unitIds.includes(u.id));
  const selectedResourceIds = new Set(activeUnits.flatMap(u => u.resourceIds));
  // Include explicit dependencies across the selected deployment root boundary.
  let dependencyExpanded = true;
  while (dependencyExpanded) { dependencyExpanded = false; for (const edge of graph.connections) if (selectedResourceIds.has(edge.from) && !selectedResourceIds.has(edge.to)) { selectedResourceIds.add(edge.to); dependencyExpanded = true; } }
  const needsScope = graph.deploymentUnits.length > 0 && unitIds.length === 0;
  const recommendationIds = new Set([...selectedResourceIds, ...graph.resources.filter(r => r.origin === 'code').map(r => r.id)]);
  const recommendationBindings = graph.bindings.filter(b => recommendationIds.has(b.consumerId)).length;
  const sourceItems = graph.resources.filter(r => !needsScope && (!graph.deploymentUnits.length || selectedResourceIds.has(r.id) || showCode && r.origin === 'code') && (showCode || r.origin !== 'code'));
  const grouped = groupArchitectureResources(sourceItems, graph.connections, combineResources);
  const overview = overviewArchitecture(grouped.resources, grouped.connections);
  const diagramResources = grouped.resources.filter(r => r.attributes.diagramRole !== 'deployment-metadata');
  const focusId = diagramResources.some(r => r.id === focus) ? focus : diagramResources.find(r => r.kind === 'application')?.id ?? diagramResources[0]?.id;
  const neighbors = new Set([focusId, ...grouped.connections.filter(e => e.from === focusId || e.to === focusId).flatMap(e => [e.from, e.to])]);
  const projection = detail ? { resources: diagramResources.filter(r => neighbors.has(r.id)), connections: grouped.connections.filter(e => e.from === focusId || e.to === focusId) } : overview;
  const items = view === 'target' && plan ? plan.components.map(c => ({ id: c.id, name: c.name, kind: c.kind, technology: c.technology, basis: c.basis, evidence: c.evidenceIds })) : projection.resources.map(r => ({ ...r, basis: r.origin }));
  const visibleItems = items.filter(r => `${r.name} ${r.kind} ${r.technology} ${'facets' in r ? r.facets.join(' ') : ''}`.toLowerCase().includes(search.toLowerCase()));
  const links = view === 'target' && plan ? plan.connections.map((e, i) => ({ id: `target-edge-${i}`, from: e.from, to: e.to, relationship: e.purpose, evidence: e.evidenceIds, basis: e.basis })) : projection.connections.map(e => ({ ...e, basis: 'repository' }));
  const selectedGroup = view === 'repository' ? projection.resources.find(r => r.id === selected) : undefined;
  const selectedResource = view === 'target' ? plan?.components.find(r => r.id === selected) : selectedGroup ?? graph.resources.find(r => r.id === selected);
  const memberIds = new Set(selectedGroup?.memberIds ?? (selected ? [selected] : []));
  const members = graph.resources.filter(r => memberIds.has(r.id));
  const internalConnections = graph.connections.filter(e => memberIds.has(e.from) && memberIds.has(e.to));
  const selectedLink = links.find(e => e.id === selected);
  const connectionDetails = selectedLink && 'connectionIds' in selectedLink ? graph.connections.filter(e => selectedLink.connectionIds.includes(e.id)) : [];
  const selectedBindings = view === 'target' ? plan?.configuration.filter(c => c.consumerId === selected || c.sourceId === selected) ?? [] : [];
  const sourceBindings = view === 'repository' ? graph.bindings.filter(b => memberIds.has(b.consumerId) || !!b.sourceId && memberIds.has(b.sourceId)) : [];
  const selectedEvidence = selectedGroup?.evidence ?? (selectedResource ? 'evidenceIds' in selectedResource ? selectedResource.evidenceIds : selectedResource.evidence : selectedLink?.evidence ?? []);
  function traceResource(id: string) {
    if (graph.resources.find(r => r.id === id)?.attributes.diagramRole === 'deployment-metadata') { setSelected(id); return; }
    setFocus(grouped.resources.find(r => r.memberIds.includes(id))?.id ?? id); setDetail(true); setSelected(null); setSearch('');
  }
  const reviewQuery = new URLSearchParams();
  unitIds.forEach(id => reviewQuery.append('unit', id));
  reviewQuery.set('cloud', cloudProvider);
  if (environment) reviewQuery.set('environment', environment);
  if (plan) reviewQuery.set('plan', plan.id);
  if (architecture.review) reviewQuery.set('design', architecture.review.design.id);

  return <section className="space-y-3 rounded-xl border bg-card p-4" aria-label="Evidence-based architecture">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div><h2 className="flex items-center gap-2 text-xl font-semibold"><GitBranch className="h-5 w-5" /> Deployment plan</h2>
        <p className="mt-1 text-xs text-muted-foreground">Saved repository analysis · {cloudProfiles[cloudProvider].name} proposal · {architecture.review ? `Revision ${architecture.review.design.revision}` : 'Preparing review'}</p>
      </div>
      <div className="flex items-center gap-3"><a className="text-xs underline underline-offset-4" href={`/architecture/${graph.id}?${reviewQuery.toString()}`}>Open saved review</a><Button variant="outline" size="sm" onClick={() => download(new Blob([JSON.stringify(graph, null, 2)], { type: 'application/json' }), 'repository-evidence.json')}><Download className="mr-2 h-4 w-4" /> Evidence</Button></div>
    </div>
    <div className="flex flex-wrap items-center justify-between gap-4">
      <label className="text-xs text-muted-foreground">Environment<select aria-label="Deployment environment" className="ml-2 rounded border bg-white p-2 text-sm text-foreground" value={environment} onChange={e => { const env = environments.find(env => env.id === e.target.value); if (env) { setEnvironment(env.id); setUnitIds(env.unitIds); setSelected(null); setFocus(null); setDetail(false); } }}>{environments.map(env => <option key={env.id} value={env.id}>{env.label}</option>)}</select></label>
      <div className="min-w-64 flex-1"><CortexTargetConnection target={graph.deploymentTarget} architectureId={graph.id} /></div>
      <label className="text-xs text-muted-foreground">Deployment cloud<select aria-label="Deployment cloud" className="ml-2 rounded-md border bg-white p-2 text-sm text-foreground" value={cloudProvider} disabled={!!graph.deploymentTarget} onChange={e => { setCloudProvider(e.target.value as ArchitectureCloud); setSelected(null); }}><option value="azure">Azure</option><option value="aws">AWS</option><option value="gcp">Google Cloud</option></select></label>
    </div>
    <ReviewStatus job={architecture.review?.job} notice={architecture.notice} onResume={architecture.resume} resuming={architecture.resuming} />
    {view === 'repository' && !needsScope && <div className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 p-3">
      <Button size="sm" variant={!detail ? 'default' : 'outline'} onClick={() => { setDetail(false); setSelected(null); }}>System overview</Button>
      <Button size="sm" variant={detail ? 'default' : 'outline'} onClick={() => { setDetail(true); setSelected(null); }}>Trace a component</Button>
      {detail ? <select aria-label="Component to trace" value={focusId ?? ''} onChange={e => { setFocus(e.target.value); setSelected(null); }} className="max-w-lg rounded-md border bg-white p-2 text-xs">{diagramResources.map(r => <option key={r.id} value={r.id}>{r.name} · {r.technology}</option>)}</select> : <p className="text-xs text-slate-500">Groups show the whole system. Select one to explore its individual components and evidence.</p>}
    </div>}
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" variant={view === 'repository' ? 'default' : 'outline'} onClick={() => { setView('repository'); setSelected(null); }}>Application architecture</Button>
      <Button size="sm" variant={view === 'target' ? 'default' : 'outline'} disabled={needsScope} onClick={() => { setView('target'); setSelected(null); }}>Proposed deployment architecture</Button>
      {view === 'repository' && <label className="ml-2 flex items-center gap-2 text-xs"><input type="checkbox" checked={showCode} onChange={e => setShowCode(e.target.checked)} /> Show source code</label>}
      {view === 'repository' && <label className="ml-2 flex items-center gap-2 text-xs"><input type="checkbox" checked={combineResources} onChange={e => { setCombineResources(e.target.checked); setSelected(null); }} /> Combine workload resources</label>}
      {view === 'repository' && <label className="ml-auto flex items-center gap-2 rounded-md border px-2"><Search className="h-4 w-4 text-muted-foreground" /><input aria-label="Filter architecture components" className="w-40 bg-transparent py-2 text-xs outline-none" value={search} onChange={e => setSearch(e.target.value)} placeholder="Find a component" /></label>}
    </div>
    {view === 'target' ? <DeploymentArchitecture graph={graph} plan={plan} unitIds={unitIds} topologyOverride={topology} design={architecture.review?.design} onEdit={architecture.save} saving={architecture.saving} issues={architecture.review?.issues} /> : <>
    <p className="text-sm text-muted-foreground">Application architecture shows logical services, data stores, integrations and configuration paths for the selected environment. Deployment architecture shows pod templates, containers, replica counts and infrastructure ownership.</p>
    <div className={expanded ? 'fixed inset-3 z-50 overflow-auto rounded-xl border bg-white p-4 shadow-2xl' : ''}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3"><div><p className="mb-1 text-sm font-semibold">{activeUnits.map(u => u.name).join(' + ') || 'Repository architecture'}{!needsScope ? detail ? ' · Component trace' : ' · System overview' : ''}</p><p className="text-xs text-muted-foreground">{visibleItems.length} {detail ? 'components in this trace' : 'diagram cards'}{` · ${sourceItems.length} resources in this scope`} · Select a card or connector for configuration and evidence.</p></div>{detail && <Button variant="outline" size="sm" onClick={() => { setDetail(false); setSelected(null); }}>Back to overview</Button>}<Button variant="outline" size="sm" onClick={() => setExpanded(!expanded)}>{expanded ? <Minimize2 className="mr-2 h-4 w-4" /> : <Maximize2 className="mr-2 h-4 w-4" />}{expanded ? 'Close expanded view' : 'Expand diagram'}</Button></div>
      <div className={`grid overflow-hidden rounded-xl border ${selected ? 'lg:grid-cols-[minmax(0,1fr)_310px]' : ''}`}>
        {visibleItems.length ? <ArchitectureCanvas items={visibleItems} links={links} focusId={detail ? focusId ?? undefined : undefined} selected={selected} onSelect={setSelected} height={expanded ? 'calc(100vh - 150px)' : 640} /> : <div className="flex h-72 items-center justify-center p-8 text-center text-sm text-muted-foreground">{needsScope ? 'Select an identified environment above to see its architecture.' : 'No matching declarations. Source code, unrendered templates and delivery evidence are available in the inventory and evidence download.'}</div>}
        {selected && <aside style={{ maxHeight: expanded ? 'calc(100vh - 130px)' : 640 }} className="space-y-4 overflow-auto border-l bg-white p-4 text-sm" aria-label="Architecture component details">
          <div className="flex items-center justify-between"><span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Component details</span><button aria-label="Close component details" onClick={() => setSelected(null)}><X size={16} /></button></div>
        {selectedResource ? <><h3 className="break-all font-semibold">{selectedResource.name}</h3><Badge variant="outline">{'basis' in selectedResource ? selectedResource.basis : selectedResource.origin}</Badge><p className="break-all text-xs">{selectedResource.technology}</p>
          {'rationale' in selectedResource && <p className="text-xs text-muted-foreground">{selectedResource.rationale}</p>}
          {'attributes' in selectedResource && Object.entries(selectedResource.attributes).filter(([key]) => !['overview', 'diagramRole'].includes(key)).map(([key, value]) => <p key={key} className="break-all text-xs"><strong>{key}:</strong> {value}</p>)}
        </> : selectedLink ? <><h3 className="font-semibold">Connection</h3><p className="text-xs">{selectedLink.relationship}</p></> : <><FileCode2 className="h-7 w-7 text-muted-foreground" /><h3 className="font-medium">Inspect the architecture</h3><p className="text-xs text-muted-foreground">Select a node or connection to inspect its source references, configuration path and design rationale. Pan, zoom, or use the component list below.</p></>}
        {members.length > 1 && <div className="space-y-2"><h4 className="text-xs font-semibold">Resources in this component ({members.length})</h4>{members.map(member => <details key={member.id} className="rounded border p-2 text-xs"><summary className="cursor-pointer font-medium">{member.name} · {member.technology.split('/').at(-1)}</summary><button className="mt-2 font-medium text-blue-700 underline" onClick={() => traceResource(member.id)}>Trace connections</button>{Object.entries(member.attributes).map(([key, value]) => <p key={key} className="mt-2 break-all"><strong>{key}:</strong> {value}</p>)}<EvidenceList ids={member.evidence} graph={graph} /></details>)}</div>}
        {!!connectionDetails.length && <div className="space-y-2"><h4 className="text-xs font-semibold">Connection paths ({connectionDetails.length})</h4>{connectionDetails.map(edge => <div key={edge.id} className="rounded border p-2 text-xs"><p>{graph.resources.find(r => r.id === edge.from)?.name} → {graph.resources.find(r => r.id === edge.to)?.name}</p><p className="mt-1">{edge.relationship}</p><EvidenceList ids={edge.evidence} graph={graph} /></div>)}</div>}
        {!!internalConnections.length && <details className="rounded border p-2 text-xs"><summary className="cursor-pointer font-medium">Connections inside this component ({internalConnections.length})</summary>{internalConnections.map(edge => <p className="mt-2" key={edge.id}>{graph.resources.find(r => r.id === edge.from)?.technology.split('/').at(-1)} → {graph.resources.find(r => r.id === edge.to)?.technology.split('/').at(-1)}: {edge.relationship}</p>)}</details>}
        {!!sourceBindings.length && <details className="rounded border p-2 text-xs"><summary className="cursor-pointer font-semibold">Configuration delivery ({sourceBindings.length} bindings)</summary><div className="mt-2 space-y-2">{sourceBindings.map(b => <div key={b.id} className="rounded border p-2 text-xs"><strong>{b.key}</strong><p>{b.source}{b.sourceKey ? ` · ${b.sourceKey}` : ''} · {b.sensitive ? 'secret value withheld' : 'configuration'}</p><p className="mt-1 text-muted-foreground">{b.resolved ? 'Provider identified in the repository' : 'Delivery path requires a target-design recommendation'}</p><EvidenceList ids={b.evidence} graph={graph} /></div>)}</div></details>}
        {selectedBindings.map((b, i) => <div key={i} className="rounded border p-2 text-xs"><strong>{b.name}</strong><p>{b.sourceId} → {b.consumerId}</p><p className="mt-1">{b.delivery}</p><p className="mt-1 text-muted-foreground">{b.recommendation}</p></div>)}
        {!!selectedEvidence.length && <details className="rounded border p-2 text-xs"><summary className="cursor-pointer font-semibold">Source references ({selectedEvidence.length})</summary><div className="mt-2"><EvidenceList ids={selectedEvidence} graph={graph} /></div></details>}
        </aside>}
      </div>
    </div>
    <div className="flex flex-wrap gap-3 text-xs text-muted-foreground"><span className="text-blue-700">● Repository declaration</span><span className="text-violet-700">● Code observation</span><span className="text-amber-700">◌ Recommended addition</span><span>● External dependency</span></div>
    <details><summary className="cursor-pointer text-sm font-medium">Complete resource inventory ({sourceItems.length})</summary><div className="mt-2 grid max-h-64 gap-1 overflow-y-auto sm:grid-cols-2">{sourceItems.filter(r => `${r.name} ${r.technology}`.toLowerCase().includes(search.toLowerCase())).map(r => <button key={r.id} onClick={() => traceResource(r.id)} className="rounded border p-2 text-left text-xs hover:bg-muted"><strong>{r.name}</strong><span className="ml-2 text-muted-foreground">{r.technology}</span></button>)}</div></details>
    </>}
    {!needsScope && <details className="rounded-lg border p-3"><summary className="cursor-pointer text-sm">Recommendations and deployment checks</summary><div className="mt-3"><ArchitectureGuidance graph={graph} topology={topology} environment={environment} cloudProvider={cloudProvider} plan={plan} designId={architecture.review?.design.id} revision={architecture.review?.design.revision} validationJob={validationJob} issues={architecture.review?.issues} /></div></details>}
    {!needsScope && <ArchitectureBudget key={`${cloudProvider}:${environment}`} topology={topology} cloudProvider={cloudProvider} environment={environment} revision={architecture.review?.design.revision} />}
    {architecture.review && <details className="rounded-xl border p-4" open><summary className="cursor-pointer font-semibold">Generate & validate deployment scripts</summary><div className="mt-4">{cloudProvider === 'azure' ? <ScriptValidation onValidationChange={setValidationJob} key={`${architecture.review.design.id}:${architecture.review.design.revision}`} designId={architecture.review.design.id} revision={architecture.review.design.revision} architectureId={graph.id} unitIds={unitIds} prerequisites={{nativeCortex:graph.deploymentTarget?.kind === 'cortex-platform',saving:architecture.saving,hasPlan:!!architecture.review.plan,reviewJob:architecture.review.job,issues:architecture.review.issues,environment}} onResumeReview={architecture.resume} /> : <p className="text-sm text-muted-foreground">The {cloudProfiles[cloudProvider].name} architecture can be reviewed and edited. Validated export currently supports Azure; a native Terraform compiler is required for this cloud. Bicep is Azure-only.</p>}</div></details>}
    {plan && <details className="space-y-4 rounded-lg border p-4"><summary className="cursor-pointer font-medium">Complete recommendation audit & evidence</summary><p className="text-sm">{plan.summary}</p>
      <p className="text-xs text-muted-foreground">{plan.evidenceCoverage.resources} resource decisions · {plan.evidenceCoverage.bindings} configuration paths · {plan.model} · Snapshot {plan.architectureId.slice(0, 12)}</p>
      {plan.decisions.map(d => <details key={d.id} className="rounded border p-3"><summary className="cursor-pointer text-sm font-medium">{d.title}</summary><p className="mt-2 text-sm">{d.recommendation}</p><p className="my-2 text-xs text-muted-foreground">{d.rationale}</p><EvidenceList ids={d.evidenceIds} graph={graph} /></details>)}
      <details><summary className="cursor-pointer text-sm font-medium">Operations and required inputs</summary><div className="mt-3 space-y-3">{plan.operations.map((op, i) => <div key={i} className="space-y-2 text-sm"><p><strong className="capitalize">{op.concern}: </strong>{op.recommendation}</p><p className="text-xs text-muted-foreground">{op.rationale}</p>{op.limitation && <details className="text-xs text-muted-foreground"><summary className="cursor-pointer text-blue-700">Limitation, tradeoff and acceptance</summary><div className="mt-2 space-y-2"><p>{op.priority==='before-deploy'?'Before deployment':op.priority==='before-production'?'Before production':'Improvement'} · {op.owner}</p><p><strong>Limitation. </strong>{op.limitation}</p><p><strong>Impact. </strong>{op.impact}</p><p><strong>Tradeoff. </strong>{op.tradeoff}</p><p><strong>Acceptance. </strong>{op.verification}</p><EvidenceList ids={op.evidenceIds} graph={graph} /></div></details>}</div>)}{plan.inputs.map(input => <p key={input.name} className="text-xs"><strong>{input.name}</strong> · {input.secret ? 'secret' : 'required configuration'} · {input.description}</p>)}</div></details>
      <details><summary className="cursor-pointer text-sm font-medium">Disposition of every repository resource</summary><ul className="mt-2 space-y-2 text-xs">{plan.resourceDecisions.map(d => <li key={d.resourceId}><strong>{graph.resources.find(r => r.id === d.resourceId)?.name}</strong> · {d.disposition}<p>{d.reason}</p></li>)}</ul></details>
      <p className="text-xs text-muted-foreground">Export availability depends on the selected deployment contract. The script panel reports compiler support, evidence review status and validation results separately.</p>
    </details>}
    <details><summary className="cursor-pointer text-sm font-medium">Analysis coverage and recommendation inputs</summary><div className="mt-3 space-y-3 text-xs">
      <p>{graph.coverage.filesScanned} files · {graph.coverage.deploymentFiles} deployment files · {graph.resources.length} observations · {graph.bindings.length} bindings · Snapshot {graph.id.slice(0, 12)}</p>
      <p>Selected definitions: {activeUnits.map(u => u.root).join(', ') || 'Source observations'}. Related Helm and pipeline files inform the review; they are not extra environments or automatically deployed duplicates.</p>
      {environments.find(e => e.id === environment)?.alternativeUnitIds.length ? <p>This environment also has alternative Helm definitions. Their controls are reviewed for reuse; their pod counts are not added to the selected manifests.</p> : null}
      {architecture.review && <Button size="sm" variant="outline" onClick={() => download(new Blob([JSON.stringify(architecture.review, null, 2)], {type:'application/json'}), `architecture-design-r${architecture.review?.design.revision}.json`)}>Export full architecture review</Button>}
      <p>Recursive static analysis. JavaScript/TypeScript configuration reads use the syntax tree; other languages use literal-access patterns. HCL/Bicep expressions and Helm templates are inventoried without executing repository code. Cloud resources, secret values and runtime reachability are not queried.</p>
      <p>Limits: {graph.coverage.limits.maxFiles.toLocaleString()} files, {Math.round(graph.coverage.limits.maxFileBytes / 1024)} KiB per file. {graph.coverage.truncated ? 'Scan limit reached: increase limits before requesting a complete plan.' : 'No scan size limit reached.'}</p>
      <p>{graph.coverage.excluded.length} excluded files/directories; secret/state files are not read. Full paths and reasons are in the evidence download.</p>
      <div className="max-h-64 space-y-3 overflow-y-auto">{graph.recommendations.map(r => <div key={r.id} className="rounded border p-2"><strong>{r.title}</strong><p>{r.rationale}</p><p className="mt-1 text-muted-foreground">{r.action}</p><EvidenceList ids={r.evidence} graph={graph} /></div>)}</div>
    </div></details>
  </section>;
}
