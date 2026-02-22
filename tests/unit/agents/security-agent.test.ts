import { describe, it, expect } from 'vitest';
import { SecurityAgent } from '../../../src/agents/security/security-agent.js';
import { PipelineContext } from '../../../src/orchestrator/context.js';
import { CloudProvider, ApplicationBlueprint, ScalingStrategy } from '../../../src/types/index.js';

function createMockBlueprint(): ApplicationBlueprint {
  return {
    repoUrl: 'https://github.com/test/app',
    repoName: 'app',
    runtime: 'node',
    appType: 'fullstack',
    frameworks: [
      { name: 'Next.js', confidence: 0.95 },
      { name: 'Express', confidence: 0.85 },
    ],
    databases: [{ type: 'postgresql', name: 'Prisma', confidence: 0.8 }],
    hasDockerfile: true,
    hasDockerCompose: false,
    envVars: ['DATABASE_URL', 'NEXTAUTH_SECRET', 'API_KEY', 'NODE_ENV'],
    ports: [3000],
    complexity: 'medium',
    detectedAt: new Date(),
  };
}

function createMockStrategy(tier: 'low' | 'medium' | 'high'): ScalingStrategy {
  const securityTiers = { low: 'basic' as const, medium: 'standard' as const, high: 'advanced' as const };
  return {
    tier,
    name: tier,
    description: '',
    provider: CloudProvider.AWS,
    compute: { instanceType: 't3.large', vCPUs: 2, memoryGB: 8, count: 1, autoScaling: false },
    network: { loadBalancer: false, cdn: false, waf: false, natGateway: false, staticIP: false },
    securityTier: securityTiers[tier],
    estimatedUsers: '0-1000',
  };
}

describe('SecurityAgent', () => {
  it('should generate basic security for low tier', async () => {
    const agent = new SecurityAgent();
    const context = new PipelineContext({ nonInteractive: true });

    const policy = await agent.execute({
      blueprint: createMockBlueprint(),
      strategy: createMockStrategy('low'),
      provider: CloudProvider.AWS,
    }, context);

    expect(policy.tier).toBe('basic');
    expect(policy.waf.enabled).toBe(false);
    expect(policy.waf.rules.length).toBeLessThanOrEqual(3);
    expect(policy.network.flowLogging).toBe(false);
  });

  it('should generate standard security for medium tier', async () => {
    const agent = new SecurityAgent();
    const context = new PipelineContext({ nonInteractive: true });

    const policy = await agent.execute({
      blueprint: createMockBlueprint(),
      strategy: createMockStrategy('medium'),
      provider: CloudProvider.AWS,
    }, context);

    expect(policy.tier).toBe('standard');
    expect(policy.waf.enabled).toBe(true);
    expect(policy.waf.rules.length).toBe(6);
    expect(policy.network.privateSubnets).toBe(true);
  });

  it('should generate advanced security for high tier', async () => {
    const agent = new SecurityAgent();
    const context = new PipelineContext({ nonInteractive: true });

    const policy = await agent.execute({
      blueprint: createMockBlueprint(),
      strategy: createMockStrategy('high'),
      provider: CloudProvider.AWS,
    }, context);

    expect(policy.tier).toBe('advanced');
    expect(policy.waf.enabled).toBe(true);
    expect(policy.waf.rules.length).toBe(10);
    expect(policy.tls.minVersion).toBe('1.3');
    expect(policy.network.flowLogging).toBe(true);
    expect(policy.iam.mfaRequired).toBe(true);
  });

  it('should map secrets from env vars', async () => {
    const agent = new SecurityAgent();
    const context = new PipelineContext({ nonInteractive: true });

    const policy = await agent.execute({
      blueprint: createMockBlueprint(),
      strategy: createMockStrategy('medium'),
      provider: CloudProvider.AWS,
    }, context);

    expect(Object.keys(policy.secrets.envVarsToSecrets)).toContain('DATABASE_URL');
    expect(Object.keys(policy.secrets.envVarsToSecrets)).toContain('NEXTAUTH_SECRET');
    expect(Object.keys(policy.secrets.envVarsToSecrets)).toContain('API_KEY');
    // NODE_ENV should NOT be a secret
    expect(Object.keys(policy.secrets.envVarsToSecrets)).not.toContain('NODE_ENV');
  });

  it('should detect vulnerabilities', async () => {
    const agent = new SecurityAgent();
    const context = new PipelineContext({ nonInteractive: true });

    const policy = await agent.execute({
      blueprint: createMockBlueprint(),
      strategy: createMockStrategy('medium'),
      provider: CloudProvider.AWS,
    }, context);

    expect(policy.vulnerabilities.length).toBeGreaterThan(0);
  });

  it('should use correct cert provider per cloud', async () => {
    const agent = new SecurityAgent();

    for (const provider of [CloudProvider.AWS, CloudProvider.GCP, CloudProvider.Azure]) {
      const context = new PipelineContext({ nonInteractive: true });
      const policy = await agent.execute({
        blueprint: createMockBlueprint(),
        strategy: createMockStrategy('medium'),
        provider,
      }, context);

      expect(policy.tls.certProvider).toBeTruthy();
    }
  });
});
