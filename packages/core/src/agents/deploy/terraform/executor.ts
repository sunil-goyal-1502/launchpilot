/**
 * Wraps the Terraform CLI for init → plan → apply → destroy lifecycle.
 * Uses child_process.spawn for real-time JSON event streaming from
 * `terraform apply -json`. Events are mapped to checkpoint callbacks
 * via resource-map.ts.
 */

import { spawn, execFile } from 'node:child_process';
import { TerraformOutputs } from './resource-map';
import { getTerraformPath } from './credential-validator';

export interface TerraformEvent {
  type:
    | 'init_complete'
    | 'plan_complete'
    | 'resource_start'
    | 'resource_complete'
    | 'resource_error'
    | 'apply_complete'
    | 'error';
  resourceType?: string;
  resourceName?: string;
  message: string;
}

export interface TerraformExecutorOptions {
  workDir: string;
  onEvent: (event: TerraformEvent) => void;
  timeout?: number; // ms, default 30 minutes
}

export interface TerraformPlanResult {
  resourceCount: number;
  summary: string;
}

export class TerraformExecutor {
  private workDir: string;
  private onEvent: (event: TerraformEvent) => void;
  private timeout: number;

  constructor(options: TerraformExecutorOptions) {
    this.workDir = options.workDir;
    this.onEvent = options.onEvent;
    this.timeout = options.timeout ?? 30 * 60 * 1000; // 30 minutes
  }

  /**
   * Run `terraform init` in the working directory.
   */
  async init(): Promise<void> {
    await this.runCommand(['init', '-no-color', '-input=false']);
    this.onEvent({ type: 'init_complete', message: 'Terraform initialized' });
  }

  /**
   * Run `terraform plan` and return resource count.
   */
  async plan(): Promise<TerraformPlanResult> {
    const output = await this.runCommand(['plan', '-no-color', '-input=false', '-out=tfplan']);

    // Parse resource count from plan output
    const addMatch = output.match(/(\d+) to add/);
    const changeMatch = output.match(/(\d+) to change/);
    const destroyMatch = output.match(/(\d+) to destroy/);

    const toAdd = addMatch ? parseInt(addMatch[1]!, 10) : 0;
    const toChange = changeMatch ? parseInt(changeMatch[1]!, 10) : 0;
    const toDestroy = destroyMatch ? parseInt(destroyMatch[1]!, 10) : 0;
    const resourceCount = toAdd + toChange + toDestroy;

    const summary = `Plan: ${toAdd} to add, ${toChange} to change, ${toDestroy} to destroy`;

    this.onEvent({ type: 'plan_complete', message: summary });

    return { resourceCount, summary };
  }

  /**
   * Run `terraform apply -json -auto-approve` with streaming JSON events.
   * Parses each line as a JSON object and emits resource_start/resource_complete events.
   */
  async apply(): Promise<TerraformOutputs> {
    return new Promise<TerraformOutputs>((resolve, reject) => {
      const proc = spawn(getTerraformPath(), ['apply', '-json', '-auto-approve', 'tfplan'], {
        cwd: this.workDir,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: true,
      });

      let stderrBuf = '';
      let lineBuf = '';

      const timer = setTimeout(() => {
        proc.kill('SIGTERM');
        reject(new Error(`Terraform apply timed out after ${this.timeout / 1000}s`));
      }, this.timeout);

      proc.stdout!.on('data', (chunk: Buffer) => {
        lineBuf += chunk.toString();
        const lines = lineBuf.split('\n');
        lineBuf = lines.pop()!; // Keep incomplete line in buffer

        for (const line of lines) {
          if (!line.trim()) continue;
          this.parseTerraformJsonLine(line.trim());
        }
      });

      proc.stderr!.on('data', (chunk: Buffer) => {
        stderrBuf += chunk.toString();
      });

      proc.on('close', (code) => {
        clearTimeout(timer);

        // Process remaining buffer
        if (lineBuf.trim()) {
          this.parseTerraformJsonLine(lineBuf.trim());
        }

        if (code !== 0) {
          this.onEvent({ type: 'error', message: stderrBuf || `terraform apply exited with code ${code}` });
          reject(new Error(`Terraform apply failed (exit code ${code}): ${stderrBuf.slice(0, 500)}`));
          return;
        }

        this.onEvent({ type: 'apply_complete', message: 'Terraform apply complete' });

        // Extract outputs
        this.getOutputs()
          .then(resolve)
          .catch(reject);
      });

      proc.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  /**
   * Run `terraform destroy -auto-approve`.
   */
  async destroy(): Promise<void> {
    await this.runCommand(['destroy', '-auto-approve', '-no-color', '-input=false']);
  }

  /**
   * Run `terraform output -json` to extract outputs.
   */
  private getOutputs(): Promise<TerraformOutputs> {
    return new Promise((resolve, reject) => {
      execFile(getTerraformPath(), ['output', '-json'], { cwd: this.workDir, timeout: 30_000 }, (err, stdout) => {
        if (err) {
          // No outputs is okay — return empty
          resolve({});
          return;
        }
        try {
          resolve(JSON.parse(stdout));
        } catch {
          resolve({});
        }
      });
    });
  }

  /**
   * Parse a single line of Terraform JSON output and emit appropriate events.
   *
   * Terraform apply -json emits objects with these relevant types:
   * - type: "apply_start"   → hook.resource.resource_type, hook.resource.addr
   * - type: "apply_complete" → hook.resource.resource_type, hook.resource.addr
   * - type: "apply_errored"  → hook.resource.resource_type, diagnostic
   */
  private parseTerraformJsonLine(line: string): void {
    try {
      const obj = JSON.parse(line);

      if (obj.type === 'apply_start' && obj.hook?.resource) {
        this.onEvent({
          type: 'resource_start',
          resourceType: obj.hook.resource.resource_type,
          resourceName: obj.hook.resource.addr,
          message: obj['@message'] ?? `Creating ${obj.hook.resource.addr}`,
        });
      } else if (obj.type === 'apply_complete' && obj.hook?.resource) {
        this.onEvent({
          type: 'resource_complete',
          resourceType: obj.hook.resource.resource_type,
          resourceName: obj.hook.resource.addr,
          message: obj['@message'] ?? `Created ${obj.hook.resource.addr}`,
        });
      } else if (obj.type === 'apply_errored' && obj.hook?.resource) {
        this.onEvent({
          type: 'resource_error',
          resourceType: obj.hook.resource.resource_type,
          resourceName: obj.hook.resource.addr,
          message: obj.diagnostic?.summary ?? obj['@message'] ?? 'Resource creation failed',
        });
      }
    } catch {
      // Ignore unparseable lines (plain text output mixed in)
    }
  }

  /**
   * Execute a terraform command and return stdout.
   */
  private runCommand(args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile(getTerraformPath(), args, { cwd: this.workDir, timeout: this.timeout }, (err, stdout, stderr) => {
        if (err) {
          reject(new Error(`terraform ${args[0]} failed: ${stderr || err.message}`));
          return;
        }
        resolve(stdout);
      });
    });
  }
}
