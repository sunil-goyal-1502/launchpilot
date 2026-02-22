import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { detectStack } from '../../../src/agents/ingestion/detector.js';

const fixturesDir = join(process.cwd(), 'tests', 'fixtures');

describe('detectStack (orchestrator)', () => {
  describe('single-app backward compatibility', () => {
    it('should detect Next.js app at root level', async () => {
      const result = await detectStack(
        join(fixturesDir, 'sample-nextjs-app'),
        'https://github.com/test/sample-nextjs-app',
        'sample-nextjs-app',
      );
      expect(result.runtime).toBe('node');
      expect(result.appType).toBe('fullstack');
      expect(result.frameworks.some(f => f.name === 'Next.js')).toBe(true);
      expect(result.databases.some(d => d.type === 'postgresql')).toBe(true);
      expect(result.components).toBeUndefined();
    });

    it('should detect Express API at root level', async () => {
      const result = await detectStack(
        join(fixturesDir, 'sample-express-api'),
        'https://github.com/test/sample-express-api',
        'sample-express-api',
      );
      expect(result.runtime).toBe('node');
      expect(result.appType).toBe('api');
      expect(result.frameworks.some(f => f.name === 'Express')).toBe(true);
    });

    it('should detect Python Flask app at root level', async () => {
      const result = await detectStack(
        join(fixturesDir, 'sample-python-flask'),
        'https://github.com/test/sample-python-flask',
        'sample-python-flask',
      );
      expect(result.runtime).toBe('python');
      expect(result.frameworks.some(f => f.name === 'Flask')).toBe(true);
    });

    it('should detect Go API at root level', async () => {
      const result = await detectStack(
        join(fixturesDir, 'sample-go-api'),
        'https://github.com/test/sample-go-api',
        'sample-go-api',
      );
      expect(result.runtime).toBe('go');
      expect(result.frameworks.some(f => f.name === 'Gin')).toBe(true);
    });

    it('should detect Spring Boot at root level', async () => {
      const result = await detectStack(
        join(fixturesDir, 'sample-spring-boot'),
        'https://github.com/test/sample-spring-boot',
        'sample-spring-boot',
      );
      expect(result.runtime).toBe('java');
      expect(result.frameworks.some(f => f.name === 'Spring Boot')).toBe(true);
    });

    it('should detect Rails app at root level', async () => {
      const result = await detectStack(
        join(fixturesDir, 'sample-rails-app'),
        'https://github.com/test/sample-rails-app',
        'sample-rails-app',
      );
      expect(result.runtime).toBe('ruby');
      expect(result.frameworks.some(f => f.name === 'Rails')).toBe(true);
    });
  });

  describe('monorepo detection', () => {
    it('should detect monorepo with backend + frontend components', async () => {
      const result = await detectStack(
        join(fixturesDir, 'sample-monorepo'),
        'https://github.com/test/sample-monorepo',
        'sample-monorepo',
      );
      expect(result.appType).toBe('monorepo');
      expect(result.components).toBeDefined();
      expect(result.components!.length).toBe(2);
    });

    it('should detect Python runtime as primary for backend+frontend monorepo', async () => {
      const result = await detectStack(
        join(fixturesDir, 'sample-monorepo'),
        'https://github.com/test/sample-monorepo',
        'sample-monorepo',
      );
      // Python (backend) is preferred over Node (frontend) as primary runtime
      expect(result.runtime).toBe('python');
    });

    it('should detect both Python and Node frameworks', async () => {
      const result = await detectStack(
        join(fixturesDir, 'sample-monorepo'),
        'https://github.com/test/sample-monorepo',
        'sample-monorepo',
      );
      expect(result.frameworks.some(f => f.name === 'FastAPI')).toBe(true);
      expect(result.frameworks.some(f => f.name === 'React')).toBe(true);
    });

    it('should infer postgresql from docker-compose', async () => {
      const result = await detectStack(
        join(fixturesDir, 'sample-monorepo'),
        'https://github.com/test/sample-monorepo',
        'sample-monorepo',
      );
      expect(result.databases.some(d => d.type === 'postgresql')).toBe(true);
    });

    it('should detect redis as cache service', async () => {
      const result = await detectStack(
        join(fixturesDir, 'sample-monorepo'),
        'https://github.com/test/sample-monorepo',
        'sample-monorepo',
      );
      expect(result.services.some(s => s.provider === 'redis')).toBe(true);
    });

    it('should have correct component paths', async () => {
      const result = await detectStack(
        join(fixturesDir, 'sample-monorepo'),
        'https://github.com/test/sample-monorepo',
        'sample-monorepo',
      );
      const backend = result.components!.find(c => c.name === 'backend');
      const frontend = result.components!.find(c => c.name === 'frontend');
      expect(backend).toBeDefined();
      expect(backend!.path).toBe('backend/');
      expect(backend!.runtime).toBe('python');
      expect(frontend).toBeDefined();
      expect(frontend!.path).toBe('frontend/');
      expect(frontend!.runtime).toBe('node');
    });

    it('should detect docker-compose and Dockerfile', async () => {
      const result = await detectStack(
        join(fixturesDir, 'sample-monorepo'),
        'https://github.com/test/sample-monorepo',
        'sample-monorepo',
      );
      expect(result.hasDockerCompose).toBe(true);
      expect(result.hasDockerfile).toBe(true);
    });

    it('should have high complexity for monorepo with many services', async () => {
      const result = await detectStack(
        join(fixturesDir, 'sample-monorepo'),
        'https://github.com/test/sample-monorepo',
        'sample-monorepo',
      );
      expect(result.complexity).toBe('high');
    });
  });
});
