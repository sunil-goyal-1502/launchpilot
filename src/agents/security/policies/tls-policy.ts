import { TLSPolicy, SecurityTier, CloudProvider } from '../../../types/index.js';

const CERT_PROVIDERS: Record<CloudProvider, string> = {
  [CloudProvider.AWS]: 'AWS Certificate Manager',
  [CloudProvider.GCP]: 'Google-managed SSL',
  [CloudProvider.Azure]: 'Azure App Service Managed Certificate',
};

export function generateTLSPolicy(tier: SecurityTier, provider: CloudProvider): TLSPolicy {
  return {
    minVersion: tier === 'advanced' ? '1.3' : '1.2',
    hstsEnabled: tier !== 'basic',
    hstsMaxAge: tier === 'advanced' ? 63072000 : 31536000, // 2 years vs 1 year
    certProvider: CERT_PROVIDERS[provider],
  };
}
