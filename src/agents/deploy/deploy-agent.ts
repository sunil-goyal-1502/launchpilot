import { BaseAgent } from '../base-agent.js';
import { PipelineContext } from '../../orchestrator/context.js';
import { CloudProvider, ScalingStrategy, SecurityPolicy, DeployResult, Checkpoint, DeployedResource } from '../../types/index.js';
import { startCheckpoint, completeCheckpoint, failCheckpoint } from './checkpoint.js';
import { generateDeployUrl, generateDashboardUrl } from './mock-url-generator.js';
import { getAWSCheckpoints, getAWSResources, getAWSLogLine } from './simulators/aws-simulator.js';
import { getGCPCheckpoints, getGCPResources, getGCPLogLine } from './simulators/gcp-simulator.js';
import { getAzureCheckpoints, getAzureResources, getAzureLogLine } from './simulators/azure-simulator.js';
import { simulateWork } from '../../utils/timer.js';
import { nanoid } from 'nanoid';
import { generateTerraformHCL } from './terraform/hcl-generator.js';
import { TerraformExecutor, TerraformEvent } from './terraform/executor.js';
import { getCheckpointForResource, mapTerraformOutputsToDeployResult } from './terraform/resource-map.js';
import { checkTerraformInstalled, validateAWSCredentials } from './terraform/credential-validator.js';
import { join } from 'node:path';

export interface DeployInput {
  repoName: string;
  provider: CloudProvider;
  strategy: ScalingStrategy;
  security: SecurityPolicy;
  live?: boolean;
  destroy?: boolean;
  outputDir?: string;
}

export class DeployAgent extends BaseAgent<DeployInput, DeployResult> {
  readonly name = 'DeployAgent';
  readonly description = 'Executes simulated deployment with checkpoint-based progress';

  private onCheckpointUpdate?: (checkpoint: Checkpoint, index: number, total: number) => void;

  setCheckpointCallback(cb: (checkpoint: Checkpoint, index: number, total: number) => void): void {
    this.onCheckpointUpdate = cb;
  }

  async execute(input: DeployInput, context: PipelineContext): Promise<DeployResult> {
    if (input.live) {
      if (context.get<{ architecture?: unknown }>('blueprint')?.architecture) {
        throw new Error('The legacy live-deploy scaffold does not implement the repository architecture. Generate the reviewed Terraform/Bicep bundle from the evidence-backed plan and validate it before deployment.');
      }
      return this.executeLive(input, context);
    }
    return this.executeSimulation(input, context);
  }

  // ── Simulation path (default — unchanged behavior) ──

  private async executeSimulation(input: DeployInput, context: PipelineContext): Promise<DeployResult> {
    const { repoName, provider, strategy } = input;
    const deploymentId = `deploy-${nanoid(10)}`;

    let checkpoints = this.getCheckpoints(provider, strategy);
    const resources = this.getResources(provider, strategy);

    const startTime = Date.now();

    for (let i = 0; i < checkpoints.length; i++) {
      let checkpoint = checkpoints[i]!;

      checkpoint = startCheckpoint(checkpoint);
      checkpoints[i] = checkpoint;
      this.onCheckpointUpdate?.(checkpoint, i, checkpoints.length);

      try {
        await simulateWork(600, 400);
        const logLine = this.getLogLine(provider, checkpoint.name);

        checkpoint = completeCheckpoint(checkpoint, logLine);
        checkpoints[i] = checkpoint;
        this.onCheckpointUpdate?.(checkpoint, i, checkpoints.length);

        this.log(context, `[${i + 1}/${checkpoints.length}] ${checkpoint.name} ✓`);
      } catch (error) {
        checkpoint = failCheckpoint(checkpoint, String(error));
        checkpoints[i] = checkpoint;
        this.onCheckpointUpdate?.(checkpoint, i, checkpoints.length);

        return {
          success: false,
          deploymentId,
          provider,
          url: '',
          dashboardUrl: '',
          checkpoints,
          totalDuration: Date.now() - startTime,
          resources,
        };
      }
    }

    const result: DeployResult = {
      success: true,
      deploymentId,
      provider,
      url: generateDeployUrl(provider, repoName),
      dashboardUrl: generateDashboardUrl(provider, deploymentId),
      checkpoints,
      totalDuration: Date.now() - startTime,
      resources,
    };

    context.set('deployResult', result);
    return result;
  }

  // ── Live Terraform path ──

  private async executeLive(input: DeployInput, context: PipelineContext): Promise<DeployResult> {
    const { repoName, provider, strategy, security } = input;
    const deploymentId = `deploy-${nanoid(10)}`;
    const startTime = Date.now();

    // Pre-flight: validate Terraform + AWS credentials
    const tfCheck = await checkTerraformInstalled();
    if (!tfCheck.installed) {
      throw new Error(tfCheck.error ?? 'Terraform CLI not found');
    }
    this.log(context, `Terraform ${tfCheck.version} detected`);

    const awsCheck = await validateAWSCredentials();
    if (!awsCheck.valid) {
      throw new Error(awsCheck.error ?? 'AWS credentials not configured');
    }
    this.log(context, `AWS identity: ${awsCheck.identity}`);

    // Generate HCL files
    const outputDir = input.outputDir ?? join(process.cwd(), 'launchpilot-infra');
    const hclResult = generateTerraformHCL(strategy, security, repoName, outputDir);
    this.log(context, `Generated ${hclResult.files.length} Terraform files in ${outputDir}`);

    // Pre-create checkpoints (same names as simulation for progress bar compatibility)
    let checkpoints = getAWSCheckpoints(strategy);
    const checkpointMap = new Map<string, number>(); // checkpoint name → index
    checkpoints.forEach((cp, i) => checkpointMap.set(cp.name, i));

    // Track resource completion per checkpoint group
    const completedPerCheckpoint = new Map<string, number>();

    // Wire Terraform events to checkpoints
    const onEvent = (event: TerraformEvent) => {
      if (event.type === 'resource_start' && event.resourceType) {
        const cpName = getCheckpointForResource(event.resourceType);
        if (cpName) {
          const idx = checkpointMap.get(cpName);
          if (idx !== undefined && checkpoints[idx]!.status === 'pending') {
            checkpoints[idx] = startCheckpoint(checkpoints[idx]!);
            this.onCheckpointUpdate?.(checkpoints[idx]!, idx, checkpoints.length);
          }
        }
      } else if (event.type === 'resource_complete' && event.resourceType) {
        const cpName = getCheckpointForResource(event.resourceType);
        if (cpName) {
          const count = (completedPerCheckpoint.get(cpName) ?? 0) + 1;
          completedPerCheckpoint.set(cpName, count);

          const idx = checkpointMap.get(cpName);
          if (idx !== undefined && checkpoints[idx]!.status !== 'completed') {
            checkpoints[idx] = completeCheckpoint(checkpoints[idx]!, event.message);
            this.onCheckpointUpdate?.(checkpoints[idx]!, idx, checkpoints.length);
            this.log(context, `[${idx + 1}/${checkpoints.length}] ${cpName} ✓`);
          }
        }
      } else if (event.type === 'resource_error' && event.resourceType) {
        const cpName = getCheckpointForResource(event.resourceType);
        if (cpName) {
          const idx = checkpointMap.get(cpName);
          if (idx !== undefined) {
            checkpoints[idx] = failCheckpoint(checkpoints[idx]!, event.message);
            this.onCheckpointUpdate?.(checkpoints[idx]!, idx, checkpoints.length);
          }
        }
      }
    };

    // Run Terraform
    const executor = new TerraformExecutor({ workDir: outputDir, onEvent });

    try {
      await executor.init();
      this.log(context, 'Terraform initialized');

      const planResult = await executor.plan();
      this.log(context, planResult.summary);

      const outputs = await executor.apply();

      // Mark any remaining pending checkpoints as completed
      // (Deploy Application and Health Check aren't TF resources)
      for (let i = 0; i < checkpoints.length; i++) {
        if (checkpoints[i]!.status === 'pending') {
          checkpoints[i] = startCheckpoint(checkpoints[i]!);
          checkpoints[i] = completeCheckpoint(checkpoints[i]!, 'Completed via Terraform');
          this.onCheckpointUpdate?.(checkpoints[i]!, i, checkpoints.length);
        }
      }

      // Extract real URLs and resources from Terraform outputs
      const tfResult = mapTerraformOutputsToDeployResult(outputs);

      const result: DeployResult = {
        success: true,
        deploymentId,
        provider,
        url: tfResult.url || generateDeployUrl(provider, repoName),
        dashboardUrl: tfResult.dashboardUrl || generateDashboardUrl(provider, deploymentId),
        checkpoints,
        totalDuration: Date.now() - startTime,
        resources: tfResult.resources.length > 0 ? tfResult.resources : getAWSResources(strategy),
        mode: 'live',
        infraDir: outputDir,
      };

      context.set('deployResult', result);
      return result;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);

      // Find and fail the first non-completed checkpoint
      for (let i = 0; i < checkpoints.length; i++) {
        if (checkpoints[i]!.status !== 'completed') {
          checkpoints[i] = failCheckpoint(checkpoints[i]!, msg);
          this.onCheckpointUpdate?.(checkpoints[i]!, i, checkpoints.length);
          break;
        }
      }

      return {
        success: false,
        deploymentId,
        provider,
        url: '',
        dashboardUrl: '',
        checkpoints,
        totalDuration: Date.now() - startTime,
        resources: [],
        mode: 'live',
        infraDir: outputDir,
      };
    }
  }

  private getCheckpoints(provider: CloudProvider, strategy: ScalingStrategy): Checkpoint[] {
    switch (provider) {
      case CloudProvider.AWS: return getAWSCheckpoints(strategy);
      case CloudProvider.GCP: return getGCPCheckpoints(strategy);
      case CloudProvider.Azure: return getAzureCheckpoints(strategy);
    }
  }

  private getResources(provider: CloudProvider, strategy: ScalingStrategy): DeployedResource[] {
    switch (provider) {
      case CloudProvider.AWS: return getAWSResources(strategy);
      case CloudProvider.GCP: return getGCPResources(strategy);
      case CloudProvider.Azure: return getAzureResources(strategy);
    }
  }

  private getLogLine(provider: CloudProvider, checkpointName: string): string {
    switch (provider) {
      case CloudProvider.AWS: return getAWSLogLine(checkpointName);
      case CloudProvider.GCP: return getGCPLogLine(checkpointName);
      case CloudProvider.Azure: return getAzureLogLine(checkpointName);
    }
  }
}
