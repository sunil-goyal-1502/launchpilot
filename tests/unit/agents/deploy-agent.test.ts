import { describe, it, expect } from 'vitest';
import { DeployAgent } from '../../../src/agents/deploy/deploy-agent.js';
import { PipelineContext } from '../../../src/orchestrator/context.js';
import { CloudProvider, ScalingStrategy, SecurityPolicy } from '../../../src/types/index.js';

function createMockStrategy(): ScalingStrategy {
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

describe('DeployAgent', () => {
  it('should complete deployment for AWS', async () => {
    const agent = new DeployAgent();
    const context = new PipelineContext({ nonInteractive: true });

    const result = await agent.execute({
      repoName: 'test-app',
      provider: CloudProvider.AWS,
      strategy: createMockStrategy(),
      security: createMockSecurity(),
    }, context);

    expect(result.success).toBe(true);
    expect(result.deploymentId).toBeTruthy();
    expect(result.url).toContain('amazonaws.com');
    expect(result.checkpoints.every(c => c.status === 'completed')).toBe(true);
    expect(result.resources.length).toBeGreaterThan(0);
  });

  it('should complete deployment for GCP', async () => {
    const agent = new DeployAgent();
    const context = new PipelineContext({ nonInteractive: true });
    const strategy = createMockStrategy();
    strategy.provider = CloudProvider.GCP;
    strategy.compute.instanceType = 'e2-standard-2';

    const result = await agent.execute({
      repoName: 'test-app',
      provider: CloudProvider.GCP,
      strategy,
      security: createMockSecurity(),
    }, context);

    expect(result.success).toBe(true);
    expect(result.url).toContain('run.app');
  });

  it('should complete deployment for Azure', async () => {
    const agent = new DeployAgent();
    const context = new PipelineContext({ nonInteractive: true });
    const strategy = createMockStrategy();
    strategy.provider = CloudProvider.Azure;
    strategy.compute.instanceType = 'D2s_v5';

    const result = await agent.execute({
      repoName: 'test-app',
      provider: CloudProvider.Azure,
      strategy,
      security: createMockSecurity(),
    }, context);

    expect(result.success).toBe(true);
    expect(result.url).toContain('azurewebsites.net');
  });

  it('should include extra checkpoints when services are present', async () => {
    const agent = new DeployAgent();
    const context = new PipelineContext({ nonInteractive: true });
    const strategy = createMockStrategy();
    strategy.cache = {
      service: 'ElastiCache',
      engine: 'redis',
      nodeType: 'cache.t3.medium',
      nodes: 2,
      replication: true,
      memoryGB: 3,
    };
    strategy.queue = {
      service: 'SQS',
      type: 'SQS Standard',
      estimatedMessagesPerDay: 100000,
    };

    const result = await agent.execute({
      repoName: 'test-app',
      provider: CloudProvider.AWS,
      strategy,
      security: createMockSecurity(),
    }, context);

    expect(result.success).toBe(true);
    expect(result.checkpoints.some(c => c.name === 'Create ElastiCache')).toBe(true);
    expect(result.checkpoints.some(c => c.name === 'Create SQS Queue')).toBe(true);
    expect(result.resources.some(r => r.type === 'ElastiCache')).toBe(true);
    expect(result.resources.some(r => r.type === 'SQS Queue')).toBe(true);
  });

  it('should fire checkpoint callbacks', async () => {
    const agent = new DeployAgent();
    const context = new PipelineContext({ nonInteractive: true });
    const updates: string[] = [];

    agent.setCheckpointCallback((cp) => {
      updates.push(`${cp.name}:${cp.status}`);
    });

    await agent.execute({
      repoName: 'test-app',
      provider: CloudProvider.AWS,
      strategy: createMockStrategy(),
      security: createMockSecurity(),
    }, context);

    expect(updates.length).toBeGreaterThan(0);
    expect(updates.some(u => u.includes('in_progress'))).toBe(true);
    expect(updates.some(u => u.includes('completed'))).toBe(true);
  });
});
