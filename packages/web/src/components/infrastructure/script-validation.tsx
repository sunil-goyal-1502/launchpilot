'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, CircleAlert, Download, Loader2, ShieldCheck } from 'lucide-react';
import type { ArchitectureValidationJob } from '@launchpilot/core';
import { Button } from '@/components/ui/button';

interface Target { id: string; name: string; environment: string; architectureId: string; unitIds: string[]; subscriptionId: string; resourceGroupName: string; location: string; context?: string; namespace?: string; allowTestDeployment: boolean; testDeploymentMethod: string; fingerprint: string }
const statusText = { pending: 'Waiting', running: 'Running', passed: 'Passed', failed: 'Failed', blocked: 'Incomplete', 'not-applicable': 'Not applicable' };
async function read(url: string, init?: RequestInit) {
  const response = await fetch(url, { ...init, cache: 'no-store' }); const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? 'Validation request failed'); return body;
}
export function ScriptValidation({ designId, revision, architectureId, unitIds, disabled, onValidationChange }: { designId: string; revision: number; architectureId: string; unitIds: string[]; disabled: boolean; onValidationChange?:(job:ArchitectureValidationJob|null)=>void }) {
  const [targets, setTargets] = useState<Target[]>([]), [targetId, setTargetId] = useState(''), [deployTest, setDeployTest] = useState(false);
  const [job, setJob] = useState<ArchitectureValidationJob | null>(null), [starting, setStarting] = useState(false), [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
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
  return <section className="mt-4 space-y-3 rounded-lg border bg-white p-4" aria-label="Infrastructure script validation">
    <div className="flex items-center gap-2 font-medium"><ShieldCheck className="h-5 w-5" /> Generate and validate infrastructure</div>
    <p className="text-sm text-muted-foreground">Every generated revision runs Terraform validation and Bicep compilation. Deployment readiness also requires Azure planning, cluster validation, a test deployment and health checks.</p>
    <label className="block text-sm">Validation target
      <select aria-label="Validation target" className="ml-3 max-w-full rounded border p-2 text-sm" value={targetId} disabled={running || starting} onChange={e => { setTargetId(e.target.value); setDeployTest(false); }}>
        <option value="">Local checks · target not selected</option>
        {targets.map(t => <option key={t.id} value={t.id}>{t.name} · {t.environment}</option>)}
      </select>
    </label>
    {!target && <p className="text-xs text-amber-800">Azure and cluster checks will remain incomplete until a validation target is configured for this saved scope. The report will list the missing inputs.</p>}
    {target && <div className="rounded border bg-slate-50 p-3 text-xs leading-relaxed"><p>Azure subscription {target.subscriptionId} · {target.location} · resource group <strong>{target.resourceGroupName}</strong></p>{target.context && <p>Cluster context {target.context} · namespace <strong>{target.namespace}</strong></p>}
      {target.allowTestDeployment && <label className="mt-2 flex items-start gap-2"><input type="checkbox" checked={deployTest} disabled={running || starting} onChange={e => setDeployTest(e.target.checked)} /><span>Run a real test deployment using {target.testDeploymentMethod} in this target after planning checks pass. This creates Azure resources and applies the exported manifests to this namespace. Resources remain for review.</span></label>}
    </div>}
    <Button onClick={generate} disabled={disabled || starting || running}>{starting || running ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}{starting ? 'Starting validation…' : running ? 'Generating and validating…' : 'Generate and validate Terraform + Bicep'}</Button>
    {disabled && <p className="text-xs text-muted-foreground">Available when the evidence review finishes and design blockers are resolved.</p>}
    {error && <p role="alert" className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    {job && <div className="space-y-3" aria-live="polite">
      <div className={`rounded border p-3 text-sm ${job.status === 'passed' ? 'border-emerald-200 bg-emerald-50' : job.status === 'failed' ? 'border-red-200 bg-red-50' : 'border-amber-200 bg-amber-50'}`}>
        <p className="flex items-center gap-2 font-medium">{job.status === 'passed' ? <CheckCircle2 className="h-4 w-4" /> : running ? <Loader2 className="h-4 w-4 animate-spin" /> : <CircleAlert className="h-4 w-4" />}{job.status === 'passed' ? 'All required checks passed' : running ? job.step : 'Validation incomplete — deployment readiness has not been established'}</p>
        <p className="mt-1">Revision {revision}{report ? ` · ${passed} checks passed · Target: ${report.targetId ?? 'not selected'} · Bundle ${report.bundleHash.slice(0, 12)}` : ''}</p>
        {job.error && <p className="mt-2">{job.error}</p>}
      </div>
      {report && <div className="grid gap-2 lg:grid-cols-2">{report.checks.map(check => <details key={check.id} className="rounded border p-3 text-xs" open={check.status === 'failed'}>
        <summary className="cursor-pointer"><span className={`mr-2 inline-block min-w-20 font-semibold ${check.status === 'passed' ? 'text-emerald-700' : check.status === 'failed' ? 'text-red-700' : 'text-slate-600'}`}>{statusText[check.status]}</span>{check.name}</summary>
        <p className="mt-2 whitespace-pre-wrap break-words text-slate-700">{check.message}</p>
        {check.details?.map((detail, i) => <pre key={i} className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded bg-slate-50 p-2">{detail}</pre>)}
      </details>)}</div>}
      {!running && report && <div className="flex flex-wrap gap-3">
        <Button variant={job.status === 'passed' ? 'default' : 'outline'} disabled={downloading} onClick={downloadBundle}>{downloading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}{job.status === 'passed' ? 'Download validated bundle' : 'Download review bundle (validation incomplete)'}</Button>
        <p className="self-center text-xs text-muted-foreground">Includes the validation report and a portable validator for this exact revision.</p>
      </div>}
    </div>}
  </section>;
}
