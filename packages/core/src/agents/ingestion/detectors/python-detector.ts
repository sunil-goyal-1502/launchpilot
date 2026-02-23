import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { DetectedFramework, DetectedDatabase, DetectedService, AppType } from '../../../types/index';

interface PythonDetection {
  runtime: 'python';
  appType: AppType;
  frameworks: DetectedFramework[];
  databases: DetectedDatabase[];
  services: DetectedService[];
  startCommand?: string;
  ports: number[];
  envVars: string[];
}

const FRAMEWORK_PATTERNS: Array<{
  pattern: RegExp;
  name: string;
  appType: AppType;
  confidence: number;
}> = [
  { pattern: /django/i, name: 'Django', appType: 'fullstack', confidence: 0.95 },
  { pattern: /flask/i, name: 'Flask', appType: 'api', confidence: 0.9 },
  { pattern: /fastapi/i, name: 'FastAPI', appType: 'api', confidence: 0.95 },
  { pattern: /starlette/i, name: 'Starlette', appType: 'api', confidence: 0.85 },
  { pattern: /streamlit/i, name: 'Streamlit', appType: 'web-app', confidence: 0.9 },
  { pattern: /gradio/i, name: 'Gradio', appType: 'web-app', confidence: 0.9 },
];

const DB_PATTERNS: Array<{
  pattern: RegExp;
  type: DetectedDatabase['type'];
  name: string;
  confidence: number;
}> = [
  { pattern: /psycopg2|asyncpg/, name: 'PostgreSQL', type: 'postgresql', confidence: 0.9 },
  { pattern: /sqlalchemy/, name: 'SQLAlchemy', type: 'postgresql', confidence: 0.7 },
  { pattern: /pymongo/, name: 'MongoDB', type: 'mongodb', confidence: 0.9 },
  { pattern: /mysqlclient|pymysql/, name: 'MySQL', type: 'mysql', confidence: 0.9 },
];

const SERVICE_PATTERNS: Array<{
  pattern: RegExp;
  serviceType: DetectedService['serviceType'];
  provider: string;
  name: string;
  confidence: number;
}> = [
  // Cache
  { pattern: /^redis/m, serviceType: 'cache', provider: 'redis', name: 'Redis', confidence: 0.85 },
  { pattern: /pymemcache/, serviceType: 'cache', provider: 'memcached', name: 'Memcached', confidence: 0.85 },
  // Queue
  { pattern: /celery/i, serviceType: 'queue', provider: 'celery', name: 'Celery', confidence: 0.9 },
  { pattern: /pika/, serviceType: 'queue', provider: 'rabbitmq', name: 'RabbitMQ (pika)', confidence: 0.9 },
  { pattern: /^rq/m, serviceType: 'queue', provider: 'rq', name: 'RQ', confidence: 0.85 },
  // Streaming
  { pattern: /kafka-python/, serviceType: 'streaming', provider: 'kafka', name: 'Kafka (kafka-python)', confidence: 0.9 },
  { pattern: /confluent-kafka/, serviceType: 'streaming', provider: 'kafka', name: 'Kafka (confluent)', confidence: 0.9 },
];

async function readDepsFile(repoPath: string): Promise<string | null> {
  // Try requirements.txt first
  const reqPath = join(repoPath, 'requirements.txt');
  if (existsSync(reqPath)) {
    return readFile(reqPath, 'utf-8');
  }

  // Try pyproject.toml
  const pyprojectPath = join(repoPath, 'pyproject.toml');
  if (existsSync(pyprojectPath)) {
    return readFile(pyprojectPath, 'utf-8');
  }

  // Try Pipfile
  const pipfilePath = join(repoPath, 'Pipfile');
  if (existsSync(pipfilePath)) {
    return readFile(pipfilePath, 'utf-8');
  }

  return null;
}

export async function detectPython(repoPath: string, subDir?: string): Promise<PythonDetection | null> {
  const basePath = subDir ? join(repoPath, subDir) : repoPath;
  const depsContent = await readDepsFile(basePath);
  if (!depsContent) return null;

  const frameworks: DetectedFramework[] = [];
  const databases: DetectedDatabase[] = [];
  const services: DetectedService[] = [];
  const seenFrameworks = new Set<string>();
  const seenDbTypes = new Set<string>();
  const seenServiceKeys = new Set<string>();

  for (const pattern of FRAMEWORK_PATTERNS) {
    if (pattern.pattern.test(depsContent) && !seenFrameworks.has(pattern.name)) {
      seenFrameworks.add(pattern.name);
      frameworks.push({
        name: pattern.name,
        confidence: pattern.confidence,
      });
    }
  }

  for (const pattern of DB_PATTERNS) {
    if (pattern.pattern.test(depsContent) && !seenDbTypes.has(pattern.type)) {
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
    if (pattern.pattern.test(depsContent) && !seenServiceKeys.has(key)) {
      seenServiceKeys.add(key);
      services.push({
        serviceType: pattern.serviceType,
        provider: pattern.provider,
        name: pattern.name,
        confidence: pattern.confidence,
      });
    }
  }

  // Allow detection when services found even without frameworks
  if (frameworks.length === 0 && services.length === 0) return null;

  let appType: AppType = 'api';
  if (frameworks.length > 0) {
    const primaryFramework = frameworks.sort((a, b) => b.confidence - a.confidence)[0]!;
    const primaryPattern = FRAMEWORK_PATTERNS.find((p) => p.name === primaryFramework.name);
    appType = primaryPattern?.appType ?? 'api';
  }

  const ports: number[] = [];
  if (seenFrameworks.has('Django')) ports.push(8000);
  else if (seenFrameworks.has('FastAPI')) ports.push(8000);
  else if (seenFrameworks.has('Flask')) ports.push(5000);
  else if (seenFrameworks.has('Streamlit')) ports.push(8501);
  else ports.push(8000);

  let startCommand: string | undefined;
  if (seenFrameworks.has('FastAPI')) startCommand = 'uvicorn main:app --host 0.0.0.0 --port 8000';
  else if (seenFrameworks.has('Django')) startCommand = 'python manage.py runserver 0.0.0.0:8000';
  else if (seenFrameworks.has('Flask')) startCommand = 'flask run --host=0.0.0.0';

  return {
    runtime: 'python',
    appType,
    frameworks,
    databases,
    services,
    startCommand,
    ports,
    envVars: [],
  };
}
