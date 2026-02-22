import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { analyzeEnvVars } from '../../../src/agents/ingestion/detectors/env-analyzer.js';

const fixturesDir = join(process.cwd(), 'tests', 'fixtures');

describe('analyzeEnvVars', () => {
  describe('Lovable app (Supabase + Stripe + Clerk + OpenAI + Sentry)', () => {
    it('should detect multiple external services', async () => {
      const result = await analyzeEnvVars(join(fixturesDir, 'sample-lovable-app'));
      expect(result.externalServices.length).toBeGreaterThanOrEqual(4);
    });

    it('should detect Supabase from SUPABASE_ vars', async () => {
      const result = await analyzeEnvVars(join(fixturesDir, 'sample-lovable-app'));
      const supabase = result.externalServices.find(s => s.provider === 'supabase');
      expect(supabase).toBeDefined();
      expect(supabase!.category).toBe('storage');
      expect(supabase!.envVarHints.length).toBeGreaterThanOrEqual(1);
    });

    it('should detect Stripe from STRIPE_ vars', async () => {
      const result = await analyzeEnvVars(join(fixturesDir, 'sample-lovable-app'));
      const stripe = result.externalServices.find(s => s.provider === 'stripe');
      expect(stripe).toBeDefined();
      expect(stripe!.category).toBe('payments');
      expect(stripe!.envVarHints).toContain('STRIPE_SECRET_KEY');
      expect(stripe!.envVarHints).toContain('STRIPE_WEBHOOK_SECRET');
    });

    it('should detect Clerk from CLERK_ and NEXT_PUBLIC_CLERK_ vars', async () => {
      const result = await analyzeEnvVars(join(fixturesDir, 'sample-lovable-app'));
      const clerk = result.externalServices.find(s => s.provider === 'clerk');
      expect(clerk).toBeDefined();
      expect(clerk!.category).toBe('auth');
    });

    it('should detect OpenAI from OPENAI_API_KEY', async () => {
      const result = await analyzeEnvVars(join(fixturesDir, 'sample-lovable-app'));
      const openai = result.externalServices.find(s => s.provider === 'openai');
      expect(openai).toBeDefined();
      expect(openai!.category).toBe('ai');
    });

    it('should detect Sentry from SENTRY_DSN', async () => {
      const result = await analyzeEnvVars(join(fixturesDir, 'sample-lovable-app'));
      const sentry = result.externalServices.find(s => s.provider === 'sentry');
      expect(sentry).toBeDefined();
      expect(sentry!.category).toBe('monitoring');
    });

    it('should collect all var names', async () => {
      const result = await analyzeEnvVars(join(fixturesDir, 'sample-lovable-app'));
      expect(result.allVarNames.length).toBeGreaterThanOrEqual(5);
      expect(result.allVarNames).toContain('STRIPE_SECRET_KEY');
      expect(result.allVarNames).toContain('OPENAI_API_KEY');
    });
  });

  describe('Firebase app', () => {
    it('should detect Firebase from FIREBASE_ vars', async () => {
      const result = await analyzeEnvVars(join(fixturesDir, 'sample-firebase-app'));
      const firebase = result.externalServices.find(s => s.provider === 'firebase');
      expect(firebase).toBeDefined();
      expect(firebase!.category).toBe('storage');
      expect(firebase!.envVarHints.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Apps without .env.example', () => {
    it('should return empty results for app without env example', async () => {
      const result = await analyzeEnvVars(join(fixturesDir, 'sample-monorepo'));
      expect(result.externalServices).toEqual([]);
      expect(result.allVarNames).toEqual([]);
    });

    it('should return empty results for non-existent directory', async () => {
      const result = await analyzeEnvVars(join(fixturesDir, 'nonexistent'));
      expect(result.externalServices).toEqual([]);
      expect(result.allVarNames).toEqual([]);
    });
  });

  describe('subDir support', () => {
    it('should analyze env vars with subDir parameter', async () => {
      const result = await analyzeEnvVars(fixturesDir, 'sample-lovable-app');
      expect(result.externalServices.length).toBeGreaterThanOrEqual(4);
    });
  });
});
