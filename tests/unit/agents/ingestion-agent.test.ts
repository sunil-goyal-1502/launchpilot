import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { IngestionAgent } from '../../../src/agents/ingestion/ingestion-agent.js';
import { PipelineContext } from '../../../src/orchestrator/context.js';

const fixturesDir = join(process.cwd(), 'tests', 'fixtures');

describe('IngestionAgent', () => {
  it('should analyze a Next.js repo from local path', async () => {
    const agent = new IngestionAgent();
    const context = new PipelineContext({ nonInteractive: true });

    const blueprint = await agent.execute(
      { repoUrl: `local://${fixturesDir}/sample-nextjs-app` },
      context,
    );

    expect(blueprint.runtime).toBe('node');
    expect(blueprint.appType).toBe('fullstack');
    expect(blueprint.frameworks.length).toBeGreaterThan(0);
    expect(blueprint.repoName).toBe('sample-nextjs-app');
    expect(blueprint.databases.length).toBeGreaterThan(0);
  });

  it('should analyze an Express API from local path', async () => {
    const agent = new IngestionAgent();
    const context = new PipelineContext({ nonInteractive: true });

    const blueprint = await agent.execute(
      { repoUrl: `local://${fixturesDir}/sample-express-api` },
      context,
    );

    expect(blueprint.runtime).toBe('node');
    expect(blueprint.appType).toBe('api');
    expect(blueprint.hasDockerfile).toBe(true);
    expect(blueprint.services.some(s => s.serviceType === 'cache')).toBe(true);
  });

  it('should analyze a Python Flask app from local path', async () => {
    const agent = new IngestionAgent();
    const context = new PipelineContext({ nonInteractive: true });

    const blueprint = await agent.execute(
      { repoUrl: `local://${fixturesDir}/sample-python-flask` },
      context,
    );

    expect(blueprint.runtime).toBe('python');
    expect(blueprint.appType).toBe('api');
    expect(blueprint.frameworks.some(f => f.name === 'Flask')).toBe(true);
  });

  it('should analyze a Spring Boot app from local path', async () => {
    const agent = new IngestionAgent();
    const context = new PipelineContext({ nonInteractive: true });

    const blueprint = await agent.execute(
      { repoUrl: `local://${fixturesDir}/sample-spring-boot` },
      context,
    );

    expect(blueprint.runtime).toBe('java');
    expect(blueprint.frameworks.some(f => f.name === 'Spring Boot')).toBe(true);
  });

  it('should analyze a Go API from local path', async () => {
    const agent = new IngestionAgent();
    const context = new PipelineContext({ nonInteractive: true });

    const blueprint = await agent.execute(
      { repoUrl: `local://${fixturesDir}/sample-go-api` },
      context,
    );

    expect(blueprint.runtime).toBe('go');
    expect(blueprint.frameworks.some(f => f.name === 'Gin')).toBe(true);
  });

  it('should analyze a Rails app from local path', async () => {
    const agent = new IngestionAgent();
    const context = new PipelineContext({ nonInteractive: true });

    const blueprint = await agent.execute(
      { repoUrl: `local://${fixturesDir}/sample-rails-app` },
      context,
    );

    expect(blueprint.runtime).toBe('ruby');
    expect(blueprint.frameworks.some(f => f.name === 'Rails')).toBe(true);
  });
});
