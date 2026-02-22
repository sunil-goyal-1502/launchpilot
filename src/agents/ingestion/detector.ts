import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ApplicationBlueprint, Runtime, AppType, DetectedFramework, DetectedDatabase, DetectedService, BaaSMetadata, DetectedPlatformConfig, ParsedMigration } from '../../types/index.js';
import { detectNode } from './detectors/node-detector.js';
import { detectPython } from './detectors/python-detector.js';
import { detectDocker, DockerDetection } from './detectors/docker-detector.js';
import { detectJava } from './detectors/java-detector.js';
import { detectGo } from './detectors/go-detector.js';
import { detectRuby } from './detectors/ruby-detector.js';
import { detectBaaS, BaaSDetectionResult } from './detectors/baas-detector.js';
import { detectPlatformConfigs } from './detectors/platform-detector.js';
import { analyzeEnvVars, EnvAnalysisResult } from './detectors/env-analyzer.js';
import { parseMigrations } from './detectors/migration-parser.js';

interface DetectionResult {
  runtime: Runtime;
  appType: AppType;
  frameworks: DetectedFramework[];
  databases: DetectedDatabase[];
  services: DetectedService[];
  buildCommand?: string;
  startCommand?: string;
  ports: number[];
  envVars?: string[];
}

interface ManifestDir {
  dir: string; // '' for root, 'backend', 'frontend', etc.
  type: 'node' | 'python' | 'java' | 'go' | 'ruby';
}

const MANIFEST_FILES: Array<{ file: string; type: ManifestDir['type'] }> = [
  { file: 'package.json', type: 'node' },
  { file: 'requirements.txt', type: 'python' },
  { file: 'pyproject.toml', type: 'python' },
  { file: 'Pipfile', type: 'python' },
  { file: 'go.mod', type: 'go' },
  { file: 'pom.xml', type: 'java' },
  { file: 'build.gradle', type: 'java' },
  { file: 'build.gradle.kts', type: 'java' },
  { file: 'Gemfile', type: 'ruby' },
];

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '__pycache__',
  '.venv', 'venv', 'vendor', '.next', '.nuxt', 'target',
  'coverage', '.cache', '.output',
]);

interface AuxDetection {
  baas: BaaSDetectionResult | null;
  platformConfigs: DetectedPlatformConfig[];
  envAnalysis: EnvAnalysisResult;
  migrations: ParsedMigration[];
}

function buildBaaSMetadata(aux: AuxDetection): BaaSMetadata | undefined {
  const providers = aux.baas?.providers ?? [];
  const { platformConfigs, envAnalysis, migrations } = aux;
  if (providers.length === 0 && platformConfigs.length === 0 && envAnalysis.externalServices.length === 0) {
    return undefined;
  }
  return {
    providers,
    platformConfigs,
    externalServices: envAnalysis.externalServices,
    migrations: migrations.length > 0 ? migrations : undefined,
    isBaaSApp: providers.length > 0,
  };
}

/**
 * Scan for directories containing manifest files (root + depth-1 subdirs).
 * Returns deduplicated list — if the same subdir has both requirements.txt
 * and pyproject.toml, only one entry for that dir+type is returned.
 */
function findManifestDirs(repoPath: string): ManifestDir[] {
  const results: ManifestDir[] = [];
  const seen = new Set<string>(); // "dir:type" dedup key

  // Check root
  for (const m of MANIFEST_FILES) {
    const key = `:${m.type}`;
    if (!seen.has(key) && existsSync(join(repoPath, m.file))) {
      seen.add(key);
      results.push({ dir: '', type: m.type });
    }
  }

  // Check immediate subdirectories (depth 1 only for performance)
  try {
    const entries = readdirSync(repoPath, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (SKIP_DIRS.has(entry.name)) continue;
      if (entry.name.startsWith('.')) continue;

      for (const m of MANIFEST_FILES) {
        const key = `${entry.name}:${m.type}`;
        if (!seen.has(key) && existsSync(join(repoPath, entry.name, m.file))) {
          seen.add(key);
          results.push({ dir: entry.name, type: m.type });
        }
      }
    }
  } catch {
    // Ignore directory read errors
  }

  return results;
}

/**
 * Run the appropriate language detector for a manifest dir.
 */
async function runDetectorForType(
  repoPath: string,
  manifest: ManifestDir,
): Promise<DetectionResult | null> {
  const subDir = manifest.dir || undefined;
  let result: DetectionResult | null = null;

  switch (manifest.type) {
    case 'node': {
      const r = await detectNode(repoPath, subDir);
      if (r) result = r;
      break;
    }
    case 'python': {
      const r = await detectPython(repoPath, subDir);
      if (r) result = r;
      break;
    }
    case 'java': {
      const r = await detectJava(repoPath, subDir);
      if (r) result = { ...r, envVars: [] };
      break;
    }
    case 'go': {
      const r = await detectGo(repoPath, subDir);
      if (r) result = { ...r, envVars: [] };
      break;
    }
    case 'ruby': {
      const r = await detectRuby(repoPath, subDir);
      if (r) result = { ...r, envVars: [] };
      break;
    }
  }

  return result;
}

/**
 * Pick the most "application-like" runtime as the primary.
 * Prefers backend runtimes (python, java, go, ruby) over frontend (node)
 * when there are multiple components, since the backend is typically the
 * core service.
 */
function pickPrimaryRuntime(
  components: Array<{ dir: string; detection: DetectionResult }>,
): Runtime {
  // If only one, return it
  if (components.length === 1) return components[0]!.detection.runtime;

  // Prefer backend-like runtimes
  const backendRuntimes: Runtime[] = ['python', 'java', 'go', 'ruby'];
  for (const comp of components) {
    if (backendRuntimes.includes(comp.detection.runtime)) {
      return comp.detection.runtime;
    }
  }

  // Fallback to first
  return components[0]!.detection.runtime;
}

export async function detectStack(
  repoPath: string,
  repoUrl: string,
  repoName: string,
): Promise<ApplicationBlueprint> {
  // 1. Run docker detector first (fast, gives structural hints)
  const dockerResult = await detectDocker(repoPath);

  // 2. Find all manifest directories (root + subdirs)
  const manifestDirs = findManifestDirs(repoPath);

  // 3. Run language detectors + BaaS/platform/env/migration detectors in parallel
  const [componentResultsRaw, baasResult, platformConfigs, envAnalysis, migrations] = await Promise.all([
    Promise.all(
      manifestDirs.map(async (manifest) => {
        const detection = await runDetectorForType(repoPath, manifest);
        return detection ? { dir: manifest.dir, detection } : null;
      }),
    ),
    detectBaaS(repoPath),
    detectPlatformConfigs(repoPath),
    analyzeEnvVars(repoPath),
    parseMigrations(repoPath),
  ]);

  const componentResults = componentResultsRaw.filter(
    (r): r is { dir: string; detection: DetectionResult } => r !== null,
  );
  const aux: AuxDetection = { baas: baasResult, platformConfigs, envAnalysis, migrations };

  // 4. Build the blueprint based on number of components
  if (componentResults.length === 0) {
    // No language detected — fall back to docker-only info
    return buildFallbackBlueprint(repoUrl, repoName, dockerResult, aux);
  }

  if (componentResults.length === 1) {
    // Single component — behave exactly as before (backward compatible)
    return buildSingleBlueprint(repoUrl, repoName, componentResults[0]!, dockerResult, aux);
  }

  // Multi-component — monorepo
  return buildMonorepoBlueprint(repoUrl, repoName, componentResults, dockerResult, aux);
}

function buildFallbackBlueprint(
  repoUrl: string,
  repoName: string,
  dockerResult: DockerDetection,
  aux: AuxDetection,
): ApplicationBlueprint {
  const runtime: Runtime = dockerResult.inferredRuntimes[0] ?? (dockerResult.hasDockerfile ? 'docker' : 'unknown');

  // Build databases and services from docker inference
  const databases: DetectedDatabase[] = dockerResult.inferredDatabases.map((db) => ({
    type: (db === 'postgresql' || db === 'mysql' || db === 'mongodb' ? db : 'unknown') as DetectedDatabase['type'],
    name: db,
    confidence: 0.7,
  }));

  // Merge BaaS-implied databases
  const seenDbTypes = new Set(databases.map((db) => db.type));
  if (aux.baas) {
    for (const db of aux.baas.databases) {
      if (!seenDbTypes.has(db.type)) {
        seenDbTypes.add(db.type);
        databases.push(db);
      }
    }
  }

  const services: DetectedService[] = dockerResult.inferredServices.map((svc) => ({
    serviceType: (svc === 'redis' || svc === 'memcached' ? 'cache' : 'queue') as DetectedService['serviceType'],
    provider: svc,
    name: svc,
    confidence: 0.7,
  }));

  // Merge env var names
  const envVars = [...aux.envAnalysis.allVarNames];

  return {
    repoUrl,
    repoName,
    runtime,
    appType: dockerResult.hasDockerCompose && dockerResult.services.length > 2 ? 'monorepo' : 'unknown',
    frameworks: [],
    databases,
    services,
    hasDockerfile: dockerResult.hasDockerfile,
    hasDockerCompose: dockerResult.hasDockerCompose,
    envVars,
    ports: dockerResult.exposedPorts,
    complexity: scoreComplexity([], databases, services, dockerResult.hasDockerCompose),
    detectedAt: new Date(),
    baas: buildBaaSMetadata(aux),
  };
}

function buildSingleBlueprint(
  repoUrl: string,
  repoName: string,
  component: { dir: string; detection: DetectionResult },
  dockerResult: DockerDetection,
  aux: AuxDetection,
): ApplicationBlueprint {
  const d = component.detection;

  // Merge docker-inferred databases that aren't already detected
  const allDatabases = [...d.databases];
  const seenDbTypes = new Set(d.databases.map((db) => db.type));
  for (const db of dockerResult.inferredDatabases) {
    const dbType = (db === 'postgresql' || db === 'mysql' || db === 'mongodb' ? db : 'unknown') as DetectedDatabase['type'];
    if (!seenDbTypes.has(dbType)) {
      seenDbTypes.add(dbType);
      allDatabases.push({ type: dbType, name: db, confidence: 0.7 });
    }
  }

  // Merge BaaS-implied databases
  if (aux.baas) {
    for (const db of aux.baas.databases) {
      if (!seenDbTypes.has(db.type)) {
        seenDbTypes.add(db.type);
        allDatabases.push(db);
      }
    }
  }

  // Merge docker-inferred services
  const allServices = [...d.services];
  const seenServiceKeys = new Set(d.services.map((s) => `${s.serviceType}:${s.provider}`));
  for (const svc of dockerResult.inferredServices) {
    const svcType = (svc === 'redis' || svc === 'memcached' ? 'cache' : 'queue') as DetectedService['serviceType'];
    const key = `${svcType}:${svc}`;
    if (!seenServiceKeys.has(key)) {
      seenServiceKeys.add(key);
      allServices.push({ serviceType: svcType, provider: svc, name: svc, confidence: 0.7 });
    }
  }

  // Merge ports
  const allPorts = [...new Set([...d.ports, ...dockerResult.exposedPorts])];

  // Merge env vars from detector + env analyzer
  const envVars = [...new Set([...(d.envVars ?? []), ...aux.envAnalysis.allVarNames])];

  return {
    repoUrl,
    repoName,
    runtime: d.runtime,
    appType: d.appType,
    frameworks: d.frameworks.sort((a, b) => b.confidence - a.confidence),
    databases: allDatabases.sort((a, b) => b.confidence - a.confidence),
    services: allServices.sort((a, b) => b.confidence - a.confidence),
    hasDockerfile: dockerResult.hasDockerfile,
    hasDockerCompose: dockerResult.hasDockerCompose,
    envVars,
    ports: allPorts,
    buildCommand: d.buildCommand,
    startCommand: d.startCommand,
    complexity: scoreComplexity(d.frameworks, allDatabases, allServices, dockerResult.hasDockerCompose),
    detectedAt: new Date(),
    baas: buildBaaSMetadata(aux),
  };
}

function buildMonorepoBlueprint(
  repoUrl: string,
  repoName: string,
  components: Array<{ dir: string; detection: DetectionResult }>,
  dockerResult: DockerDetection,
  aux: AuxDetection,
): ApplicationBlueprint {
  const allFrameworks: DetectedFramework[] = [];
  const allDatabases: DetectedDatabase[] = [];
  const allServices: DetectedService[] = [];
  const seenFrameworks = new Set<string>();
  const seenDbTypes = new Set<string>();
  const seenServiceKeys = new Set<string>();
  const allEnvVars: string[] = [];
  const allPorts: number[] = [];

  const blueprintComponents: Array<{ name: string; path: string; runtime: string; frameworks: string[] }> = [];

  for (const comp of components) {
    const d = comp.detection;

    // Build component entry
    blueprintComponents.push({
      name: comp.dir || 'root',
      path: comp.dir ? comp.dir + '/' : './',
      runtime: d.runtime,
      frameworks: d.frameworks.map((f) => f.name),
    });

    // Aggregate frameworks
    for (const f of d.frameworks) {
      if (!seenFrameworks.has(f.name)) {
        seenFrameworks.add(f.name);
        allFrameworks.push(f);
      }
    }

    // Aggregate databases
    for (const db of d.databases) {
      if (!seenDbTypes.has(db.type)) {
        seenDbTypes.add(db.type);
        allDatabases.push(db);
      }
    }

    // Aggregate services
    for (const svc of d.services) {
      const key = `${svc.serviceType}:${svc.provider}`;
      if (!seenServiceKeys.has(key)) {
        seenServiceKeys.add(key);
        allServices.push(svc);
      }
    }

    // Aggregate env vars and ports
    if (d.envVars) allEnvVars.push(...d.envVars);
    allPorts.push(...d.ports);
  }

  // Merge docker-inferred databases
  for (const db of dockerResult.inferredDatabases) {
    const dbType = (db === 'postgresql' || db === 'mysql' || db === 'mongodb' ? db : 'unknown') as DetectedDatabase['type'];
    if (!seenDbTypes.has(dbType)) {
      seenDbTypes.add(dbType);
      allDatabases.push({ type: dbType, name: db, confidence: 0.7 });
    }
  }

  // Merge docker-inferred services
  for (const svc of dockerResult.inferredServices) {
    const svcType = (svc === 'redis' || svc === 'memcached' ? 'cache' : 'queue') as DetectedService['serviceType'];
    const key = `${svcType}:${svc}`;
    if (!seenServiceKeys.has(key)) {
      seenServiceKeys.add(key);
      allServices.push({ serviceType: svcType, provider: svc, name: svc, confidence: 0.7 });
    }
  }

  // Merge BaaS-implied databases
  if (aux.baas) {
    for (const db of aux.baas.databases) {
      if (!seenDbTypes.has(db.type)) {
        seenDbTypes.add(db.type);
        allDatabases.push(db);
      }
    }
  }

  // Merge docker ports
  for (const port of dockerResult.exposedPorts) {
    if (!allPorts.includes(port)) allPorts.push(port);
  }

  // Merge env var names from env analyzer
  for (const v of aux.envAnalysis.allVarNames) {
    if (!allEnvVars.includes(v)) allEnvVars.push(v);
  }

  const primaryRuntime = pickPrimaryRuntime(components);

  return {
    repoUrl,
    repoName,
    runtime: primaryRuntime,
    appType: 'monorepo',
    frameworks: allFrameworks.sort((a, b) => b.confidence - a.confidence),
    databases: allDatabases.sort((a, b) => b.confidence - a.confidence),
    services: allServices.sort((a, b) => b.confidence - a.confidence),
    hasDockerfile: dockerResult.hasDockerfile,
    hasDockerCompose: dockerResult.hasDockerCompose,
    envVars: [...new Set(allEnvVars)],
    ports: [...new Set(allPorts)],
    buildCommand: components[0]?.detection.buildCommand,
    startCommand: components[0]?.detection.startCommand,
    complexity: scoreComplexity(allFrameworks, allDatabases, allServices, dockerResult.hasDockerCompose),
    detectedAt: new Date(),
    components: blueprintComponents,
    baas: buildBaaSMetadata(aux),
  };
}

function scoreComplexity(
  frameworks: DetectedFramework[],
  databases: DetectedDatabase[],
  services: DetectedService[],
  hasCompose: boolean,
): 'low' | 'medium' | 'high' {
  let score = 0;
  score += frameworks.length;
  score += databases.length * 2;
  score += services.length;
  if (hasCompose) score += 2;
  if (databases.length > 1) score += 2;

  if (score <= 2) return 'low';
  if (score <= 5) return 'medium';
  return 'high';
}
