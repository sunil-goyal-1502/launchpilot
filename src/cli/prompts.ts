import { select, confirm } from '@inquirer/prompts';
import { CloudProvider, StrategyTier, ScalingStrategy } from '../types/index.js';

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
