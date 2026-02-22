import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { detectNode } from '../../../src/agents/ingestion/detectors/node-detector.js';

const fixturesDir = join(process.cwd(), 'tests', 'fixtures');

describe('node-detector', () => {
  it('should detect Next.js + Prisma app', async () => {
    const result = await detectNode(join(fixturesDir, 'sample-nextjs-app'));
    expect(result).not.toBeNull();
    expect(result!.runtime).toBe('node');
    expect(result!.appType).toBe('fullstack');
    expect(result!.frameworks.some(f => f.name === 'Next.js')).toBe(true);
    expect(result!.frameworks.some(f => f.name === 'React')).toBe(true);
    expect(result!.databases.some(d => d.type === 'postgresql')).toBe(true);
  });

  it('should detect Express + PostgreSQL API with Redis as cache service', async () => {
    const result = await detectNode(join(fixturesDir, 'sample-express-api'));
    expect(result).not.toBeNull();
    expect(result!.runtime).toBe('node');
    expect(result!.appType).toBe('api');
    expect(result!.frameworks.some(f => f.name === 'Express')).toBe(true);
    expect(result!.databases.some(d => d.type === 'postgresql')).toBe(true);
    expect(result!.services.some(s => s.serviceType === 'cache' && s.provider === 'redis')).toBe(true);
  });

  it('should detect cache and queue services', async () => {
    const result = await detectNode(join(fixturesDir, 'sample-express-queue'));
    expect(result).not.toBeNull();
    expect(result!.services.some(s => s.serviceType === 'cache' && s.provider === 'redis')).toBe(true);
    expect(result!.services.some(s => s.serviceType === 'queue' && s.provider === 'bullmq')).toBe(true);
  });

  it('should detect streaming service', async () => {
    const result = await detectNode(join(fixturesDir, 'sample-kafka-app'));
    expect(result).not.toBeNull();
    expect(result!.services.some(s => s.serviceType === 'streaming' && s.provider === 'kafka')).toBe(true);
  });

  it('should detect env vars from .env.example', async () => {
    const result = await detectNode(join(fixturesDir, 'sample-nextjs-app'));
    expect(result!.envVars).toContain('DATABASE_URL');
    expect(result!.envVars).toContain('NEXTAUTH_SECRET');
  });

  it('should return null for non-Node projects', async () => {
    const result = await detectNode(join(fixturesDir, 'sample-python-flask'));
    expect(result).toBeNull();
  });

  describe('subdirectory detection', () => {
    it('should detect Node.js project in a subdirectory', async () => {
      const result = await detectNode(join(fixturesDir, 'sample-monorepo'), 'frontend');
      expect(result).not.toBeNull();
      expect(result!.runtime).toBe('node');
      expect(result!.frameworks.some(f => f.name === 'React')).toBe(true);
    });

    it('should return null for subdirectory without package.json', async () => {
      const result = await detectNode(join(fixturesDir, 'sample-monorepo'), 'backend');
      expect(result).toBeNull();
    });
  });

  describe('config file detection', () => {
    it('should detect Vite from vite.config.ts in monorepo frontend', async () => {
      const result = await detectNode(join(fixturesDir, 'sample-monorepo'), 'frontend');
      expect(result).not.toBeNull();
      expect(result!.frameworks.some(f => f.name === 'Vite')).toBe(true);
    });

    it('should detect Next.js from config file in nextjs fixture', async () => {
      // sample-nextjs-app has next in dependencies AND would match next.config if present
      // This test just verifies config detection doesn't break existing dep-based detection
      const result = await detectNode(join(fixturesDir, 'sample-nextjs-app'));
      expect(result).not.toBeNull();
      expect(result!.frameworks.some(f => f.name === 'Next.js')).toBe(true);
    });
  });
});
