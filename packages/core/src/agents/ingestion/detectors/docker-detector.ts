import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { Runtime } from '../../../types/index';

// Known database/cache/queue service patterns from docker-compose service names
const KNOWN_SERVICE_TYPES: Record<string, { type: 'database' | 'cache' | 'queue' | 'worker' | 'app'; inferred: string }> = {
  'postgres': { type: 'database', inferred: 'postgresql' },
  'postgresql': { type: 'database', inferred: 'postgresql' },
  'pg': { type: 'database', inferred: 'postgresql' },
  'mysql': { type: 'database', inferred: 'mysql' },
  'mariadb': { type: 'database', inferred: 'mysql' },
  'mongo': { type: 'database', inferred: 'mongodb' },
  'mongodb': { type: 'database', inferred: 'mongodb' },
  'redis': { type: 'cache', inferred: 'redis' },
  'valkey': { type: 'cache', inferred: 'redis' },
  'memcached': { type: 'cache', inferred: 'memcached' },
  'elasticsearch': { type: 'queue', inferred: 'elasticsearch' },
  'opensearch': { type: 'queue', inferred: 'elasticsearch' },
  'rabbitmq': { type: 'queue', inferred: 'rabbitmq' },
  'nats': { type: 'queue', inferred: 'nats' },
  'kafka': { type: 'queue', inferred: 'kafka' },
  'zookeeper': { type: 'queue', inferred: 'zookeeper' },
};

// Map docker image prefixes to runtimes
const IMAGE_RUNTIME_MAP: Record<string, Runtime> = {
  'python': 'python',
  'node': 'node',
  'golang': 'go',
  'go': 'go',
  'ruby': 'ruby',
  'openjdk': 'java',
  'eclipse-temurin': 'java',
  'amazoncorretto': 'java',
  'maven': 'java',
  'gradle': 'java',
};

export interface ServiceComponent {
  name: string;
  type: 'app' | 'database' | 'cache' | 'queue' | 'worker';
}

export interface DockerDetection {
  hasDockerfile: boolean;
  hasDockerCompose: boolean;
  baseImage?: string;
  exposedPorts: number[];
  services: string[];
  inferredDatabases: string[];
  inferredServices: string[];
  inferredRuntimes: Runtime[];
  serviceComponents: ServiceComponent[];
}

function classifyServiceName(name: string): ServiceComponent {
  const lower = name.toLowerCase();

  // Check exact match first
  if (KNOWN_SERVICE_TYPES[lower]) {
    return { name, type: KNOWN_SERVICE_TYPES[lower]!.type };
  }

  // Check if service name contains a known pattern
  for (const [pattern, info] of Object.entries(KNOWN_SERVICE_TYPES)) {
    if (lower.includes(pattern)) {
      return { name, type: info.type };
    }
  }

  // Worker patterns
  if (/worker|celery|sidekiq|beat|scheduler|cron/.test(lower)) {
    return { name, type: 'worker' };
  }

  return { name, type: 'app' };
}

function inferFromServiceName(name: string): { databases: string[]; services: string[] } {
  const lower = name.toLowerCase();
  const databases: string[] = [];
  const services: string[] = [];

  for (const [pattern, info] of Object.entries(KNOWN_SERVICE_TYPES)) {
    if (lower === pattern || lower.includes(pattern)) {
      if (info.type === 'database') {
        databases.push(info.inferred);
      } else if (info.type === 'cache' || info.type === 'queue') {
        services.push(info.inferred);
      }
      break;
    }
  }

  return { databases, services };
}

function runtimeFromImage(image: string): Runtime | null {
  // image format: "python:3.11", "node:20-alpine", "golang:1.21", etc.
  const imageName = image.split(':')[0]!.split('/').pop()!.toLowerCase();

  if (IMAGE_RUNTIME_MAP[imageName]) {
    return IMAGE_RUNTIME_MAP[imageName]!;
  }

  // Check partial matches (e.g., "python3.11" base images)
  for (const [prefix, runtime] of Object.entries(IMAGE_RUNTIME_MAP)) {
    if (imageName.startsWith(prefix)) {
      return runtime;
    }
  }

  return null;
}

export async function detectDocker(repoPath: string): Promise<DockerDetection> {
  const result: DockerDetection = {
    hasDockerfile: false,
    hasDockerCompose: false,
    exposedPorts: [],
    services: [],
    inferredDatabases: [],
    inferredServices: [],
    inferredRuntimes: [],
    serviceComponents: [],
  };

  // Check Dockerfile at root
  const dockerfilePath = join(repoPath, 'Dockerfile');
  if (existsSync(dockerfilePath)) {
    result.hasDockerfile = true;
    try {
      const content = await readFile(dockerfilePath, 'utf-8');

      // Extract base image (first FROM, ignoring build stages)
      const fromMatch = content.match(/^FROM\s+(\S+)/m);
      if (fromMatch) {
        result.baseImage = fromMatch[1];
        const runtime = runtimeFromImage(fromMatch[1]!);
        if (runtime) {
          result.inferredRuntimes.push(runtime);
        }
      }

      // Extract EXPOSE ports
      const exposeMatches = content.matchAll(/^EXPOSE\s+(\d+)/gm);
      for (const match of exposeMatches) {
        result.exposedPorts.push(parseInt(match[1]!, 10));
      }
    } catch {
      // Ignore parse errors
    }
  }

  // Also check Dockerfiles in immediate subdirectories
  try {
    const { readdirSync } = await import('node:fs');
    const entries = readdirSync(repoPath, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (['node_modules', '.git', 'dist', 'build', '__pycache__', '.venv', 'vendor'].includes(entry.name)) continue;
      const subDockerfile = join(repoPath, entry.name, 'Dockerfile');
      if (existsSync(subDockerfile)) {
        result.hasDockerfile = true;
        try {
          const content = await readFile(subDockerfile, 'utf-8');
          const fromMatch = content.match(/^FROM\s+(\S+)/m);
          if (fromMatch) {
            const runtime = runtimeFromImage(fromMatch[1]!);
            if (runtime && !result.inferredRuntimes.includes(runtime)) {
              result.inferredRuntimes.push(runtime);
            }
          }
        } catch {
          // Ignore parse errors
        }
      }
    }
  } catch {
    // Ignore directory read errors
  }

  // Check docker-compose.yml
  for (const name of ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml']) {
    const composePath = join(repoPath, name);
    if (existsSync(composePath)) {
      result.hasDockerCompose = true;
      try {
        const content = await readFile(composePath, 'utf-8');

        // Simple service extraction (line starting with 2 spaces + name + colon)
        const serviceMatches = content.matchAll(/^  (\w[\w-]*):/gm);
        for (const match of serviceMatches) {
          const svcName = match[1]!;
          result.services.push(svcName);

          // Classify the service
          const component = classifyServiceName(svcName);
          result.serviceComponents.push(component);

          // Infer databases and services from names
          const inferred = inferFromServiceName(svcName);
          for (const db of inferred.databases) {
            if (!result.inferredDatabases.includes(db)) {
              result.inferredDatabases.push(db);
            }
          }
          for (const svc of inferred.services) {
            if (!result.inferredServices.includes(svc)) {
              result.inferredServices.push(svc);
            }
          }
        }

        // Also check image: lines for known images
        const imageMatches = content.matchAll(/image:\s*["']?(\S+?)["']?\s*$/gm);
        for (const match of imageMatches) {
          const image = match[1]!;
          // Check for database/service images
          const imageName = image.split(':')[0]!.split('/').pop()!.toLowerCase();
          if (KNOWN_SERVICE_TYPES[imageName]) {
            const info = KNOWN_SERVICE_TYPES[imageName]!;
            if (info.type === 'database' && !result.inferredDatabases.includes(info.inferred)) {
              result.inferredDatabases.push(info.inferred);
            } else if ((info.type === 'cache' || info.type === 'queue') && !result.inferredServices.includes(info.inferred)) {
              result.inferredServices.push(info.inferred);
            }
          }
        }

        // Extract ports
        const portMatches = content.matchAll(/["']?(\d+):(\d+)["']?/g);
        for (const match of portMatches) {
          result.exposedPorts.push(parseInt(match[2]!, 10));
        }
      } catch {
        // Ignore parse errors
      }
      break;
    }
  }

  // Deduplicate ports
  result.exposedPorts = [...new Set(result.exposedPorts)];

  return result;
}
