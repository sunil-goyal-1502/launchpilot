import { describe, it, expect } from 'vitest';
import { mapRequirements } from '../../../src/agents/infra-planner/resource-mapper.js';
import { buildStrategies } from '../../../src/agents/infra-planner/strategy-builder.js';
import { ApplicationBlueprint, CloudProvider } from '../../../src/types/index.js';

function makeSupabaseBlueprint(): ApplicationBlueprint {
  return {
    repoUrl: 'https://github.com/test/lovable-app',
    repoName: 'lovable-app',
    runtime: 'node',
    appType: 'fullstack',
    frameworks: [{ name: 'Next.js', confidence: 0.95 }],
    databases: [{ type: 'postgresql', name: 'Supabase DB', confidence: 0.8 }],
    services: [],
    hasDockerfile: false,
    hasDockerCompose: false,
    envVars: ['SUPABASE_URL', 'STRIPE_SECRET_KEY'],
    ports: [3000],
    complexity: 'medium',
    detectedAt: new Date(),
    baas: {
      providers: [{
        provider: 'supabase',
        name: 'Supabase',
        confidence: 0.9,
        features: ['database', 'auth', 'storage', 'realtime', 'edge-functions'],
      }],
      platformConfigs: [{ target: 'vercel', configFile: 'vercel.json', confidence: 0.9 }],
      externalServices: [
        { category: 'payments', provider: 'stripe', name: 'Stripe', confidence: 0.95, envVarHints: ['STRIPE_SECRET_KEY'] },
      ],
      migrations: [
        {
          filename: '20240101_init.sql',
          tables: [
            { name: 'profiles', columns: [{ name: 'id', type: 'UUID', nullable: false, isPrimaryKey: true }] },
            { name: 'posts', columns: [{ name: 'id', type: 'UUID', nullable: false, isPrimaryKey: true }] },
          ],
        },
      ],
      isBaaSApp: true,
    },
  };
}

function makeNonBaaSBlueprint(): ApplicationBlueprint {
  return {
    repoUrl: 'https://github.com/test/plain-app',
    repoName: 'plain-app',
    runtime: 'node',
    appType: 'api',
    frameworks: [{ name: 'Express', confidence: 0.85 }],
    databases: [{ type: 'postgresql', name: 'PostgreSQL', confidence: 0.9 }],
    services: [],
    hasDockerfile: true,
    hasDockerCompose: false,
    envVars: [],
    ports: [3000],
    complexity: 'low',
    detectedAt: new Date(),
  };
}

describe('resource-mapper — BaaS mapping', () => {
  it('should set needsAuth=true for Supabase app with auth feature', () => {
    const reqs = mapRequirements(makeSupabaseBlueprint());
    expect(reqs.needsAuth).toBe(true);
  });

  it('should set needsObjectStorage=true for Supabase app with storage feature', () => {
    const reqs = mapRequirements(makeSupabaseBlueprint());
    expect(reqs.needsObjectStorage).toBe(true);
  });

  it('should set needsDatabase=true and dbEngine=postgresql', () => {
    const reqs = mapRequirements(makeSupabaseBlueprint());
    expect(reqs.needsDatabase).toBe(true);
    expect(reqs.dbEngine).toBe('postgresql');
  });

  it('should create baasReplacements for each BaaS feature', () => {
    const reqs = mapRequirements(makeSupabaseBlueprint());
    expect(reqs.baasReplacements.length).toBeGreaterThanOrEqual(3);
    expect(reqs.baasReplacements.some(r => r.feature === 'database')).toBe(true);
    expect(reqs.baasReplacements.some(r => r.feature === 'auth')).toBe(true);
    expect(reqs.baasReplacements.some(r => r.feature === 'storage')).toBe(true);
    expect(reqs.baasReplacements.some(r => r.feature === 'realtime')).toBe(true);
  });

  it('should NOT set auth/storage for non-BaaS app', () => {
    const reqs = mapRequirements(makeNonBaaSBlueprint());
    expect(reqs.needsAuth).toBe(false);
    expect(reqs.needsObjectStorage).toBe(false);
    expect(reqs.baasReplacements).toHaveLength(0);
  });
});

describe('strategy-builder — BaaS strategies', () => {
  it('should include auth resource in strategies for Supabase app', () => {
    const strategies = buildStrategies(makeSupabaseBlueprint(), CloudProvider.AWS);
    for (const s of strategies) {
      expect(s.auth).toBeDefined();
      expect(s.auth!.service).toBe('Cognito');
      expect(s.auth!.estimatedMAU).toBeGreaterThan(0);
    }
  });

  it('should include objectStorage resource in strategies', () => {
    const strategies = buildStrategies(makeSupabaseBlueprint(), CloudProvider.AWS);
    for (const s of strategies) {
      expect(s.objectStorage).toBeDefined();
      expect(s.objectStorage!.service).toBe('S3');
      expect(s.objectStorage!.estimatedGB).toBeGreaterThan(0);
    }
  });

  it('should scale auth MAU by tier', () => {
    const strategies = buildStrategies(makeSupabaseBlueprint(), CloudProvider.AWS);
    const maus = strategies.map(s => s.auth!.estimatedMAU);
    expect(maus[0]).toBeLessThan(maus[1]!);
    expect(maus[1]).toBeLessThan(maus[2]!);
  });

  it('should use provider-specific names (GCP)', () => {
    const strategies = buildStrategies(makeSupabaseBlueprint(), CloudProvider.GCP);
    expect(strategies[0]!.auth!.service).toBe('Identity Platform');
    expect(strategies[0]!.objectStorage!.service).toBe('Cloud Storage');
  });

  it('should use provider-specific names (Azure)', () => {
    const strategies = buildStrategies(makeSupabaseBlueprint(), CloudProvider.Azure);
    expect(strategies[0]!.auth!.service).toBe('Azure AD B2C');
    expect(strategies[0]!.objectStorage!.service).toBe('Blob Storage');
  });

  it('should include baasReplacements on strategies', () => {
    const strategies = buildStrategies(makeSupabaseBlueprint(), CloudProvider.AWS);
    for (const s of strategies) {
      expect(s.baasReplacements).toBeDefined();
      expect(s.baasReplacements!.length).toBeGreaterThanOrEqual(3);
    }
  });

  it('should NOT include auth/storage for non-BaaS app', () => {
    const strategies = buildStrategies(makeNonBaaSBlueprint(), CloudProvider.AWS);
    for (const s of strategies) {
      expect(s.auth).toBeUndefined();
      expect(s.objectStorage).toBeUndefined();
      expect(s.baasReplacements).toBeUndefined();
    }
  });

  it('should include auth + storage costs in cost breakdown', () => {
    const strategies = buildStrategies(makeSupabaseBlueprint(), CloudProvider.AWS);
    const mediumStrategy = strategies[1]!;
    expect(mediumStrategy.costBreakdown).toBeDefined();
    const services = mediumStrategy.costBreakdown!.lineItems.map(i => i.service);
    expect(services).toContain('Auth');
    expect(services).toContain('Object Storage');
  });
});
