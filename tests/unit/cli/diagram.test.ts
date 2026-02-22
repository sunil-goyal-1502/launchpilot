import { describe, it, expect, vi } from 'vitest';
import { showArchitectureDiagram } from '../../../src/cli/diagram.js';
import { CloudProvider, ScalingStrategy, SecurityPolicy } from '../../../src/types/index.js';

function createMockStrategy(overrides: Partial<ScalingStrategy> = {}): ScalingStrategy {
  return {
    tier: 'medium',
    name: 'Production',
    description: '',
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

function createMockSecurity(): SecurityPolicy {
  return {
    tier: 'standard',
    waf: { enabled: true, rules: [], rateLimitRpm: 500 },
    network: {
      vpcEnabled: true,
      privateSubnets: true,
      publicSubnets: true,
      securityGroups: [],
      networkACLs: true,
      flowLogging: false,
    },
    tls: { minVersion: '1.2', hstsEnabled: true, hstsMaxAge: 31536000, certProvider: 'ACM' },
    iam: { leastPrivilege: true, serviceRoles: [], mfaRequired: false },
    secrets: { provider: 'Secrets Manager', envVarsToSecrets: {}, rotationEnabled: true, rotationDays: 90 },
    vulnerabilities: [],
  };
}

describe('Architecture Diagram', () => {
  it('should render without errors for a medium AWS strategy', () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(() => {
      showArchitectureDiagram(createMockStrategy(), createMockSecurity());
    }).not.toThrow();
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('should render without errors for a minimal low-tier strategy', () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const strategy = createMockStrategy({
      tier: 'low',
      database: undefined,
      network: {
        loadBalancer: false,
        cdn: false,
        waf: false,
        natGateway: false,
        staticIP: true,
      },
      securityTier: 'basic',
    });

    expect(() => {
      showArchitectureDiagram(strategy, createMockSecurity());
    }).not.toThrow();
    consoleSpy.mockRestore();
  });

  it('should render with cache, queue, and streaming services', () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const strategy = createMockStrategy({
      cache: {
        service: 'ElastiCache',
        engine: 'redis',
        nodeType: 'cache.t3.medium',
        nodes: 2,
        replication: true,
        memoryGB: 3,
      },
      queue: {
        service: 'SQS',
        type: 'SQS Standard',
        estimatedMessagesPerDay: 100000,
      },
      streaming: {
        service: 'Kinesis/MSK',
        type: 'Kinesis',
        shards: 2,
        retentionHours: 48,
      },
    });

    expect(() => {
      showArchitectureDiagram(strategy, createMockSecurity());
    }).not.toThrow();

    // Verify the data tier was rendered (should have more log calls)
    expect(consoleSpy.mock.calls.length).toBeGreaterThan(5);
    consoleSpy.mockRestore();
  });

  it('should render for GCP provider', () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const strategy = createMockStrategy({ provider: CloudProvider.GCP });

    expect(() => {
      showArchitectureDiagram(strategy, createMockSecurity());
    }).not.toThrow();
    consoleSpy.mockRestore();
  });

  it('should render for Azure provider', () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const strategy = createMockStrategy({ provider: CloudProvider.Azure });

    expect(() => {
      showArchitectureDiagram(strategy, createMockSecurity());
    }).not.toThrow();
    consoleSpy.mockRestore();
  });
});
