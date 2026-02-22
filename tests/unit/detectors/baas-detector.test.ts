import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { detectBaaS } from '../../../src/agents/ingestion/detectors/baas-detector.js';

const fixturesDir = join(process.cwd(), 'tests', 'fixtures');

describe('detectBaaS', () => {
  describe('Supabase detection', () => {
    it('should detect Supabase from npm deps + config', async () => {
      const result = await detectBaaS(join(fixturesDir, 'sample-lovable-app'));
      expect(result).not.toBeNull();
      expect(result!.providers).toHaveLength(1);
      expect(result!.providers[0]!.provider).toBe('supabase');
      expect(result!.providers[0]!.name).toBe('Supabase');
    });

    it('should detect all Supabase features', async () => {
      const result = await detectBaaS(join(fixturesDir, 'sample-lovable-app'));
      const supabase = result!.providers[0]!;
      expect(supabase.features).toContain('database');
      expect(supabase.features).toContain('auth');
      expect(supabase.features).toContain('storage');
      expect(supabase.features).toContain('realtime');
      expect(supabase.features).toContain('edge-functions');
    });

    it('should infer postgresql database from Supabase', async () => {
      const result = await detectBaaS(join(fixturesDir, 'sample-lovable-app'));
      expect(result!.databases).toHaveLength(1);
      expect(result!.databases[0]!.type).toBe('postgresql');
      expect(result!.databases[0]!.name).toBe('Supabase DB');
    });

    it('should have high confidence with multiple npm deps + config file', async () => {
      const result = await detectBaaS(join(fixturesDir, 'sample-lovable-app'));
      // 2 npm deps (@supabase/supabase-js + @supabase/ssr) → 0.7 + 2*0.1 = 0.9
      // config file → max(0.9, 0.85) = 0.9
      expect(result!.providers[0]!.confidence).toBeGreaterThanOrEqual(0.85);
    });
  });

  describe('Firebase detection', () => {
    it('should detect Firebase from npm deps + config files', async () => {
      const result = await detectBaaS(join(fixturesDir, 'sample-firebase-app'));
      expect(result).not.toBeNull();
      expect(result!.providers).toHaveLength(1);
      expect(result!.providers[0]!.provider).toBe('firebase');
      expect(result!.providers[0]!.name).toBe('Firebase');
    });

    it('should detect Firebase features (database, auth, storage)', async () => {
      const result = await detectBaaS(join(fixturesDir, 'sample-firebase-app'));
      const firebase = result!.providers[0]!;
      expect(firebase.features).toContain('database');
      expect(firebase.features).toContain('auth');
      expect(firebase.features).toContain('storage');
    });

    it('should NOT infer postgresql for Firebase (no implied DB)', async () => {
      const result = await detectBaaS(join(fixturesDir, 'sample-firebase-app'));
      expect(result!.databases).toHaveLength(0);
    });
  });

  describe('Non-BaaS apps', () => {
    it('should return null for a plain Next.js app', async () => {
      const result = await detectBaaS(join(fixturesDir, 'sample-nextjs-app'));
      expect(result).toBeNull();
    });

    it('should return null for non-existent directory', async () => {
      const result = await detectBaaS(join(fixturesDir, 'nonexistent'));
      expect(result).toBeNull();
    });
  });

  describe('subDir support', () => {
    it('should detect BaaS when given a subDir', async () => {
      // sample-lovable-app is at fixtures root, so use parent as repoPath
      const result = await detectBaaS(fixturesDir, 'sample-lovable-app');
      expect(result).not.toBeNull();
      expect(result!.providers[0]!.provider).toBe('supabase');
    });
  });

  describe('result structure', () => {
    it('should return services array (may be empty)', async () => {
      const result = await detectBaaS(join(fixturesDir, 'sample-lovable-app'));
      expect(result).not.toBeNull();
      expect(Array.isArray(result!.services)).toBe(true);
    });

    it('should return providers with all required fields', async () => {
      const result = await detectBaaS(join(fixturesDir, 'sample-lovable-app'));
      const p = result!.providers[0]!;
      expect(p).toHaveProperty('provider');
      expect(p).toHaveProperty('name');
      expect(p).toHaveProperty('confidence');
      expect(p).toHaveProperty('features');
      expect(typeof p.confidence).toBe('number');
      expect(p.confidence).toBeGreaterThan(0);
      expect(p.confidence).toBeLessThanOrEqual(1);
    });
  });
});
