import { readFile, writeFile } from 'node:fs/promises';
// Exact product/meter families supported by the estimator; retain all volume tiers.
const supported = r => (
  r.productName === 'Virtual Machines Dsv5 Series' && r.meterName === 'D4s v5' ||
  r.productName === 'Azure AI Search' && / Unit$/.test(r.meterName) ||
  r.productName === 'Service Bus' && r.meterName === 'Premium Messaging Unit' ||
  r.productName === 'App Configuration' && ['Standard Instance', 'Standard Overage Operations'].includes(r.meterName) ||
  r.productName === 'General Block Blob v2' && r.skuName === 'Hot LRS' && ['Hot LRS Data Stored', 'Hot Read Operations', 'Hot LRS Write Operations', 'All Other Operations', 'LRS List and Create Container Operations'].includes(r.meterName) ||
  r.productName === 'Azure Document Intelligence' && ['S0 Read Pages', 'S0 Pre-built Pages', 'S0 Custom Pages'].includes(r.meterName) ||
  r.productName === 'Azure Speech' && ['S1 Speech To Text', 'S1 Neural Text To Speech Characters'].includes(r.meterName) ||
  r.productName === 'Key Vault' && r.skuName === 'Standard' && /Operations$/.test(r.meterName) ||
  /^Azure Redis Cache (Standard|Basic)$/.test(r.productName) && /^C[0-6] Cache$/.test(r.meterName) ||
  r.productName === 'Azure OpenAI' && /^(gpt 4\.1( mini)? (Inp|Outp) glbl|text-embedding-3-(large|small)-(regional|glbl)) Tokens$/.test(r.meterName) ||
  r.productName === 'Azure OpenAI GPT5' && /^GPT 5\.2 (inp|opt) Gl 1M Tokens$/.test(r.meterName) ||
  r.productName === 'Event Grid' && r.meterName === 'Standard Operations' ||
  r.productName === 'Translator Text' && ['S1 Characters', 'S1 Document Characters'].includes(r.meterName) ||
  r.productName === 'Azure Front Door' && r.skuName === 'Premium' && ['Premium Base Fees', 'Premium Data Transfer Out', 'Premium Data Transfer In', 'Premium Requests'].includes(r.meterName) ||
  r.productName === 'Virtual Network Private Link' && r.skuName === 'Standard'
);
const rows = [];
const snapshots = [];
for (const region of ['eastus', 'uaenorth', 'global']) {
  const data = JSON.parse(await readFile(`.cache/architecture-prices/azure-${region}.json`, 'utf8'));
  snapshots.push(data.checkedAt);
  rows.push(...data.rows.filter(r => ['eastus','uaenorth','Global', ...Array.from({length:8},(_,i)=>`Zone ${i+1}`)].includes(r.armRegionName) && r.currencyCode === 'USD' && r.type === 'Consumption' && supported(r)));
}
const unique = [...new Map(rows.map(r => [JSON.stringify(r), r])).values()].sort((a,b) => `${a.armRegionName}:${a.productName}:${a.meterName}:${a.tierMinimumUnits}`.localeCompare(`${b.armRegionName}:${b.productName}:${b.meterName}:${b.tierMinimumUnits}`));
await writeFile('packages/core/src/architecture/prices/azure-supported.json', JSON.stringify({checkedAt:snapshots.sort()[0].slice(0,10), source:'https://prices.azure.com/api/retail/prices', rows:unique},null,2)+'\n');
console.log(`Curated ${unique.length} official retail meters, including volume tiers.`);
