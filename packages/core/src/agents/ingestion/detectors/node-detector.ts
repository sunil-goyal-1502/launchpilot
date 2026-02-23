import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { DetectedFramework, DetectedDatabase, DetectedService, Runtime, AppType } from '../../../types/index';

interface NodeDetection {
  runtime: Runtime;
  appType: AppType;
  frameworks: DetectedFramework[];
  databases: DetectedDatabase[];
  services: DetectedService[];
  buildCommand?: string;
  startCommand?: string;
  ports: number[];
  envVars: string[];
}

const FRAMEWORK_PATTERNS: Array<{
  dep: string;
  name: string;
  appType: AppType;
  confidence: number;
}> = [
  { dep: 'next', name: 'Next.js', appType: 'fullstack', confidence: 0.95 },
  { dep: 'nuxt', name: 'Nuxt', appType: 'fullstack', confidence: 0.95 },
  { dep: '@nestjs/core', name: 'NestJS', appType: 'api', confidence: 0.95 },
  { dep: 'express', name: 'Express', appType: 'api', confidence: 0.85 },
  { dep: 'fastify', name: 'Fastify', appType: 'api', confidence: 0.85 },
  { dep: 'koa', name: 'Koa', appType: 'api', confidence: 0.85 },
  { dep: 'hapi', name: 'Hapi', appType: 'api', confidence: 0.85 },
  { dep: '@hapi/hapi', name: 'Hapi', appType: 'api', confidence: 0.85 },
  { dep: 'react', name: 'React', appType: 'web-app', confidence: 0.8 },
  { dep: 'vue', name: 'Vue', appType: 'web-app', confidence: 0.8 },
  { dep: 'svelte', name: 'Svelte', appType: 'web-app', confidence: 0.8 },
  { dep: '@angular/core', name: 'Angular', appType: 'web-app', confidence: 0.8 },
  { dep: 'gatsby', name: 'Gatsby', appType: 'static-site', confidence: 0.9 },
  { dep: 'astro', name: 'Astro', appType: 'static-site', confidence: 0.9 },
  { dep: 'remix', name: 'Remix', appType: 'fullstack', confidence: 0.95 },
  { dep: '@remix-run/node', name: 'Remix', appType: 'fullstack', confidence: 0.95 },
];

const DB_PATTERNS: Array<{
  dep: string;
  type: DetectedDatabase['type'];
  name: string;
  confidence: number;
}> = [
  { dep: 'pg', type: 'postgresql', name: 'PostgreSQL (pg)', confidence: 0.9 },
  { dep: 'prisma', type: 'postgresql', name: 'Prisma', confidence: 0.8 },
  { dep: '@prisma/client', type: 'postgresql', name: 'Prisma', confidence: 0.8 },
  { dep: 'mongoose', type: 'mongodb', name: 'MongoDB (Mongoose)', confidence: 0.9 },
  { dep: 'mongodb', type: 'mongodb', name: 'MongoDB', confidence: 0.9 },
  { dep: 'mysql2', type: 'mysql', name: 'MySQL', confidence: 0.9 },
  { dep: 'mysql', type: 'mysql', name: 'MySQL', confidence: 0.9 },
  { dep: 'better-sqlite3', type: 'sqlite', name: 'SQLite', confidence: 0.85 },
  { dep: 'sequelize', type: 'postgresql', name: 'Sequelize', confidence: 0.7 },
  { dep: 'typeorm', type: 'postgresql', name: 'TypeORM', confidence: 0.7 },
  { dep: 'drizzle-orm', type: 'postgresql', name: 'Drizzle', confidence: 0.7 },
];

const SERVICE_PATTERNS: Array<{
  dep: string;
  serviceType: DetectedService['serviceType'];
  provider: string;
  name: string;
  confidence: number;
}> = [
  // Cache
  { dep: 'redis', serviceType: 'cache', provider: 'redis', name: 'Redis', confidence: 0.85 },
  { dep: 'ioredis', serviceType: 'cache', provider: 'redis', name: 'Redis (ioredis)', confidence: 0.85 },
  { dep: 'memcached', serviceType: 'cache', provider: 'memcached', name: 'Memcached', confidence: 0.85 },
  // Queue
  { dep: 'bull', serviceType: 'queue', provider: 'bullmq', name: 'Bull Queue', confidence: 0.9 },
  { dep: 'bullmq', serviceType: 'queue', provider: 'bullmq', name: 'BullMQ', confidence: 0.9 },
  { dep: 'amqplib', serviceType: 'queue', provider: 'rabbitmq', name: 'RabbitMQ (amqplib)', confidence: 0.9 },
  { dep: '@aws-sdk/client-sqs', serviceType: 'queue', provider: 'sqs', name: 'AWS SQS', confidence: 0.95 },
  // Streaming
  { dep: 'kafkajs', serviceType: 'streaming', provider: 'kafka', name: 'Kafka (kafkajs)', confidence: 0.9 },
  { dep: 'kafka-node', serviceType: 'streaming', provider: 'kafka', name: 'Kafka (kafka-node)', confidence: 0.9 },
  { dep: '@aws-sdk/client-kinesis', serviceType: 'streaming', provider: 'kinesis', name: 'AWS Kinesis', confidence: 0.95 },
];

// Config files that indicate specific frameworks (Vercel-style detection)
const CONFIG_FILE_FRAMEWORKS: Record<string, { framework: string; appType: AppType; confidence: number }> = {
  'next.config.js':    { framework: 'Next.js',    appType: 'fullstack',    confidence: 0.95 },
  'next.config.mjs':   { framework: 'Next.js',    appType: 'fullstack',    confidence: 0.95 },
  'next.config.ts':    { framework: 'Next.js',    appType: 'fullstack',    confidence: 0.95 },
  'nuxt.config.ts':    { framework: 'Nuxt',       appType: 'fullstack',    confidence: 0.95 },
  'nuxt.config.js':    { framework: 'Nuxt',       appType: 'fullstack',    confidence: 0.95 },
  'vite.config.ts':    { framework: 'Vite',       appType: 'web-app',      confidence: 0.85 },
  'vite.config.js':    { framework: 'Vite',       appType: 'web-app',      confidence: 0.85 },
  'vite.config.mjs':   { framework: 'Vite',       appType: 'web-app',      confidence: 0.85 },
  'astro.config.mjs':  { framework: 'Astro',      appType: 'static-site',  confidence: 0.9 },
  'astro.config.ts':   { framework: 'Astro',      appType: 'static-site',  confidence: 0.9 },
  'svelte.config.js':  { framework: 'SvelteKit',  appType: 'fullstack',    confidence: 0.9 },
  'svelte.config.ts':  { framework: 'SvelteKit',  appType: 'fullstack',    confidence: 0.9 },
  'remix.config.js':   { framework: 'Remix',      appType: 'fullstack',    confidence: 0.95 },
  'remix.config.mjs':  { framework: 'Remix',      appType: 'fullstack',    confidence: 0.95 },
  'angular.json':      { framework: 'Angular',    appType: 'web-app',      confidence: 0.9 },
  'gatsby-config.js':  { framework: 'Gatsby',     appType: 'static-site',  confidence: 0.9 },
  'gatsby-config.ts':  { framework: 'Gatsby',     appType: 'static-site',  confidence: 0.9 },
};

function detectConfigFileFrameworks(basePath: string, seenFrameworks: Set<string>): DetectedFramework[] {
  const found: DetectedFramework[] = [];
  for (const [file, info] of Object.entries(CONFIG_FILE_FRAMEWORKS)) {
    if (existsSync(join(basePath, file)) && !seenFrameworks.has(info.framework)) {
      seenFrameworks.add(info.framework);
      found.push({ name: info.framework, confidence: info.confidence });
    }
  }
  return found;
}

export async function detectNode(repoPath: string, subDir?: string): Promise<NodeDetection | null> {
  const basePath = subDir ? join(repoPath, subDir) : repoPath;
  const pkgPath = join(basePath, 'package.json');
  if (!existsSync(pkgPath)) return null;

  let pkg: Record<string, unknown>;
  try {
    const raw = await readFile(pkgPath, 'utf-8');
    pkg = JSON.parse(raw);
  } catch {
    return null;
  }

  const allDeps = {
    ...(pkg['dependencies'] as Record<string, string> | undefined),
    ...(pkg['devDependencies'] as Record<string, string> | undefined),
  };

  const frameworks: DetectedFramework[] = [];
  const databases: DetectedDatabase[] = [];
  const services: DetectedService[] = [];
  const seenFrameworks = new Set<string>();
  const seenDbTypes = new Set<string>();
  const seenServiceKeys = new Set<string>();

  for (const pattern of FRAMEWORK_PATTERNS) {
    if (allDeps[pattern.dep] && !seenFrameworks.has(pattern.name)) {
      seenFrameworks.add(pattern.name);
      frameworks.push({
        name: pattern.name,
        version: allDeps[pattern.dep],
        confidence: pattern.confidence,
      });
    }
  }

  for (const pattern of DB_PATTERNS) {
    if (allDeps[pattern.dep] && !seenDbTypes.has(pattern.type)) {
      seenDbTypes.add(pattern.type);
      databases.push({
        type: pattern.type,
        name: pattern.name,
        confidence: pattern.confidence,
      });
    }
  }

  for (const pattern of SERVICE_PATTERNS) {
    const key = `${pattern.serviceType}:${pattern.provider}`;
    if (allDeps[pattern.dep] && !seenServiceKeys.has(key)) {
      seenServiceKeys.add(key);
      services.push({
        serviceType: pattern.serviceType,
        provider: pattern.provider,
        name: pattern.name,
        confidence: pattern.confidence,
      });
    }
  }

  // Supplement with config file detection (Vercel-style)
  const configFrameworks = detectConfigFileFrameworks(basePath, seenFrameworks);
  frameworks.push(...configFrameworks);

  if (frameworks.length === 0) return null;

  // Determine app type from highest-confidence framework
  const primaryFramework = frameworks.sort((a, b) => b.confidence - a.confidence)[0]!;
  const primaryPattern = FRAMEWORK_PATTERNS.find((p) => p.name === primaryFramework.name);
  const configPattern = Object.values(CONFIG_FILE_FRAMEWORKS).find((c) => c.framework === primaryFramework.name);
  let appType: AppType = primaryPattern?.appType ?? configPattern?.appType ?? 'unknown';

  // If we have both frontend + backend frameworks, it's fullstack
  const hasBackend = frameworks.some((f) =>
    ['Express', 'NestJS', 'Fastify', 'Koa', 'Hapi'].includes(f.name),
  );
  const hasFrontend = frameworks.some((f) =>
    ['React', 'Vue', 'Svelte', 'Angular'].includes(f.name),
  );
  if (hasBackend && hasFrontend) {
    appType = 'fullstack';
  }

  // Extract scripts for build/start commands
  const scripts = pkg['scripts'] as Record<string, string> | undefined;
  const buildCommand = scripts?.['build'];
  const startCommand = scripts?.['start'] || scripts?.['dev'];

  // Detect ports from common patterns
  const ports: number[] = [];
  if (startCommand?.includes('3000') || allDeps['next']) ports.push(3000);
  if (startCommand?.includes('8080')) ports.push(8080);
  if (startCommand?.includes('4000')) ports.push(4000);
  if (ports.length === 0) ports.push(3000); // Default Node.js port

  // Detect env vars from .env.example if present
  const envVars: string[] = [];
  try {
    const envExample = await readFile(join(basePath, '.env.example'), 'utf-8');
    const vars = envExample
      .split('\n')
      .filter((line) => line.includes('=') && !line.startsWith('#'))
      .map((line) => line.split('=')[0]!.trim());
    envVars.push(...vars);
  } catch {
    // No .env.example
  }

  return {
    runtime: 'node',
    appType,
    frameworks,
    databases,
    services,
    buildCommand,
    startCommand,
    ports,
    envVars,
  };
}
