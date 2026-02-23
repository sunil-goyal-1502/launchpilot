import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TerraformExecutor, TerraformEvent } from '../../../../src/agents/deploy/terraform/executor.js';
import * as childProcess from 'node:child_process';
import { EventEmitter } from 'node:events';

// Mock child_process
vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
  execFile: vi.fn(),
}));

const mockedSpawn = vi.mocked(childProcess.spawn);
const mockedExecFile = vi.mocked(childProcess.execFile);

// ── Helper: create a mock child process ──

function createMockProcess(): EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; kill: ReturnType<typeof vi.fn> } {
  const proc = new EventEmitter() as any;
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.kill = vi.fn();
  return proc;
}

describe('TerraformExecutor', () => {
  let events: TerraformEvent[];

  beforeEach(() => {
    vi.clearAllMocks();
    events = [];
  });

  describe('init', () => {
    it('should emit init_complete event on success', async () => {
      mockedExecFile.mockImplementation((_cmd, _args, _opts, callback: any) => {
        callback(null, 'Terraform has been successfully initialized!', '');
        return {} as any;
      });

      const executor = new TerraformExecutor({
        workDir: '/tmp/test',
        onEvent: (e) => events.push(e),
      });

      await executor.init();
      expect(events).toHaveLength(1);
      expect(events[0]!.type).toBe('init_complete');
    });

    it('should throw on init failure', async () => {
      mockedExecFile.mockImplementation((_cmd, _args, _opts, callback: any) => {
        callback(new Error('init failed'), '', 'Error: provider not found');
        return {} as any;
      });

      const executor = new TerraformExecutor({
        workDir: '/tmp/test',
        onEvent: (e) => events.push(e),
      });

      await expect(executor.init()).rejects.toThrow('init failed');
    });
  });

  describe('plan', () => {
    it('should parse resource counts from plan output', async () => {
      mockedExecFile.mockImplementation((_cmd, _args, _opts, callback: any) => {
        callback(null, 'Plan: 15 to add, 0 to change, 0 to destroy.', '');
        return {} as any;
      });

      const executor = new TerraformExecutor({
        workDir: '/tmp/test',
        onEvent: (e) => events.push(e),
      });

      const result = await executor.plan();
      expect(result.resourceCount).toBe(15);
      expect(result.summary).toContain('15 to add');
      expect(events.some(e => e.type === 'plan_complete')).toBe(true);
    });

    it('should handle plan with changes and destroys', async () => {
      mockedExecFile.mockImplementation((_cmd, _args, _opts, callback: any) => {
        callback(null, 'Plan: 5 to add, 3 to change, 1 to destroy.', '');
        return {} as any;
      });

      const executor = new TerraformExecutor({
        workDir: '/tmp/test',
        onEvent: (e) => events.push(e),
      });

      const result = await executor.plan();
      expect(result.resourceCount).toBe(9);
    });
  });

  describe('apply', () => {
    it('should parse resource_start and resource_complete events from JSON stream', async () => {
      const mockProc = createMockProcess();
      mockedSpawn.mockReturnValue(mockProc as any);

      // Mock getOutputs (called after apply completes)
      mockedExecFile.mockImplementation((_cmd, _args, _opts, callback: any) => {
        callback(null, JSON.stringify({
          app_url: { value: 'http://alb-123.amazonaws.com', type: 'string' },
        }), '');
        return {} as any;
      });

      const executor = new TerraformExecutor({
        workDir: '/tmp/test',
        onEvent: (e) => events.push(e),
      });

      const applyPromise = executor.apply();

      // Simulate Terraform JSON output
      const jsonLines = [
        JSON.stringify({
          '@level': 'info',
          '@message': 'aws_vpc.main: Creating...',
          type: 'apply_start',
          hook: { resource: { resource_type: 'aws_vpc', addr: 'aws_vpc.main' } },
        }),
        JSON.stringify({
          '@level': 'info',
          '@message': 'aws_vpc.main: Creation complete after 2s [id=vpc-abc123]',
          type: 'apply_complete',
          hook: { resource: { resource_type: 'aws_vpc', addr: 'aws_vpc.main' } },
        }),
      ];

      mockProc.stdout.emit('data', Buffer.from(jsonLines.join('\n') + '\n'));
      mockProc.emit('close', 0);

      const outputs = await applyPromise;

      expect(events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: 'resource_start', resourceType: 'aws_vpc' }),
          expect.objectContaining({ type: 'resource_complete', resourceType: 'aws_vpc' }),
          expect.objectContaining({ type: 'apply_complete' }),
        ]),
      );

      expect(outputs['app_url']?.value).toBe('http://alb-123.amazonaws.com');
    });

    it('should handle resource errors', async () => {
      const mockProc = createMockProcess();
      mockedSpawn.mockReturnValue(mockProc as any);

      const executor = new TerraformExecutor({
        workDir: '/tmp/test',
        onEvent: (e) => events.push(e),
      });

      const applyPromise = executor.apply();

      const errorLine = JSON.stringify({
        '@level': 'error',
        type: 'apply_errored',
        hook: { resource: { resource_type: 'aws_db_instance', addr: 'aws_db_instance.main' } },
        diagnostic: { summary: 'Error creating RDS instance: InsufficientDBInstanceCapacity' },
      });

      mockProc.stdout.emit('data', Buffer.from(errorLine + '\n'));
      mockProc.stderr.emit('data', Buffer.from('Error: insufficient capacity'));
      mockProc.emit('close', 1);

      await expect(applyPromise).rejects.toThrow('Terraform apply failed');
      expect(events.some(e => e.type === 'resource_error')).toBe(true);
    });

    it('should reject on non-zero exit code', async () => {
      const mockProc = createMockProcess();
      mockedSpawn.mockReturnValue(mockProc as any);

      const executor = new TerraformExecutor({
        workDir: '/tmp/test',
        onEvent: (e) => events.push(e),
      });

      const applyPromise = executor.apply();
      mockProc.stderr.emit('data', Buffer.from('Error: something went wrong'));
      mockProc.emit('close', 1);

      await expect(applyPromise).rejects.toThrow('exit code 1');
    });

    it('should handle split JSON across chunks', async () => {
      const mockProc = createMockProcess();
      mockedSpawn.mockReturnValue(mockProc as any);

      mockedExecFile.mockImplementation((_cmd, _args, _opts, callback: any) => {
        callback(null, '{}', '');
        return {} as any;
      });

      const executor = new TerraformExecutor({
        workDir: '/tmp/test',
        onEvent: (e) => events.push(e),
      });

      const applyPromise = executor.apply();

      const fullLine = JSON.stringify({
        type: 'apply_complete',
        hook: { resource: { resource_type: 'aws_vpc', addr: 'aws_vpc.main' } },
        '@message': 'Done',
      });

      // Split the line across two chunks
      const mid = Math.floor(fullLine.length / 2);
      mockProc.stdout.emit('data', Buffer.from(fullLine.slice(0, mid)));
      mockProc.stdout.emit('data', Buffer.from(fullLine.slice(mid) + '\n'));
      mockProc.emit('close', 0);

      await applyPromise;
      expect(events.some(e => e.type === 'resource_complete' && e.resourceType === 'aws_vpc')).toBe(true);
    });
  });

  describe('destroy', () => {
    it('should call terraform destroy', async () => {
      mockedExecFile.mockImplementation((_cmd, _args, _opts, callback: any) => {
        callback(null, 'Destroy complete! Resources: 15 destroyed.', '');
        return {} as any;
      });

      const executor = new TerraformExecutor({
        workDir: '/tmp/test',
        onEvent: (e) => events.push(e),
      });

      await expect(executor.destroy()).resolves.toBeUndefined();
    });

    it('should throw on destroy failure', async () => {
      mockedExecFile.mockImplementation((_cmd, _args, _opts, callback: any) => {
        callback(new Error('destroy failed'), '', 'Error: resource still in use');
        return {} as any;
      });

      const executor = new TerraformExecutor({
        workDir: '/tmp/test',
        onEvent: (e) => events.push(e),
      });

      await expect(executor.destroy()).rejects.toThrow('destroy failed');
    });
  });
});
