import { CloudProvider } from './cloud-provider.types';
import { ScalingStrategy } from './scaling-strategy';
import { SecurityPolicy } from './security-policy';

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
