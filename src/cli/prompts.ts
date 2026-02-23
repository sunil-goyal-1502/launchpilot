import { select, confirm } from '@inquirer/prompts';
import { CloudProvider, StrategyTier, ScalingStrategy, BaaSMigrationOption, BaaSMigrationChoice, BaaSMigrationStrategy } from '../types/index.js';

export async function selectCloud(): Promise<CloudProvider> {
  const answer = await select({
    message: 'Select cloud provider:',
    choices: [
      { name: 'AWS (Amazon Web Services)', value: CloudProvider.AWS },
      { name: 'GCP (Google Cloud Platform)', value: CloudProvider.GCP },
      { name: 'Azure (Microsoft Azure)', value: CloudProvider.Azure },
    ],
  });
  return answer;
}

export async function selectStrategy(strategies: ScalingStrategy[]): Promise<ScalingStrategy> {
  const answer = await select({
    message: 'Select scaling strategy:',
    choices: strategies.map((s) => ({
      name: `${s.name} (${s.tier}) — ${s.estimatedUsers} users — $${s.costBreakdown?.total.toFixed(2) ?? '?'}/mo`,
      value: s,
    })),
  });
  return answer;
}

export async function confirmDeployment(): Promise<boolean> {
  return confirm({
    message: 'Proceed with deployment?',
    default: true,
  });
}

export function parseCloudFlag(value: string): CloudProvider | undefined {
  const normalized = value.toLowerCase().trim();
  if (normalized === 'aws') return CloudProvider.AWS;
  if (normalized === 'gcp') return CloudProvider.GCP;
  if (normalized === 'azure') return CloudProvider.Azure;
  return undefined;
}

export function parseStrategyFlag(value: string): StrategyTier | undefined {
  const normalized = value.toLowerCase().trim();
  if (normalized === 'low' || normalized === 'starter') return 'low';
  if (normalized === 'medium' || normalized === 'production') return 'medium';
  if (normalized === 'high' || normalized === 'enterprise') return 'high';
  return undefined;
}

export async function selectBaaSStrategy(options: BaaSMigrationOption[]): Promise<BaaSMigrationChoice> {
  const answer = await select({
    message: 'How would you like to handle BaaS services?',
    choices: options.map(opt => ({
      name: opt.label,
      value: opt,
      description: opt.description,
    })),
  });
  return {
    strategy: answer.strategy,
    vendor: answer.vendor,
    handledFeatures: answer.handledFeatures,
  };
}

export function parseBackendFlag(value: string): BaaSMigrationStrategy | undefined {
  const normalized = value.toLowerCase().trim();
  if (normalized === 'self-hosted' || normalized === 'cloud') return 'self-hosted';
  if (normalized === 'keep' || normalized === 'keep-vendor') return 'keep-vendor';
  if (normalized === 'migrate' || normalized === 'migrate-vendor') return 'migrate-vendor';
  return undefined;
}
