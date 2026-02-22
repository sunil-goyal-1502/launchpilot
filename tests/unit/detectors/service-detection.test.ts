import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { detectNode } from '../../../src/agents/ingestion/detectors/node-detector.js';
import { detectPython } from '../../../src/agents/ingestion/detectors/python-detector.js';

const fixturesDir = join(process.cwd(), 'tests', 'fixtures');

describe('Service Detection (cross-language)', () => {
  describe('Node.js', () => {
    it('should detect Redis as cache service (not database) in Express API', async () => {
      const result = await detectNode(join(fixturesDir, 'sample-express-api'));
      expect(result).not.toBeNull();

      // Redis should NOT be in databases
      expect(result!.databases.every(d => (d.type as string) !== 'redis')).toBe(true);

      // Redis SHOULD be in services as cache
      expect(result!.services.some(s => s.serviceType === 'cache' && s.provider === 'redis')).toBe(true);
    });

    it('should detect BullMQ as queue service', async () => {
      const result = await detectNode(join(fixturesDir, 'sample-express-queue'));
      expect(result).not.toBeNull();
      expect(result!.services.some(s => s.serviceType === 'queue' && s.provider === 'bullmq')).toBe(true);
    });

    it('should detect Kafka as streaming service', async () => {
      const result = await detectNode(join(fixturesDir, 'sample-kafka-app'));
      expect(result).not.toBeNull();
      expect(result!.services.some(s => s.serviceType === 'streaming' && s.provider === 'kafka')).toBe(true);
    });

    it('should detect multiple services simultaneously', async () => {
      const result = await detectNode(join(fixturesDir, 'sample-express-queue'));
      expect(result).not.toBeNull();

      const serviceTypes = result!.services.map(s => s.serviceType);
      expect(serviceTypes).toContain('cache');
      expect(serviceTypes).toContain('queue');
    });
  });

  describe('Python', () => {
    it('should detect Redis as cache service (not database) in Flask app', async () => {
      const result = await detectPython(join(fixturesDir, 'sample-python-flask'));
      expect(result).not.toBeNull();

      // Redis should NOT be in databases
      expect(result!.databases.every(d => (d.type as string) !== 'redis')).toBe(true);

      // Redis SHOULD be in services as cache
      expect(result!.services.some(s => s.serviceType === 'cache' && s.provider === 'redis')).toBe(true);
    });
  });

  describe('Service deduplication', () => {
    it('should not duplicate services with same serviceType:provider key', async () => {
      const result = await detectNode(join(fixturesDir, 'sample-express-api'));
      expect(result).not.toBeNull();

      // Should only have one Redis cache entry even if both redis and ioredis were present
      const redisCaches = result!.services.filter(s => s.serviceType === 'cache' && s.provider === 'redis');
      expect(redisCaches.length).toBe(1);
    });
  });
});
