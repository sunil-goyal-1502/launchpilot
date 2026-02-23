import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DeployAgent } from '../../../../src/agents/deploy/deploy-agent.js';
import { PipelineContext } from '../../../../src/orchestrator/context.js';
import { CloudProvider, ScalingStrategy, SecurityPolicy, Checkpoint } from '../../../../src/types/index.js';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Mock the Terraform modules so we don't need actual terraform installed
vi.mock('../../../../src/agents/deploy/terraform/credential-validator.js', () => ({
  checkTerraformInstalled: vi.fn().mockResolvedValue({ installed: true, version: '1.7.2' }),
  validateAWSCredentials: vi.fn().mockResolvedValue({ valid: true, identity: 'arn:aws:iam::123:user/test' }),
}));

vi.mock('../../../../src/agents/deploy/terraform/executor.js', () => {
  return {
    TerraformExecutor: vi.fn().mockImplementation(({ onEvent }: any) => ({
      init: vi.fn().mockImplementation(async () => {
        onEvent({ type: 'init_complete', message: 'Initialized' });
      }),
      plan: vi.fn().mockImplementation(async () => {
        onEvent({ type: 'plan_complete', message: 'Plan: 15 to add' });
        return { resourceCount: 15, summary: 'Plan: 15 to add' };
      }),
      apply: vi.fn().mockImplementation(async () => {
        // Simulate resource events
        onEvent({ type: 'resource_start', resourceType: 'aws_vpc', resourceName: 'aws_vpc.main', message: 'Creating VPC...' });
        onEvent({ type: 'resource_complete', resourceType: 'aws_vpc', resourceName: 'aws_vpc.main', message: 'VPC created' });
        onEvent({ type: 'resource_start', resourceType: 'aws_security_group', resourceName: 'aws_security_group.web', message: 'Creating SG...' });
        onEvent({ type: 'resource_complete', resourceType: 'aws_security_group', resourceName: 'aws_security_group.web', message: 'SG created' });
        onEvent({ type: 'resource_start', resourceType: 'aws_ecs_service', resourceName: 'aws_ecs_service.app', message: 'Creating ECS...' });
        onEvent({ type: 'resource_complete', resourceType: 'aws_ecs_service', resourceName: 'aws_ecs_service.app', message: 'ECS created' });
        onEvent({ type: 'resource_start', resourceType: 'aws_db_instance', resourceName: 'aws_db_instance.main', message: 'Creating RDS...' });
        onEvent({ type: 'resource_complete', resourceType: 'aws_db_instance', resourceName: 'aws_db_instance.main', message: 'RDS created' });
        onEvent({ type: 'resource_start', resourceType: 'aws_lb', resourceName: 'aws_lb.app', message: 'Creating ALB...' });
        onEvent({ type: 'resource_complete', resourceType: 'aws_lb', resourceName: 'aws_lb.app', message: 'ALB created' });
        onEvent({ type: 'resource_start', resourceType: 'aws_route53_zone', resourceName: 'aws_route53_zone.main', message: 'Creating DNS...' });
        onEvent({ type: 'resource_complete', resourceType: 'aws_route53_zone', resourceName: 'aws_route53_zone.main', message: 'DNS created' });
        onEvent({ type: 'apply_complete', message: 'Apply complete' });

        return {
          app_url: { value: 'http://test-alb.us-east-1.elb.amazonaws.com', type: 'string' },
          dashboard_url: { value: 'https://console.aws.amazon.com/ecs/clusters/test', type: 'string' },
          vpc_id: { value: 'vpc-abc123', type: 'string' },
          ecs_cluster_arn: { value: 'arn:aws:ecs:us-east-1:123:cluster/test', type: 'string' },
        };
      }),
      destroy: vi.fn().mockResolvedValue(undefined),
    })),
  };
});

// ── Fixtures ──

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

// ── Tests ──

const testDirs: string[] = [];

function makeTempDir(): string {
  const dir = join(tmpdir(), `launchpilot-live-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  testDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of testDirs) {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  }
  testDirs.length = 0;
});

describe('DeployAgent — live mode', () => {
  it('should set mode to "live" on the result', async () => {
    const agent = new DeployAgent();
    const context = new PipelineContext({ nonInteractive: true });
    const dir = makeTempDir();

    const result = await agent.execute({
      repoName: 'test-app',
      provider: CloudProvider.AWS,
      strategy: createMockStrategy(),
      security: createMockSecurity(),
      live: true,
      outputDir: dir,
    }, context);

    expect(result.mode).toBe('live');
    expect(result.infraDir).toBe(dir);
  });

  it('should generate .tf files in outputDir', async () => {
    const agent = new DeployAgent();
    const context = new PipelineContext({ nonInteractive: true });
    const dir = makeTempDir();

    await agent.execute({
      repoName: 'test-app',
      provider: CloudProvider.AWS,
      strategy: createMockStrategy(),
      security: createMockSecurity(),
      live: true,
      outputDir: dir,
    }, context);

    expect(existsSync(join(dir, 'main.tf'))).toBe(true);
    expect(existsSync(join(dir, 'vpc.tf'))).toBe(true);
    expect(existsSync(join(dir, 'compute.tf'))).toBe(true);
    expect(existsSync(join(dir, 'database.tf'))).toBe(true);
  });

  it('should complete all checkpoints successfully', async () => {
    const agent = new DeployAgent();
    const context = new PipelineContext({ nonInteractive: true });
    const dir = makeTempDir();

    const result = await agent.execute({
      repoName: 'test-app',
      provider: CloudProvider.AWS,
      strategy: createMockStrategy(),
      security: createMockSecurity(),
      live: true,
      outputDir: dir,
    }, context);

    expect(result.success).toBe(true);
    expect(result.checkpoints.every(c => c.status === 'completed')).toBe(true);
  });

  it('should extract real URL from Terraform outputs', async () => {
    const agent = new DeployAgent();
    const context = new PipelineContext({ nonInteractive: true });
    const dir = makeTempDir();

    const result = await agent.execute({
      repoName: 'test-app',
      provider: CloudProvider.AWS,
      strategy: createMockStrategy(),
      security: createMockSecurity(),
      live: true,
      outputDir: dir,
    }, context);

    expect(result.url).toBe('http://test-alb.us-east-1.elb.amazonaws.com');
    expect(result.dashboardUrl).toContain('console.aws.amazon.com');
  });

  it('should fire checkpoint callbacks during Terraform apply', async () => {
    const agent = new DeployAgent();
    const context = new PipelineContext({ nonInteractive: true });
    const dir = makeTempDir();
    const updates: string[] = [];

    agent.setCheckpointCallback((cp) => {
      updates.push(`${cp.name}:${cp.status}`);
    });

    await agent.execute({
      repoName: 'test-app',
      provider: CloudProvider.AWS,
      strategy: createMockStrategy(),
      security: createMockSecurity(),
      live: true,
      outputDir: dir,
    }, context);

    expect(updates.length).toBeGreaterThan(0);
    expect(updates.some(u => u.includes('Create VPC:completed'))).toBe(true);
    expect(updates.some(u => u.includes('Configure Security Groups:completed'))).toBe(true);
    expect(updates.some(u => u.includes('Launch Compute:completed'))).toBe(true);
  });

  it('should return resources from Terraform outputs', async () => {
    const agent = new DeployAgent();
    const context = new PipelineContext({ nonInteractive: true });
    const dir = makeTempDir();

    const result = await agent.execute({
      repoName: 'test-app',
      provider: CloudProvider.AWS,
      strategy: createMockStrategy(),
      security: createMockSecurity(),
      live: true,
      outputDir: dir,
    }, context);

    expect(result.resources.some(r => r.type === 'VPC')).toBe(true);
    expect(result.resources.some(r => r.type === 'ECS Cluster')).toBe(true);
  });
});

describe('DeployAgent — simulation mode (backward compat)', () => {
  it('should NOT set mode when live is not specified', async () => {
    const agent = new DeployAgent();
    const context = new PipelineContext({ nonInteractive: true });

    const result = await agent.execute({
      repoName: 'test-app',
      provider: CloudProvider.AWS,
      strategy: createMockStrategy(),
      security: createMockSecurity(),
    }, context);

    expect(result.mode).toBeUndefined();
    expect(result.infraDir).toBeUndefined();
    expect(result.success).toBe(true);
    expect(result.url).toContain('amazonaws.com');
  });

  it('should use simulation when live is false', async () => {
    const agent = new DeployAgent();
    const context = new PipelineContext({ nonInteractive: true });

    const result = await agent.execute({
      repoName: 'test-app',
      provider: CloudProvider.AWS,
      strategy: createMockStrategy(),
      security: createMockSecurity(),
      live: false,
    }, context);

    expect(result.mode).toBeUndefined();
    expect(result.success).toBe(true);
  });
});

describe('DeployAgent — live mode credential failure', () => {
  it('should handle Terraform not installed', async () => {
    const credValidator = await import('../../../../src/agents/deploy/terraform/credential-validator.js');
    vi.mocked(credValidator.checkTerraformInstalled).mockResolvedValueOnce({
      installed: false,
      error: 'Terraform CLI not found',
    });

    const agent = new DeployAgent();
    const context = new PipelineContext({ nonInteractive: true });
    const dir = makeTempDir();

    await expect(agent.execute({
      repoName: 'test-app',
      provider: CloudProvider.AWS,
      strategy: createMockStrategy(),
      security: createMockSecurity(),
      live: true,
      outputDir: dir,
    }, context)).rejects.toThrow('Terraform CLI not found');
  });

  it('should handle AWS credentials not configured', async () => {
    const credValidator = await import('../../../../src/agents/deploy/terraform/credential-validator.js');
    vi.mocked(credValidator.checkTerraformInstalled).mockResolvedValueOnce({
      installed: true,
      version: '1.7.2',
    });
    vi.mocked(credValidator.validateAWSCredentials).mockResolvedValueOnce({
      valid: false,
      error: 'AWS credentials not configured',
    });

    const agent = new DeployAgent();
    const context = new PipelineContext({ nonInteractive: true });
    const dir = makeTempDir();

    await expect(agent.execute({
      repoName: 'test-app',
      provider: CloudProvider.AWS,
      strategy: createMockStrategy(),
      security: createMockSecurity(),
      live: true,
      outputDir: dir,
    }, context)).rejects.toThrow('AWS credentials not configured');
  });
});
