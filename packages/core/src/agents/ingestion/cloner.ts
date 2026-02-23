import { simpleGit } from 'simple-git';
import { createTempDir } from '../../utils/fs-helpers';
import { isLocalPath, getLocalPath } from '../../utils/validator';
import { existsSync } from 'node:fs';
import { cp } from 'node:fs/promises';

export interface CloneResult {
  localPath: string;
  isTemp: boolean;
}

export async function cloneRepo(repoUrl: string): Promise<CloneResult> {
  if (isLocalPath(repoUrl)) {
    const localPath = getLocalPath(repoUrl);
    if (!existsSync(localPath)) {
      throw new Error(`Local path does not exist: ${localPath}`);
    }
    // Copy to temp dir so we don't modify the original
    const tempDir = await createTempDir();
    await cp(localPath, tempDir, { recursive: true });
    return { localPath: tempDir, isTemp: true };
  }

  const tempDir = await createTempDir();
  const git = simpleGit();

  await git.clone(repoUrl, tempDir, ['--depth', '1', '--single-branch']);

  return { localPath: tempDir, isTemp: true };
}
