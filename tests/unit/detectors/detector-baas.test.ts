import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { detectStack } from '../../../src/agents/ingestion/detector.js';

const fixturesDir = join(process.cwd(), 'tests', 'fixtures');

describe('detectStack — BaaS integration', () => {
  describe('Lovable-style app (Next.js + Supabase + Vercel)', () => {
    it('should detect BaaS metadata', async () => {
      const result = await detectStack(
        join(fixturesDir, 'sample-lovable-app'),
        'https://github.com/test/sample-lovable-app',
        'sample-lovable-app',
      );
      expect(result.baas).toBeDefined();
      expect(result.baas!.isBaaSApp).toBe(true);
    });

    it('should detect Supabase as BaaS provider', async () => {
      const result = await detectStack(
        join(fixturesDir, 'sample-lovable-app'),
        'https://github.com/test/sample-lovable-app',
        'sample-lovable-app',
      );
      expect(result.baas!.providers).toHaveLength(1);
      expect(result.baas!.providers[0]!.provider).toBe('supabase');
    });

    it('should detect vercel as platform config', async () => {
      const result = await detectStack(
        join(fixturesDir, 'sample-lovable-app'),
        'https://github.com/test/sample-lovable-app',
        'sample-lovable-app',
      );
      expect(result.baas!.platformConfigs).toHaveLength(1);
      expect(result.baas!.platformConfigs[0]!.target).toBe('vercel');
    });

    it('should detect external services (Stripe, Clerk, OpenAI, Sentry)', async () => {
      const result = await detectStack(
        join(fixturesDir, 'sample-lovable-app'),
        'https://github.com/test/sample-lovable-app',
        'sample-lovable-app',
      );
      const providers = result.baas!.externalServices.map(s => s.provider);
      expect(providers).toContain('stripe');
      expect(providers).toContain('clerk');
      expect(providers).toContain('openai');
      expect(providers).toContain('sentry');
    });

    it('should parse supabase migrations with 3 tables', async () => {
      const result = await detectStack(
        join(fixturesDir, 'sample-lovable-app'),
        'https://github.com/test/sample-lovable-app',
        'sample-lovable-app',
      );
      expect(result.baas!.migrations).toBeDefined();
      const totalTables = result.baas!.migrations!.reduce((sum, m) => sum + m.tables.length, 0);
      expect(totalTables).toBe(3);
    });

    it('should merge postgresql database from Supabase detection', async () => {
      const result = await detectStack(
        join(fixturesDir, 'sample-lovable-app'),
        'https://github.com/test/sample-lovable-app',
        'sample-lovable-app',
      );
      expect(result.databases.some(d => d.type === 'postgresql')).toBe(true);
    });

    it('should merge env vars from .env.example', async () => {
      const result = await detectStack(
        join(fixturesDir, 'sample-lovable-app'),
        'https://github.com/test/sample-lovable-app',
        'sample-lovable-app',
      );
      expect(result.envVars).toContain('STRIPE_SECRET_KEY');
      expect(result.envVars).toContain('OPENAI_API_KEY');
    });

    it('should still detect runtime and frameworks', async () => {
      const result = await detectStack(
        join(fixturesDir, 'sample-lovable-app'),
        'https://github.com/test/sample-lovable-app',
        'sample-lovable-app',
      );
      expect(result.runtime).toBe('node');
      expect(result.frameworks.some(f => f.name === 'Next.js')).toBe(true);
    });
  });

  describe('Firebase-style app (React + Vite + Firebase)', () => {
    it('should detect Firebase as BaaS provider', async () => {
      const result = await detectStack(
        join(fixturesDir, 'sample-firebase-app'),
        'https://github.com/test/sample-firebase-app',
        'sample-firebase-app',
      );
      expect(result.baas).toBeDefined();
      expect(result.baas!.isBaaSApp).toBe(true);
      expect(result.baas!.providers[0]!.provider).toBe('firebase');
    });

    it('should not have migrations for Firebase app', async () => {
      const result = await detectStack(
        join(fixturesDir, 'sample-firebase-app'),
        'https://github.com/test/sample-firebase-app',
        'sample-firebase-app',
      );
      expect(result.baas!.migrations).toBeUndefined();
    });
  });

  describe('Backward compatibility', () => {
    it('should not flag a plain Next.js app as a BaaS app', async () => {
      const result = await detectStack(
        join(fixturesDir, 'sample-nextjs-app'),
        'https://github.com/test/sample-nextjs-app',
        'sample-nextjs-app',
      );
      // May have baas metadata if env vars match external services,
      // but isBaaSApp should be false (no Supabase/Firebase/etc.)
      if (result.baas) {
        expect(result.baas.isBaaSApp).toBe(false);
        expect(result.baas.providers).toHaveLength(0);
      }
    });
  });
});
