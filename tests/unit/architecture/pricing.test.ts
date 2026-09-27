import { describe, it, expect } from 'vitest';
import { estimateArchitectureCost, architecturePricingRegion } from '../../../packages/core/src/architecture/cost';
import { deploymentPricing, type DeploymentNode, type DeploymentTopology } from '../../../packages/core/src/architecture/deployment-topology';
import { estimateServiceCost } from '../../../packages/core/src/architecture/service-cost';
import { azureRate, tieredCost } from '../../../packages/core/src/architecture/retail-pricing';

function node(provider: string, params: Record<string,unknown> = {}, config: Record<string,unknown> = {}): DeploymentNode {
  return { id:provider,name:provider,kind:'service',technology:`${provider} (Cortex capability)`,basis:'repository',layer:'data',owner:'Cortex',details:[],resourceIds:[],evidenceIds:[],pricing:deploymentPricing(provider,config,{location:'uaenorth',...params}) };
}
function topology(nodes: DeploymentNode[]): DeploymentTopology {
  return { version:1,architectureId:'fixture',unitIds:['preprod'],owner:'Cortex',namespaces:['app'],nodes,workloads:[],connections:[],controls:[],limitations:[],totals:{workloads:0,applicationPods:0,unspecifiedWorkloads:0,applicationContainers:0,initContainers:0} };
}
const estimate = (n:DeploymentNode, usage:Record<string,number|null>={}) => estimateServiceCost(n,'eastus',730,{usage:{[n.id]:usage}});

describe('deployment-grounded service prices',()=>{
  it('retains only public pricing selectors and merges explicit model declarations without secrets',()=>{
    const p=deploymentPricing('azure-openai',{additionalModels:[{name:'gpt-5.2',sku:'GlobalStandard',capacity:'500',key:'never-export'}]}, {location:'uaenorth',sku:'S0',modelName:'gpt-4.1',modelVersion:'2025-04-14',connectionString:'secret',adminPassword:'never-export',replicaCount:'2'});
    expect(p).toMatchObject({region:'uaenorth',replicas:2,models:[{name:'gpt-4.1',version:'2025-04-14'},{name:'gpt-5.2',sku:'GlobalStandard'}]});
    expect(JSON.stringify(p)).not.toMatch(/secret|never-export|capacity|Password/);
  });
  it('uses each resource’s declared region and proposes worker co-location only for one Azure region',()=>{
    const search=node('azure-search',{sku:'standard',replicaCount:'2',partitionCount:'3'});
    const cost=estimateArchitectureCost(topology([search]),'azure',{region:'eastus'});
    expect(architecturePricingRegion(topology([search]),'azure')).toBe('uaenorth');
    expect(architecturePricingRegion(topology([search]),'aws')).toBe('us-west-2');
    expect(cost.lines[0]).toMatchObject({quantity:6,monthly:1471.68,region:'uaenorth',status:'estimated'});
    expect(cost.lines[0].meters![0].tiers[0].price).toBe(.336); // Regular S1, not confidential-compute pricing.
    search.pricing!.computeType='confidential';expect(estimate(search).meters![0].tiers[0].price).toBe(.3696);
  });
  it('prices Premium messaging units per partition and makes undeclared quantities explicit',()=>{
    const bus=node('azure-service-bus',{sku:'Premium'});
    expect(estimate(bus)).toMatchObject({monthly:714.67,basis:'proposed'});
    expect(estimate(bus).inputs!.map(i=>i.label)).toEqual(['Messaging units per partition','Service Bus partitions']);
    expect(estimate(bus,{messagingUnits:2,partitions:2}).monthly).toBe(2858.68);
    expect(estimateServiceCost(bus,'uaenorth',730,{usageMode:'rates-only'}).monthly).toBeNull();
  });
  it('calculates progressive tiers in billing units, including shared Event Grid allowance',()=>{
    const blob=azureRate('uaenorth','General Block Blob v2','Hot LRS Data Stored')!;
    expect(tieredCost(blob,60000)).toBeCloseTo(51200*.020275+8800*.019464,6);
    const event=node('azure-storage-event-route');
    expect(estimate(event,{operations:1000000,allowanceUsed:0}).monthly).toBe(.54);
    expect(estimate(event,{operations:1000000,allowanceUsed:100000}).monthly).toBe(.6);
    expect(estimate(event,{operations:0}).monthly).toBe(0); // Explicit zero, not missing usage.
  });
  it('covers the declared service families using real regional retail meters',()=>{
    const expected:[DeploymentNode,number][]=[
      [node('azure-app-config',{sku:'standard'}),37.1],
      [node('azure-storage',{sku:'Standard_LRS'}),2.2],
      [node('azure-speech',{sku:'S0'}),25],
      [node('azure-document-intelligence',{sku:'S0'}),11.5],
      [node('azure-translator',{sku:'S1'}),25],
      [node('azure-redis'),132.86],
    ];
    for(const [service,total] of expected){const cost=estimate(service);expect(cost.monthly,service.name).toBe(total);expect(cost.status,service.name).toBe('estimated');expect(cost.meters!.every(m=>m.tiers.length && m.source?.startsWith('https://prices.azure.com/'))).toBe(true);}
  });
  it('recalculates usage while rates-only mode keeps missing quantities out of the subtotal',()=>{
    const speech=node('azure-speech',{sku:'S0'});
    expect(estimate(speech,{audioHours:20}).monthly).toBe(35);
    const empty=estimateServiceCost(speech,'eastus',730,{usageMode:'rates-only'});
    expect(empty.monthly).toBeNull();expect(empty.meters![0].tiers[0].price).toBe(1);
    expect(estimate(speech,{audioHours:null}).status).toBe('partial');
    expect(()=>estimate(speech,{audioHours:-1})).toThrow('Invalid cost input');
    expect(()=>estimate(speech,{audioHours:Infinity})).toThrow('Invalid cost input');
  });
  it('prices each declared model and never substitutes an East US embedding rate for UAE North',()=>{
    const ai=node('azure-openai',{sku:'S0',modelName:'gpt-4.1',embeddingModelName:'text-embedding-3-large',embeddingModelSku:'Standard'}, {additionalModels:[{name:'gpt-4.1-mini',sku:'GlobalStandard'},{name:'gpt-5.2',sku:'GlobalStandard'}]});
    const cost=estimate(ai);expect(cost.monthly).toBe(10.05);expect(cost.status).toBe('partial');
    expect(cost.missing!.some(m=>m.includes('text-embedding-3-large'))).toBe(true);
    expect(cost.note).toContain('rate-limit allocation, not monthly token consumption');
    const completed=estimate(ai,{'quote:text-embedding-3-large input':10});expect(completed.monthly).toBe(20.05);expect(completed.status).toBe('estimated');
    ai.pricing!.region='eastus';expect(estimate(ai).monthly).toBe(10.77);
  });
  it('keeps unsupported SKUs unresolved and only falls back to explicitly global billing meters',()=>{
    expect(azureRate('unknown','Azure AI Search','Standard S1 Unit')).toBeUndefined();
    expect(azureRate('uaenorth','Translator Text','S1 Characters')).toBeUndefined();
    expect(azureRate('uaenorth','Translator Text','S1 Characters',true)?.region).toBe('Global');
    expect(azureRate('usgovvirginia','Translator Text','S1 Characters',true)).toBeUndefined();
    expect(estimate(node('azure-search',{sku:'unknown',replicaCount:1,partitionCount:1})).monthly).toBeNull();
    const invalid=node('azure-openai',{modelName:'gpt-5.2',modelSku:'ProvisionedManaged'});expect(estimate(invalid).monthly).toBeNull();
  });
  it('prices Front Door by the selected traffic zone and keeps its WAF/private link included',()=>{
    const edge={...node('edge'),technology:'Azure Front Door Premium + WAF'};
    const cost=estimateServiceCost(edge,'uaenorth',365,{});
    expect(cost.monthly).toBe(343.28);expect(cost.meters![0].monthly).toBe(330);
    expect(cost.region).toBe('Global');
    expect(cost.meters).toHaveLength(4);
    expect(estimateServiceCost(edge,'uaenorth',730,{usageMode:'rates-only'}).monthly).toBe(330);
    expect(estimateServiceCost(edge,'uaenorth',730,{edgeZone:'Zone 1'}).monthly).toBe(339.95);
  });
  it('prices the selected vault private endpoint separately from Front Door private link',()=>{
    const vault={...node('vault'),technology:'Azure Key Vault',details:['Private endpoint + existing private DNS zone']};
    const cost=estimate(vault);expect(cost.monthly).toBe(7.72);expect(cost.meters!.find(m=>m.label==='Vault private endpoint')?.monthly).toBe(7.3);
    vault.details=[];expect(estimate(vault).monthly).toBe(.4);
  });
  it('does not invent managed database/cache purchases or charge per Kubernetes route',()=>{
    const db=node('cortex-postgresql');const platform={...node('platform'),id:'existing-cortex-platform'};const ingress={...node('ingress'),technology:'networking.k8s.io/v1/Ingress'};
    const cost=estimateArchitectureCost(topology([db,platform,ingress]));
    expect(cost.pricedSubtotal).toBeNull();expect(cost.lines.find(l=>l.id===ingress.id)?.includedIn).toBe('existing-cortex-platform');
    expect(estimate(db,{monthlyAllocation:120}).monthly).toBe(120);expect(estimate(db,{monthlyAllocation:120}).note).toContain('provider-owned');
  });
});
