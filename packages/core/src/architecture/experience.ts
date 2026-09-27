import { parseAllDocuments } from 'yaml';
import type { RepositoryArchitecture } from '../types/architecture';

export type ArchitectureCloud = 'azure' | 'aws' | 'gcp';
export const cloudProfiles = {
  azure: { name: 'Azure', kubernetes: 'Azure Kubernetes Service', edge: 'Azure Front Door Premium + WAF', vault: 'Azure Key Vault', identity: 'Azure Workload Identity', firewall: 'Azure Firewall', gateway: 'Azure API Management', region: 'eastus', instance: 'Standard_D4s_v5' },
  aws: { name: 'AWS', kubernetes: 'Amazon EKS', edge: 'Amazon CloudFront + AWS WAF', vault: 'AWS Secrets Manager', identity: 'EKS Pod Identity', firewall: 'AWS Network Firewall', gateway: 'Amazon API Gateway', region: 'us-west-2', instance: 'm5a.xlarge' },
  gcp: { name: 'Google Cloud', kubernetes: 'Google Kubernetes Engine', edge: 'External Application Load Balancer + Cloud Armor', vault: 'Google Secret Manager', identity: 'Workload Identity Federation for GKE', firewall: 'Cloud NGFW', gateway: 'Google Cloud API Gateway', region: 'us-central1', instance: 'e2-standard-4' },
} as const;

export interface DeploymentEnvironment {
  id: string; label: string; unitIds: string[]; files: string[]; alternativeUnitIds: string[];
}
const aliases: Record<string, string> = { production: 'prod', prod: 'prod', preproduction: 'preprod', preprod: 'preprod', qa: 'qa', staging: 'staging', stage: 'staging', uat: 'uat', test: 'test', testing: 'test', development: 'dev', dev: 'dev', local: 'local', sandbox: 'sandbox', demo: 'demo', preview: 'preview', integration: 'integration', dr: 'dr' };
export const environmentName = (value: string) => aliases[value.toLowerCase()] ?? value.toLowerCase();
export function fileEnvironment(file: string): string | undefined {
  const tokens = file.toLowerCase().replace(/\.(ya?ml|json|tfvars|tf|bicep)$/, '').split(/[\/_.-]/);
  const known = tokens.map(t => aliases[t]).find(Boolean);
  if (known) return known;
  // Explicit environment directories can contain repository-specific names (e.g. performance).
  const explicit = file.match(/(?:^|\/)(?:environments|envs|overlays)\/([a-z0-9][a-z0-9_-]*)(?:\/|$)/i);
  return explicit ? environmentName(explicit[1]) : undefined;
}

/** UI choices are environments, not file formats. Alternative deployment owners stay in the audit. */
export function deploymentEnvironments(graph: RepositoryArchitecture): DeploymentEnvironment[] {
  const groups = new Map<string, { explicit: string[]; overlays: string[]; files: Set<string> }>();
  for (const unit of graph.deploymentUnits.filter(u => u.format !== 'workflow')) {
    const rootEnv = fileEnvironment(unit.root);
    const envFiles = unit.files.filter(f => fileEnvironment(f));
    const names = new Set(rootEnv ? [rootEnv] : envFiles.map(f => fileEnvironment(f)!));
    for (const id of names) {
      const group = groups.get(id) ?? { explicit: [], overlays: [], files: new Set<string>() };
      (rootEnv || unit.format !== 'helm' ? group.explicit : group.overlays).push(unit.id);
      unit.files.filter(f => !fileEnvironment(f) || fileEnvironment(f) === id).forEach(f => group.files.add(f));
      groups.set(id, group);
    }
  }
  if (!groups.size) {
    const units = graph.deploymentUnits.filter(u => u.format !== 'workflow');
    const selected = units.length ? units : graph.deploymentUnits;
    return [{ id: 'default', label: 'Default', unitIds: selected.map(u => u.id), files: selected.flatMap(u => u.files), alternativeUnitIds: [] }];
  }
  return [...groups].map(([id, group]) => ({ id, label: ({ prod: 'Prod', preprod: 'Preprod', qa: 'QA', uat: 'UAT', dr: 'DR', dev: 'Dev' } as Record<string,string>)[id] ?? id[0].toUpperCase() + id.slice(1), unitIds: [...new Set(group.explicit.length ? group.explicit : group.overlays)], files: [...group.files], alternativeUnitIds: group.explicit.length ? [...new Set(group.overlays)] : [] })).sort((a, b) => {
    const order = ['prod', 'preprod', 'qa', 'staging', 'uat', 'test', 'dev', 'local'];
    return (order.indexOf(a.id) < 0 ? 99 : order.indexOf(a.id)) - (order.indexOf(b.id) < 0 ? 99 : order.indexOf(b.id)) || a.id.localeCompare(b.id);
  });
}
export function selectedEnvironment(graph: RepositoryArchitecture, unitIds: string[]) {
  const ids = [...unitIds].sort().join('|');
  return deploymentEnvironments(graph).find(e => [...e.unitIds].sort().join('|') === ids)
    ?? deploymentEnvironments(graph).find(e => unitIds.length && unitIds.every(id => e.unitIds.includes(id)));
}

export interface ControlFinding {
  id: string; name: string; status: 'declared' | 'available' | 'disabled' | 'missing';
  action: string; evidenceIds: string[]; files: string[];
}
const controlSpecs = [
  { id: 'health', name: 'Health checks', kinds: /never-match/, keys: /(?:^|\.)(?:livenessProbe|readinessProbe|startupProbe|healthCheck|health|readiness)(?:\.|$)/i, action: 'Add readiness and liveness checks to the existing workload definitions, using the application’s real health endpoints.' },
  { id: 'requests', name: 'CPU and memory requests', kinds: /never-match/, keys: /(?:^|\.)resources\.requests\.(cpu|memory)$/i, action: 'Set per-container CPU and memory requests from load measurements. Proposed starting capacity is shown in the sizing estimate.' },
  { id: 'scaling', name: 'Replica configuration', kinds: /^(HorizontalPodAutoscaler|PodDisruptionBudget)$/, keys: /(?:^|\.)(replicas|replicaCount|minReplicas|maxReplicas)$/, action: 'Define replicas, disruption budgets and scaling against measured traffic in the existing deployment owner.' },
  { id: 'disruption', name: 'Disruption protection', kinds: /^(PodDisruptionBudget)$/, keys: /(?:^|\.)(?:topologySpreadConstraints|podAntiAffinity)(?:\.|$)/, action: 'Check failure tolerance and add disruption budgets or placement constraints to the existing deployment owner where availability requires them.' },
  { id: 'network-policy', name: 'Network policies', kinds: /^(NetworkPolicy|CiliumNetworkPolicy)$/, keys: /(?:^|\.)networkPolicy\.enabled$/i, action: 'Add workload network policies for the evidenced service, DNS, identity and data-store connections; verify enforcement by the cluster CNI.' },
  { id: 'identity', name: 'Workload identity', kinds: /^(AzureIdentity|IAMRole|IAMServiceAccount)$/, keys: /(?:workloadIdentity\.(enabled|clientId)|azure\.workload\.identity\/client-id|eks\.amazonaws\.com\/role-arn|iam\.gke\.io\/gcp-service-account)$/i, action: 'Bind workloads to scoped cloud identities. Use the selected cloud’s federation mechanism with the existing service accounts.' },
  { id: 'secret-store', name: 'External secret-store delivery', kinds: /^(SecretProviderClass|SecretStore|ClusterSecretStore|ExternalSecret)$/, keys: /(?:keyVaultName|vaultUrl|secretStoreRef\.name)$/i, action: 'Complete the cloud secret-store → workload delivery path for the existing secret names and keys; retain an existing supplier when one is declared.' },
  { id: 'edge-protection', name: 'Public entry protection', kinds: /(?:WAF|WebACL|SecurityPolicy|frontdoor|firewallpolicies)/i, keys: /(?:waf|webApplicationFirewall|cloudArmor)\.enabled$/i, action: 'Protect the existing public ingress with the selected cloud’s WAF and restrict direct origin access.' },
  { id: 'backups', name: 'Backup and recovery', kinds: /^(Backup|Schedule|BackupPolicy)$/, keys: /(?:backup\.enabled|backupRetentionDays|retentionInDays|backup\.barmanObjectStore)/i, action: 'Define backup retention, recovery objectives and a restore test through the existing database/storage owner.' },
  { id: 'telemetry', name: 'Telemetry', kinds: /^(ServiceMonitor|PodMonitor|OpenTelemetryCollector)$/, keys: /(?:otel|otelPythonInstrumentation|monitoring|prometheus|opentelemetry)\.(enabled|endpoint)$/i, action: 'Connect the application’s telemetry to the selected cloud’s monitoring service or retain its existing collector; add service health alerts.' },
] as const;

type Entry = { path: string; value: unknown };
function leaves(value: unknown, path = '', result: Entry[] = []): Entry[] {
  if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) leaves(child, path ? `${path}.${key}` : key, result);
  else result.push({ path, value });
  return result;
}
/** All relevant templates are reviewed, but an unrendered chart is never proof of enabled runtime resources. */
export function reviewDeploymentControls(graph: RepositoryArchitecture, unitIds: string[], environmentId?: string): ControlFinding[] {
  const environment = environmentId ?? selectedEnvironment(graph, unitIds)?.id;
  const selectedFiles = new Set(graph.deploymentUnits.filter(u => unitIds.includes(u.id)).flatMap(u => u.files));
  const context = graph.deploymentContext.filter(c => !fileEnvironment(c.file) || !environment || fileEnvironment(c.file) === environment);
  const matches = new Map<string, { file: string; status: ControlFinding['status'] }[]>();
  for (const file of context) {
    const isTemplate = file.content.includes('{{') || /\/templates\/|(?:^|\/)values[^/]*\.ya?ml$/.test(file.file);
    let entries: Entry[] = [];
    try { entries = leaves(JSON.parse(file.content)); } catch {
      try { entries = file.content.includes('{{') ? [] : parseAllDocuments(file.content).filter(d => !d.errors.length).flatMap(d => leaves(d.toJSON())); } catch { /* Unrendered templates remain conditional evidence. */ }
    }
    for (const spec of controlSpecs) {
      const keyMatches = entries.filter(e => spec.keys.test(e.path));
      const kindMatch = entries.some(e => /(?:^|\.)kind$/.test(e.path) && spec.kinds.test(String(e.value))) || (isTemplate && [...file.content.matchAll(/^\s*kind:\s*([\w.\/-]+)/gm)].some(m => spec.kinds.test(m[1])));
      const conditionalKey = isTemplate && file.content.split('\n').some(line => spec.keys.test(line.trim().replace(/:.*/, '')));
      if (!keyMatches.length && !kindMatch && !conditionalKey) continue;
      const positive = kindMatch || conditionalKey || keyMatches.some(e => e.value !== false && e.value !== null && e.value !== '' && e.value !== 0);
      const status: ControlFinding['status'] = !positive ? 'disabled' : isTemplate || !selectedFiles.has(file.file) ? 'available' : 'declared';
      matches.set(spec.id, [...(matches.get(spec.id) ?? []), { file: file.file, status }]);
    }
  }
  // Native IaC declarations count too; a matching source import or comment does not.
  const nativeTypes: Record<string, RegExp> = {
    'network-policy': /(?:kubernetes_network_policy|networkpolicies)/i,
    'edge-protection': /(?:frontdoor_firewall_policy|wafv2_web_acl|compute_security_policy|frontdoorwebapplicationfirewallpolicies)/i,
    identity: /(?:federated_identity_credential|workload_identity_pool|eks_pod_identity_association)/i,
    backups: /(?:backup_policy|backup_plan|recoveryservices\/vaults\/backuppolicies)/i,
    telemetry: /(?:monitor_diagnostic_setting|monitor_metric_alert|cloudwatch_metric_alarm|monitoring_alert_policy)/i,
  };
  for (const resource of graph.resources.filter(r => r.origin === 'declared')) {
    const files = graph.evidence.filter(e => resource.evidence.includes(e.id)).map(e => e.file).filter(f => context.some(c => c.file === f));
    for (const [id, pattern] of Object.entries(nativeTypes)) if (pattern.test(resource.technology)) for (const file of files) matches.set(id, [...(matches.get(id) ?? []), { file, status: selectedFiles.has(file) ? 'declared' : 'available' }]);
  }
  return controlSpecs.map(spec => {
    const found = matches.get(spec.id) ?? [];
    const status = found.some(f => f.status === 'declared') ? 'declared' : found.some(f => f.status === 'available') ? 'available' : found.length ? 'disabled' : 'missing';
    const files = [...new Set(found.map(f => f.file))];
    const action = status === 'declared' ? 'Retain the selected deployment’s existing implementation. Verify its runtime behavior during deployment validation.' : status === 'available' ? 'Reuse the implementation already in the repository. Confirm its selected values, release and deployment ownership before adding anything; template presence alone does not prove it is enabled.' : status === 'disabled' ? 'An existing configuration disables this control. Review whether it should be enabled in this environment; do not add a duplicate implementation.' : spec.action;
    return { id: spec.id, name: spec.name, status, action, files, evidenceIds: graph.evidence.filter(e => files.includes(e.file)).map(e => e.id) };
  });
}

/** Additional definitions inform recommendations without becoming duplicate deployed resources. */
export function relatedDeploymentContext(graph: RepositoryArchitecture, unitIds: string[], environmentId?: string) {
  const environment = environmentId ?? selectedEnvironment(graph, unitIds)?.id;
  return graph.deploymentContext.filter(c => !fileEnvironment(c.file) || !environment || fileEnvironment(c.file) === environment);
}
