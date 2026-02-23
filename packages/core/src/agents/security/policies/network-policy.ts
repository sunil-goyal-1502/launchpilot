import { NetworkSecurityPolicy, SecurityTier } from '../../../types/index';

export function generateNetworkPolicy(tier: SecurityTier): NetworkSecurityPolicy {
  switch (tier) {
    case 'basic':
      return {
        vpcEnabled: true,
        privateSubnets: false,
        publicSubnets: true,
        securityGroups: ['sg-web-ingress', 'sg-ssh-restricted'],
        networkACLs: false,
        flowLogging: false,
      };
    case 'standard':
      return {
        vpcEnabled: true,
        privateSubnets: true,
        publicSubnets: true,
        securityGroups: [
          'sg-web-ingress',
          'sg-app-internal',
          'sg-db-private',
          'sg-bastion',
        ],
        networkACLs: true,
        flowLogging: false,
      };
    case 'advanced':
      return {
        vpcEnabled: true,
        privateSubnets: true,
        publicSubnets: true,
        securityGroups: [
          'sg-web-ingress',
          'sg-app-internal',
          'sg-db-private',
          'sg-bastion',
          'sg-monitoring',
          'sg-cache',
        ],
        networkACLs: true,
        flowLogging: true,
      };
  }
}
