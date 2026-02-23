import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pricesPath = join(__dirname, '..', '..', '..', '..', 'data', 'pricing', 'aws-prices.json');

interface InstanceSpec {
  vCPUs: number;
  memoryGB: number;
  hourlyPrice: number;
}

interface ServicePrices {
  cache: Record<string, { hourlyPrice: number }>;
  queue: Record<string, number>;
  streaming: Record<string, number>;
}

interface AWSPrices {
  compute: Record<string, InstanceSpec>;
  database: Record<string, { hourlyPrice: number }>;
  storage: Record<string, number>;
  network: Record<string, number>;
  security: Record<string, number>;
  services: ServicePrices;
  other: Record<string, number>;
}

let cached: AWSPrices | null = null;

export function getAWSPrices(): AWSPrices {
  if (!cached) {
    cached = JSON.parse(readFileSync(pricesPath, 'utf-8')) as AWSPrices;
  }
  return cached;
}

export function getComputePrice(instanceType: string): number {
  return getAWSPrices().compute[instanceType]?.hourlyPrice ?? 0;
}

export function getDBPrice(instanceType: string): number {
  return getAWSPrices().database[instanceType]?.hourlyPrice ?? 0;
}

export function getNetworkPrice(key: string): number {
  return (getAWSPrices().network as Record<string, number>)[key] ?? 0;
}

export function getSecurityPrice(key: string): number {
  return (getAWSPrices().security as Record<string, number>)[key] ?? 0;
}

export function getCachePrice(nodeType: string): number {
  return getAWSPrices().services.cache[nodeType]?.hourlyPrice ?? 0;
}

export function getQueuePrice(key: string): number {
  return getAWSPrices().services.queue[key] ?? 0;
}

export function getStreamPrice(key: string): number {
  return getAWSPrices().services.streaming[key] ?? 0;
}
