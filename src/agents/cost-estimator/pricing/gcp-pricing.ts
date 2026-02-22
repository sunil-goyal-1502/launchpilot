import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pricesPath = join(__dirname, '..', '..', '..', '..', 'data', 'pricing', 'gcp-prices.json');

interface ServicePrices {
  cache: Record<string, { hourlyPrice: number }>;
  queue: Record<string, number>;
  streaming: Record<string, number>;
}

interface GCPPrices {
  compute: Record<string, { vCPUs: number; memoryGB: number; hourlyPrice: number }>;
  database: Record<string, { hourlyPrice: number }>;
  storage: Record<string, number>;
  network: Record<string, number>;
  security: Record<string, number>;
  services: ServicePrices;
  other: Record<string, number>;
}

let cached: GCPPrices | null = null;

export function getGCPPrices(): GCPPrices {
  if (!cached) {
    cached = JSON.parse(readFileSync(pricesPath, 'utf-8')) as GCPPrices;
  }
  return cached;
}

export function getComputePrice(instanceType: string): number {
  return getGCPPrices().compute[instanceType]?.hourlyPrice ?? 0;
}

export function getDBPrice(instanceType: string): number {
  return getGCPPrices().database[instanceType]?.hourlyPrice ?? 0;
}

export function getNetworkPrice(key: string): number {
  return (getGCPPrices().network as Record<string, number>)[key] ?? 0;
}

export function getSecurityPrice(key: string): number {
  return (getGCPPrices().security as Record<string, number>)[key] ?? 0;
}

export function getCachePrice(nodeType: string): number {
  return getGCPPrices().services.cache[nodeType]?.hourlyPrice ?? 0;
}

export function getQueuePrice(key: string): number {
  return getGCPPrices().services.queue[key] ?? 0;
}

export function getStreamPrice(key: string): number {
  return getGCPPrices().services.streaming[key] ?? 0;
}
