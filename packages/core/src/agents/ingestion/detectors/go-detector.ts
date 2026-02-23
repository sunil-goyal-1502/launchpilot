import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { DetectedFramework, DetectedDatabase, DetectedService, AppType } from '../../../types/index';

interface GoDetection {
  runtime: 'go';
  appType: AppType;
  frameworks: DetectedFramework[];
  databases: DetectedDatabase[];
  services: DetectedService[];
  buildCommand: string;
  ports: number[];
}

const FRAMEWORK_PATTERNS: Array<{
  pattern: RegExp;
  name: string;
  confidence: number;
}> = [
  { pattern: /github\.com\/gin-gonic\/gin/, name: 'Gin', confidence: 0.95 },
  { pattern: /github\.com\/gofiber\/fiber/, name: 'Fiber', confidence: 0.95 },
  { pattern: /github\.com\/labstack\/echo/, name: 'Echo', confidence: 0.95 },
  { pattern: /github\.com\/gorilla\/mux/, name: 'Gorilla Mux', confidence: 0.85 },
  { pattern: /github\.com\/go-chi\/chi/, name: 'Chi', confidence: 0.85 },
];

const DB_PATTERNS: Array<{
  pattern: RegExp;
  type: DetectedDatabase['type'];
  name: string;
  confidence: number;
}> = [
  { pattern: /github\.com\/lib\/pq|github\.com\/jackc\/pgx/, name: 'PostgreSQL', type: 'postgresql', confidence: 0.9 },
  { pattern: /github\.com\/go-sql-driver\/mysql/, name: 'MySQL', type: 'mysql', confidence: 0.9 },
  { pattern: /go\.mongodb\.org\/mongo-driver/, name: 'MongoDB', type: 'mongodb', confidence: 0.9 },
];

const SERVICE_PATTERNS: Array<{
  pattern: RegExp;
  serviceType: DetectedService['serviceType'];
  provider: string;
  name: string;
  confidence: number;
}> = [
  { pattern: /github\.com\/go-redis\/redis|github\.com\/redis\/go-redis/, serviceType: 'cache', provider: 'redis', name: 'Redis (go-redis)', confidence: 0.85 },
  { pattern: /github\.com\/rabbitmq\/amqp091-go/, serviceType: 'queue', provider: 'rabbitmq', name: 'RabbitMQ (amqp091-go)', confidence: 0.9 },
  { pattern: /github\.com\/segmentio\/kafka-go/, serviceType: 'streaming', provider: 'kafka', name: 'Kafka (kafka-go)', confidence: 0.9 },
];

export async function detectGo(repoPath: string, subDir?: string): Promise<GoDetection | null> {
  const basePath = subDir ? join(repoPath, subDir) : repoPath;
  const goModPath = join(basePath, 'go.mod');
  if (!existsSync(goModPath)) return null;

  const content = await readFile(goModPath, 'utf-8');

  const frameworks: DetectedFramework[] = [];
  const databases: DetectedDatabase[] = [];
  const services: DetectedService[] = [];

  for (const pattern of FRAMEWORK_PATTERNS) {
    if (pattern.pattern.test(content)) {
      frameworks.push({ name: pattern.name, confidence: pattern.confidence });
    }
  }

  for (const pattern of DB_PATTERNS) {
    if (pattern.pattern.test(content)) {
      databases.push({ type: pattern.type, name: pattern.name, confidence: pattern.confidence });
    }
  }

  for (const pattern of SERVICE_PATTERNS) {
    if (pattern.pattern.test(content)) {
      services.push({ serviceType: pattern.serviceType, provider: pattern.provider, name: pattern.name, confidence: pattern.confidence });
    }
  }

  // Go always has at least net/http, but we need a framework for better detection
  if (frameworks.length === 0) {
    frameworks.push({ name: 'net/http (stdlib)', confidence: 0.5 });
  }

  return {
    runtime: 'go',
    appType: 'api',
    frameworks,
    databases,
    services,
    buildCommand: 'go build -o app .',
    ports: [8080],
  };
}
