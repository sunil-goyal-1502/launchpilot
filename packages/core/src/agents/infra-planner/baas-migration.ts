import {
  BaaSVendorInfo,
  BaaSFeature,
  BaaSMigrationOption,
  BaaSMigrationChoice,
  ApplicationBlueprint,
} from '../../types/index';
import { VendorSubscription } from '../../types/scaling-strategy';

// ── Vendor Catalog ──

const VENDOR_CATALOG: Record<string, BaaSVendorInfo> = {
  supabase: {
    id: 'supabase',
    name: 'Supabase',
    signupUrl: 'https://supabase.com/dashboard',
    features: ['database', 'auth', 'storage', 'realtime', 'edge-functions'],
    pricingTier: 'Pro $25/mo',
    monthlyEstimate: 25,
    requiredEnvVars: ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'],
    setupSteps: [
      'Create a project at supabase.com/dashboard',
      'Copy project URL and anon key from Settings > API',
      'Set SUPABASE_URL and SUPABASE_ANON_KEY env vars',
    ],
  },
  firebase: {
    id: 'firebase',
    name: 'Firebase',
    signupUrl: 'https://console.firebase.google.com',
    features: ['database', 'auth', 'storage', 'realtime'],
    pricingTier: 'Blaze (pay-as-you-go)',
    monthlyEstimate: 0,
    requiredEnvVars: ['FIREBASE_PROJECT_ID', 'FIREBASE_API_KEY', 'GOOGLE_APPLICATION_CREDENTIALS'],
    setupSteps: [
      'Create a project at console.firebase.google.com',
      'Enable required services (Firestore, Auth, Storage)',
      'Download service account key from Project Settings',
      'Set GOOGLE_APPLICATION_CREDENTIALS to key file path',
    ],
  },
  convex: {
    id: 'convex',
    name: 'Convex',
    signupUrl: 'https://dashboard.convex.dev',
    features: ['database', 'auth', 'storage', 'realtime'],
    pricingTier: 'Pro $25/mo',
    monthlyEstimate: 25,
    requiredEnvVars: ['CONVEX_DEPLOYMENT', 'CONVEX_URL'],
    setupSteps: [
      'Create a project at dashboard.convex.dev',
      'Run npx convex dev to initialize',
      'Copy deployment URL from dashboard',
      'Set CONVEX_DEPLOYMENT and CONVEX_URL env vars',
    ],
  },
  appwrite: {
    id: 'appwrite',
    name: 'Appwrite',
    signupUrl: 'https://cloud.appwrite.io',
    features: ['database', 'auth', 'storage', 'realtime'],
    pricingTier: 'Pro $15/mo',
    monthlyEstimate: 15,
    requiredEnvVars: ['APPWRITE_ENDPOINT', 'APPWRITE_PROJECT_ID', 'APPWRITE_API_KEY'],
    setupSteps: [
      'Create a project at cloud.appwrite.io',
      'Go to Settings to find Project ID',
      'Create an API key under API Keys',
      'Set APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID, APPWRITE_API_KEY env vars',
    ],
  },
  nhost: {
    id: 'nhost',
    name: 'Nhost',
    signupUrl: 'https://app.nhost.io',
    features: ['database', 'auth', 'storage', 'realtime'],
    pricingTier: 'Pro $25/mo',
    monthlyEstimate: 25,
    requiredEnvVars: ['NHOST_SUBDOMAIN', 'NHOST_REGION', 'NHOST_ADMIN_SECRET'],
    setupSteps: [
      'Create a project at app.nhost.io',
      'Copy subdomain and region from project settings',
      'Set NHOST_SUBDOMAIN, NHOST_REGION, and NHOST_ADMIN_SECRET env vars',
    ],
  },
};

// Which vendors can serve as alternatives to each provider
const ALTERNATIVE_MAP: Record<string, string[]> = {
  supabase: ['firebase', 'nhost'],
  firebase: ['supabase', 'nhost'],
  convex: ['supabase', 'firebase'],
  appwrite: ['supabase', 'firebase'],
  nhost: ['supabase', 'firebase'],
};

// ── Public API ──

export function getVendorCatalog(): Record<string, BaaSVendorInfo> {
  return VENDOR_CATALOG;
}

export function generateMigrationOptions(blueprint: ApplicationBlueprint): BaaSMigrationOption[] {
  if (!blueprint.baas?.isBaaSApp || blueprint.baas.providers.length === 0) {
    return [];
  }

  const primaryProvider = blueprint.baas.providers[0]!;
  const detectedFeatures = primaryProvider.features;
  const options: BaaSMigrationOption[] = [];

  // Option 1: Self-hosted (always present)
  options.push({
    strategy: 'self-hosted',
    label: 'Self-Hosted — Deploy all on your cloud',
    description: 'Replace all BaaS services with cloud-managed equivalents (DB, auth, storage)',
    handledFeatures: [],
  });

  // Option 2: Keep current vendor
  const currentVendor = VENDOR_CATALOG[primaryProvider.provider];
  if (currentVendor) {
    options.push({
      strategy: 'keep-vendor',
      label: `Keep ${currentVendor.name} — Use ${currentVendor.pricingTier}`,
      description: `Continue using ${currentVendor.name} for ${detectedFeatures.join(', ')}`,
      vendor: currentVendor,
      handledFeatures: [...detectedFeatures],
    });
  }

  // Option 3: Migrate to alternative (only if it covers all detected features)
  const alternatives = ALTERNATIVE_MAP[primaryProvider.provider] ?? [];
  for (const altId of alternatives) {
    const altVendor = VENDOR_CATALOG[altId];
    if (!altVendor) continue;

    const coversAll = detectedFeatures.every(f => altVendor.features.includes(f));
    if (coversAll) {
      options.push({
        strategy: 'migrate-vendor',
        label: `Migrate to ${altVendor.name} — ${altVendor.pricingTier}`,
        description: `Switch from ${primaryProvider.name} to ${altVendor.name} for ${detectedFeatures.join(', ')}`,
        vendor: altVendor,
        handledFeatures: [...detectedFeatures],
      });
      break; // Only suggest the first compatible alternative
    }
  }

  return options;
}

export function shouldProvisionResource(
  feature: BaaSFeature,
  migrationChoice?: BaaSMigrationChoice,
): boolean {
  if (!migrationChoice || migrationChoice.strategy === 'self-hosted') {
    return true;
  }
  return !migrationChoice.handledFeatures.includes(feature);
}

export function buildVendorSubscription(vendor: BaaSVendorInfo): VendorSubscription {
  return {
    vendorName: vendor.name,
    pricingTier: vendor.pricingTier,
    monthlyEstimate: vendor.monthlyEstimate,
    features: [...vendor.features],
    requiredEnvVars: [...vendor.requiredEnvVars],
    signupUrl: vendor.signupUrl,
  };
}
