import { CloudProvider } from './cloud-provider.types.js';
import { ScalingStrategy } from './scaling-strategy.js';
import { SecurityPolicy } from './security-policy.js';

export type CheckpointStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped';

export interface Checkpoint {
  id: string;
  name: string;
  description: string;
  status: CheckpointStatus;
  startedAt?: Date;
  completedAt?: Date;
  output?: string;
  error?: string;
}

export interface DeployResult {
  success: boolean;
  deploymentId: string;
  provider: CloudProvider;
  url: string;
  dashboardUrl: string;
  checkpoints: Checkpoint[];
  totalDuration: number;
  resources: DeployedResource[];
  mode?: 'simulation' | 'live';
  infraDir?: string;
}

export interface DeployedResource {
  type: string;
  name: string;
  id: string;
  status: string;
}

export interface DeploymentPlan {
  id: string;
  repoUrl: string;
  provider: CloudProvider;
  region: string;
  strategy: ScalingStrategy;
  security: SecurityPolicy;
  checkpoints: Checkpoint[];
  createdAt: Date;
}
