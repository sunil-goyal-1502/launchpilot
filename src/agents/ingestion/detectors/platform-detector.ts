import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { DetectedPlatformConfig, DeployTarget } from '../../../types/index.js';

interface PlatformPattern {
  target: DeployTarget;
  configFiles: string[];
}

const PLATFORM_PATTERNS: PlatformPattern[] = [
  { target: 'vercel', configFiles: ['vercel.json'] },
  { target: 'netlify', configFiles: ['netlify.toml', 'netlify.yaml'] },
  { target: 'replit', configFiles: ['.replit', 'replit.nix'] },
  { target: 'railway', configFiles: ['railway.toml', 'railway.json'] },
  { target: 'render', configFiles: ['render.yaml'] },
  { target: 'fly', configFiles: ['fly.toml'] },
];

export function detectPlatformConfigs(
  repoPath: string,
  subDir?: string,
): DetectedPlatformConfig[] {
  const basePath = subDir ? join(repoPath, subDir) : repoPath;
  const results: DetectedPlatformConfig[] = [];
  const seenTargets = new Set<DeployTarget>();

  for (const pattern of PLATFORM_PATTERNS) {
    if (seenTargets.has(pattern.target)) continue;

    for (const cf of pattern.configFiles) {
      if (existsSync(join(basePath, cf))) {
        seenTargets.add(pattern.target);
        results.push({
          target: pattern.target,
          configFile: cf,
          confidence: 0.9,
        });
        break;
      }
    }
  }

  return results;
}
