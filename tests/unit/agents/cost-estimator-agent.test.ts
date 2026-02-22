import { describe, it, expect } from 'vitest';
import { calculateCost } from '../../../src/agents/cost-estimator/calculator.js';
import { CloudProvider, ScalingStrategy } from '../../../src/types/index.js';

function createMockStrategy(overrides: Partial<ScalingStrategy> = {}): ScalingStrategy {
  return {
    tier: 'medium',
    name: 'Production',
    description: 'Balanced for production',
    provider: CloudProvider.AWS,
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
      engine: 'postgresql',
      storageGB: 100,
      multiAZ: true,
      readReplicas: 1,
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
    ...overrides,
  };
}

describe('CostEstimator Calculator', () => {
  it('should calculate costs for a medium AWS strategy', () => {
    const strategy = createMockStrategy();
    const breakdown = calculateCost(strategy);

    expect(breakdown.total).toBeGreaterThan(0);
    expect(breakdown.lineItems.length).toBeGreaterThan(0);
    expect(breakdown.currency).toBe('USD');
  });

  it('should include compute costs', () => {
    const strategy = createMockStrategy();
    const breakdown = calculateCost(strategy);

    const computeItem = breakdown.lineItems.find(i => i.service === 'Compute');
    expect(computeItem).toBeDefined();
    expect(computeItem!.monthlyTotal).toBeGreaterThan(0);
  });

  it('should include database costs when strategy has a database', () => {
    const strategy = createMockStrategy();
    const breakdown = calculateCost(strategy);

    const dbItem = breakdown.lineItems.find(i => i.service === 'Database');
    expect(dbItem).toBeDefined();
    expect(dbItem!.monthlyTotal).toBeGreaterThan(0);
  });

  it('should skip database costs when no database', () => {
    const strategy = createMockStrategy({ database: undefined });
    const breakdown = calculateCost(strategy);

    const dbItem = breakdown.lineItems.find(i => i.service === 'Database');
    expect(dbItem).toBeUndefined();
  });

  it('should apply reserved discount for medium+ tiers', () => {
    const strategy = createMockStrategy({ tier: 'medium' });
    const breakdown = calculateCost(strategy);

    expect(breakdown.reservedDiscount).toBeGreaterThan(0);
    expect(breakdown.total).toBeLessThan(breakdown.subtotal);
  });

  it('should not apply reserved discount for low tier', () => {
    const strategy = createMockStrategy({ tier: 'low' });
    const breakdown = calculateCost(strategy);

    expect(breakdown.reservedDiscount).toBe(0);
    expect(breakdown.total).toBe(breakdown.subtotal);
  });

  it('should calculate GCP costs', () => {
    const strategy = createMockStrategy({
      provider: CloudProvider.GCP,
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
        engine: 'postgresql',
        storageGB: 100,
        multiAZ: true,
        readReplicas: 1,
      },
    });
    const breakdown = calculateCost(strategy);

    expect(breakdown.total).toBeGreaterThan(0);
  });

  it('should include cache cost line item', () => {
    const strategy = createMockStrategy({
      cache: {
        service: 'ElastiCache',
        engine: 'redis',
        nodeType: 'cache.t3.medium',
        nodes: 2,
        replication: true,
        memoryGB: 3,
      },
    });
    const breakdown = calculateCost(strategy);

    const cacheItem = breakdown.lineItems.find(i => i.service === 'Cache');
    expect(cacheItem).toBeDefined();
    expect(cacheItem!.monthlyTotal).toBeGreaterThan(0);
  });

  it('should include queue cost line item', () => {
    const strategy = createMockStrategy({
      queue: {
        service: 'SQS',
        type: 'SQS Standard',
        estimatedMessagesPerDay: 100000,
      },
    });
    const breakdown = calculateCost(strategy);

    const queueItem = breakdown.lineItems.find(i => i.service === 'Queue');
    expect(queueItem).toBeDefined();
    expect(queueItem!.monthlyTotal).toBeGreaterThan(0);
  });

  it('should include streaming cost line item', () => {
    const strategy = createMockStrategy({
      streaming: {
        service: 'Kinesis/MSK',
        type: 'Kinesis',
        shards: 2,
        retentionHours: 48,
      },
    });
    const breakdown = calculateCost(strategy);

    const streamItem = breakdown.lineItems.find(i => i.service === 'Streaming');
    expect(streamItem).toBeDefined();
    expect(streamItem!.monthlyTotal).toBeGreaterThan(0);
  });

  it('should calculate Azure costs', () => {
    const strategy = createMockStrategy({
      provider: CloudProvider.Azure,
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
        engine: 'postgresql',
        storageGB: 100,
        multiAZ: true,
        readReplicas: 1,
      },
    });
    const breakdown = calculateCost(strategy);

    expect(breakdown.total).toBeGreaterThan(0);
  });
});
