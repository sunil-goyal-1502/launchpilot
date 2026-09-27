import type { DeploymentTopology } from './deployment-topology';
import { cloudProfiles, type ArchitectureCloud } from './experience';
import { azureRate, priceCatalogDate } from './retail-pricing';
import { estimateServiceCost } from './service-cost';

/** Public on-demand Linux prices checked 2026-09-27. No spot, commitments or credits assumed. */
export const computePriceCatalog = {
  azure: { region: 'eastus', sku: 'Standard_D4s_v5', cpu: 4, memoryGiB: 16, hourly: 0.192, source: 'https://prices.azure.com/api/retail/prices?$filter=serviceName%20eq%20%27Virtual%20Machines%27%20and%20armSkuName%20eq%20%27Standard_D4s_v5%27%20and%20armRegionName%20eq%20%27eastus%27', checkedAt: '2026-09-27' },
  aws: { region: 'us-west-2', sku: 'm5a.xlarge', cpu: 4, memoryGiB: 16, hourly: 0.172, source: 'https://aws.amazon.com/eks/pricing/', checkedAt: '2026-09-27' },
  gcp: { region: 'us-central1', sku: 'e2-standard-4', cpu: 4, memoryGiB: 16, hourly: 0.13402284, source: 'https://cloud.google.com/products/compute/pricing/general-purpose', checkedAt: '2026-09-27' },
} as const;

export interface ArchitectureCostLine {
  id: string; name: string; size: string; quantity: number | null; monthly: number | null;
  basis: 'proposed' | 'repository' | 'input-required' | 'included'; note: string; source?: string;
  status?: 'estimated' | 'partial' | 'input-required'; region?: string;
  includedIn?: 'worker-capacity' | 'existing-cortex-platform';
  meters?: CostMeter[]; inputs?: CostInput[]; missing?: string[];
}
export interface CostInput {
  key: string; label: string; unit: string; value: number | null; suggested: number | null;
  basis: 'proposed' | 'user'; min?: number; max?: number; integer?: boolean;
  choices?: Array<{value: number; label: string}>;
}
export interface CostMeter {
  label: string; quantity: number | null; unit: string; monthly: number | null;
  tiers: Array<{from: number; price: number; meterId: string}>;
  source?: string; region?: string; note?: string;
}
export interface ArchitectureCostOptions {
  environment?: string; region?: string; hours?: number; revision?: number; spareNodes?: number;
  usageMode?: 'reference' | 'rates-only'; usage?: Record<string,Record<string,number|null>>; edgeZone?: string;
}
export interface ArchitectureCostEstimate {
  cloudProvider: ArchitectureCloud; region: string; hours: number; checkedAt: string; revision?: number;
  computeNodes: number | null; sku: string; requestedCpu: number; requestedMemoryGiB: number;
  missingRequestContainers: number; unknownReplicas: number; pricedSubtotal: number | null;
  lines: ArchitectureCostLine[]; assumptions: string[]; excluded: string[];
}
export function cpuCores(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const text = String(value), match = text.match(/^(\d+(?:\.\d+)?)(m|u|n)?$/);
  return match ? Number(match[1]) / (match[2] === 'm' ? 1000 : match[2] === 'u' ? 1e6 : match[2] === 'n' ? 1e9 : 1) : null;
}
export function memoryGiB(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const match = String(value).match(/^(\d+(?:\.\d+)?)(Ki|Mi|Gi|Ti|K|M|G|T)?$/);
  const scale: Record<string, number> = { Ki: 1024, Mi: 1024 ** 2, Gi: 1024 ** 3, Ti: 1024 ** 4, K: 1e3, M: 1e6, G: 1e9, T: 1e12 };
  return match ? Number(match[1]) * (scale[match[2]] ?? 1) / 1024 ** 3 : null;
}
const round = (n: number) => Math.round(n * 100) / 100;
export function architecturePricingRegion(topology: DeploymentTopology, cloudProvider: ArchitectureCloud): string {
  const regions = [...new Set(topology.nodes.map(n => n.pricing?.region?.toLowerCase()).filter((r): r is string => !!r))];
  return cloudProvider === 'azure' && regions.length === 1 ? regions[0] : computePriceCatalog[cloudProvider].region;
}

/** Estimate this exact saved topology; no repo ingestion, generic strategy regeneration or LLM pricing. */
export function estimateArchitectureCost(topology: DeploymentTopology, cloudProvider: ArchitectureCloud = 'azure', options: ArchitectureCostOptions = {}): ArchitectureCostEstimate {
  const rate = computePriceCatalog[cloudProvider];
  const region = options.region?.trim().toLowerCase() || architecturePricingRegion(topology,cloudProvider), hours = options.hours ?? 730;
  if (!Number.isFinite(hours) || hours < 1 || hours > 744) throw new Error('Monthly hours must be between 1 and 744');
  const spareNodes = options.spareNodes ?? 1;
  if (!Number.isInteger(spareNodes) || spareNodes < 0 || spareNodes > 10) throw new Error('Spare nodes must be between 0 and 10');
  let missing = 0, cpu = 0, memory = 0;
  const pods: { cpu: number; memory: number }[] = [];
  const lines: ArchitectureCostLine[] = [];
  const excluded: string[] = [];
  for (const workload of topology.workloads) {
    let appCpu = 0, appMem = 0, initCpu = 0, initMem = 0;
    for (const c of workload.containers) {
      const observedCpu = cpuCores(c.requests.cpu), observedMem = memoryGiB(c.requests.memory);
      if (observedCpu === null || observedMem === null) missing++;
      // Explicit initial sizing suggestion, never represented as a repository fact.
      const vcpu = observedCpu ?? 0.25, gib = observedMem ?? 0.5;
      if (c.role === 'application') { appCpu += vcpu; appMem += gib; }
      else { initCpu = Math.max(initCpu, vcpu); initMem = Math.max(initMem, gib); }
    }
    const pod = { cpu: Math.max(appCpu, initCpu), memory: Math.max(appMem, initMem) };
    const replicas = workload.replicas;
    if (replicas === null) excluded.push(`${workload.name}: replica count is not declared; its capacity is not included.`);
    else for (let n = 0; n < replicas; n++) { pods.push(pod); cpu += pod.cpu; memory += pod.memory; }
    lines.push({ id: workload.id, name: workload.name, size: `${round(pod.cpu)} vCPU / ${round(pod.memory)} GiB per pod`, quantity: replicas, monthly: null, basis: 'included', includedIn:'worker-capacity', note: 'Included in the worker capacity below; pods are not billed again. Uses the larger of app-container requests and sequential init-container requests.' });
  }
  // First-fit decreasing preserves indivisible pods; summing requests alone can under-size nodes.
  const allocCpu = rate.cpu * 0.8 / 1.3, allocMem = rate.memoryGiB * 0.8 / 1.3;
  const bins: { cpu: number; memory: number }[] = [];
  const oversized = pods.some(p => p.cpu > allocCpu || p.memory > allocMem);
  if (!oversized) for (const p of [...pods].sort((a,b) => Math.max(b.cpu/allocCpu,b.memory/allocMem)-Math.max(a.cpu/allocCpu,a.memory/allocMem))) {
    const bin = bins.find(b => b.cpu + p.cpu <= allocCpu && b.memory + p.memory <= allocMem);
    if (bin) { bin.cpu += p.cpu; bin.memory += p.memory; } else bins.push({ ...p });
  }
  const nodes = oversized ? null : pods.length ? bins.length + spareNodes : topology.workloads.length && !topology.totals.unspecifiedWorkloads ? 0 : null;
  const regionalRate = cloudProvider === 'azure' ? azureRate(region,'Virtual Machines Dsv5 Series','D4s v5') : undefined;
  const hourly = cloudProvider === 'azure' ? regionalRate?.tiers[0]?.price : region === rate.region ? rate.hourly : undefined;
  if (oversized) excluded.push(`At least one pod exceeds the proposed ${rate.sku} allocatable capacity. Select and price a larger node; no misleading node total is reported.`);
  const monthly = nodes !== null && hourly !== undefined ? round(nodes * hours * hourly) : null;
  if (topology.workloads.length) lines.unshift({ id: 'worker-capacity', name: 'Proposed worker capacity', size: `${rate.sku} · ${rate.cpu} vCPU / ${rate.memoryGiB} GiB`, quantity: nodes, monthly, basis: 'proposed', status: monthly === null ? 'input-required' : 'estimated', region, note: `${hours} h/month; ${spareNodes} spare node(s). ${topology.nodes.some(n => n.id === 'existing-cortex-platform') ? 'Capacity allocation in the existing Cortex cluster, not a request to create a duplicate cluster. Incremental spend depends on its free capacity.' : 'Proposed worker capacity; cluster control-plane pricing is separate.'}${hourly === undefined ? ` No verified rate for ${region}; another region’s price is not substituted.` : ''}`, source: regionalRate?.source ?? rate.source, meters: [{label:'Linux worker hours',quantity:nodes === null ? null : nodes * hours,unit:'1 Hour',monthly,tiers:regionalRate?.tiers ?? (hourly === undefined ? [] : [{from:0,price:hourly,meterId:'published-reference'}]),source:regionalRate?.source ?? rate.source,region}] });
  const capabilities = topology.nodes.filter(n => !n.workloadIds?.length && (!['secret', 'identity', 'configuration'].includes(n.kind) || /^(?:azure-|cortex-).*\(Cortex capability\)|Microsoft\.AppConfiguration|configurationStores/i.test(n.technology)));
  for (const n of capabilities) {
    if (n.kind === 'application' && topology.workloads.some(w => w.id === n.id)) continue;
    if (/ingress|\/Service$/i.test(n.technology) && topology.nodes.some(node => node.id === 'existing-cortex-platform')) {
      lines.push({id:n.id,name:n.name,size:'Shared platform routing',quantity:null,monthly:null,basis:'included',includedIn:'existing-cortex-platform',note:'No separate cloud purchase per routing declaration. Controller, load balancer and network costs must be included in the Cortex platform allocation, which remains unresolved until supplied.'});
      continue;
    }
    lines.push(estimateServiceCost(n,region,hours,options));
  }
  const checkedAt = cloudProvider === 'azure' ? priceCatalogDate : rate.checkedAt;
  const isStale = Date.now() - Date.parse(checkedAt) > 30 * 86400000;
  return { cloudProvider, region, hours, revision: options.revision, checkedAt, computeNodes: nodes, sku: rate.sku, requestedCpu: round(cpu), requestedMemoryGiB: round(memory), missingRequestContainers: missing, unknownReplicas: topology.totals.unspecifiedWorkloads, pricedSubtotal: lines.some(l => l.monthly !== null) ? round(lines.reduce((sum, l) => sum + (l.monthly ?? 0), 0)) : null,
    lines, assumptions: [
      `${cloudProfiles[cloudProvider].name} worker pricing scenario uses ${region}. When one Azure region is declared by capabilities, co-location is proposed for workers. The actual cluster region is not inferred. Each service retains its declared region.`,
      `Proposed capacity reserves 20% for system services, adds 30% request headroom and ${spareNodes} spare node(s). Confirm placement, architecture/OS, workload peaks, pod overhead, affinities and actual node allocatable capacity before deployment.`,
      `On-demand Linux, USD, ${hours} hours/month; no discounts, credits, taxes or support included. Price snapshot checked ${checkedAt}${isStale ? ' (over 30 days old; refresh the catalog before budget approval)' : ''}.`,
      options.usageMode === 'rates-only' ? 'Usage quantities require your inputs; published unit rates remain visible. Blank usage is not zero usage.' : 'Editable reference usage and missing-size proposals are budget scenarios, not measurements or facts from the repository. Rates include volume tiers; no negotiated discounts are assumed.',
      ...(missing ? [`${missing} container definitions lack CPU or memory requests. For those missing fields only, proposed starting values of 0.25 vCPU / 0.5 GiB are used; validate with load tests.`] : []),
      'The subtotal includes only rows with a verified price and quantity. It is not the complete deployment bill or an incremental-spend quote.',
    ], excluded: [...excluded, 'Unresolved provider allocations, capability-created pods, node disks, backups, shared control plane, NAT/egress, logs and optional API features are excluded unless explicitly priced in a row. Catalog prices do not verify SKU/model availability, account quotas or deployment readiness.'] };
}
