import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { join } from 'node:path';

const projectRoot = join(process.cwd());
const fixturesDir = join(projectRoot, 'tests', 'fixtures');

function runCLI(args: string): string {
  return execSync(
    `npx tsx bin/launchpilot.ts ${args}`,
    {
      cwd: projectRoot,
      encoding: 'utf-8',
      env: { ...process.env, LAUNCHPILOT_FAST: '1', NODE_ENV: 'test' },
      timeout: 30000,
    },
  );
}

describe('CLI Integration', () => {
  it('should show help', () => {
    const output = runCLI('--help');
    expect(output).toContain('launchpilot');
    expect(output).toContain('deploy');
    expect(output).toContain('analyze');
    expect(output).toContain('estimate');
  });

  it('should show version', () => {
    const output = runCLI('--version');
    expect(output.trim()).toBe('0.1.0');
  });

  it('should run analyze command on local fixture', () => {
    const output = runCLI(`analyze local://${fixturesDir}/sample-nextjs-app`);
    expect(output).toContain('Next.js');
    expect(output).toContain('node');
  });
});
