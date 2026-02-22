import { describe, it, expect } from 'vitest';
import { validateRepoUrl, extractRepoName, isLocalPath, getLocalPath } from '../../../src/utils/validator.js';

describe('validateRepoUrl', () => {
  it('should accept valid GitHub HTTPS URLs', () => {
    expect(validateRepoUrl('https://github.com/vercel/next.js').valid).toBe(true);
    expect(validateRepoUrl('https://github.com/facebook/react').valid).toBe(true);
    expect(validateRepoUrl('https://github.com/owner/repo').valid).toBe(true);
  });

  it('should accept GitHub SSH URLs', () => {
    expect(validateRepoUrl('git@github.com:owner/repo.git').valid).toBe(true);
  });

  it('should accept local:// paths', () => {
    expect(validateRepoUrl('local://tests/fixtures/sample-nextjs-app').valid).toBe(true);
  });

  it('should reject invalid URLs', () => {
    expect(validateRepoUrl('not-a-url').valid).toBe(false);
    expect(validateRepoUrl('https://gitlab.com/owner/repo').valid).toBe(false);
    expect(validateRepoUrl('').valid).toBe(false);
  });
});

describe('extractRepoName', () => {
  it('should extract repo name from HTTPS URL', () => {
    expect(extractRepoName('https://github.com/vercel/next.js')).toBe('next.js');
  });

  it('should extract repo name from local path', () => {
    expect(extractRepoName('local://tests/fixtures/sample-nextjs-app')).toBe('sample-nextjs-app');
  });
});

describe('isLocalPath', () => {
  it('should detect local paths', () => {
    expect(isLocalPath('local://path')).toBe(true);
    expect(isLocalPath('https://github.com/owner/repo')).toBe(false);
  });
});

describe('getLocalPath', () => {
  it('should strip the local:// prefix', () => {
    expect(getLocalPath('local://tests/fixtures/sample')).toBe('tests/fixtures/sample');
  });
});
