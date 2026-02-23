import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { DetectedFramework, DetectedDatabase, DetectedService, AppType } from '../../../types/index';

interface JavaDetection {
  runtime: 'java';
  appType: AppType;
  frameworks: DetectedFramework[];
  databases: DetectedDatabase[];
  services: DetectedService[];
  buildCommand?: string;
  ports: number[];
}

export async function detectJava(repoPath: string, subDir?: string): Promise<JavaDetection | null> {
  const basePath = subDir ? join(repoPath, subDir) : repoPath;
  let buildFileContent: string | null = null;
  let buildCommand: string | undefined;

  const pomPath = join(basePath, 'pom.xml');
  const gradlePath = join(basePath, 'build.gradle');
  const gradleKtsPath = join(basePath, 'build.gradle.kts');

  if (existsSync(pomPath)) {
    buildFileContent = await readFile(pomPath, 'utf-8');
    buildCommand = 'mvn clean package';
  } else if (existsSync(gradlePath)) {
    buildFileContent = await readFile(gradlePath, 'utf-8');
    buildCommand = './gradlew build';
  } else if (existsSync(gradleKtsPath)) {
    buildFileContent = await readFile(gradleKtsPath, 'utf-8');
    buildCommand = './gradlew build';
  }

  if (!buildFileContent) return null;

  const frameworks: DetectedFramework[] = [];
  const databases: DetectedDatabase[] = [];
  const services: DetectedService[] = [];

  // Detect Spring Boot
  if (/spring-boot/.test(buildFileContent)) {
    frameworks.push({ name: 'Spring Boot', confidence: 0.95 });

    if (/spring-boot-starter-web/.test(buildFileContent)) {
      frameworks.push({ name: 'Spring Web', confidence: 0.9 });
    }
    if (/spring-boot-starter-data-jpa/.test(buildFileContent)) {
      frameworks.push({ name: 'Spring Data JPA', confidence: 0.9 });
    }
    if (/spring-boot-starter-security/.test(buildFileContent)) {
      frameworks.push({ name: 'Spring Security', confidence: 0.9 });
    }
  }

  // Detect databases
  if (/postgresql|postgres/.test(buildFileContent)) {
    databases.push({ type: 'postgresql', name: 'PostgreSQL', confidence: 0.9 });
  }
  if (/mysql/.test(buildFileContent)) {
    databases.push({ type: 'mysql', name: 'MySQL', confidence: 0.9 });
  }
  if (/mongodb/.test(buildFileContent)) {
    databases.push({ type: 'mongodb', name: 'MongoDB', confidence: 0.9 });
  }
  if (/h2/.test(buildFileContent) || /hsqldb/.test(buildFileContent)) {
    databases.push({ type: 'sqlite', name: 'H2/Embedded DB', confidence: 0.7 });
  }

  // Detect services
  if (/spring-data-redis|jedis/.test(buildFileContent)) {
    services.push({ serviceType: 'cache', provider: 'redis', name: 'Spring Data Redis', confidence: 0.9 });
  }
  if (/spring-kafka/.test(buildFileContent)) {
    services.push({ serviceType: 'streaming', provider: 'kafka', name: 'Spring Kafka', confidence: 0.9 });
  }
  if (/spring-amqp|spring-rabbit/.test(buildFileContent)) {
    services.push({ serviceType: 'queue', provider: 'rabbitmq', name: 'Spring AMQP', confidence: 0.9 });
  }

  if (frameworks.length === 0) return null;

  return {
    runtime: 'java',
    appType: 'api',
    frameworks,
    databases,
    services,
    buildCommand,
    ports: [8080],
  };
}
