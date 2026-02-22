export interface WAFRule {
  id: string;
  name: string;
  description: string;
  priority: number;
  action: 'block' | 'allow' | 'count';
}

export interface WAFPolicy {
  enabled: boolean;
  rules: WAFRule[];
  rateLimitRpm: number;
}

export interface NetworkSecurityPolicy {
  vpcEnabled: boolean;
  privateSubnets: boolean;
  publicSubnets: boolean;
  securityGroups: string[];
  networkACLs: boolean;
  flowLogging: boolean;
}

export interface TLSPolicy {
  minVersion: '1.2' | '1.3';
  hstsEnabled: boolean;
  hstsMaxAge: number;
  certProvider: string;
}

export interface IAMPolicy {
  leastPrivilege: boolean;
  serviceRoles: string[];
  mfaRequired: boolean;
}

export interface SecretsPolicy {
  provider: string;
  envVarsToSecrets: Record<string, string>;
  rotationEnabled: boolean;
  rotationDays: number;
}

export interface SecurityPolicy {
  tier: 'basic' | 'standard' | 'advanced';
  waf: WAFPolicy;
  network: NetworkSecurityPolicy;
  tls: TLSPolicy;
  iam: IAMPolicy;
  secrets: SecretsPolicy;
  vulnerabilities: VulnerabilityReport[];
}

export interface VulnerabilityReport {
  package: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  recommendation: string;
}
