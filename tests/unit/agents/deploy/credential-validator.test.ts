import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { checkTerraformInstalled, validateAWSCredentials } from '../../../../src/agents/deploy/terraform/credential-validator.js';
import * as childProcess from 'node:child_process';

// Mock execFile
vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}));

const mockedExecFile = vi.mocked(childProcess.execFile);

describe('checkTerraformInstalled', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return installed=true with version when terraform is available', async () => {
    mockedExecFile.mockImplementation((_cmd, _args, _opts, callback: any) => {
      callback(null, JSON.stringify({ terraform_version: '1.7.2' }), '');
      return {} as any;
    });

    const result = await checkTerraformInstalled();
    expect(result.installed).toBe(true);
    expect(result.version).toBe('1.7.2');
    expect(result.error).toBeUndefined();
  });

  it('should parse plain text version output as fallback', async () => {
    mockedExecFile.mockImplementation((_cmd, _args, _opts, callback: any) => {
      callback(null, 'Terraform v1.6.5\non linux_amd64', '');
      return {} as any;
    });

    const result = await checkTerraformInstalled();
    expect(result.installed).toBe(true);
    expect(result.version).toBe('1.6.5');
  });

  it('should return installed=false when terraform is not found', async () => {
    mockedExecFile.mockImplementation((_cmd, _args, _opts, callback: any) => {
      callback(new Error('ENOENT'), '', '');
      return {} as any;
    });

    const result = await checkTerraformInstalled();
    expect(result.installed).toBe(false);
    expect(result.error).toContain('not found');
    expect(result.error).toContain('https://');
  });
});

describe('validateAWSCredentials', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should return valid=true when AWS CLI confirms identity', async () => {
    mockedExecFile.mockImplementation((_cmd, _args, _opts, callback: any) => {
      callback(null, JSON.stringify({
        UserId: 'AIDAEXAMPLE',
        Account: '123456789012',
        Arn: 'arn:aws:iam::123456789012:user/dev',
      }), '');
      return {} as any;
    });

    const result = await validateAWSCredentials();
    expect(result.valid).toBe(true);
    expect(result.identity).toContain('arn:aws:iam');
  });

  it('should fallback to env vars when AWS CLI is not available', async () => {
    process.env['AWS_ACCESS_KEY_ID'] = 'AKIA1234567890';
    process.env['AWS_SECRET_ACCESS_KEY'] = 'secret';

    mockedExecFile.mockImplementation((_cmd, _args, _opts, callback: any) => {
      callback(new Error('ENOENT'), '', '');
      return {} as any;
    });

    const result = await validateAWSCredentials();
    expect(result.valid).toBe(true);
    expect(result.identity).toContain('env:');
  });

  it('should return valid=false when no credentials found', async () => {
    delete process.env['AWS_ACCESS_KEY_ID'];
    delete process.env['AWS_SECRET_ACCESS_KEY'];

    mockedExecFile.mockImplementation((_cmd, _args, _opts, callback: any) => {
      callback(new Error('ENOENT'), '', '');
      return {} as any;
    });

    const result = await validateAWSCredentials();
    expect(result.valid).toBe(false);
    expect(result.error).toContain('AWS credentials not configured');
  });
});
