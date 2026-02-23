import { SecretsPolicy, SecurityTier, CloudProvider } from '../../../types/index';

const SECRETS_PROVIDERS: Record<CloudProvider, string> = {
  [CloudProvider.AWS]: 'AWS Secrets Manager',
  [CloudProvider.GCP]: 'GCP Secret Manager',
  [CloudProvider.Azure]: 'Azure Key Vault',
};

export function generateSecretsPolicy(
  tier: SecurityTier,
  provider: CloudProvider,
  envVars: string[],
): SecretsPolicy {
  // Map env vars that look like secrets to the secrets manager
  const secretPatterns = /^(.*SECRET.*|.*KEY.*|.*TOKEN.*|.*PASSWORD.*|.*API.*|.*AUTH.*|.*PRIVATE.*|DATABASE_URL|REDIS_URL|MONGO.*)$/i;

  const envVarsToSecrets: Record<string, string> = {};
  for (const envVar of envVars) {
    if (secretPatterns.test(envVar)) {
      const secretName = envVar.toLowerCase().replace(/_/g, '-');
      envVarsToSecrets[envVar] = `${secretName}`;
    }
  }

  return {
    provider: SECRETS_PROVIDERS[provider],
    envVarsToSecrets,
    rotationEnabled: tier !== 'basic',
    rotationDays: tier === 'advanced' ? 30 : 90,
  };
}
