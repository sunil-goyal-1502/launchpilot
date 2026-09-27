import type { RepositoryArchitecture } from './architecture';
export type Runtime = 'node' | 'python' | 'java' | 'go' | 'ruby' | 'docker' | 'unknown';

export type AppType =
  | 'web-app'
  | 'api'
  | 'fullstack'
  | 'static-site'
  | 'microservice'
  | 'monolith'
  | 'monorepo'
  | 'unknown';

export interface DetectedFramework {
  name: string;
  version?: string;
  confidence: number; // 0-1
}

export interface DetectedDatabase {
  type: 'postgresql' | 'mysql' | 'mongodb' | 'sqlite' | 'dynamodb' | 'unknown';
  name: string;
  confidence: number;
}

export type ServiceType = 'cache' | 'queue' | 'streaming';
export type CacheProvider = 'redis' | 'memcached';
export type QueueProvider = 'sqs' | 'rabbitmq' | 'bullmq' | 'celery' | 'sidekiq' | 'rq';
export type StreamProvider = 'kafka' | 'kinesis' | 'pulsar';

export interface DetectedService {
  serviceType: ServiceType;
  provider: string;
  name: string;
  confidence: number;
}

export type BaaSProvider = 'supabase' | 'firebase' | 'convex' | 'appwrite' | 'nhost';
export type BaaSFeature = 'database' | 'auth' | 'storage' | 'realtime' | 'edge-functions';
export type DeployTarget = 'vercel' | 'netlify' | 'replit' | 'railway' | 'render' | 'fly';

export interface DetectedBaaS {
  provider: BaaSProvider;
  name: string;
  confidence: number;
  features: BaaSFeature[];
}

export interface DetectedPlatformConfig {
  target: DeployTarget;
  configFile: string;
  confidence: number;
}

export interface DetectedExternalService {
  category: 'auth' | 'payments' | 'email' | 'analytics' | 'monitoring' | 'search' | 'ai' | 'storage' | 'other';
  provider: string;
  name: string;
  confidence: number;
  envVarHints: string[];
}

export interface ParsedTable {
  name: string;
  columns: Array<{
    name: string;
    type: string;
    nullable: boolean;
    isPrimaryKey: boolean;
    references?: { table: string; column: string };
  }>;
}

export interface ParsedMigration {
  filename: string;
  tables: ParsedTable[];
}

export interface BaaSMetadata {
  providers: DetectedBaaS[];
  platformConfigs: DetectedPlatformConfig[];
  externalServices: DetectedExternalService[];
  migrations?: ParsedMigration[];
  isBaaSApp: boolean;
}

export interface ApplicationBlueprint {
  repoUrl: string;
  repoName: string;
  runtime: Runtime;
  appType: AppType;
  frameworks: DetectedFramework[];
  databases: DetectedDatabase[];
  services: DetectedService[];
  hasDockerfile: boolean;
  hasDockerCompose: boolean;
  envVars: string[];
  ports: number[];
  buildCommand?: string;
  startCommand?: string;
  complexity: 'low' | 'medium' | 'high';
  detectedAt: Date;
  components?: Array<{
    name: string;
    path: string;
    runtime: string;
    frameworks: string[];
  }>;
  baas?: BaaSMetadata;
  architecture?: RepositoryArchitecture;
}

// ── BaaS Migration Types ──

export interface BaaSVendorInfo {
  id: string;
  name: string;
  signupUrl: string;
  features: BaaSFeature[];
  pricingTier: string;
  monthlyEstimate: number;
  requiredEnvVars: string[];
  setupSteps: string[];
}

export type BaaSMigrationStrategy = 'self-hosted' | 'keep-vendor' | 'migrate-vendor';

export interface BaaSMigrationOption {
  strategy: BaaSMigrationStrategy;
  label: string;
  description: string;
  vendor?: BaaSVendorInfo;
  handledFeatures: BaaSFeature[];
}

export interface BaaSMigrationChoice {
  strategy: BaaSMigrationStrategy;
  vendor?: BaaSVendorInfo;
  handledFeatures: BaaSFeature[];
}
