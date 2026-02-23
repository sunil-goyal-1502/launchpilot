import { describe, it, expect } from 'vitest';
import {
  generateMigrationOptions,
  shouldProvisionResource,
  buildVendorSubscription,
  getVendorCatalog,
} from '../../../src/agents/infra-planner/baas-migration.js';
import { mapRequirements } from '../../../src/agents/infra-planner/resource-mapper.js';
import { buildStrategies } from '../../../src/agents/infra-planner/strategy-builder.js';
import { ApplicationBlueprint, CloudProvider, BaaSMigrationChoice, BaaSFeature } from '../../../src/types/index.js';

// ── Test Fixtures ──

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
    envVars: ['SUPABASE_URL'],
    ports: [3000],
    complexity: 'medium',
    detectedAt: new Date(),
    baas: {
      providers: [{
        provider: 'supabase',
        name: 'Supabase',
        confidence: 0.9,
        features: ['database', 'auth', 'storage', 'realtime'],
      }],
      platformConfigs: [],
      externalServices: [],
      isBaaSApp: true,
    },
  };
}

function makeFirebaseBlueprint(): ApplicationBlueprint {
  return {
    repoUrl: 'https://github.com/test/firebase-app',
    repoName: 'firebase-app',
    runtime: 'node',
    appType: 'fullstack',
    frameworks: [{ name: 'React', confidence: 0.9 }],
    databases: [],
    services: [],
    hasDockerfile: false,
    hasDockerCompose: false,
    envVars: ['FIREBASE_API_KEY'],
    ports: [3000],
    complexity: 'medium',
    detectedAt: new Date(),
    baas: {
      providers: [{
        provider: 'firebase',
        name: 'Firebase',
        confidence: 0.9,
        features: ['database', 'auth', 'storage'],
      }],
      platformConfigs: [],
      externalServices: [],
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

// ── Tests ──

describe('getVendorCatalog', () => {
  it('should contain all 5 supported vendors', () => {
    const catalog = getVendorCatalog();
    expect(Object.keys(catalog)).toEqual(
      expect.arrayContaining(['supabase', 'firebase', 'convex', 'appwrite', 'nhost']),
    );
  });

  it('should have required fields on each vendor', () => {
    const catalog = getVendorCatalog();
    for (const vendor of Object.values(catalog)) {
      expect(vendor.id).toBeTruthy();
      expect(vendor.name).toBeTruthy();
      expect(vendor.signupUrl).toMatch(/^https:\/\//);
      expect(vendor.features.length).toBeGreaterThan(0);
      expect(vendor.requiredEnvVars.length).toBeGreaterThan(0);
      expect(vendor.setupSteps.length).toBeGreaterThan(0);
    }
  });
});

describe('generateMigrationOptions', () => {
  it('should return empty array for non-BaaS blueprint', () => {
    const options = generateMigrationOptions(makeNonBaaSBlueprint());
    expect(options).toHaveLength(0);
  });

  it('should always include self-hosted option first', () => {
    const options = generateMigrationOptions(makeSupabaseBlueprint());
    expect(options.length).toBeGreaterThanOrEqual(2);
    expect(options[0]!.strategy).toBe('self-hosted');
    expect(options[0]!.handledFeatures).toHaveLength(0);
    expect(options[0]!.vendor).toBeUndefined();
  });

  it('should include keep-vendor option for Supabase', () => {
    const options = generateMigrationOptions(makeSupabaseBlueprint());
    const keepOption = options.find(o => o.strategy === 'keep-vendor');
    expect(keepOption).toBeDefined();
    expect(keepOption!.vendor!.id).toBe('supabase');
    expect(keepOption!.handledFeatures).toEqual(
      expect.arrayContaining(['database', 'auth', 'storage', 'realtime']),
    );
  });

  it('should include migrate-vendor option for Supabase (to Firebase)', () => {
    const options = generateMigrationOptions(makeSupabaseBlueprint());
    const migrateOption = options.find(o => o.strategy === 'migrate-vendor');
    expect(migrateOption).toBeDefined();
    expect(migrateOption!.vendor!.id).toBe('firebase');
  });

  it('should include migrate-vendor option for Firebase (to Supabase)', () => {
    const options = generateMigrationOptions(makeFirebaseBlueprint());
    const migrateOption = options.find(o => o.strategy === 'migrate-vendor');
    expect(migrateOption).toBeDefined();
    expect(migrateOption!.vendor!.id).toBe('supabase');
  });

  it('should return 3 options for Supabase (self-hosted, keep, migrate)', () => {
    const options = generateMigrationOptions(makeSupabaseBlueprint());
    expect(options).toHaveLength(3);
  });
});

describe('shouldProvisionResource', () => {
  it('should return true when migrationChoice is undefined (backward compat)', () => {
    expect(shouldProvisionResource('database', undefined)).toBe(true);
    expect(shouldProvisionResource('auth', undefined)).toBe(true);
  });

  it('should return true for self-hosted strategy', () => {
    const choice: BaaSMigrationChoice = { strategy: 'self-hosted', handledFeatures: [] };
    expect(shouldProvisionResource('database', choice)).toBe(true);
    expect(shouldProvisionResource('auth', choice)).toBe(true);
  });

  it('should return false for features handled by vendor', () => {
    const choice: BaaSMigrationChoice = {
      strategy: 'keep-vendor',
      handledFeatures: ['database', 'auth', 'storage'] as BaaSFeature[],
    };
    expect(shouldProvisionResource('database', choice)).toBe(false);
    expect(shouldProvisionResource('auth', choice)).toBe(false);
    expect(shouldProvisionResource('storage', choice)).toBe(false);
  });

  it('should return true for features NOT handled by vendor', () => {
    const choice: BaaSMigrationChoice = {
      strategy: 'keep-vendor',
      handledFeatures: ['database'] as BaaSFeature[],
    };
    expect(shouldProvisionResource('auth', choice)).toBe(true);
    expect(shouldProvisionResource('storage', choice)).toBe(true);
  });
});

describe('buildVendorSubscription', () => {
  it('should convert BaaSVendorInfo to VendorSubscription', () => {
    const catalog = getVendorCatalog();
    const sub = buildVendorSubscription(catalog['supabase']!);
    expect(sub.vendorName).toBe('Supabase');
    expect(sub.pricingTier).toBe('Pro $25/mo');
    expect(sub.monthlyEstimate).toBe(25);
    expect(sub.features).toContain('database');
    expect(sub.requiredEnvVars).toContain('SUPABASE_URL');
    expect(sub.signupUrl).toMatch(/supabase\.com/);
  });
});

describe('resource-mapper with migrationChoice', () => {
  it('should skip BaaS resources when vendor handles them', () => {
    const choice: BaaSMigrationChoice = {
      strategy: 'keep-vendor',
      handledFeatures: ['database', 'auth', 'storage', 'realtime'],
    };
    const reqs = mapRequirements(makeSupabaseBlueprint(), choice);
    // Database should still be true from the DetectedDatabase in the blueprint (not BaaS mapping)
    // but auth and object storage from BaaS should be skipped
    expect(reqs.needsAuth).toBe(false);
    expect(reqs.needsObjectStorage).toBe(false);
    expect(reqs.baasReplacements).toHaveLength(0);
  });

  it('should provision all resources for self-hosted strategy', () => {
    const choice: BaaSMigrationChoice = {
      strategy: 'self-hosted',
      handledFeatures: [],
    };
    const reqs = mapRequirements(makeSupabaseBlueprint(), choice);
    expect(reqs.needsAuth).toBe(true);
    expect(reqs.needsObjectStorage).toBe(true);
    expect(reqs.baasReplacements.length).toBeGreaterThan(0);
  });

  it('should still work without migrationChoice (backward compat)', () => {
    const reqs = mapRequirements(makeSupabaseBlueprint());
    expect(reqs.needsAuth).toBe(true);
    expect(reqs.needsObjectStorage).toBe(true);
  });
});

describe('strategy-builder with migrationChoice', () => {
  it('should attach vendorSubscription when vendor is chosen', () => {
    const catalog = getVendorCatalog();
    const choice: BaaSMigrationChoice = {
      strategy: 'keep-vendor',
      vendor: catalog['supabase'],
      handledFeatures: ['database', 'auth', 'storage', 'realtime'],
    };
    const strategies = buildStrategies(makeSupabaseBlueprint(), CloudProvider.AWS, choice);
    for (const s of strategies) {
      expect(s.vendorSubscription).toBeDefined();
      expect(s.vendorSubscription!.vendorName).toBe('Supabase');
      expect(s.vendorSubscription!.monthlyEstimate).toBe(25);
    }
  });

  it('should NOT attach vendorSubscription for self-hosted', () => {
    const choice: BaaSMigrationChoice = {
      strategy: 'self-hosted',
      handledFeatures: [],
    };
    const strategies = buildStrategies(makeSupabaseBlueprint(), CloudProvider.AWS, choice);
    for (const s of strategies) {
      expect(s.vendorSubscription).toBeUndefined();
    }
  });

  it('should exclude auth/storage resources when vendor handles them', () => {
    const catalog = getVendorCatalog();
    const choice: BaaSMigrationChoice = {
      strategy: 'keep-vendor',
      vendor: catalog['supabase'],
      handledFeatures: ['database', 'auth', 'storage', 'realtime'],
    };
    const strategies = buildStrategies(makeSupabaseBlueprint(), CloudProvider.AWS, choice);
    for (const s of strategies) {
      expect(s.auth).toBeUndefined();
      expect(s.objectStorage).toBeUndefined();
    }
  });

  it('should include vendor subscription in cost breakdown', () => {
    const catalog = getVendorCatalog();
    const choice: BaaSMigrationChoice = {
      strategy: 'keep-vendor',
      vendor: catalog['supabase'],
      handledFeatures: ['database', 'auth', 'storage', 'realtime'],
    };
    const strategies = buildStrategies(makeSupabaseBlueprint(), CloudProvider.AWS, choice);
    const medium = strategies[1]!;
    expect(medium.costBreakdown).toBeDefined();
    const services = medium.costBreakdown!.lineItems.map(i => i.service);
    expect(services).toContain('Vendor Subscription');
  });

  it('should result in lower cost with vendor vs self-hosted', () => {
    const catalog = getVendorCatalog();
    const vendorChoice: BaaSMigrationChoice = {
      strategy: 'keep-vendor',
      vendor: catalog['supabase'],
      handledFeatures: ['database', 'auth', 'storage', 'realtime'],
    };
    const selfHostedChoice: BaaSMigrationChoice = {
      strategy: 'self-hosted',
      handledFeatures: [],
    };

    const vendorStrategies = buildStrategies(makeSupabaseBlueprint(), CloudProvider.AWS, vendorChoice);
    const selfHostedStrategies = buildStrategies(makeSupabaseBlueprint(), CloudProvider.AWS, selfHostedChoice);

    // At medium tier, vendor should have fewer line items (no DB, auth, storage)
    const vendorMedium = vendorStrategies[1]!;
    const selfHostedMedium = selfHostedStrategies[1]!;

    expect(vendorMedium.costBreakdown!.lineItems.length).toBeLessThan(
      selfHostedMedium.costBreakdown!.lineItems.length,
    );
  });

  it('should still work without migrationChoice (backward compat)', () => {
    const strategies = buildStrategies(makeSupabaseBlueprint(), CloudProvider.AWS);
    for (const s of strategies) {
      expect(s.vendorSubscription).toBeUndefined();
      expect(s.auth).toBeDefined(); // self-hosted provisions all
    }
  });
});
