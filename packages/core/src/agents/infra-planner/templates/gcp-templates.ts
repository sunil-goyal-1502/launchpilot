import { ComputeResource, DatabaseResource, NetworkResource, CacheResource, QueueResource, StreamResource, SecurityTier, StrategyTier } from '../../../types/index';

interface TierTemplate {
  compute: ComputeResource;
  database: Omit<DatabaseResource, 'engine'>;
  network: NetworkResource;
  cache: Omit<CacheResource, 'service'>;
  queue: Omit<QueueResource, 'service'>;
  streaming: Omit<StreamResource, 'service'>;
  securityTier: SecurityTier;
  estimatedUsers: string;
}

const templates: Record<StrategyTier, TierTemplate> = {
  low: {
    compute: {
      instanceType: 'e2-small',
      vCPUs: 0.5,
      memoryGB: 2,
      count: 1,
      autoScaling: false,
    },
    database: {
      instanceType: 'db-f1-micro',
      storageGB: 20,
      multiAZ: false,
      readReplicas: 0,
    },
    cache: {
      engine: 'redis',
      nodeType: 'M1',
      nodes: 1,
      replication: false,
      memoryGB: 1,
    },
    queue: {
      type: 'Cloud Tasks',
      estimatedMessagesPerDay: 10000,
    },
    streaming: {
      type: 'Pub/Sub',
      shards: 1,
      retentionHours: 24,
    },
    network: {
      loadBalancer: false,
      cdn: false,
      waf: false,
      natGateway: false,
      staticIP: true,
    },
    securityTier: 'basic',
    estimatedUsers: '0-1,000',
  },
  medium: {
    compute: {
      instanceType: 'e2-standard-2',
      vCPUs: 2,
      memoryGB: 8,
      count: 2,
      autoScaling: true,
      minInstances: 2,
      maxInstances: 6,
    },
    database: {
      instanceType: 'db-n1-standard-1',
      storageGB: 100,
      multiAZ: true,
      readReplicas: 1,
    },
    cache: {
      engine: 'redis',
      nodeType: 'M2',
      nodes: 2,
      replication: true,
      memoryGB: 4,
    },
    queue: {
      type: 'Cloud Tasks',
      estimatedMessagesPerDay: 100000,
    },
    streaming: {
      type: 'Pub/Sub',
      shards: 2,
      retentionHours: 72,
    },
    network: {
      loadBalancer: true,
      loadBalancerType: 'Cloud Load Balancer',
      cdn: true,
      cdnProvider: 'Cloud CDN',
      waf: true,
      natGateway: true,
      staticIP: true,
    },
    securityTier: 'standard',
    estimatedUsers: '1,000-50,000',
  },
  high: {
    compute: {
      instanceType: 'c2-standard-4',
      vCPUs: 4,
      memoryGB: 16,
      count: 4,
      autoScaling: true,
      minInstances: 4,
      maxInstances: 20,
    },
    database: {
      instanceType: 'db-n1-standard-2',
      storageGB: 500,
      multiAZ: true,
      readReplicas: 2,
    },
    cache: {
      engine: 'redis',
      nodeType: 'M3',
      nodes: 3,
      replication: true,
      memoryGB: 12,
    },
    queue: {
      type: 'Cloud Tasks',
      estimatedMessagesPerDay: 1000000,
    },
    streaming: {
      type: 'Pub/Sub',
      shards: 6,
      retentionHours: 168,
    },
    network: {
      loadBalancer: true,
      loadBalancerType: 'Cloud Load Balancer',
      cdn: true,
      cdnProvider: 'Cloud CDN',
      waf: true,
      natGateway: true,
      staticIP: true,
    },
    securityTier: 'advanced',
    estimatedUsers: '50,000-500,000+',
  },
};

export function getGCPTemplate(tier: StrategyTier): TierTemplate {
  return templates[tier];
}
