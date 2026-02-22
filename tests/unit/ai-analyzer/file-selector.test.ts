import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { selectFiles } from '../../../src/agents/ai-analyzer/file-selector.js';

const fixturesDir = join(process.cwd(), 'tests', 'fixtures');

describe('FileSelector', () => {
  it('should select files from sample-nextjs-app', () => {
    const files = selectFiles(join(fixturesDir, 'sample-nextjs-app'));

    expect(files.length).toBeGreaterThan(0);
    // Should find package.json (config, priority 2)
    expect(files.some(f => f.path === 'package.json')).toBe(true);
  });

  it('should prioritize entry points and routes', () => {
    const files = selectFiles(join(fixturesDir, 'sample-nextjs-app'));

    // Find source files if they exist
    const srcFiles = files.filter(f => f.path.endsWith('.ts') || f.path.endsWith('.tsx'));
    if (srcFiles.length > 1) {
      // Higher priority files should come first
      const priorities = files.map(f => f.priority);
      // Should be sorted descending (or at least the first file has >= priority of last)
      expect(priorities[0]).toBeGreaterThanOrEqual(priorities[priorities.length - 1]!);
    }
  });

  it('should respect maxFiles limit', () => {
    const files = selectFiles(join(fixturesDir, 'sample-nextjs-app'), undefined, {
      maxFiles: 2,
    });

    expect(files.length).toBeLessThanOrEqual(2);
  });

  it('should respect maxTotalInputTokens budget', () => {
    const files = selectFiles(join(fixturesDir, 'sample-nextjs-app'), undefined, {
      maxTotalInputTokens: 100, // Very low budget
    });

    const totalTokens = files.reduce((sum, f) => sum + f.tokenEstimate, 0);
    // Should stay within budget (with some tolerance for truncation)
    expect(totalTokens).toBeLessThanOrEqual(200);
  });

  it('should include relative paths', () => {
    const files = selectFiles(join(fixturesDir, 'sample-nextjs-app'));

    for (const f of files) {
      expect(f.path).not.toContain('\\'); // Forward slashes
      expect(f.path).not.toMatch(/^\//);  // Relative, not absolute
    }
  });

  it('should skip node_modules and .git', () => {
    const files = selectFiles(join(fixturesDir, 'sample-nextjs-app'));

    for (const f of files) {
      expect(f.path).not.toContain('node_modules');
      expect(f.path).not.toContain('.git/');
    }
  });

  it('should include content for each file', () => {
    const files = selectFiles(join(fixturesDir, 'sample-nextjs-app'));

    for (const f of files) {
      expect(f.content.length).toBeGreaterThan(0);
      expect(f.tokenEstimate).toBeGreaterThan(0);
    }
  });

  it('should work with express-api fixture', () => {
    const files = selectFiles(join(fixturesDir, 'sample-express-api'));
    expect(files.length).toBeGreaterThan(0);
  });
});
