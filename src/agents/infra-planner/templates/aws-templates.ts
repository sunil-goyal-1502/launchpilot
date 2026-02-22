import { ComputeResource, DatabaseResource, NetworkResource, CacheResource, QueueResource, StreamResource, SecurityTier, StrategyTier } from '../../../types/index.js';

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
      instanceType: 't3.small',
      vCPUs: 2,
      memoryGB: 2,
      count: 1,
      autoScaling: false,
    },
    database: {
      instanceType: 'db.t3.micro',
      storageGB: 20,
      multiAZ: false,
      readReplicas: 0,
    },
    cache: {
      engine: 'redis',
      nodeType: 'cache.t3.micro',
      nodes: 1,
      replication: false,
      memoryGB: 0.5,
    },
    queue: {
      type: 'SQS Standard',
      estimatedMessagesPerDay: 10000,
    },
    streaming: {
      type: 'Kinesis',
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
      instanceType: 't3.large',
      vCPUs: 2,
      memoryGB: 8,
      count: 2,
      autoScaling: true,
      minInstances: 2,
      maxInstances: 6,
    },
    database: {
      instanceType: 'db.t3.medium',
      storageGB: 100,
      multiAZ: true,
      readReplicas: 1,
    },
    cache: {
      engine: 'redis',
      nodeType: 'cache.t3.medium',
      nodes: 2,
      replication: true,
      memoryGB: 3,
    },
    queue: {
      type: 'SQS Standard',
      estimatedMessagesPerDay: 100000,
    },
    streaming: {
      type: 'MSK Serverless',
      shards: 2,
      retentionHours: 48,
    },
    network: {
      loadBalancer: true,
      loadBalancerType: 'ALB',
      cdn: true,
      cdnProvider: 'CloudFront',
      waf: true,
      natGateway: true,
      staticIP: true,
    },
    securityTier: 'standard',
    estimatedUsers: '1,000-50,000',
  },
  high: {
    compute: {
      instanceType: 'c6i.2xlarge',
      vCPUs: 8,
      memoryGB: 16,
      count: 4,
      autoScaling: true,
      minInstances: 4,
      maxInstances: 20,
    },
    database: {
      instanceType: 'db.r6g.xlarge',
      storageGB: 500,
      multiAZ: true,
      readReplicas: 2,
    },
    cache: {
      engine: 'redis',
      nodeType: 'cache.r6g.large',
      nodes: 3,
      replication: true,
      memoryGB: 13,
    },
    queue: {
      type: 'SQS FIFO',
      estimatedMessagesPerDay: 1000000,
    },
    streaming: {
      type: 'MSK',
      shards: 6,
      retentionHours: 168,
    },
    network: {
      loadBalancer: true,
      loadBalancerType: 'ALB',
      cdn: true,
      cdnProvider: 'CloudFront',
      waf: true,
      natGateway: true,
      staticIP: true,
    },
    securityTier: 'advanced',
    estimatedUsers: '50,000-500,000+',
  },
};

export function getAWSTemplate(tier: StrategyTier): TierTemplate {
  return templates[tier];
}
