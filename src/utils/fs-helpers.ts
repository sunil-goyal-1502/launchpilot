import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export async function createTempDir(prefix: string = 'launchpilot-'): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

export async function cleanupDir(dirPath: string): Promise<void> {
  try {
    await rm(dirPath, { recursive: true, force: true });
  } catch {
    // Ignore cleanup failures
  }
}
