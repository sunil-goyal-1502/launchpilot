import { IAMPolicy, SecurityTier, CloudProvider } from '../../../types/index';

const SERVICE_ROLES: Record<CloudProvider, Record<SecurityTier, string[]>> = {
  [CloudProvider.AWS]: {
    basic: ['ecs-task-execution-role', 'rds-monitoring-role'],
    standard: ['ecs-task-execution-role', 'rds-monitoring-role', 'cloudwatch-agent-role', 'secrets-access-role'],
    advanced: ['ecs-task-execution-role', 'rds-monitoring-role', 'cloudwatch-agent-role', 'secrets-access-role', 'config-recorder-role', 'guardduty-role'],
  },
  [CloudProvider.GCP]: {
    basic: ['compute-service-agent', 'sql-service-agent'],
    standard: ['compute-service-agent', 'sql-service-agent', 'logging-writer', 'secretmanager-accessor'],
    advanced: ['compute-service-agent', 'sql-service-agent', 'logging-writer', 'secretmanager-accessor', 'security-admin', 'monitoring-viewer'],
  },
  [CloudProvider.Azure]: {
    basic: ['vm-contributor', 'sql-db-contributor'],
    standard: ['vm-contributor', 'sql-db-contributor', 'key-vault-secrets-user', 'monitoring-reader'],
    advanced: ['vm-contributor', 'sql-db-contributor', 'key-vault-secrets-user', 'monitoring-reader', 'security-admin', 'network-contributor'],
  },
};

export function generateIAMPolicy(tier: SecurityTier, provider: CloudProvider): IAMPolicy {
  return {
    leastPrivilege: true,
    serviceRoles: SERVICE_ROLES[provider][tier],
    mfaRequired: tier === 'advanced',
  };
}
