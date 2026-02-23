/**
 * Pre-flight checks for Terraform CLI installation and AWS credentials.
 * Uses shell commands only — no AWS SDK dependency.
 */

import { execFile } from 'node:child_process';

export interface TerraformCheckResult {
  installed: boolean;
  version?: string;
  error?: string;
}

export interface AWSCredentialResult {
  valid: boolean;
  identity?: string;
  error?: string;
}

/**
 * Checks whether `terraform` is on PATH and returns its version.
 */
export function checkTerraformInstalled(): Promise<TerraformCheckResult> {
  return new Promise((resolve) => {
    execFile('terraform', ['version', '-json'], { timeout: 10_000 }, (err, stdout) => {
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
        });
      } catch {
        // Fallback: parse plain text output
        const match = stdout.match(/Terraform v([\d.]+)/);
        resolve({
          installed: true,
          version: match?.[1] ?? 'unknown',
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
