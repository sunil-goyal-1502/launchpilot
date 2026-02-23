import { z } from 'zod';

const githubUrlSchema = z
  .string()
  .trim()
  .refine(
    (url) =>
      /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/?$/.test(url) ||
      /^git@github\.com:[\w.-]+\/[\w.-]+\.git$/.test(url) ||
      /^local:\/\//.test(url),
    {
      message:
        'Must be a valid GitHub URL (https://github.com/owner/repo), SSH URL (git@github.com:owner/repo.git), or local path (local://path)',
    },
  );

export function validateRepoUrl(url: string): { valid: boolean; error?: string } {
  const result = githubUrlSchema.safeParse(url);
  if (result.success) {
    return { valid: true };
  }
  return { valid: false, error: result.error.issues[0]?.message };
}

export function extractRepoName(url: string): string {
  if (url.startsWith('local://')) {
    const parts = url.replace('local://', '').split('/');
    return parts[parts.length - 1] || 'local-repo';
  }
  const match = url.match(/\/([^/]+?)(\.git)?$/);
  return match?.[1] || 'unknown-repo';
}

export function isLocalPath(url: string): boolean {
  return url.startsWith('local://');
}

export function getLocalPath(url: string): string {
  return url.replace('local://', '');
}
