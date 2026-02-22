import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { detectPython } from '../../../src/agents/ingestion/detectors/python-detector.js';

const fixturesDir = join(process.cwd(), 'tests', 'fixtures');

describe('python-detector', () => {
  it('should detect Flask + PostgreSQL app with Redis as cache service', async () => {
    const result = await detectPython(join(fixturesDir, 'sample-python-flask'));
    expect(result).not.toBeNull();
    expect(result!.runtime).toBe('python');
    expect(result!.appType).toBe('api');
    expect(result!.frameworks.some(f => f.name === 'Flask')).toBe(true);
    expect(result!.databases.some(d => d.type === 'postgresql')).toBe(true);
    expect(result!.services.some(s => s.serviceType === 'cache' && s.provider === 'redis')).toBe(true);
  });

  it('should set correct port for Flask', async () => {
    const result = await detectPython(join(fixturesDir, 'sample-python-flask'));
    expect(result!.ports).toContain(5000);
  });

  it('should return null for non-Python projects', async () => {
    const result = await detectPython(join(fixturesDir, 'sample-nextjs-app'));
    expect(result).toBeNull();
  });

  describe('subdirectory detection', () => {
    it('should detect Python project in a subdirectory', async () => {
      const result = await detectPython(join(fixturesDir, 'sample-monorepo'), 'backend');
      expect(result).not.toBeNull();
      expect(result!.runtime).toBe('python');
      expect(result!.frameworks.some(f => f.name === 'FastAPI')).toBe(true);
      expect(result!.databases.some(d => d.type === 'postgresql')).toBe(true);
      expect(result!.services.some(s => s.serviceType === 'cache' && s.provider === 'redis')).toBe(true);
      expect(result!.services.some(s => s.serviceType === 'queue' && s.provider === 'celery')).toBe(true);
    });

    it('should return null for subdirectory without Python manifest', async () => {
      const result = await detectPython(join(fixturesDir, 'sample-monorepo'), 'frontend');
      expect(result).toBeNull();
    });
  });
});
