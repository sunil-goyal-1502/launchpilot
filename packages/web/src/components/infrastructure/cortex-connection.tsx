'use client';
import { useEffect, useState } from 'react';
import type { ArchitectureDeploymentTarget } from '@launchpilot/core';
import type { CortexConnection } from '@/lib/cortex-connection';
import { Button } from '@/components/ui/button';
export interface CortexSelection { applicationId: string; environment: string; definitionName?: string }
async function request(url: string, init?: RequestInit) {
  const response = await fetch(url, { ...init, cache: 'no-store' }), body = await response.json();
  if (!response.ok) throw new Error(body.error || 'Cortex connection failed');
  return body;
}

export function CortexSelector({ selection, onChange, disabled, onStatus }: { selection: CortexSelection; onChange: (value: CortexSelection) => void; disabled?: boolean; onStatus?: (connection: CortexConnection) => void }) {
  const [connection, setConnection] = useState<CortexConnection | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [repoUrl, setRepoUrl] = useState('https://github.com/Cortex-Inception/cortex'), [ref, setRef] = useState('main');
  function accept(value: CortexConnection) { setConnection(value); setRepoUrl(value.repoUrl); setRef(value.ref); onStatus?.(value); }
  useEffect(() => { let cancelled = false; void request('/api/cortex/connection').then(value => { if (!cancelled) accept(value); }).catch(e => { if (!cancelled) setError(e.message); }); return () => { cancelled = true; }; }, []);
  async function connect(save = false) {
    setBusy(true); setError('');
    try { accept(await request('/api/cortex/connection', save ? { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ repoUrl, ref }) } : { method: 'POST' })); }
    catch (e) { setError(e instanceof Error ? e.message : 'Cortex connection failed'); }
    finally { setBusy(false); }
  }
  const choices = connection?.definitions ?? [], apps = [...new Set(choices.map(d => d.applicationId))];
  const environments = [...new Set(choices.filter(d => !selection.applicationId || d.applicationId === selection.applicationId).map(d => d.environment))];
  const definitions = choices.filter(d => d.applicationId === selection.applicationId && d.environment === selection.environment);
  return <div className="space-y-3 text-sm" aria-label="Cortex repository connection">
    <div className="flex flex-wrap items-center gap-2"><span className="text-xs text-slate-600">{connection?.revision ? `Connected · ${connection.ref} @ ${connection.revision.slice(0, 10)}` : 'Connect to load registered Cortex applications and environments.'}</span><Button type="button" size="sm" variant="outline" disabled={busy || disabled} onClick={() => void connect()}>{busy ? 'Checking Cortex…' : connection?.revision ? 'Check for updates' : 'Connect Cortex'}</Button></div>
    {choices.length > 0 && <div className="flex flex-wrap gap-3">
      <label className="text-xs">Cortex application<select aria-label="Cortex application" className="ml-2 rounded border bg-white p-2" value={selection.applicationId} disabled={disabled || busy} onChange={e => onChange({ ...selection, applicationId: e.target.value, definitionName: undefined })}><option value="">Select application</option>{apps.map(app => <option key={app}>{app}</option>)}</select></label>
      <label className="text-xs">Environment<select aria-label="Cortex environment" className="ml-2 rounded border bg-white p-2" value={selection.environment} disabled={disabled || busy} onChange={e => onChange({ ...selection, environment: e.target.value, definitionName: undefined })}><option value="">Select environment</option>{environments.map(env => <option key={env}>{env}</option>)}</select></label>
    </div>}
    <details className="text-xs text-slate-600"><summary className="cursor-pointer">Connection and release settings</summary><div className="mt-3 space-y-3">
      <label className="block">Repository<input aria-label="Cortex repository URL" className="mt-1 block w-full rounded border bg-white p-2" value={repoUrl} disabled={busy || disabled} onChange={e => setRepoUrl(e.target.value)} /></label>
      <label className="block">Branch<input aria-label="Cortex branch" className="ml-2 rounded border bg-white p-2" value={ref} disabled={busy || disabled} onChange={e => setRef(e.target.value)} /></label>
      <Button type="button" variant="outline" size="sm" disabled={busy || disabled} onClick={() => void connect(true)}>Save and connect</Button>
      {definitions.length > 0 && <label className="block">Registered release<select aria-label="Cortex registered release" className="ml-2 rounded border bg-white p-2" disabled={busy || disabled} value={selection.definitionName ?? ''} onChange={e => onChange({ ...selection, definitionName: e.target.value || undefined })}><option value="">Latest registered release</option>{definitions.map(d => <option key={d.definitionName} value={d.definitionName}>{d.definitionName} · {d.mode}</option>)}</select></label>}
      <p>Uses the LaunchPilot server’s Git/GitHub access. Planning fetches this branch again and pins its commit. Existing saved plans keep their original artifacts.</p>
      {connection?.checkedAt && <p>Last checked: {new Date(connection.checkedAt).toLocaleString()}</p>}
    </div></details>
    {(error || connection?.error) && <p role="alert" className="text-xs text-red-700">{error || connection?.error}</p>}
  </div>;
}

export function CortexTargetConnection({ target, architectureId }: { target?: ArchitectureDeploymentTarget; architectureId: string }) {
  const [selection, setSelection] = useState<CortexSelection>({ applicationId: target?.applicationId ?? '', environment: target?.environment ?? 'prod' });
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function select() {
    setBusy(true); setError('');
    try {
      const result = await request('/api/architecture/deployment-target', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source: 'connection', applicationArchitectureId: architectureId, ...selection }) });
      window.location.assign(result.url);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not prepare the Cortex deployment'); setBusy(false); }
  }
  return <details className="rounded-lg border bg-white p-3" aria-label="Deployment platform connection"><summary className="cursor-pointer text-sm"><strong>{target ? 'Current Cortex' : 'Deploy on Cortex'}</strong>{target && <span className="ml-2 text-xs text-slate-500">{target.applicationId} · {target.environment} · {target.revision.slice(0, 8)}</span>}</summary><div className="mt-3 space-y-3">
    <CortexSelector selection={selection} onChange={setSelection} disabled={busy} />
    <Button type="button" size="sm" disabled={busy || !selection.applicationId || !selection.environment} onClick={() => void select()}>{busy ? 'Fetching artifacts and rendering deployment…' : target ? 'Refresh Cortex and plan deployment' : 'Use current Cortex'}</Button>
    {target && <p className="text-xs text-muted-foreground">A changed Cortex commit creates a new review. Your current saved design remains available. <a className="underline" href={`/architecture/${target.applicationArchitectureId}?original=1`}>Original application evidence</a></p>}
    {error && <p role="alert" className="text-xs text-red-700">{error}</p>}
  </div></details>;
}
