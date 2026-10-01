'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, CircleAlert, Download, Loader2, ShieldCheck } from 'lucide-react';
import type { ArchitectureValidationJob } from '@launchpilot/core';
import { Button } from '@/components/ui/button';
import { scriptGenerationBlocker, type GenerationPrerequisites } from '@/lib/script-generation';

interface Target { id: string; name: string; environment: string; architectureId: string; unitIds: string[]; subscriptionId: string; resourceGroupName: string; location: string; context?: string; namespace?: string; allowTestDeployment: boolean; testDeploymentMethod: string; fingerprint: string }
const statusText = { pending: 'Waiting', running: 'Running', passed: 'Passed', failed: 'Failed', blocked: 'Incomplete', 'not-applicable': 'Not applicable' };
async function read(url: string, init?: RequestInit) {
  const response = await fetch(url, { ...init, cache: 'no-store' }); const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? 'Validation request failed'); return body;
}
export function ScriptValidation({ designId, revision, architectureId, unitIds, prerequisites, onResumeReview, onValidationChange }: { designId: string; revision: number; architectureId: string; unitIds: string[]; prerequisites: GenerationPrerequisites; onResumeReview:()=>Promise<void>; onValidationChange?:(job:ArchitectureValidationJob|null)=>void }) {
  const [targets, setTargets] = useState<Target[]>([]), [targetId, setTargetId] = useState(''), [deployTest, setDeployTest] = useState(false);
  const [job, setJob] = useState<ArchitectureValidationJob | null>(null), [starting, setStarting] = useState(false), [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [resuming, setResuming] = useState(false);
  const blocker = scriptGenerationBlocker(prerequisites);
  const scope = [...unitIds].sort().join('|');
  useEffect(()=>{onValidationChange?.(job);},[job,onValidationChange]);
  useEffect(() => {
    let cancelled = false;
    void read('/api/architecture/export?targets=1').then(result => { if (!cancelled) setTargets(result.targets.filter((t: Target) => t.architectureId === architectureId && [...t.unitIds].sort().join('|') === scope)); }).catch(e => { if (!cancelled) setError(e.message); });
    void read(`/api/architecture/export?designId=${designId}`).then(result => { if (!cancelled) setJob(result.job); }).catch(e => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [designId, revision, architectureId, scope]);
  const running = job?.status === 'queued' || job?.status === 'running';
  useEffect(() => {
    if (!job || !running) return;
    let cancelled = false;
    const timer = setInterval(() => { void read(`/api/architecture/export?id=${job.id}`).then(result => { if (!cancelled) { setJob(result.job); setError(null); } }).catch(e => { if (!cancelled) setError(e.message + '. The saved validation job continues; reconnect to view its result.'); }); }, 1800);
    return () => { cancelled = true; clearInterval(timer); };
  }, [job?.id, running]);
  const target = targets.find(t => t.id === targetId), report = job?.report;
  async function generate() {
    setStarting(true); setError(null);
    try { const result = await read('/api/architecture/export', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ designId, revision, ...(target ? { targetId: target.id, targetFingerprint: target.fingerprint } : {}), deployTest }) }); setJob(result.job); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not start validation'); }
    finally { setStarting(false); }
  }
  async function downloadBundle() {
    if (!job) return;
    setDownloading(true); setError(null);
    try {
      const response = await fetch(`/api/architecture/export?id=${job.id}&download=${job.status === 'passed' ? 'validated' : 'review'}`, { cache: 'no-store' });
      if (!response.ok) throw new Error((await response.json()).error ?? 'Bundle download failed');
      const url = URL.createObjectURL(await response.blob()), link = document.createElement('a');
      link.href = url; link.download = `launchpilot-${designId.slice(0, 12)}-r${revision}-${job.status === 'passed' ? 'validated' : 'VALIDATION-INCOMPLETE'}.zip`; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { setError(e instanceof Error ? e.message : 'Bundle download failed'); }
    finally { setDownloading(false); }
  }
  const passed = report?.checks.filter(c => c.status === 'passed').length ?? 0;
  const localPassed = !!report && (prerequisites.nativeCortex ? ['integrity', 'native-contract', 'terraform-init', 'terraform-validate', 'helm-render'] : ['integrity', 'terraform-init', 'terraform-validate', 'bicep-build']).every(id=>report.checks.some(check=>check.id===id && check.status==='passed'));
  return <section className="mt-4 space-y-3 rounded-lg border bg-white p-4" aria-label="Infrastructure script validation">
    <div className="flex items-center gap-2 font-medium"><ShieldCheck className="h-5 w-5" /> Generate and validate infrastructure</div>
    <p className="text-sm text-muted-foreground">{prerequisites.nativeCortex ? 'Exports the pinned Cortex Terraform, Helm charts and deployment manifests. Each generation validates Terraform, renders Helm and checks the saved pod counts. Live tenant and cluster checks remain required before rollout.' : 'Every generated revision runs Terraform validation and Bicep compilation. Deployment readiness also requires Azure planning, cluster validation, a test deployment and health checks.'}</p>
    <p className="text-xs text-muted-foreground">{prerequisites.nativeCortex ? 'Cortex · Azure' : 'Azure'}{prerequisites.environment ? ` · ${prerequisites.environment}` : ''} is the selected architecture. {prerequisites.nativeCortex ? 'Uses the existing Cortex deployment owner. Bicep is not a separate deployment path for this contract.' : 'A cloud validation target adds account and cluster settings for live checks; it is optional for generating scripts.'}</p>
    {!prerequisites.nativeCortex && <details className="text-xs"><summary className="cursor-pointer">Cloud validation settings (optional)</summary><div className="mt-3 space-y-3">
    <label className="block text-sm">Cloud validation target (optional)
      <select aria-label="Cloud validation target (optional)" className="ml-3 max-w-full rounded border p-2 text-sm" value={targetId} disabled={running || starting} onChange={e => { setTargetId(e.target.value); setDeployTest(false); }}>
        <option value="">Local script checks — no cloud target required</option>
        {targets.map(t => <option key={t.id} value={t.id}>{t.name} · {t.environment}</option>)}
      </select>
    </label>
    {!target && <p className="text-xs text-muted-foreground">Generate a review bundle with Terraform and Bicep checks. Cloud deployment readiness will remain unverified.{!targets.length && ' No matching cloud targets are configured for this saved design.'}</p>}
    {!target && <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">What is a cloud validation target?</summary><p className="mt-2">A configured non-production target supplies the Azure subscription, resource group, region, deployment parameters and, where applicable, cluster context and namespace. It enables cloud previews and cluster checks. A real test deployment is a separate option after a target is selected.</p></details>}
    {target && <div className="rounded border bg-slate-50 p-3 text-xs leading-relaxed"><p>Azure subscription {target.subscriptionId} · {target.location} · resource group <strong>{target.resourceGroupName}</strong></p>{target.context && <p>Cluster context {target.context} · namespace <strong>{target.namespace}</strong></p>}
      {target.allowTestDeployment && <label className="mt-2 flex items-start gap-2"><input type="checkbox" checked={deployTest} disabled={running || starting} onChange={e => setDeployTest(e.target.checked)} /><span>Run a real test deployment using {target.testDeploymentMethod} in this target after planning checks pass. This creates Azure resources and applies the exported manifests to this namespace. Resources remain for review.</span></label>}
    </div>}
    </div></details>}
    {blocker && <div role="status" className="space-y-2 rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"><p className="font-medium">{blocker.title}</p><p>{blocker.message}</p>{blocker.details.length>0 && <details className="text-xs"><summary className="cursor-pointer">{blocker.canResume ? 'Review failure details' : 'Details'}</summary><ul className="mt-2 list-disc space-y-1 pl-4">{blocker.details.map((detail,index)=><li key={index} className="break-words">{detail}</li>)}</ul></details>}{blocker.canResume && <Button variant="outline" disabled={resuming} onClick={async()=>{setResuming(true);try{setError(null);await onResumeReview();}catch(e){setError(e instanceof Error ? e.message : 'Could not resume the AI review');}finally{setResuming(false);}}}>{resuming ? 'Resuming AI review…' : 'Retry AI review'}</Button>}</div>}
    <Button onClick={generate} disabled={!!blocker || starting || running}>{starting || running ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}{starting ? 'Starting validation…' : running ? 'Generating and validating…' : prerequisites.nativeCortex ? 'Generate and validate Cortex scripts' : 'Generate and validate Terraform + Bicep'}</Button>
    {error && <p role="alert" className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    {job && <div className="space-y-3" aria-live="polite">
      <div className={`rounded border p-3 text-sm ${job.status === 'passed' ? 'border-emerald-200 bg-emerald-50' : job.status === 'failed' ? 'border-red-200 bg-red-50' : 'border-amber-200 bg-amber-50'}`}>
        <p className="flex items-center gap-2 font-medium">{job.status === 'passed' ? <CheckCircle2 className="h-4 w-4" /> : running ? <Loader2 className="h-4 w-4 animate-spin" /> : <CircleAlert className="h-4 w-4" />}{job.status === 'passed' ? 'All required checks passed' : running ? job.step : job.status==='blocked' && localPassed && !report?.targetId ? 'Scripts generated · local checks passed · cloud checks not run' : 'Validation incomplete — deployment readiness has not been established'}</p>
        <p className="mt-1">Revision {revision}{report ? ` · ${passed} checks passed · Target: ${report.targetId ?? 'local script checks'} · Bundle ${report.bundleHash.slice(0, 12)}` : ''}</p>
        {job.error && <p className="mt-2">{job.error}</p>}
      </div>
      {report && <details><summary className="cursor-pointer text-xs">Validation details ({passed} passed)</summary><div className="mt-3 grid gap-2 lg:grid-cols-2">{report.checks.map(check => <details key={check.id} className="rounded border p-3 text-xs" open={check.status === 'failed'}>
        <summary className="cursor-pointer"><span className={`mr-2 inline-block min-w-20 font-semibold ${check.status === 'passed' ? 'text-emerald-700' : check.status === 'failed' ? 'text-red-700' : 'text-slate-600'}`}>{statusText[check.status]}</span>{check.name}</summary>
        <p className="mt-2 whitespace-pre-wrap break-words text-slate-700">{check.message}</p>
        {check.details?.map((detail, i) => <pre key={i} className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded bg-slate-50 p-2">{detail}</pre>)}
      </details>)}</div></details>}
      {!running && report && <div className="flex flex-wrap gap-3">
        <Button variant={job.status === 'passed' ? 'default' : 'outline'} disabled={downloading} onClick={downloadBundle}>{downloading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}{job.status === 'passed' ? 'Download validated bundle' : 'Download review bundle (validation incomplete)'}</Button>
        <p className="self-center text-xs text-muted-foreground">Includes the validation report and a portable validator for this exact revision.</p>
      </div>}
    </div>}
  </section>;
}
