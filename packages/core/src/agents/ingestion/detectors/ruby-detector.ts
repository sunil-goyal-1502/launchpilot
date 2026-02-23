import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { DetectedFramework, DetectedDatabase, DetectedService, AppType } from '../../../types/index';

interface RubyDetection {
  runtime: 'ruby';
  appType: AppType;
  frameworks: DetectedFramework[];
  databases: DetectedDatabase[];
  services: DetectedService[];
  startCommand?: string;
  ports: number[];
}

export async function detectRuby(repoPath: string, subDir?: string): Promise<RubyDetection | null> {
  const basePath = subDir ? join(repoPath, subDir) : repoPath;
  const gemfilePath = join(basePath, 'Gemfile');
  if (!existsSync(gemfilePath)) return null;

  const content = await readFile(gemfilePath, 'utf-8');

  const frameworks: DetectedFramework[] = [];
  const databases: DetectedDatabase[] = [];
  const services: DetectedService[] = [];

  // Detect frameworks
  if (/gem\s+['"]rails['"]/.test(content)) {
    frameworks.push({ name: 'Rails', confidence: 0.95 });
  }
  if (/gem\s+['"]sinatra['"]/.test(content)) {
    frameworks.push({ name: 'Sinatra', confidence: 0.9 });
  }
  if (/gem\s+['"]hanami['"]/.test(content)) {
    frameworks.push({ name: 'Hanami', confidence: 0.9 });
  }

  // Detect databases
  if (/gem\s+['"]pg['"]/.test(content)) {
    databases.push({ type: 'postgresql', name: 'PostgreSQL', confidence: 0.9 });
  }
  if (/gem\s+['"]mysql2['"]/.test(content)) {
    databases.push({ type: 'mysql', name: 'MySQL', confidence: 0.9 });
  }
  if (/gem\s+['"]mongoid['"]/.test(content)) {
    databases.push({ type: 'mongodb', name: 'MongoDB', confidence: 0.9 });
  }
  if (/gem\s+['"]sqlite3['"]/.test(content)) {
    databases.push({ type: 'sqlite', name: 'SQLite', confidence: 0.85 });
  }

  // Detect services
  if (/gem\s+['"]redis['"]/.test(content)) {
    services.push({ serviceType: 'cache', provider: 'redis', name: 'Redis', confidence: 0.85 });
  }
  if (/gem\s+['"]sidekiq['"]/.test(content)) {
    services.push({ serviceType: 'queue', provider: 'sidekiq', name: 'Sidekiq', confidence: 0.9 });
  }
  if (/gem\s+['"]bunny['"]/.test(content)) {
    services.push({ serviceType: 'queue', provider: 'rabbitmq', name: 'RabbitMQ (Bunny)', confidence: 0.9 });
  }
  if (/gem\s+['"]ruby-kafka['"]/.test(content)) {
    services.push({ serviceType: 'streaming', provider: 'kafka', name: 'Ruby Kafka', confidence: 0.9 });
  }

  if (frameworks.length === 0) return null;

  const isRails = frameworks.some((f) => f.name === 'Rails');
  const appType: AppType = isRails ? 'fullstack' : 'api';
  const startCommand = isRails ? 'rails server -b 0.0.0.0' : undefined;
  const ports = isRails ? [3000] : [4567]; // Sinatra default

  return {
    runtime: 'ruby',
    appType,
    frameworks,
    databases,
    services,
    startCommand,
    ports,
  };
}
