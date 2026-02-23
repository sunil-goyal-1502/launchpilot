import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pricesPath = join(__dirname, '..', '..', '..', '..', 'data', 'pricing', 'azure-prices.json');

interface ServicePrices {
  cache: Record<string, { hourlyPrice: number }>;
  queue: Record<string, number>;
  streaming: Record<string, number>;
}

interface AzurePrices {
  compute: Record<string, { vCPUs: number; memoryGB: number; hourlyPrice: number }>;
  database: Record<string, { hourlyPrice: number }>;
  storage: Record<string, number>;
  network: Record<string, number>;
  security: Record<string, number>;
  services: ServicePrices;
  other: Record<string, number>;
}

let cached: AzurePrices | null = null;

export function getAzurePrices(): AzurePrices {
  if (!cached) {
    cached = JSON.parse(readFileSync(pricesPath, 'utf-8')) as AzurePrices;
  }
  return cached;
}

export function getComputePrice(instanceType: string): number {
  return getAzurePrices().compute[instanceType]?.hourlyPrice ?? 0;
}

export function getDBPrice(instanceType: string): number {
  return getAzurePrices().database[instanceType]?.hourlyPrice ?? 0;
}

export function getNetworkPrice(key: string): number {
  return (getAzurePrices().network as Record<string, number>)[key] ?? 0;
}

export function getSecurityPrice(key: string): number {
  return (getAzurePrices().security as Record<string, number>)[key] ?? 0;
}

export function getCachePrice(nodeType: string): number {
  return getAzurePrices().services.cache[nodeType]?.hourlyPrice ?? 0;
}

export function getQueuePrice(key: string): number {
  return getAzurePrices().services.queue[key] ?? 0;
}

export function getStreamPrice(key: string): number {
  return getAzurePrices().services.streaming[key] ?? 0;
}
