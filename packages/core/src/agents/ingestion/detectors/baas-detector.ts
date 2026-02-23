import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { DetectedBaaS, DetectedDatabase, DetectedService, BaaSProvider, BaaSFeature } from '../../../types/index';

export interface BaaSDetectionResult {
  providers: DetectedBaaS[];
  databases: DetectedDatabase[];
  services: DetectedService[];
}

interface BaaSPattern {
  provider: BaaSProvider;
  name: string;
  npmDeps: string[];
  pyDeps: string[];
  configFiles: string[];
  features: BaaSFeature[];
  impliedDb?: DetectedDatabase['type'];
}

const BAAS_PATTERNS: BaaSPattern[] = [
  {
    provider: 'supabase',
    name: 'Supabase',
    npmDeps: ['@supabase/supabase-js', '@supabase/ssr', '@supabase/auth-helpers-nextjs'],
    pyDeps: ['supabase'],
    configFiles: ['supabase/config.toml'],
    features: ['database', 'auth', 'storage', 'realtime', 'edge-functions'],
    impliedDb: 'postgresql',
  },
  {
    provider: 'firebase',
    name: 'Firebase',
    npmDeps: ['firebase', 'firebase-admin', '@firebase/app'],
    pyDeps: ['firebase-admin'],
    configFiles: ['firebase.json'],
    features: ['database', 'auth', 'storage'],
  },
  {
    provider: 'convex',
    name: 'Convex',
    npmDeps: ['convex'],
    pyDeps: [],
    configFiles: [],
    features: ['database', 'realtime', 'edge-functions'],
  },
  {
    provider: 'appwrite',
    name: 'Appwrite',
    npmDeps: ['appwrite'],
    pyDeps: [],
    configFiles: [],
    features: ['database', 'auth', 'storage'],
  },
  {
    provider: 'nhost',
    name: 'Nhost',
    npmDeps: ['@nhost/react', '@nhost/nextjs', '@nhost/nhost-js'],
    pyDeps: [],
    configFiles: [],
    features: ['database', 'auth', 'storage'],
    impliedDb: 'postgresql',
  },
];

export async function detectBaaS(
  repoPath: string,
  subDir?: string,
): Promise<BaaSDetectionResult | null> {
  const basePath = subDir ? join(repoPath, subDir) : repoPath;
  const providers: DetectedBaaS[] = [];
  const databases: DetectedDatabase[] = [];
  const services: DetectedService[] = [];

  // Try to read npm dependencies
  const npmDeps = await readNpmDeps(basePath);

  // Try to read Python dependencies if no npm deps found
  const pyDeps = npmDeps.size === 0 ? await readPyDeps(basePath) : new Set<string>();

  for (const pattern of BAAS_PATTERNS) {
    let matched = false;
    let confidence = 0;

    // Check npm deps
    const matchedNpmDeps = pattern.npmDeps.filter((d) => npmDeps.has(d));
    if (matchedNpmDeps.length > 0) {
      matched = true;
      confidence = Math.min(0.7 + matchedNpmDeps.length * 0.1, 0.95);
    }

    // Check Python deps
    if (!matched) {
      const matchedPyDeps = pattern.pyDeps.filter((d) => pyDeps.has(d));
      if (matchedPyDeps.length > 0) {
        matched = true;
        confidence = 0.8;
      }
    }

    // Check config files
    for (const cf of pattern.configFiles) {
      if (existsSync(join(basePath, cf))) {
        matched = true;
        confidence = Math.max(confidence, 0.85);
      }
    }

    if (matched) {
      providers.push({
        provider: pattern.provider,
        name: pattern.name,
        confidence,
        features: [...pattern.features],
      });

      if (pattern.impliedDb) {
        databases.push({
          type: pattern.impliedDb,
          name: `${pattern.name} DB`,
          confidence: confidence * 0.9,
        });
      }
    }
  }

  if (providers.length === 0) {
    return null;
  }

  return { providers, databases, services };
}

async function readNpmDeps(basePath: string): Promise<Set<string>> {
  const pkgPath = join(basePath, 'package.json');
  if (!existsSync(pkgPath)) return new Set();
  try {
    const content = await readFile(pkgPath, 'utf-8');
    const pkg = JSON.parse(content);
    const deps = new Set<string>();
    for (const key of Object.keys(pkg.dependencies ?? {})) deps.add(key);
    for (const key of Object.keys(pkg.devDependencies ?? {})) deps.add(key);
    return deps;
  } catch {
    return new Set();
  }
}

async function readPyDeps(basePath: string): Promise<Set<string>> {
  const deps = new Set<string>();

  // Try requirements.txt
  const reqPath = join(basePath, 'requirements.txt');
  if (existsSync(reqPath)) {
    try {
      const content = await readFile(reqPath, 'utf-8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
          const pkgName = trimmed.split(/[>=<!\[]/)[0]!.trim();
          if (pkgName) deps.add(pkgName);
        }
      }
    } catch { /* ignore */ }
  }

  // Try pyproject.toml (simple heuristic — look for dependency lines)
  const pyprojectPath = join(basePath, 'pyproject.toml');
  if (existsSync(pyprojectPath)) {
    try {
      const content = await readFile(pyprojectPath, 'utf-8');
      const depMatches = content.matchAll(/"([a-zA-Z0-9_-]+)(?:[>=<].*)?"/g);
      for (const match of depMatches) {
        if (match[1]) deps.add(match[1]);
      }
    } catch { /* ignore */ }
  }

  return deps;
}
