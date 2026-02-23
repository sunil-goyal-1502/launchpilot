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
      instanceType: 'B2s',
      vCPUs: 2,
      memoryGB: 4,
      count: 1,
      autoScaling: false,
    },
    database: {
      instanceType: 'B_Standard_B1s',
      storageGB: 20,
      multiAZ: false,
      readReplicas: 0,
    },
    cache: {
      engine: 'redis',
      nodeType: 'C0',
      nodes: 1,
      replication: false,
      memoryGB: 0.25,
    },
    queue: {
      type: 'Service Bus Basic',
      estimatedMessagesPerDay: 10000,
    },
    streaming: {
      type: 'Event Hubs Basic',
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
      instanceType: 'D2s_v5',
      vCPUs: 2,
      memoryGB: 8,
      count: 2,
      autoScaling: true,
      minInstances: 2,
      maxInstances: 6,
    },
    database: {
      instanceType: 'GP_Standard_D2ds_v4',
      storageGB: 100,
      multiAZ: true,
      readReplicas: 1,
    },
    cache: {
      engine: 'redis',
      nodeType: 'C1',
      nodes: 2,
      replication: true,
      memoryGB: 1,
    },
    queue: {
      type: 'Service Bus Standard',
      estimatedMessagesPerDay: 100000,
    },
    streaming: {
      type: 'Event Hubs Standard',
      shards: 2,
      retentionHours: 72,
    },
    network: {
      loadBalancer: true,
      loadBalancerType: 'Application Gateway',
      cdn: true,
      cdnProvider: 'Azure Front Door',
      waf: true,
      natGateway: true,
      staticIP: true,
    },
    securityTier: 'standard',
    estimatedUsers: '1,000-50,000',
  },
  high: {
    compute: {
      instanceType: 'D8s_v5',
      vCPUs: 8,
      memoryGB: 32,
      count: 4,
      autoScaling: true,
      minInstances: 4,
      maxInstances: 20,
    },
    database: {
      instanceType: 'BC_Standard_D2ds_v4',
      storageGB: 500,
      multiAZ: true,
      readReplicas: 2,
    },
    cache: {
      engine: 'redis',
      nodeType: 'P1',
      nodes: 3,
      replication: true,
      memoryGB: 6,
    },
    queue: {
      type: 'Service Bus Premium',
      estimatedMessagesPerDay: 1000000,
    },
    streaming: {
      type: 'Event Hubs Standard',
      shards: 6,
      retentionHours: 168,
    },
    network: {
      loadBalancer: true,
      loadBalancerType: 'Application Gateway',
      cdn: true,
      cdnProvider: 'Azure Front Door',
      waf: true,
      natGateway: true,
      staticIP: true,
    },
    securityTier: 'advanced',
    estimatedUsers: '50,000-500,000+',
  },
};

export function getAzureTemplate(tier: StrategyTier): TierTemplate {
  return templates[tier];
}
