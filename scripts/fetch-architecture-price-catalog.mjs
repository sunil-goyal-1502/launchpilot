import { writeFile, mkdir, readFile } from 'node:fs/promises';
const region = process.argv[2] ?? 'uaenorth';
if (!/^[a-z0-9]+$/.test(region)) throw new Error('Use an Azure ARM region name');
const filters = region === 'global' ? [
  "contains(productName, 'Translator')", "contains(productName, 'Event Grid')", "contains(productName, 'Azure Front Door')", "serviceName eq 'Bandwidth'",
  "contains(productName, 'Private Link')", "contains(meterName, 'emb')",
] : process.argv.includes('--supplement') ? [
  "contains(productName, 'Speech')", "contains(serviceName, 'Kubernetes')", "contains(productName, 'Translator')", "contains(productName, 'Private Link')", "contains(meterName, 'Embedding')",
] : [
  "contains(serviceName, 'Search')", "serviceName eq 'Service Bus'", "serviceName eq 'Storage'",
  "contains(serviceName, 'Speech')", "contains(productName, 'Document Intelligence')", "contains(productName, 'Form Recognizer')",
  "contains(productName, 'Translator')", "contains(serviceName, 'Event Grid')", "serviceName eq 'App Configuration'",
  "contains(serviceName, 'Redis')", "serviceName eq 'Key Vault'", "contains(productName, 'Azure OpenAI')",
  "serviceName eq 'Virtual Machines' and armSkuName eq 'Standard_D4s_v5'", "serviceName eq 'Virtual Network'",
  "contains(productName, 'Private Link')", "contains(meterName, 'Embedding')", "contains(productName, 'Speech')",
];
const rows=[];
const cacheDirectory = '.cache/architecture-prices';
if(process.argv.includes('--supplement')) { try { rows.push(...JSON.parse(await readFile(`${cacheDirectory}/azure-${region}.json`,'utf8')).rows); } catch {} }
for (let offset=0;offset<filters.length;offset+=4) await Promise.all(filters.slice(offset,offset+4).map(async filter => {
  const url=new URL('https://prices.azure.com/api/retail/prices');
  url.searchParams.set('$filter', `${filter}${region === 'global' ? '' : ` and armRegionName eq '${region}'`} and priceType eq 'Consumption'`);
  let next=url.toString(), pages=0, count=0;
  while(next) {
    if(new URL(next).hostname!=='prices.azure.com') throw new Error('Unexpected catalog pagination host');
    const response=await fetch(next,{signal:AbortSignal.timeout(30000)});
    if(!response.ok) throw new Error(`${filter}: HTTP ${response.status}`);
    const data=await response.json();
    if(data.Error) throw new Error(JSON.stringify(data.Error));
    for(const item of data.Items??[]) rows.push(Object.fromEntries(['currencyCode','retailPrice','unitOfMeasure','meterId','meterName','productName','skuName','armSkuName','serviceName','armRegionName','effectiveStartDate','isPrimaryMeterRegion','type','tierMinimumUnits'].map(k=>[k,item[k]])));
    count+=(data.Items??[]).length;
    next=data.NextPageLink;
    if(++pages>30) throw new Error('Catalog pagination exceeded 30 pages; refusing partial results');
  }
  console.log(JSON.stringify({filter,count}));
}));
const unique=[...new Map(rows.map(row=>[JSON.stringify(row),row])).values()];
await mkdir(cacheDirectory,{recursive:true});
await writeFile(`${cacheDirectory}/azure-${region}.json`,JSON.stringify({region,currency:'USD',checkedAt:new Date().toISOString(),source:'https://prices.azure.com/api/retail/prices',rows:unique},null,2)+'\n');
console.log(JSON.stringify({region,records:unique.length,services:[...new Set(unique.map(r=>r.serviceName))]}));
