import type { DeploymentNode } from './deployment-topology';
import type { ArchitectureCostLine, ArchitectureCostOptions, CostInput, CostMeter } from './cost';
import { azureRate, tieredCost, type RetailRate } from './retail-pricing';

const round = (n: number) => Math.round(n * 100) / 100;
const positive = (n: number | undefined) => n !== undefined && Number.isFinite(n) && n > 0 ? n : undefined;
const times = (n: number | null, factor: number) => n === null ? null : n * factor;

/** Price the existing contract, including Azure dependencies retained in an AWS/GCP proposal. */
export function estimateServiceCost(node: DeploymentNode, region: string, hours: number, options: ArchitectureCostOptions): ArchitectureCostLine {
  const p = node.pricing ?? {}, provider = p.provider ?? node.technology.toLowerCase();
  const declaredRegion = p.region?.toLowerCase(), resourceRegion = declaredRegion || region;
  const inputs: CostInput[] = [], meters: CostMeter[] = [], missing: string[] = [], notes: string[] = [];
  let size = node.details.filter(d => /^(SKU|Replicas|Partitions|Instances):/.test(d)).join(' · ') || node.technology;
  let proposed = node.basis === 'recommendation' || node.basis === 'user', quantity: number | null = 1;
  const reference = options.usageMode !== 'rates-only';
  const input = (key: string, label: string, unit: string, suggestion: number | null, extra: Partial<CostInput> = {}) => {
    const specified = options.usage?.[node.id]?.[key];
    const value = specified !== undefined ? specified : reference ? suggestion : null;
    if (value !== null && (!Number.isFinite(value) || value < (extra.min ?? 0) || value > (extra.max ?? 1e12) || extra.integer && !Number.isInteger(value))) throw new Error(`Invalid cost input: ${label}`);
    inputs.push({ key, label, unit, value, suggested: suggestion, basis: specified !== undefined ? 'user' : 'proposed', ...extra });
    proposed = true;
    if (value === null) missing.push(label);
    return value;
  };
  const charge = (label: string, amount: number | null, rate: RetailRate | undefined, explanation?: string) => {
    if (!rate) {
      const quote = input(`quote:${label}`, `${label}: verified owner quote`, 'USD / month', null);
      if (quote === null) missing.push(`${label}: no verified matching meter in ${resourceRegion}; supply a quote for this charge`);
      meters.push({label,quantity:1,unit:'month',tiers:[],monthly:quote,note:`No matching regional meter. ${quote === null ? 'Owner quote needed.' : 'User-supplied quote, not a catalog-verified rate.'}`});
      return;
    }
    meters.push({ label, quantity: amount, unit: rate?.unit ?? 'matching meter needed', tiers: rate?.tiers ?? [], monthly: rate && amount !== null ? tieredCost(rate, amount) : null, source: rate?.source, region: rate?.region, note: explanation });
  };
  const rate = (product: string, meter: string, global = false) => azureRate(resourceRegion, product, meter, global);
  const countInput = (key: string, label: string, declared: number | undefined, suggestion = 1) => positive(declared) ?? input(key, label, 'instances', suggestion, { min: 1, max: 1000, integer: true });

  if (/azure-search|Microsoft.Search\/searchServices/i.test(provider)) {
    const skus: Record<string,string> = { basic:'Basic', standard:'Standard S1', standard2:'Standard S2', standard3:'Standard S3', storage_optimized_l1:'Storage Optimized L1', storage_optimized_l2:'Storage Optimized L2' };
    const sku = skus[p.sku?.toLowerCase() ?? ''];
    const replicas = countInput('replicas','Search replicas',p.replicas), partitions = countInput('partitions','Search partitions',p.partitions);
    quantity = replicas !== null && partitions !== null ? replicas * partitions : null;
    size = `${p.sku ?? 'SKU needed'} · ${replicas ?? '?'} replicas × ${partitions ?? '?'} partitions`;
    charge('Search units', times(quantity, hours), sku ? rate('Azure AI Search', `${sku}${p.computeType?.toLowerCase() === 'confidential' ? ' CC' : ''} Unit`) : undefined);
    notes.push('One billed search unit per replica × partition. Semantic ranking, agentic retrieval and optional enrichment are additional usage.');
  } else if (/azure-service-bus/i.test(provider) && p.sku?.toLowerCase() === 'premium') {
    const units = countInput('messagingUnits','Messaging units per partition',p.messagingUnits ?? p.capacity);
    const partitions = countInput('partitions','Service Bus partitions',p.partitions);
    quantity = units !== null && partitions !== null ? units * partitions : null;
    size = `Premium · ${units ?? '?'} MU × ${partitions ?? '?'} partitions`;
    charge('Premium messaging capacity', times(quantity, hours), rate('Service Bus','Premium Messaging Unit'));
    notes.push('Premium includes message operations. Capacity uses the maximum purchased units each billing day; the scenario holds it constant.');
  } else if (/azure-app-config|Microsoft.AppConfiguration/i.test(provider) && p.sku?.toLowerCase() === 'standard') {
    size = 'Standard · 1 store';
    charge('Configuration store', hours / 24, rate('App Configuration','Standard Instance'));
    const overage = input('overageOperations','Operations above the daily included allowance','operations / month',100000);
    charge('Configuration overage', times(overage,1/10000),rate('App Configuration','Standard Overage Operations'));
    notes.push('Enter the sum of daily overage operations; unused daily allowances do not carry forward. Replicas, snapshot overage and experimentation are excluded.');
  } else if (/azure-storage(?!-event)|Microsoft.Storage\/storageAccounts/i.test(provider) && p.sku?.toUpperCase() === 'STANDARD_LRS') {
    size = 'Standard LRS · Hot block blobs (proposed tier)'; proposed = true;
    charge('Stored data',input('storageGB','Average stored data','GB / month',100),rate('General Block Blob v2','Hot LRS Data Stored'));
    for (const [key,label,meter,suggestion] of [['reads','Read operations','Hot Read Operations',100000],['writes','Write operations','Hot LRS Write Operations',10000],['lists','List / container operations','LRS List and Create Container Operations',10000],['other','Other operations','All Other Operations',10000]] as const) charge(label,times(input(key,label,'operations / month',suggestion),1/10000),rate('General Block Blob v2',meter));
    notes.push('Hot, flat-namespace StorageV2 is a proposed pricing tier. Counts cover all containers together. Replication is included in LRS; egress, versions, snapshots and optional features require additional usage.');
  } else if (/azure-speech/i.test(provider) && /^(S0|S1)$/i.test(p.sku ?? '')) {
    size = `${p.sku} · standard speech`;
    charge('Speech to text',input('audioHours','Standard speech-to-text audio','hours / month',10),rate('Azure Speech','S1 Speech To Text'));
    charge('Neural text to speech',input('speechCharacters','Neural synthesis','million characters / month',1),rate('Azure Speech','S1 Neural Text To Speech Characters'));
    notes.push('The S0 account uses S1-labelled retail speech meters. Scenario covers standard transcription and neural synthesis; batch, custom voices, translation and Voice Live use different meters.');
  } else if (/azure-document-intelligence/i.test(provider) && p.sku?.toUpperCase() === 'S0') {
    size = 'S0 · pay per processed page';
    for (const [key,label,meter,suggestion] of [['readPages','Read / OCR pages','S0 Read Pages',1000],['prebuiltPages','Layout / prebuilt pages','S0 Pre-built Pages',1000],['customPages','Custom extraction pages','S0 Custom Pages',0]] as const) charge(label,times(input(key,label,'pages / month',suggestion),1/1000),rate('Azure Document Intelligence',meter));
    notes.push('Read, layout/prebuilt and custom extraction are separately billable operations. Additional queries, training, classification and add-ons are outside this scenario.');
  } else if (/azure-translator/i.test(provider) && p.sku?.toUpperCase() === 'S1') {
    size = 'S1 · text and document translation';
    charge('Text translation',input('textCharacters','Text translation','million characters / month',1),rate('Translator Text','S1 Characters',true));
    charge('Document translation',input('documentCharacters','Document translation','million characters / month',1),rate('Translator Text','S1 Document Characters',true));
    notes.push('Characters count each target language. Uses the published Global billing meter when no regional meter is listed; this does not establish regional service availability. Custom translation/training are excluded.');
  } else if (/azure-storage-event-route|event.?grid/i.test(provider)) {
    size = 'Event Grid · Basic event operations'; proposed = true;
    charge('Event operations',times(input('operations','Billable event operations (64 KB units)','operations / month',1000000),1/100000),rate('Event Grid','Standard Operations',true));
    notes.push('Basic event routing scenario; includes publishing, delivery, retries and payload-size billing units. The first 100K operations allowance is subscription-wide, so enter operations already consuming it below.');
    const used = input('allowanceUsed','Free operations already consumed elsewhere','operations / month',100000,{max:100000});
    const met = meters[0];
    if (used !== null && met.quantity !== null && met.tiers.length) {
      const r = rate('Event Grid','Standard Operations',true)!;
      met.monthly = tieredCost(r,met.quantity + used/100000) - tieredCost(r,used/100000);
    } else met.monthly = null;
  } else if (/azure-redis/i.test(provider)) {
    const tier = p.sku ?? 'Standard';
    const index = p.capacity ?? input('cacheSize','Cache capacity','C size index',1,{integer:true,min:0,max:6,choices:[0,1,2,3,4,5,6].map((value)=>({value,label:`C${value} · ${['250 MB','1 GB','2.5 GB','6 GB','13 GB','26 GB','53 GB'][value]}`}))});
    size = `${tier} ${index === null ? '(size needed)' : `C${index}`} · existing Redis contract`;
    const candidate = index ?? 1;
    quantity = index === null ? null : 1;
    charge('Cache capacity',times(quantity,hours),rate(`Azure Redis Cache ${tier}`,`C${candidate} Cache`));
    notes.push(`${p.sku ? 'Declared' : 'Proposed'} ${tier} tier. Standard meter includes the primary/replica pair; it is not billed twice. This prices the existing Azure Redis contract, not a migration to Managed Redis. Confirm the provider’s actual SKU and deployment eligibility.`);
    if (!p.sku) proposed = true;
  } else if (/azure-openai/i.test(provider)) {
    const models = p.models ?? [];
    size = models.map(m => m.name).join(' · ') || 'Model deployments needed';
    if (!models.length) missing.push('Model names and deployment SKUs');
    for (const model of models) {
      const sku = model.sku ?? 'GlobalStandard', suffix = sku === 'Standard' ? 'regional' : sku === 'GlobalStandard' ? 'glbl' : undefined;
      if (!model.sku) notes.push(`${model.name}: GlobalStandard is a proposed billing mode; deployment SKU was not declared.`);
      if (model.name.startsWith('text-embedding-3-')) {
        charge(`${model.name} input`,times(input(`${model.name}:input`,`${model.name} input`,'million tokens / month',5),1000),suffix ? rate('Azure OpenAI',`${model.name}-${suffix} Tokens`) : undefined);
      } else {
        const is52 = model.name === 'gpt-5.2';
        const prefix = model.name === 'gpt-4.1' ? 'gpt 4.1' : model.name === 'gpt-4.1-mini' ? 'gpt 4.1 mini' : undefined;
        for (const [key,suggestion] of [['input',1],['output',0.25]] as const) {
          const meterName = is52 ? `GPT 5.2 ${key === 'input' ? 'inp' : 'opt'} Gl 1M Tokens` : `${prefix} ${key === 'input' ? 'Inp' : 'Outp'} glbl Tokens`;
          charge(`${model.name} ${key}`,times(input(`${model.name}:${key}`,`${model.name} ${key}`,'million tokens / month',suggestion),is52 ? 1 : 1000),suffix === 'glbl' && (is52 || prefix) ? rate(is52 ? 'Azure OpenAI GPT5' : 'Azure OpenAI',meterName) : undefined);
        }
      }
    }
    notes.push('Capacity in the repo is a rate-limit allocation, not monthly token consumption. Uses uncached standard inference, not batch/commitment discounts. Missing regional model meters remain unresolved.');
  } else if (/Front Door Premium/i.test(node.technology)) {
    const zone = options.edgeZone ?? (region === 'uaenorth' ? 'Zone 7' : 'Zone 1');
    size = `Premium · ${zone} traffic scenario`;
    charge('Profile base fee',1,azureRate(zone,'Azure Front Door','Premium Base Fees'));
    charge('Edge requests',times(input('requests','Edge requests','requests / month',1000000),1/10000),azureRate(zone,'Azure Front Door','Premium Requests'));
    charge('Edge → client',input('egressGB','Responses from edge to clients','GB / month',100),azureRate(zone,'Azure Front Door','Premium Data Transfer Out'));
    charge('Edge → origin',input('originGB','Uploads / requests from edge to origin','GB / month',10),azureRate(zone,'Azure Front Door','Premium Data Transfer In'));
    notes.push('The full-month base fee includes WAF and Front Door private link; neither is charged again. Traffic zone is proposed, independent of the origin region. Multi-zone traffic needs separate estimates; CAPTCHA/edge actions are excluded.');
  } else if (/key.?vault/i.test(node.technology)) {
    size = 'Standard vault · secret operations';
    charge('Secret operations',times(input('operations','Secret operations','operations / month',100000),1/10000),rate('Key Vault','Operations'));
    if (node.details.some(d => /private endpoint/i.test(d))) {
      size += ' · 1 private endpoint';
      charge('Vault private endpoint',hours,rate('Virtual Network Private Link','Standard Private Endpoint',true));
      charge('Private endpoint ingress',input('ingressGB','Vault endpoint ingress','GB / month',1),rate('Virtual Network Private Link','Standard Data Processed - Ingress',true));
      charge('Private endpoint egress',input('egressGB','Vault endpoint egress','GB / month',1),rate('Virtual Network Private Link','Standard Data Processed - Egress',true));
    }
    notes.push('Secret operations and declared private endpoint. Certificates, HSM/key operations and private DNS allocation are excluded.');
  } else {
    // Unknown provider implementations cannot be turned into guessed Azure database/cache purchases.
    quantity = null;
    const reason = /cortex-postgresql/.test(provider) ? 'Cortex PostgreSQL: provider-owned instance sizes, HA placement, disks and backups are not in this app contract.'
      : /cortex-(redis|spicedb)/.test(provider) ? 'Provider-created pods are not sized in the app manifests. Obtain their requests/replicas and storage allocation from the Cortex provider.'
      : /ingress|\/Service$/i.test(node.technology) ? 'Routing declaration: no separate cloud price per route. Its controller, load balancer and network allocation belong to the shared platform.'
      : node.id === 'existing-cortex-platform' ? 'Supply this application’s share of cluster controllers, control plane, node disks, ingress/load balancers, observability and network costs. App worker capacity is already counted.'
      : `The ${node.technology} contract has no supported price mapping for its current SKU. Supply a verified owner quote or add a catalog mapping.`;
    notes.push(reason);
    const allocation = input('monthlyAllocation','Additional owner allocation / quote','USD / month',null);
    if (allocation !== null) meters.push({label:'User-supplied allocation',quantity:1,unit:'month',tiers:[],monthly:allocation,note:'User quote, not a catalog-verified rate. Exclude any amount already counted in workers or another platform row.'});
    else missing.push(reason);
    size = /ingress|\/Service$/i.test(node.technology) ? 'Shared platform routing' : size;
  }
  const subtotal = meters.some(m => m.monthly !== null) ? round(meters.reduce((sum,m)=>sum+(m.monthly ?? 0),0)) : null;
  const globalEdge = /Front Door Premium/i.test(node.technology);
  return { id:node.id, name:node.name, size, quantity, monthly:subtotal, basis:proposed ? 'proposed' : 'repository', status:missing.length ? subtotal === null ? 'input-required' : 'partial' : 'estimated', note:[...notes, ...(globalEdge ? ['Front Door is a global service; the traffic zone does not set an origin deployment region.'] : declaredRegion ? [`Resource region ${declaredRegion} is declared in the repository and is retained when the worker region changes.`] : [`Resource region ${resourceRegion} is a proposed pricing location.`])].join(' '), region:globalEdge ? 'Global' : resourceRegion, inputs, meters, missing:[...new Set(missing)], source:meters.find(m=>m.source)?.source };
}
