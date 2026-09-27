import catalog from './prices/azure-supported.json';

export type RetailMeter = typeof catalog.rows[number];
export const priceCatalogDate = catalog.checkedAt;
export interface RetailRate {
  unit: string; region: string; source: string;
  tiers: Array<{ from: number; price: number; meterId: string }>;
}
/** Exact commercial meter match. Global fallback is allowed only for explicitly global-billed products. */
export function azureRate(region: string, product: string, meter: string, globalBilling = false): RetailRate | undefined {
  const active = catalog.rows.filter(r => r.effectiveStartDate.slice(0,10) <= catalog.checkedAt && r.retailPrice >= 0);
  let rows = active.filter(r => r.armRegionName === region && r.productName === product && r.meterName === meter);
  if (!rows.length && globalBilling && !/^(usgov|usdod|china)/i.test(region)) rows = active.filter(r => r.armRegionName === 'Global' && r.productName === product && r.meterName === meter);
  if (!rows.length || new Set(rows.map(r => r.unitOfMeasure)).size !== 1) return undefined;
  const tiers: RetailRate['tiers'] = [];
  for (const from of [...new Set(rows.map(r => r.tierMinimumUnits))].sort((a,b) => a-b)) {
    const matches = rows.filter(r => r.tierMinimumUnits === from).sort((a,b) => b.effectiveStartDate.localeCompare(a.effectiveStartDate));
    const latest = matches.filter(r => r.effectiveStartDate === matches[0].effectiveStartDate);
    if (new Set(latest.map(r => r.retailPrice)).size !== 1) return undefined; // Conflicting meters need review.
    tiers.push({ from, price: latest[0].retailPrice, meterId: latest[0].meterId });
  }
  if (tiers[0]?.from !== 0) return undefined;
  const filter = `productName eq '${product.replaceAll("'", "''")}' and meterName eq '${meter.replaceAll("'", "''")}' and armRegionName eq '${rows[0].armRegionName}' and priceType eq 'Consumption'`;
  return { unit: rows[0].unitOfMeasure, region: rows[0].armRegionName, tiers, source: `https://prices.azure.com/api/retail/prices?$filter=${encodeURIComponent(filter)}` };
}
/** Quantities and tier boundaries both use the meter's billing unit (e.g. 100K operations). */
export function tieredCost(rate: RetailRate, quantity: number): number {
  if (!Number.isFinite(quantity) || quantity < 0) throw new Error('A pricing quantity must be finite and non-negative');
  return rate.tiers.reduce((sum, t, index) => sum + Math.max(0, Math.min(quantity, rate.tiers[index + 1]?.from ?? Infinity) - t.from) * t.price, 0);
}
