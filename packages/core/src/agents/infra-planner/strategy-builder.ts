import { ApplicationBlueprint, CloudProvider, ScalingStrategy, StrategyTier, AuthResource, ObjectStorageResource, BaaSMigrationChoice } from '../../types/index';
import { mapRequirements, BaseRequirements } from './resource-mapper';
import { buildVendorSubscription } from './baas-migration';
import { getAWSTemplate } from './templates/aws-templates';
import { getGCPTemplate } from './templates/gcp-templates';
import { getAzureTemplate } from './templates/azure-templates';
import { calculateCost } from '../cost-estimator/calculator';

function getTemplate(provider: CloudProvider, tier: StrategyTier) {
  switch (provider) {
    case CloudProvider.AWS: return getAWSTemplate(tier);
    case CloudProvider.GCP: return getGCPTemplate(tier);
    case CloudProvider.Azure: return getAzureTemplate(tier);
  }
}

const TIER_NAMES: Record<StrategyTier, string> = {
  low: 'Starter',
  medium: 'Production',
  high: 'Enterprise',
};

const TIER_DESCRIPTIONS: Record<StrategyTier, string> = {
  low: 'Cost-optimized for development, demos, and low-traffic apps',
  medium: 'Balanced for production workloads with high availability',
  high: 'Maximum performance and redundancy for mission-critical apps',
};

export function buildStrategies(
  blueprint: ApplicationBlueprint,
  provider: CloudProvider,
  migrationChoice?: BaaSMigrationChoice,
): ScalingStrategy[] {
  const requirements = mapRequirements(blueprint, migrationChoice);
  const tiers: StrategyTier[] = ['low', 'medium', 'high'];

  return tiers.map((tier) => {
    const template = getTemplate(provider, tier);
    const strategy = buildStrategy(tier, template, requirements, provider);

    // Attach vendor subscription if a vendor was chosen
    if (migrationChoice?.vendor) {
      strategy.vendorSubscription = buildVendorSubscription(migrationChoice.vendor);
    }

    strategy.costBreakdown = calculateCost(strategy);
    return strategy;
  });
}

function getAuthServiceName(provider: CloudProvider): string {
  const names: Record<string, string> = { aws: 'Cognito', gcp: 'Identity Platform', azure: 'Azure AD B2C' };
  return names[provider] ?? 'Auth Service';
}

function getStorageServiceName(provider: CloudProvider): string {
  const names: Record<string, string> = { aws: 'S3', gcp: 'Cloud Storage', azure: 'Blob Storage' };
  return names[provider] ?? 'Object Storage';
}

function getServiceName(provider: CloudProvider, type: 'cache' | 'queue' | 'streaming'): string {
  const names: Record<string, Record<string, string>> = {
    aws: { cache: 'ElastiCache', queue: 'SQS', streaming: 'Kinesis/MSK' },
    gcp: { cache: 'Memorystore', queue: 'Cloud Tasks', streaming: 'Pub/Sub' },
    azure: { cache: 'Azure Cache for Redis', queue: 'Service Bus', streaming: 'Event Hubs' },
  };
  return names[provider]?.[type] ?? type;
}

function buildStrategy(
  tier: StrategyTier,
  template: ReturnType<typeof getAWSTemplate>,
  requirements: BaseRequirements,
  provider: CloudProvider,
): ScalingStrategy {
  const strategy: ScalingStrategy = {
    tier,
    name: TIER_NAMES[tier],
    description: TIER_DESCRIPTIONS[tier],
    provider,
    compute: { ...template.compute },
    network: { ...template.network },
    securityTier: template.securityTier,
    estimatedUsers: template.estimatedUsers,
  };

  // Add database if needed
  if (requirements.needsDatabase) {
    strategy.database = {
      ...template.database,
      engine: requirements.dbEngine,
    };
  }

  // Add cache if needed
  if (requirements.needsCache) {
    strategy.cache = {
      service: getServiceName(provider, 'cache'),
      ...template.cache,
    };
  }

  // Add queue if needed
  if (requirements.needsQueue) {
    strategy.queue = {
      service: getServiceName(provider, 'queue'),
      ...template.queue,
    };
  }

  // Add streaming if needed
  if (requirements.needsStreaming) {
    strategy.streaming = {
      service: getServiceName(provider, 'streaming'),
      ...template.streaming,
    };
  }

  // Add auth if needed
  if (requirements.needsAuth) {
    strategy.auth = {
      service: getAuthServiceName(provider),
      estimatedMAU: tier === 'low' ? 1000 : tier === 'medium' ? 50000 : 500000,
    };
  }

  // Add object storage if needed
  if (requirements.needsObjectStorage) {
    strategy.objectStorage = {
      service: getStorageServiceName(provider),
      estimatedGB: tier === 'low' ? 10 : tier === 'medium' ? 100 : 1000,
      cdn: tier !== 'low',
    };
  }

  // Attach BaaS replacement mapping
  if (requirements.baasReplacements.length > 0) {
    strategy.baasReplacements = requirements.baasReplacements;
  }

  // Adjust network based on requirements
  if (!requirements.needsCDN) {
    strategy.network.cdn = false;
    strategy.network.cdnProvider = undefined;
  }
  if (!requirements.needsLoadBalancer && tier === 'low') {
    strategy.network.loadBalancer = false;
    strategy.network.loadBalancerType = undefined;
  }

  return strategy;
}
