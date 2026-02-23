import { ApplicationBlueprint, AppType, BaaSMigrationChoice } from '../../types/index';
import { shouldProvisionResource } from './baas-migration';

export interface BaseRequirements {
  needsDatabase: boolean;
  dbEngine: string;
  needsLoadBalancer: boolean;
  needsCDN: boolean;
  isStateless: boolean;
  baseMemoryGB: number;
  needsCache: boolean;
  cacheType: string;
  needsQueue: boolean;
  queueType: string;
  needsStreaming: boolean;
  streamType: string;
  needsAuth: boolean;
  authType: string;
  needsObjectStorage: boolean;
  objectStorageType: string;
  baasReplacements: Array<{ original: string; feature: string; replacement: string }>;
}

const BASE_SERVICE_DEFAULTS = {
  needsCache: false,
  cacheType: 'none',
  needsQueue: false,
  queueType: 'none',
  needsStreaming: false,
  streamType: 'none',
  needsAuth: false,
  authType: 'none',
  needsObjectStorage: false,
  objectStorageType: 'none',
  baasReplacements: [] as Array<{ original: string; feature: string; replacement: string }>,
};

const APP_TYPE_REQUIREMENTS: Record<AppType, BaseRequirements> = {
  'web-app': {
    needsDatabase: false,
    dbEngine: 'none',
    needsLoadBalancer: true,
    needsCDN: true,
    isStateless: true,
    baseMemoryGB: 2,
    ...BASE_SERVICE_DEFAULTS,
  },
  api: {
    needsDatabase: true,
    dbEngine: 'postgresql',
    needsLoadBalancer: true,
    needsCDN: false,
    isStateless: true,
    baseMemoryGB: 2,
    ...BASE_SERVICE_DEFAULTS,
  },
  fullstack: {
    needsDatabase: true,
    dbEngine: 'postgresql',
    needsLoadBalancer: true,
    needsCDN: true,
    isStateless: false,
    baseMemoryGB: 4,
    ...BASE_SERVICE_DEFAULTS,
  },
  'static-site': {
    needsDatabase: false,
    dbEngine: 'none',
    needsLoadBalancer: false,
    needsCDN: true,
    isStateless: true,
    baseMemoryGB: 1,
    ...BASE_SERVICE_DEFAULTS,
  },
  microservice: {
    needsDatabase: true,
    dbEngine: 'postgresql',
    needsLoadBalancer: true,
    needsCDN: false,
    isStateless: true,
    baseMemoryGB: 2,
    ...BASE_SERVICE_DEFAULTS,
  },
  monolith: {
    needsDatabase: true,
    dbEngine: 'postgresql',
    needsLoadBalancer: true,
    needsCDN: true,
    isStateless: false,
    baseMemoryGB: 8,
    ...BASE_SERVICE_DEFAULTS,
  },
  monorepo: {
    needsDatabase: true,
    dbEngine: 'postgresql',
    needsLoadBalancer: true,
    needsCDN: true,
    isStateless: false,
    baseMemoryGB: 8,
    ...BASE_SERVICE_DEFAULTS,
  },
  unknown: {
    needsDatabase: true,
    dbEngine: 'postgresql',
    needsLoadBalancer: true,
    needsCDN: false,
    isStateless: true,
    baseMemoryGB: 4,
    ...BASE_SERVICE_DEFAULTS,
  },
};

export function mapRequirements(blueprint: ApplicationBlueprint, migrationChoice?: BaaSMigrationChoice): BaseRequirements {
  const base = { ...APP_TYPE_REQUIREMENTS[blueprint.appType], baasReplacements: [] as Array<{ original: string; feature: string; replacement: string }> };

  // Override DB engine based on detected databases
  if (blueprint.databases.length > 0) {
    base.needsDatabase = true;
    const primaryDb = blueprint.databases[0]!;
    base.dbEngine = primaryDb.type === 'mongodb' ? 'mongodb'
      : primaryDb.type === 'mysql' ? 'mysql'
      : 'postgresql';
  }

  // Map detected services to requirements
  for (const svc of blueprint.services) {
    switch (svc.serviceType) {
      case 'cache':
        base.needsCache = true;
        base.cacheType = svc.provider;
        break;
      case 'queue':
        base.needsQueue = true;
        base.queueType = svc.provider;
        break;
      case 'streaming':
        base.needsStreaming = true;
        base.streamType = svc.provider;
        break;
    }
  }

  // Map BaaS features to self-hosted requirements
  if (blueprint.baas?.isBaaSApp) {
    for (const provider of blueprint.baas.providers) {
      for (const feature of provider.features) {
        if (!shouldProvisionResource(feature, migrationChoice)) continue;
        switch (feature) {
          case 'database':
            base.needsDatabase = true;
            if (provider.provider === 'supabase' || provider.provider === 'nhost') base.dbEngine = 'postgresql';
            base.baasReplacements.push({ original: `${provider.name} Database`, feature: 'database', replacement: `Managed ${base.dbEngine}` });
            break;
          case 'auth':
            base.needsAuth = true;
            base.baasReplacements.push({ original: `${provider.name} Auth`, feature: 'auth', replacement: 'Managed Auth Service' });
            break;
          case 'storage':
            base.needsObjectStorage = true;
            base.baasReplacements.push({ original: `${provider.name} Storage`, feature: 'storage', replacement: 'Object Storage' });
            break;
          case 'realtime':
            base.baasReplacements.push({ original: `${provider.name} Realtime`, feature: 'realtime', replacement: 'WebSocket/Pub-Sub' });
            break;
        }
      }
    }
    // Migration-informed sizing
    if (blueprint.baas.migrations && blueprint.baas.migrations.length > 0) {
      const totalTables = blueprint.baas.migrations.reduce((sum, m) => sum + m.tables.length, 0);
      if (totalTables > 20) base.baseMemoryGB = Math.max(base.baseMemoryGB, 8);
    }
  }

  // Increase memory for complex apps
  if (blueprint.complexity === 'high') {
    base.baseMemoryGB = Math.max(base.baseMemoryGB, 8);
  }

  return base;
}
