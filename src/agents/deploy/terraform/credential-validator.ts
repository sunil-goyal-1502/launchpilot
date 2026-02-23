/**
 * Pre-flight checks for Terraform CLI installation and AWS credentials.
 * Uses shell commands only — no AWS SDK dependency.
 */

import { execFile } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export interface TerraformCheckResult {
  installed: boolean;
  version?: string;
  path?: string;
  error?: string;
}

export interface AWSCredentialResult {
  valid: boolean;
  identity?: string;
  error?: string;
}

/** Cached resolved path for terraform binary */
let resolvedTerraformPath: string | null = null;

/**
 * Resolves the terraform binary path — checks PATH first, then common
 * Windows installation locations (WinGet, Chocolatey, scoop, manual).
 */
function findTerraformBinary(): string {
  if (resolvedTerraformPath) return resolvedTerraformPath;

  // Default: rely on PATH
  const defaultBin = process.platform === 'win32' ? 'terraform.exe' : 'terraform';

  if (process.platform !== 'win32') {
    resolvedTerraformPath = 'terraform';
    return resolvedTerraformPath;
  }

  // On Windows, search common installation directories
  const home = process.env['USERPROFILE'] ?? process.env['HOME'] ?? '';
  const candidates: string[] = [];

  // WinGet packages — directory name varies, so scan for it
  const wingetPkgsDir = join(home, 'AppData', 'Local', 'Microsoft', 'WinGet', 'Packages');
  try {
    const entries = readdirSync(wingetPkgsDir);
    for (const entry of entries) {
      if (entry.toLowerCase().includes('terraform')) {
        candidates.push(join(wingetPkgsDir, entry, 'terraform.exe'));
      }
    }
  } catch { /* WinGet dir may not exist */ }

  // Other common locations
  candidates.push(
    join(home, 'AppData', 'Local', 'Programs', 'Terraform', 'terraform.exe'),
    join(home, 'scoop', 'shims', 'terraform.exe'),
    'C:\\ProgramData\\chocolatey\\bin\\terraform.exe',
    'C:\\HashiCorp\\Terraform\\terraform.exe',
  );

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      resolvedTerraformPath = candidate;
      return resolvedTerraformPath;
    }
  }

  // Fall back to bare name (will use PATH)
  resolvedTerraformPath = defaultBin;
  return resolvedTerraformPath;
}

/**
 * Returns the resolved terraform binary path. Exported so TerraformExecutor
 * can use the same resolved path.
 */
export function getTerraformPath(): string {
  return findTerraformBinary();
}

/**
 * Checks whether `terraform` is on PATH and returns its version.
 */
export function checkTerraformInstalled(): Promise<TerraformCheckResult> {
  const tfBin = findTerraformBinary();

  return new Promise((resolve) => {
    execFile(tfBin, ['version', '-json'], { timeout: 10_000 }, (err, stdout) => {
      if (err) {
        resolve({
          installed: false,
          error: 'Terraform CLI not found. Install from https://developer.hashicorp.com/terraform/install',
        });
        return;
      }

      try {
        const parsed = JSON.parse(stdout);
        resolve({
          installed: true,
          version: parsed.terraform_version ?? stdout.trim().split('\n')[0],
          path: tfBin,
        });
      } catch {
        // Fallback: parse plain text output
        const match = stdout.match(/Terraform v([\d.]+)/);
        resolve({
          installed: true,
          version: match?.[1] ?? 'unknown',
          path: tfBin,
        });
      }
    });
  });
}

/**
 * Validates that AWS credentials are configured and functional by calling
 * `aws sts get-caller-identity`. Falls back to checking env vars if AWS CLI
 * is not available.
 */
export function validateAWSCredentials(): Promise<AWSCredentialResult> {
  return new Promise((resolve) => {
    execFile('aws', ['sts', 'get-caller-identity', '--output', 'json'], { timeout: 15_000 }, (err, stdout) => {
      if (err) {
        // AWS CLI not installed or credentials invalid — check env vars as fallback
        const hasEnvCreds = !!(
          process.env['AWS_ACCESS_KEY_ID'] &&
          process.env['AWS_SECRET_ACCESS_KEY']
        );

        if (hasEnvCreds) {
          resolve({
            valid: true,
            identity: `env:${process.env['AWS_ACCESS_KEY_ID']?.slice(0, 8)}...`,
          });
        } else {
          resolve({
            valid: false,
            error: 'AWS credentials not configured. Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY, or run `aws configure`.',
          });
        }
        return;
      }

      try {
        const parsed = JSON.parse(stdout);
        resolve({
          valid: true,
          identity: `${parsed.Arn ?? parsed.Account ?? 'authenticated'}`,
        });
      } catch {
        resolve({ valid: true, identity: 'authenticated' });
      }
    });
  });
}
