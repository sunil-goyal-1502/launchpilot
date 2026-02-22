import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { DeploymentPipeline } from '../../src/orchestrator/pipeline.js';
import { CloudProvider } from '../../src/types/index.js';

const fixturesDir = join(process.cwd(), 'tests', 'fixtures');

describe('DeploymentPipeline (Integration)', () => {
  it('should run full pipeline for a Next.js app on AWS', async () => {
    const pipeline = new DeploymentPipeline();

    const result = await pipeline.execute({
      repoUrl: `local://${fixturesDir}/sample-nextjs-app`,
      provider: CloudProvider.AWS,
      strategyTier: 'medium',
      nonInteractive: true,
    });

    // Blueprint
    expect(result.blueprint.runtime).toBe('node');
    expect(result.blueprint.appType).toBe('fullstack');

    // Strategies
    expect(result.strategies).toHaveLength(3);

    // Selected strategy
    expect(result.selectedStrategy.tier).toBe('medium');
    expect(result.selectedStrategy.costBreakdown).toBeDefined();

    // Security
    expect(result.security.tier).toBe('standard');
    expect(result.security.waf.enabled).toBe(true);

    // Deploy
    expect(result.deployResult.success).toBe(true);
    expect(result.deployResult.url).toContain('amazonaws.com');
  });

  it('should run full pipeline for a Flask app on GCP', async () => {
    const pipeline = new DeploymentPipeline();

    const result = await pipeline.execute({
      repoUrl: `local://${fixturesDir}/sample-python-flask`,
      provider: CloudProvider.GCP,
      strategyTier: 'low',
      nonInteractive: true,
    });

    expect(result.blueprint.runtime).toBe('python');
    expect(result.selectedStrategy.tier).toBe('low');
    expect(result.deployResult.success).toBe(true);
    expect(result.deployResult.url).toContain('run.app');
  });

  it('should run full pipeline for an Express API on Azure', async () => {
    const pipeline = new DeploymentPipeline();

    const result = await pipeline.execute({
      repoUrl: `local://${fixturesDir}/sample-express-api`,
      provider: CloudProvider.Azure,
      strategyTier: 'high',
      nonInteractive: true,
    });

    expect(result.blueprint.runtime).toBe('node');
    expect(result.selectedStrategy.tier).toBe('high');
    expect(result.security.tier).toBe('advanced');
    expect(result.deployResult.success).toBe(true);
    expect(result.deployResult.url).toContain('azurewebsites.net');

    // Redis should be detected as a cache service, not a database
    expect(result.blueprint.services.some(s => s.serviceType === 'cache' && s.provider === 'redis')).toBe(true);
    expect(result.blueprint.databases.every(d => (d.type as string) !== 'redis')).toBe(true);

    // Cache should appear in the strategy
    expect(result.selectedStrategy.cache).toBeDefined();
  });

  it('should run full pipeline for an Express+Queue app on AWS', async () => {
    const pipeline = new DeploymentPipeline();

    const result = await pipeline.execute({
      repoUrl: `local://${fixturesDir}/sample-express-queue`,
      provider: CloudProvider.AWS,
      strategyTier: 'medium',
      nonInteractive: true,
    });

    expect(result.blueprint.runtime).toBe('node');
    expect(result.blueprint.services.some(s => s.serviceType === 'cache')).toBe(true);
    expect(result.blueprint.services.some(s => s.serviceType === 'queue')).toBe(true);
    expect(result.selectedStrategy.cache).toBeDefined();
    expect(result.selectedStrategy.cache!.service).toBe('ElastiCache');
    expect(result.selectedStrategy.queue).toBeDefined();
    expect(result.selectedStrategy.queue!.service).toBe('SQS');
    expect(result.deployResult.success).toBe(true);
  });
});
