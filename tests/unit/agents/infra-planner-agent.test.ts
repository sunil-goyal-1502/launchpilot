import { describe, it, expect } from 'vitest';
import { InfraPlannerAgent } from '../../../src/agents/infra-planner/infra-planner-agent.js';
import { PipelineContext } from '../../../src/orchestrator/context.js';
import { CloudProvider, ApplicationBlueprint } from '../../../src/types/index.js';

function createMockBlueprint(overrides: Partial<ApplicationBlueprint> = {}): ApplicationBlueprint {
  return {
    repoUrl: 'https://github.com/test/app',
    repoName: 'app',
    runtime: 'node',
    appType: 'fullstack',
    frameworks: [{ name: 'Next.js', confidence: 0.95 }],
    databases: [{ type: 'postgresql', name: 'Prisma', confidence: 0.8 }],
    services: [],
    hasDockerfile: false,
    hasDockerCompose: false,
    envVars: [],
    ports: [3000],
    complexity: 'medium',
    detectedAt: new Date(),
    ...overrides,
  };
}

describe('InfraPlannerAgent', () => {
  it('should generate 3 strategies for AWS', async () => {
    const agent = new InfraPlannerAgent();
    const context = new PipelineContext({ nonInteractive: true });
    const blueprint = createMockBlueprint();

    const result = await agent.execute({ blueprint, provider: CloudProvider.AWS }, context);

    expect(result.strategies).toHaveLength(3);
    expect(result.strategies[0]!.tier).toBe('low');
    expect(result.strategies[1]!.tier).toBe('medium');
    expect(result.strategies[2]!.tier).toBe('high');
  });

  it('should generate 3 strategies for GCP', async () => {
    const agent = new InfraPlannerAgent();
    const context = new PipelineContext({ nonInteractive: true });
    const blueprint = createMockBlueprint();

    const result = await agent.execute({ blueprint, provider: CloudProvider.GCP }, context);

    expect(result.strategies).toHaveLength(3);
    expect(result.strategies[0]!.compute.instanceType).toContain('e2');
  });

  it('should generate 3 strategies for Azure', async () => {
    const agent = new InfraPlannerAgent();
    const context = new PipelineContext({ nonInteractive: true });
    const blueprint = createMockBlueprint();

    const result = await agent.execute({ blueprint, provider: CloudProvider.Azure }, context);

    expect(result.strategies).toHaveLength(3);
  });

  it('should include database when blueprint has databases', async () => {
    const agent = new InfraPlannerAgent();
    const context = new PipelineContext({ nonInteractive: true });
    const blueprint = createMockBlueprint();

    const result = await agent.execute({ blueprint, provider: CloudProvider.AWS }, context);

    for (const strategy of result.strategies) {
      expect(strategy.database).toBeDefined();
      expect(strategy.database!.engine).toBe('postgresql');
    }
  });

  it('should skip database for static sites', async () => {
    const agent = new InfraPlannerAgent();
    const context = new PipelineContext({ nonInteractive: true });
    const blueprint = createMockBlueprint({
      appType: 'static-site',
      databases: [],
    });

    const result = await agent.execute({ blueprint, provider: CloudProvider.AWS }, context);

    expect(result.strategies[0]!.database).toBeUndefined();
  });

  it('should attach cost breakdowns to each strategy', async () => {
    const agent = new InfraPlannerAgent();
    const context = new PipelineContext({ nonInteractive: true });
    const blueprint = createMockBlueprint();

    const result = await agent.execute({ blueprint, provider: CloudProvider.AWS }, context);

    for (const strategy of result.strategies) {
      expect(strategy.costBreakdown).toBeDefined();
      expect(strategy.costBreakdown!.total).toBeGreaterThan(0);
      expect(strategy.costBreakdown!.lineItems.length).toBeGreaterThan(0);
    }
  });

  it('should include cache when blueprint has cache service', async () => {
    const agent = new InfraPlannerAgent();
    const context = new PipelineContext({ nonInteractive: true });
    const blueprint = createMockBlueprint({
      services: [{ serviceType: 'cache', provider: 'redis', name: 'Redis', confidence: 0.85 }],
    });

    const result = await agent.execute({ blueprint, provider: CloudProvider.AWS }, context);

    for (const strategy of result.strategies) {
      expect(strategy.cache).toBeDefined();
      expect(strategy.cache!.service).toBe('ElastiCache');
    }
  });

  it('should include queue and streaming when detected', async () => {
    const agent = new InfraPlannerAgent();
    const context = new PipelineContext({ nonInteractive: true });
    const blueprint = createMockBlueprint({
      services: [
        { serviceType: 'queue', provider: 'bullmq', name: 'BullMQ', confidence: 0.9 },
        { serviceType: 'streaming', provider: 'kafka', name: 'Kafka', confidence: 0.9 },
      ],
    });

    const result = await agent.execute({ blueprint, provider: CloudProvider.AWS }, context);

    for (const strategy of result.strategies) {
      expect(strategy.queue).toBeDefined();
      expect(strategy.streaming).toBeDefined();
    }
  });

  it('should have increasing costs from low to high', async () => {
    const agent = new InfraPlannerAgent();
    const context = new PipelineContext({ nonInteractive: true });
    const blueprint = createMockBlueprint();

    const result = await agent.execute({ blueprint, provider: CloudProvider.AWS }, context);

    const lowCost = result.strategies[0]!.costBreakdown!.total;
    const medCost = result.strategies[1]!.costBreakdown!.total;
    const highCost = result.strategies[2]!.costBreakdown!.total;

    expect(medCost).toBeGreaterThan(lowCost);
    expect(highCost).toBeGreaterThan(medCost);
  });
});
