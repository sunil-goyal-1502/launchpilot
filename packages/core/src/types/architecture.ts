/** Repository observations, not a claim about resources running in a cloud account. */
export interface SourceEvidence {
  id: string;
  file: string;
  line: number;
  endLine: number;
  kind: 'deployment' | 'code' | 'configuration';
  summary: string;
}

export type ResourceKind = 'application' | 'database' | 'cache' | 'queue' | 'streaming' | 'storage' | 'vault' | 'secret' | 'identity' | 'network' | 'configuration' | 'service' | 'module' | 'unknown';
export interface ArchitectureResource {
  id: string;
  name: string;
  kind: ResourceKind;
  technology: string;
  scope: string;
  origin: 'declared' | 'code' | 'external';
  evidence: string[];
  /** Safe metadata only. Never connection-string, token, password or Secret contents. */
  attributes: Record<string, string>;
}
export interface ArchitectureConnection {
  id: string;
  from: string;
  to: string;
  relationship: string;
  evidence: string[];
}
export interface ConfigurationBinding {
  id: string;
  consumerId: string;
  key: string;
  source: 'environment' | 'secret' | 'config-map' | 'literal' | 'expression' | 'file';
  sourceId?: string;
  sourceKey?: string;
  sensitive: boolean;
  evidence: string[];
  /** Whether the provider of the configuration is identified; not whether its value is known. */
  resolved: boolean;
}
export interface ArchitectureGap {
  id: string;
  severity: 'warning' | 'blocker';
  code: string;
  message: string;
  evidence: string[];
  scope?: string;
}
export interface ArchitectureRecommendation {
  id: string;
  title: string;
  rationale: string;
  action: string;
  evidence: string[];
}
export type DeploymentFormat = 'terraform' | 'bicep' | 'kubernetes' | 'cortex' | 'compose' | 'helm' | 'arm' | 'workflow';
export interface DeploymentUnit {
  id: string;
  name: string;
  format: DeploymentFormat;
  root: string;
  files: string[];
  resourceIds: string[];
  exportFormats: Array<'terraform' | 'bicep'>;
}
export interface RepositoryArchitecture {
  version: 1;
  id: string;
  repoUrl: string;
  revision: string | null;
  scannedAt: string;
  resources: ArchitectureResource[];
  connections: ArchitectureConnection[];
  bindings: ConfigurationBinding[];
  evidence: SourceEvidence[];
  deploymentUnits: DeploymentUnit[];
  gaps: ArchitectureGap[];
  recommendations: ArchitectureRecommendation[];
  /** Related implementations for reuse review; not selected deployment resources. */
  relatedDeploymentContext?: Array<{ file: string; content: string; redacted: true }>;
  deploymentContext: Array<{ file: string; content: string; redacted: true }>;
  coverage: {
    filesScanned: number;
    deploymentFiles: number;
    files: Array<{ path: string; sha256: string; category: string }>;
    excluded: Array<{ path: string; reason: string }>;
    limits: { maxFiles: number; maxFileBytes: number; maxTotalBytes: number };
    truncated: boolean;
    runtimeVerified: false;
  };
}
export interface ArchitectureExport {
  status: 'ready' | 'blocked';
  architectureId: string;
  unitId: string;
  format: 'terraform' | 'bicep';
  files: Record<string, string>;
  blockers: string[];
  notes: string[];
}
