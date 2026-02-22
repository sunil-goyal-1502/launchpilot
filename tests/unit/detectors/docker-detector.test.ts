import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { detectDocker } from '../../../src/agents/ingestion/detectors/docker-detector.js';

const fixturesDir = join(process.cwd(), 'tests', 'fixtures');

describe('docker-detector', () => {
  describe('basic detection', () => {
    it('should detect Dockerfile in express-api fixture', async () => {
      const result = await detectDocker(join(fixturesDir, 'sample-express-api'));
      expect(result.hasDockerfile).toBe(true);
      expect(result.hasDockerCompose).toBe(false);
      expect(result.exposedPorts).toContain(3000);
    });

    it('should return false for repos without Docker files', async () => {
      const result = await detectDocker(join(fixturesDir, 'sample-python-flask'));
      expect(result.hasDockerfile).toBe(false);
      expect(result.hasDockerCompose).toBe(false);
    });
  });

  describe('docker-compose service inference', () => {
    it('should detect docker-compose services in monorepo fixture', async () => {
      const result = await detectDocker(join(fixturesDir, 'sample-monorepo'));
      expect(result.hasDockerCompose).toBe(true);
      expect(result.services).toContain('postgresql');
      expect(result.services).toContain('redis');
      expect(result.services).toContain('backend');
      expect(result.services).toContain('frontend');
      expect(result.services).toContain('celery-worker');
    });

    it('should infer postgresql from docker-compose service name', async () => {
      const result = await detectDocker(join(fixturesDir, 'sample-monorepo'));
      expect(result.inferredDatabases).toContain('postgresql');
    });

    it('should infer redis from docker-compose service name', async () => {
      const result = await detectDocker(join(fixturesDir, 'sample-monorepo'));
      expect(result.inferredServices).toContain('redis');
    });

    it('should classify worker services correctly', async () => {
      const result = await detectDocker(join(fixturesDir, 'sample-monorepo'));
      const workerComponent = result.serviceComponents.find(c => c.name === 'celery-worker');
      expect(workerComponent).toBeDefined();
      expect(workerComponent!.type).toBe('worker');
    });
  });

  describe('Dockerfile base image parsing', () => {
    it('should infer python runtime from subdirectory Dockerfile', async () => {
      const result = await detectDocker(join(fixturesDir, 'sample-monorepo'));
      expect(result.inferredRuntimes).toContain('python');
    });

    it('should infer node runtime from subdirectory Dockerfile', async () => {
      const result = await detectDocker(join(fixturesDir, 'sample-monorepo'));
      expect(result.inferredRuntimes).toContain('node');
    });

    it('should infer runtime from root Dockerfile', async () => {
      const result = await detectDocker(join(fixturesDir, 'sample-express-api'));
      expect(result.inferredRuntimes).toContain('node');
    });
  });

  describe('port extraction', () => {
    it('should extract ports from docker-compose port mappings', async () => {
      const result = await detectDocker(join(fixturesDir, 'sample-monorepo'));
      expect(result.exposedPorts).toContain(5432);
      expect(result.exposedPorts).toContain(6379);
      expect(result.exposedPorts).toContain(8000);
      expect(result.exposedPorts).toContain(3000);
    });
  });
});
