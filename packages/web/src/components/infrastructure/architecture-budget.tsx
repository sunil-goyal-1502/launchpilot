'use client';

import { useMemo, useState } from 'react';
import { estimateArchitectureCost, architecturePricingRegion, type ArchitectureCostOptions } from '@launchpilot/core/architecture-cost';
import type { ArchitectureCloud } from '@launchpilot/core/architecture-experience';
import type { DeploymentTopology } from '@launchpilot/core';

const money = (amount: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(amount);
const rateMoney = (amount: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 7 }).format(amount);
const zoneNames = ['North America','Asia Pacific / Japan','South America','Australia','India','Europe','Middle East / Africa','Korea'];

export function ArchitectureBudget({ topology, cloudProvider, environment, revision }: { topology: DeploymentTopology; cloudProvider: ArchitectureCloud; environment?: string; revision?: number }) {
  // Empty override follows the saved evidence once the asynchronous review arrives.
  const [regionOverride, setRegion] = useState('');
  const region = regionOverride || architecturePricingRegion(topology, cloudProvider);
  const [hours, setHours] = useState(730);
  const [spareNodes, setSpareNodes] = useState(1);
  const [usageMode, setUsageMode] = useState<'reference'|'rates-only'>('reference');
  const [usage, setUsage] = useState<NonNullable<ArchitectureCostOptions['usage']>>({});
  const [edgeZone, setEdgeZone] = useState('');
  const estimate = useMemo(() => estimateArchitectureCost(topology, cloudProvider, { region, hours, spareNodes, environment, revision, usageMode, usage, edgeZone:edgeZone || undefined }), [topology, cloudProvider, region, hours, spareNodes, environment, revision, usageMode, usage, edgeZone]);
  const resources = estimate.lines.filter(l => l.basis !== 'included');
  const complete = resources.filter(l => l.status === 'estimated');
  const partial = resources.filter(l => l.status === 'partial');
  const unresolved = resources.filter(l => l.monthly === null);
  const pods = estimate.lines.filter(l => l.includedIn === 'worker-capacity');
  const platformRoutes = estimate.lines.filter(l => l.includedIn === 'existing-cortex-platform');
  const hasEdge = topology.nodes.some(n=>/Front Door Premium/i.test(n.technology));
  return <section aria-label="Architecture sizing and cost" className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-sm font-semibold">Proposed sizing & cost</h3><p className="mt-1 text-xs text-muted-foreground">{estimate.computeNodes === null ? 'Worker sizing needs deployment inputs' : `${estimate.computeNodes} × ${estimate.sku} · 4 vCPU / 16 GiB per node · ${estimate.region}`}</p></div><div className="text-right"><p className="text-xl font-semibold">{estimate.pricedSubtotal === null || estimate.computeNodes === null ? 'Estimate incomplete' : `${money(estimate.pricedSubtotal)}/mo`}</p><p className="text-xs text-muted-foreground">{estimate.computeNodes === null && estimate.pricedSubtotal !== null ? `${money(estimate.pricedSubtotal)}/mo priced so far` : usageMode === 'reference' ? 'Reference usage estimate' : 'Priced subtotal'} · excludes unresolved costs</p></div></div>

    <details className="mt-3 text-xs"><summary className="cursor-pointer font-medium text-blue-700">Review resource prices & edit usage</summary>
    <p className="mt-2 text-xs text-slate-600">{complete.length} of {resources.length} resource estimates priced{partial.length ? ` · ${partial.length} partly priced` : ''}{unresolved.length ? ` · ${unresolved.length} need inputs` : ''}. {topology.totals.applicationPods} known pod replicas.{estimate.missingRequestContainers ? ` ${estimate.missingRequestContainers} containers use proposed defaults for missing requests.` : ''}</p>
      <div className="my-4 flex flex-wrap items-end gap-4">
        <label className="space-y-1">Worker / proposed resource region<input aria-label="Estimate region" className="block rounded border bg-white p-2" value={region} onChange={e => setRegion(e.target.value)} /></label>
        <label className="space-y-1">Hours / month<input aria-label="Estimate monthly hours" type="number" min={1} max={744} className="block w-28 rounded border bg-white p-2" value={hours} onChange={e => setHours(Math.min(744, Math.max(1, Number(e.target.value) || 1)))} /></label>
        <label className="space-y-1">Spare nodes<input aria-label="Estimate spare nodes" type="number" min={0} max={10} className="block w-24 rounded border bg-white p-2" value={spareNodes} onChange={e => setSpareNodes(Math.min(10, Math.max(0, Math.floor(Number(e.target.value) || 0))))} /></label>
        <label className="space-y-1">Usage estimates<select aria-label="Usage estimate mode" className="block rounded border bg-white p-2" value={usageMode} onChange={e=>setUsageMode(e.target.value as typeof usageMode)}><option value="reference">Editable reference scenario</option><option value="rates-only">Unit rates; enter my usage</option></select></label>
        {hasEdge && <label className="space-y-1">Proposed edge traffic zone<select aria-label="Edge traffic zone" className="block rounded border bg-white p-2" value={edgeZone || (region === 'uaenorth' ? 'Zone 7' : 'Zone 1')} onChange={e=>setEdgeZone(e.target.value)}>{zoneNames.map((name,i)=><option key={name} value={`Zone ${i+1}`}>{name}</option>)}</select></label>}
      </div>
      <p className="mb-3 text-muted-foreground">Declared regions and sizes come from saved deployment evidence. Missing locations, sizing and usage use labelled budget scenarios, not observed consumption. These inputs do not change deployment manifests. Select a resource for its rates, inputs and coverage.</p>
      <div className="divide-y rounded-lg border bg-white">{resources.map(line => <details key={line.id} className="group p-3" aria-label={`${line.name} cost details`}>
        <summary className="flex cursor-pointer list-none items-start justify-between gap-4"><span className="min-w-0"><span className="font-medium"><span className="mr-2 text-slate-400">▸</span>{line.name}</span><span className="mt-1 block pl-5 text-muted-foreground">{line.size}{line.region ? ` · ${line.region}` : ''}</span></span><span className="shrink-0 text-right font-medium">{line.monthly !== null ? money(line.monthly) : 'Input needed'}<span className={`mt-1 block text-[11px] font-normal ${line.status === 'estimated' ? 'text-slate-500' : 'text-amber-700'}`}>{line.status === 'partial' ? 'Partial estimate' : line.status === 'estimated' ? line.basis === 'repository' ? 'Declared size' : 'Scenario estimate' : 'See missing inputs'}</span></span></summary>
        <div className="mt-3 space-y-3 pl-5"><p className="max-w-4xl text-muted-foreground">{line.note}</p>
          {!!line.missing?.length && <p className="rounded bg-amber-50 p-2 text-amber-900"><strong>To complete this estimate: </strong>{line.missing.join('; ')}.</p>}
          {!!line.inputs?.length && <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{line.inputs.map(input=><label key={input.key} className="space-y-1">{input.label}<span className="block text-muted-foreground">{input.unit}{input.value !== null ? ` · ${input.basis === 'user' ? 'your input' : 'proposed'}` : ''}</span>{input.choices ? <select aria-label={`${line.name}: ${input.label}`} className="w-full rounded border p-2" value={input.value ?? ''} onChange={e=>setUsage(old=>({...old,[line.id]:{...old[line.id],[input.key]:e.target.value === '' ? null : Number(e.target.value)}}))}><option value="">Select size</option>{input.choices.map(c=><option key={c.value} value={c.value}>{c.label}</option>)}</select> : <input aria-label={`${line.name}: ${input.label}`} className="w-full rounded border p-2" type="number" min={input.min ?? 0} max={input.max ?? 1e12} step={input.integer ? 1 : 'any'} value={input.value ?? ''} placeholder="Enter quantity" onChange={e=>{ const value=e.target.value === '' ? null : Math.min(input.max ?? 1e12,Math.max(input.min ?? 0,Number(e.target.value))); setUsage(old=>({...old,[line.id]:{...old[line.id],[input.key]:value === null ? null : input.integer ? Math.floor(value) : value}})); }} />}</label>)}</div>}
          {!!line.meters?.length && <div className="overflow-x-auto"><table className="w-full text-left"><thead><tr className="border-b text-muted-foreground"><th className="py-2 pr-3">Billing meter</th><th className="p-2">Published unit rate</th><th className="p-2">Billing units / month</th><th className="p-2 text-right">USD / month</th></tr></thead><tbody>{line.meters.map((meter,i)=><tr key={`${meter.label}:${i}`} className="border-b align-top"><td className="py-2 pr-3">{meter.label}{meter.region && <span className="block text-muted-foreground">{meter.region}</span>}</td><td className="p-2">{meter.tiers.length ? <><span>{rateMoney(meter.tiers[0].price)} / {meter.unit}</span>{meter.tiers.length > 1 && <details className="mt-1"><summary className="cursor-pointer text-blue-700">{meter.tiers.length} volume tiers</summary>{meter.tiers.map(t=><p key={t.from}>From {t.from.toLocaleString()} billing units: {rateMoney(t.price)}</p>)}</details>}</> : meter.source ? 'Meter unavailable' : 'Owner quote / no matching rate'}{meter.source && <a className="mt-1 block text-blue-700 underline" target="_blank" rel="noreferrer" href={meter.source}>Official meter</a>}</td><td className="p-2">{meter.quantity === null ? 'Usage needed' : meter.quantity.toLocaleString(undefined,{maximumFractionDigits:4})}</td><td className="p-2 text-right">{meter.monthly === null ? 'Input needed' : money(meter.monthly)}</td></tr>)}</tbody></table></div>}
        </div>
      </details>)}</div>
      {!!pods.length && <details className="mt-4"><summary className="cursor-pointer font-medium">{pods.length} application workloads included in worker capacity</summary><ul className="mt-2 space-y-1 text-muted-foreground">{pods.map(p=><li key={p.id}>{p.name} · {p.quantity ?? '?'} pods · {p.size}</li>)}</ul></details>}
      {!!platformRoutes.length && <p className="mt-3 text-muted-foreground">{platformRoutes.length} routing declaration(s) use the shared Cortex platform. Their controller and load-balancer costs belong in its allocation, not separate route charges.</p>}
      <details className="mt-4"><summary className="cursor-pointer font-medium">Pricing assumptions & exclusions · checked {estimate.checkedAt}</summary><ul className="mt-2 list-disc space-y-2 pl-4 text-muted-foreground">{[...estimate.assumptions, ...estimate.excluded].map(item => <li key={item}>{item}</li>)}</ul></details>
      <p className="mt-3 text-muted-foreground">Sizing inputs: {estimate.requestedCpu} vCPU / {estimate.requestedMemoryGiB} GiB before headroom · saved design revision {revision ?? 0}. Changes to pods and replicas recalculate this estimate.</p>
    </details>
  </section>;
}
