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

export interface DeployInput {
  repoName: string;
  provider: CloudProvider;
  strategy: ScalingStrategy;
  security: SecurityPolicy;
}

export class DeployAgent extends BaseAgent<DeployInput, DeployResult> {
  readonly name = 'DeployAgent';
  readonly description = 'Executes simulated deployment with checkpoint-based progress';

  private onCheckpointUpdate?: (checkpoint: Checkpoint, index: number, total: number) => void;

  setCheckpointCallback(cb: (checkpoint: Checkpoint, index: number, total: number) => void): void {
    this.onCheckpointUpdate = cb;
  }

  async execute(input: DeployInput, context: PipelineContext): Promise<DeployResult> {
    const { repoName, provider, strategy, security } = input;
    const deploymentId = `deploy-${nanoid(10)}`;

    // Get cloud-specific checkpoints
    let checkpoints = this.getCheckpoints(provider, strategy);
    const resources = this.getResources(provider, strategy);

    const startTime = Date.now();

    // Execute each checkpoint
    for (let i = 0; i < checkpoints.length; i++) {
      let checkpoint = checkpoints[i]!;

      // Start checkpoint
      checkpoint = startCheckpoint(checkpoint);
      checkpoints[i] = checkpoint;
      this.onCheckpointUpdate?.(checkpoint, i, checkpoints.length);

      try {
        // Simulate the work
        await simulateWork(600, 400);

        // Get realistic log output
        const logLine = this.getLogLine(provider, checkpoint.name);

        // Complete checkpoint
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
