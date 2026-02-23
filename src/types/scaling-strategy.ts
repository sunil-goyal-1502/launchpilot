import { CloudProvider } from './cloud-provider.types.js';
import { CostBreakdown } from './cost-estimate.js';

export type StrategyTier = 'low' | 'medium' | 'high';

export interface ComputeResource {
  instanceType: string;
  vCPUs: number;
  memoryGB: number;
  count: number;
  autoScaling: boolean;
  minInstances?: number;
  maxInstances?: number;
}

export interface DatabaseResource {
  instanceType: string;
  engine: string;
  storageGB: number;
  multiAZ: boolean;
  readReplicas: number;
}

export interface CacheResource {
  service: string;
  engine: string;
  nodeType: string;
  nodes: number;
  replication: boolean;
  memoryGB: number;
}

export interface QueueResource {
  service: string;
  type: string;
  estimatedMessagesPerDay: number;
}

export interface StreamResource {
  service: string;
  type: string;
  shards: number;
  retentionHours: number;
}

export interface AuthResource {
  service: string;
  estimatedMAU: number;
}

export interface ObjectStorageResource {
  service: string;
  estimatedGB: number;
  cdn: boolean;
}

export interface NetworkResource {
  loadBalancer: boolean;
  loadBalancerType?: string;
  cdn: boolean;
  cdnProvider?: string;
  waf: boolean;
  natGateway: boolean;
  staticIP: boolean;
}

export type SecurityTier = 'basic' | 'standard' | 'advanced';

export interface VendorSubscription {
  vendorName: string;
  pricingTier: string;
  monthlyEstimate: number;
  features: string[];
  requiredEnvVars: string[];
  signupUrl: string;
}

export interface ScalingStrategy {
  tier: StrategyTier;
  name: string;
  description: string;
  provider: CloudProvider;
  compute: ComputeResource;
  database?: DatabaseResource;
  cache?: CacheResource;
  queue?: QueueResource;
  streaming?: StreamResource;
  auth?: AuthResource;
  objectStorage?: ObjectStorageResource;
  baasReplacements?: Array<{ original: string; feature: string; replacement: string }>;
  vendorSubscription?: VendorSubscription;
  network: NetworkResource;
  securityTier: SecurityTier;
  costBreakdown?: CostBreakdown;
  estimatedUsers: string; // e.g., "0-1,000", "1,000-50,000"
}
