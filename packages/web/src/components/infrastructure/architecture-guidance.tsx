'use client';

import { useMemo } from 'react';
import { ChevronRight } from 'lucide-react';
import { assessArchitecture, type ArchitectFinding } from '@launchpilot/core/architect-review';
import type { RepositoryArchitecture, DeploymentTopology, GroundedArchitecturePlan, ArchitectureCloud, ArchitectureValidationJob, DesignIssue } from '@launchpilot/core';

const priorityLabels = { 'before-deploy':'Before deployment', 'before-production':'Before production', improve:'Improvement' };
const stateLabels = { observed:'Repository pattern', verify:'Verification needed', proposed:'Proposed mitigation' };

export function ArchitectureGuidance({ graph, topology, environment, cloudProvider, plan, designId, revision, validationJob, issues }: { graph:RepositoryArchitecture; topology:DeploymentTopology; environment?:string; cloudProvider:ArchitectureCloud; plan?:GroundedArchitecturePlan|null; designId?:string; revision?:number; validationJob?:ArchitectureValidationJob|null; issues?:DesignIssue[] }) {
  const review=useMemo(()=>assessArchitecture(graph,topology,{environment,cloudProvider,plan,designId,revision,validationJob,issues}),[graph,topology,environment,cloudProvider,plan,designId,revision,validationJob,issues]);
  const top=review.findings.slice(0,3), remaining=review.findings.slice(3);
  const row=(f:ArchitectFinding) => <details key={f.id} className="group rounded-lg border bg-white p-3" aria-label={`${f.title} review`}>
    <summary className="cursor-pointer list-none"><span className="flex flex-wrap items-center justify-between gap-2"><span className="flex items-center gap-2 text-sm font-medium"><ChevronRight aria-hidden="true" className="h-4 w-4 shrink-0 transition-transform group-open:rotate-90" />{f.title}</span><span className={`rounded px-2 py-1 text-[11px] ${f.priority==='before-deploy'?'bg-amber-100 text-amber-900':f.priority==='before-production'?'bg-slate-100 text-slate-700':'bg-blue-50 text-blue-700'}`}>{priorityLabels[f.priority]}</span></span><span className="mt-1 block line-clamp-2 text-xs leading-relaxed text-muted-foreground">{f.limitation}</span></summary>
    <div className="mt-3 space-y-3 text-sm">
      <p className="text-xs text-muted-foreground">{stateLabels[f.state]} · {f.owner}</p>
      <p><strong>Current limitation. </strong>{f.limitation}</p>
      <p><strong>Why it matters. </strong>{f.impact}</p>
      <p><strong>Recommended action. </strong>{f.recommendation}</p>
      <p><strong>Tradeoff. </strong>{f.tradeoff}</p>
      <p><strong>How to verify. </strong>{f.verification}</p>
      {!!f.componentIds.length && <details className="text-xs"><summary className="cursor-pointer text-blue-700">Affected components ({f.componentIds.length})</summary><p className="mt-2 text-muted-foreground">{f.componentIds.map(id=>topology.nodes.find(n=>n.id===id)?.name ?? topology.workloads.find(w=>w.id===id)?.name ?? id).join(' · ')}</p></details>}
      {!!f.evidenceIds.length && <details className="text-xs"><summary className="cursor-pointer text-blue-700">Repository evidence ({f.evidenceIds.length} references)</summary><ul className="mt-2 max-h-60 space-y-2 overflow-auto">{f.evidenceIds.map(id=>{const e=graph.evidence.find(e=>e.id===id);return e?<li key={id} className="rounded bg-slate-50 p-2"><span className="break-all font-mono">{e.file}:{e.line}{e.endLine>e.line?`–${e.endLine}`:''}</span><p className="mt-1 text-muted-foreground">{e.summary}</p></li>:null;})}</ul></details>}
      {!!f.planRecommendations.length && <details className="text-xs"><summary className="cursor-pointer text-blue-700">Related guidance in the saved plan</summary><div className="mt-2 space-y-3">{f.planRecommendations.map((p,i)=><div key={i} className="space-y-2 text-muted-foreground"><p>{p.recommendation}</p><p>{p.rationale}</p>{p.limitation && <p><strong>Limitation. </strong>{p.limitation}</p>}{p.impact && <p><strong>Impact. </strong>{p.impact}</p>}{p.tradeoff && <p><strong>Tradeoff. </strong>{p.tradeoff}</p>}{p.verification && <p><strong>Acceptance. </strong>{p.verification}</p>}{p.owner && <p><strong>Owner. </strong>{p.owner}</p>}</div>)}</div></details>}
    </div>
  </details>;
  return <section aria-label="Prioritized architecture guidance" className="space-y-3 rounded-xl border bg-slate-50/50 p-4">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-semibold">Architecture decisions & limitations</h3><p className="mt-1 text-xs text-muted-foreground">{review.counts['before-deploy']} before deployment · {review.counts['before-production']} before production · {review.counts.improve} improvements</p></div><span className="text-xs text-slate-600">{review.validationCurrent?'Configured target checks passed':'Deployment readiness not established'}</span></div>
    <p className="text-xs text-muted-foreground">The highest-priority decisions are shown first. Existing implementations are reused; declared controls and proposed changes still need their acceptance checks.</p>
    {top.map(row)}
    {!!remaining.length && <details className="border-t pt-3"><summary className="cursor-pointer text-sm text-blue-700">Review {remaining.length} other architecture decisions</summary><div className="mt-3 space-y-4">{review.domains.map(domain=>{const items=remaining.filter(f=>f.domain===domain.id);return items.length?<div key={domain.id} className="space-y-2"><h4 className="text-xs font-semibold text-muted-foreground">{domain.name}</h4>{items.map(row)}</div>:null;})}</div></details>}
    {!!review.declared.length && <details className="border-t pt-3"><summary className="cursor-pointer text-sm text-muted-foreground">Already declared — retain and verify ({review.declared.length})</summary><div className="mt-3 space-y-3">{review.declared.map(c=><div key={c.id} className="text-xs"><p className="font-medium">{c.name}</p><p className="mt-1 text-muted-foreground">{c.detail}</p>{c.files.length>0 && <details className="mt-1"><summary className="cursor-pointer text-blue-700">Source files</summary>{c.files.map(file=><p key={file} className="mt-1 break-all font-mono text-muted-foreground">{file}</p>)}</details>}</div>)}</div></details>}
    <details className="border-t pt-3"><summary className="cursor-pointer text-xs text-muted-foreground">Review coverage and limits</summary><div className="mt-3 space-y-3 text-xs text-muted-foreground"><p>{review.domains.map(d=>d.name).join(' · ')}</p><p>Uses the selected cloud’s <a href={review.standardUrl} className="text-blue-700 underline" target="_blank" rel="noreferrer">Well-Architected principles</a> and a repository-specific engineering review. It is not a framework certification or a blanket production-readiness score.</p><ul className="list-disc space-y-2 pl-4">{review.limitations.map(item=><li key={item}>{item}</li>)}</ul></div></details>
  </section>;
}
