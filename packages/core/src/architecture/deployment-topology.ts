import { cloudProfiles, reviewDeploymentControls, type ArchitectureCloud } from './experience';
import { parseAllDocuments } from 'yaml';
import type { ArchitectureResource, RepositoryArchitecture } from '../types/architecture';
import type { GroundedArchitecturePlan } from './planner';
import { terraformSizingResolver } from './terraform-sizing';

export type TopologyBasis = 'repository' | 'recommendation' | 'external' | 'user';
export interface DeploymentContainer {
  name: string; image: string; role: 'application' | 'init'; ports: number[];
  requests: Record<string, string>; limits: Record<string, string>;
  probes?: { readiness: boolean; liveness: boolean; startup: boolean; sameReadinessAndLiveness: boolean; slowStartup: boolean };
  runsMigration?: boolean;
  security?: { runAsNonRoot?: boolean; privileged?: boolean; allowPrivilegeEscalation?: boolean; readOnlyRootFilesystem?: boolean };
}
export interface DeploymentWorkload {
  id: string; name: string; controller: string; namespace: string; owner: string;
  replicas: number | null; replicaBasis: TopologyBasis; minReplicas?: number; maxReplicas?: number;
  containers: DeploymentContainer[]; exposed: boolean; servicePort?: number;
  resourceIds: string[]; evidenceIds: string[]; file: string; pointer: string;
  placement?: { topologySpread: boolean; antiAffinity: boolean };
  countNote?: string;
  jobParallelism?: number;
}
export interface DeploymentNode {
  id: string; name: string; kind: string; technology: string;
  layer: 'edge' | 'routing' | 'runtime' | 'data' | 'integration' | 'operations';
  basis: TopologyBasis; owner: string; details: string[]; resourceIds: string[]; evidenceIds: string[];
  workloadIds?: string[];
  pricing?: DeploymentPricing;
}
/** Public billing selectors only. Never copy a capability's connection/secret parameters into the browser. */
export interface DeploymentPricing {
  provider?: string; region?: string; sku?: string; computeType?: string; replicas?: number; partitions?: number;
  instances?: number; messagingUnits?: number; capacity?: number;
  models?: Array<{ name: string; sku?: string; version?: string }>;
}
export function deploymentPricing(provider: string | undefined, config: ObjectValue, params: ObjectValue): DeploymentPricing {
  const str = (v: unknown) => typeof v === 'string' && /^[a-zA-Z0-9_. -]{1,100}$/.test(v) ? v : undefined;
  const num = (v: unknown) => (typeof v === 'number' || typeof v === 'string' && /^\d+$/.test(v)) && Number.isSafeInteger(Number(v)) && Number(v) >= 0 ? Number(v) : undefined;
  const models = [
    ...(params.modelName ? [{ name: params.modelName, sku: params.modelSku, version: params.modelVersion }] : []),
    ...(params.embeddingModelName ? [{ name: params.embeddingModelName, sku: params.embeddingModelSku, version: params.embeddingModelVersion }] : []),
    ...(Array.isArray(config.additionalModels) ? config.additionalModels : []),
  ].filter(m => str(m?.name)).map(m => ({ name: str(m.name)!, sku: str(m.sku), version: str(m.version) }));
  return { provider: str(provider), region: str(params.location ?? params.region), sku: str(params.sku), computeType: str(params.computeType),
    replicas: num(params.replicaCount), partitions: num(params.partitionCount), instances: num(params.instances),
    messagingUnits: num(params.messagingUnits ?? params.messagingUnitCount), capacity: num(params.capacity),
    ...(models.length ? { models } : {}) };
}
export interface DeploymentControl {
  id: string; name: string; decision: 'retain' | 'add' | 'not-selected' | 'verify';
  recommendation: string; rationale: string; evidenceIds: string[];
}
export interface DeploymentTopology {
  version: 1; architectureId: string; planId?: string; unitIds: string[];
  owner: string; namespaces: string[]; workloads: DeploymentWorkload[];
  nodes: DeploymentNode[];
  connections: Array<{ id: string; from: string; to: string; purpose: string; basis: TopologyBasis; evidenceIds: string[] }>;
  controls: DeploymentControl[];
  totals: { workloads: number; applicationPods: number; unspecifiedWorkloads: number; applicationContainers: number; initContainers: number };
  limitations: string[];
}

export const isSteadyWorkload = (w: DeploymentWorkload) => !['Job', 'CronJob'].includes(w.controller);
export function deploymentTotals(workloads: DeploymentWorkload[]): DeploymentTopology['totals'] {
  const steady = workloads.filter(isSteadyWorkload);
  return { workloads: workloads.length, applicationPods: steady.reduce((n, w) => n + (w.replicas ?? 0), 0),
    unspecifiedWorkloads: steady.filter(w => w.replicas === null).length,
    applicationContainers: steady.reduce((n, w) => n + (w.replicas ?? 0) * w.containers.filter(c => c.role === 'application').length, 0),
    initContainers: workloads.reduce((n, w) => n + w.containers.filter(c => c.role === 'init').length, 0) };
}
export function deploymentCountSummary(topology: DeploymentTopology) {
  const steady = topology.workloads.filter(isSteadyWorkload), batch = topology.workloads.filter(w => !isSteadyWorkload(w));
  return { ...deploymentTotals(topology.workloads), steadyWorkloads: steady.length, batchJobs: batch.length,
    minPods: steady.reduce((sum, w) => sum + (w.minReplicas ?? w.replicas ?? 0), 0),
    maxPods: steady.reduce((sum, w) => sum + (w.maxReplicas ?? w.replicas ?? 0), 0),
    autoscaled: steady.some(w => w.maxReplicas !== undefined),
  };
}

type ObjectValue = Record<string, any>;
/** Parse only the immutable, already-redacted deployment snapshot. No current checkout or cloud defaults. */
export function deploymentDocuments(graph: RepositoryArchitecture, unitIds: string[]) {
  const files = new Set(graph.deploymentUnits.filter(u => unitIds.includes(u.id)).flatMap(u => u.files));
  return graph.deploymentContext.filter(c => files.has(c.file)).flatMap(c => {
    // A Go template is not a Kubernetes declaration. YAML can otherwise turn
    // {{ .Values.* }} into object keys and create misleading pseudo-resources.
    if (c.content.includes('{{')) { try { JSON.parse(c.content); } catch { return []; } }
    try { return parseAllDocuments(c.content).filter(d => !d.errors.length).flatMap(d => {
      const data = d.toJS({ maxAliasCount: 50 });
      const documents = Array.isArray(data) ? data : data?.kind === 'List' ? data.items : [data];
      return documents.filter((v: unknown) => v && typeof v === 'object').map((value: ObjectValue) => ({ file: c.file, value }));
    }); } catch { return []; }
  });
}
const count = (value: unknown) => typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
const port = (value: unknown) => typeof value === 'number' && value > 0 && value <= 65535 ? value : undefined;
const safeImage = (image: unknown) => typeof image === 'string' ? image : 'Image supplied by deployment owner';
const hasProbe = (probe: ObjectValue | undefined) => !!probe && ['httpGet','tcpSocket','exec','grpc'].some(key => probe[key] && typeof probe[key] === 'object');
const placement = (pod: ObjectValue) => ({ topologySpread: Array.isArray(pod.topologySpreadConstraints) && pod.topologySpreadConstraints.length > 0, antiAffinity: !!pod.affinity?.podAntiAffinity && Object.keys(pod.affinity.podAntiAffinity).length > 0 });
const container = (c: ObjectValue, role: DeploymentContainer['role']): DeploymentContainer => ({
  name: String(c.name ?? 'container'), image: safeImage(c.image), role,
  ports: (c.ports ?? []).map((p: ObjectValue) => port(p.containerPort)).filter((p: unknown): p is number => typeof p === 'number'),
  requests: c.resources?.requests ?? {}, limits: c.resources?.limits ?? {},
  probes: { readiness:hasProbe(c.readinessProbe), liveness:hasProbe(c.livenessProbe), startup:hasProbe(c.startupProbe), sameReadinessAndLiveness:hasProbe(c.readinessProbe) && hasProbe(c.livenessProbe) && ['httpGet','tcpSocket','exec','grpc'].every(key=>JSON.stringify(c.readinessProbe[key]) === JSON.stringify(c.livenessProbe[key])), slowStartup:Number(c.livenessProbe?.initialDelaySeconds ?? 0) >= 120 },
  runsMigration: /(?:alembic\s+upgrade|prisma\s+migrate|manage\.py\s+migrate|flyway\s+migrate|liquibase\s+update|db:migrate)/i.test([c.name,...(Array.isArray(c.command) ? c.command : []),...(Array.isArray(c.args) ? c.args : [])].join(' ')),
  security: Object.fromEntries(['runAsNonRoot','privileged','allowPrivilegeEscalation','readOnlyRootFilesystem'].filter(key=>typeof c.securityContext?.[key] === 'boolean').map(key=>[key,c.securityContext[key]])),
});
const taggedImage = (image: string, tag?: string) => !tag ? image : image.replace(/@sha256:[a-f\d]+$/i, '').replace(/:[^/:]+$/, '') + ':' + tag;

export function buildDeploymentTopology(graph: RepositoryArchitecture, unitIds: string[], plan?: GroundedArchitecturePlan, cloudProvider: ArchitectureCloud = plan?.provider ?? 'azure', environment?: string): DeploymentTopology {
  const cloud = cloudProfiles[cloudProvider];
  const audit = reviewDeploymentControls(graph, unitIds, environment);
  const units = graph.deploymentUnits.filter(u => unitIds.includes(u.id));
  const ids = new Set(units.flatMap(u => u.resourceIds));
  let expanded = true;
  while (expanded) { expanded = false; for (const edge of graph.connections) if (ids.has(edge.from) && !ids.has(edge.to)) { ids.add(edge.to); expanded = true; } }
  const resources = graph.resources.filter(r => ids.has(r.id));
  const resolveSizing = terraformSizingResolver(graph);
  const documents = deploymentDocuments(graph, unitIds);
  const workloads: DeploymentWorkload[] = [];
  const nodes: DeploymentNode[] = [];
  const controls: DeploymentControl[] = [];
  const limitations = ['Counts describe the selected deployment declarations, not live cluster state. Platform controllers, capability-created pods, rollout surge and injected sidecars are excluded unless explicitly declared.'];
  if (graph.deploymentPreparation?.previewOnly) limitations.push('Helm previews use explicit unresolved-input markers for tenant identity, namespace and infrastructure outputs. Replica counts and container settings come from the selected chart/value layers. Supply real operator inputs and render again before deployment.');
  const roots = (file: string) => units.filter(u => u.files.includes(file)).map(u => u.id);
  const refs = (r?: ArchitectureResource) => r?.evidence ?? [];
  for (const doc of documents) {
    const value = doc.value;
    if (value.kind === 'ApplicationDefinition' && /^cortex\.cortex\.ai\//.test(value.apiVersion ?? '')) {
      const instances = documents.filter(d => d.value.kind === 'CortexApp' && d.value.spec?.definitionRef?.name === value.metadata?.name && roots(doc.file).some(id => roots(d.file).includes(id)));
      // Ambiguous or unmatched instances are findings, not invented namespaces or pod placements.
      for (const instance of instances) for (const [index, c] of (value.spec?.components ?? []).entries()) {
        const namespace = instance.value.metadata?.namespace ?? '(namespace not declared)';
        const app = instance.value.metadata?.name;
        const resource = resources.find(r => r.attributes.deploymentOwner === 'Cortex' && r.scope.endsWith(`::${namespace}:${app}`) && r.id.endsWith(`:component:${c.name}`));
        if (!resource) continue;
        const overlay = instance.value.spec?.componentConfig?.[c.name] ?? {};
        const effective = { ...c, ...overlay };
        const replicas = count(effective.replicas);
        const appContainer = container({ ...effective, image: taggedImage(safeImage(effective.image), instance.value.spec?.componentImageTags?.[c.name]), ports: port(effective.containerPort) ? [{ containerPort: effective.containerPort }] : [] }, 'application');
        workloads.push({ id: resource.id, name: `${app}-${c.name}`, controller: 'Cortex component → Deployment', namespace, owner: 'Cortex operator', replicas, replicaBasis: 'repository', containers: [appContainer, ...(effective.initContainers ?? []).map((i: ObjectValue) => container(i, 'init'))], exposed: effective.expose === true, servicePort: port(effective.servicePort), resourceIds: [resource.id], evidenceIds: refs(resource), file: doc.file, pointer: `/spec/components/${index}`, placement:placement(effective) });
      }
    }
    if (['Deployment', 'StatefulSet', 'DaemonSet', 'Pod', 'Job', 'CronJob'].includes(value.kind)) {
      const resource = resources.find(r => r.origin === 'declared' && r.name === value.metadata?.name && r.technology.endsWith('/' + value.kind) && r.evidence.some(id => graph.evidence.some(e => e.id === id && e.file === doc.file)));
      if (!resource) continue;
      const pod = value.kind === 'Pod' ? value.spec : value.kind === 'CronJob' ? value.spec?.jobTemplate?.spec?.template?.spec : value.spec?.template?.spec;
      const hpa = documents.find(d => d.value.kind === 'HorizontalPodAutoscaler' && d.value.metadata?.namespace === value.metadata?.namespace && d.value.spec?.scaleTargetRef?.name === value.metadata?.name && d.value.spec?.scaleTargetRef?.kind === value.kind)?.value;
      const batch = ['Job', 'CronJob'].includes(value.kind), daemon = value.kind === 'DaemonSet';
      const defaulted = ['Deployment', 'StatefulSet'].includes(value.kind) && value.spec?.replicas === undefined;
      const replicas = value.kind === 'Pod' ? 1 : batch || daemon ? null : defaulted ? 1 : count(value.spec?.replicas);
      workloads.push({ id: resource.id, name: resource.name, controller: value.kind, namespace: value.metadata?.namespace ?? '(namespace from apply context)', owner: 'Kubernetes manifests', replicas, replicaBasis: 'repository',
        countNote: batch ? 'Batch execution; excluded from steady-state pods' : daemon ? 'One pod per eligible node; node count is required' : defaulted ? 'Kubernetes default: replicas omitted' : hpa ? 'Initial replicas; autoscaler controls the running count' : 'Selected manifest replicas',
        ...(batch ? { jobParallelism: count((value.kind === 'CronJob' ? value.spec?.jobTemplate?.spec : value.spec)?.parallelism) ?? 1 } : {}),
        ...(hpa ? { minReplicas: count(hpa.spec?.minReplicas) ?? 1, maxReplicas: count(hpa.spec?.maxReplicas) ?? undefined } : {}), containers: [...(pod?.containers ?? []).map((c: ObjectValue) => container({ ...c, securityContext:{ ...pod?.securityContext, ...c.securityContext } }, 'application')), ...(pod?.initContainers ?? []).map((c: ObjectValue) => container({ ...c, securityContext:{ ...pod?.securityContext, ...c.securityContext } }, 'init'))], exposed: false, resourceIds: [resource.id], evidenceIds: refs(resource), file: doc.file, pointer: value.kind === 'Pod' ? '/spec' : value.kind === 'CronJob' ? '/spec/jobTemplate/spec/template/spec' : '/spec/template/spec', placement:placement(pod ?? {}) });
    }
  }
  const cortex = units.some(u => u.format === 'cortex');
  const owner = graph.deploymentTarget?.kind === 'cortex-platform' ? 'Current Cortex · ApplicationDeployment → Terraform + Argo CD / Helm'
    : cortex ? 'Cortex / Crossplane on the selected environment’s Kubernetes cluster' : units.map(u => u.format).join(' + ') || 'Target hosting must be selected';
  if (graph.deploymentTarget?.kind === 'cortex-platform') nodes.push({ id: 'existing-cortex-platform', name: 'Cortex cluster & controllers', kind: 'platform', technology: 'Kubernetes · Argo CD · Cortex tenant operator', layer: 'operations', basis: 'external', owner: 'Cortex platform owner', details: ['Existing deployment target', 'Cluster identity, tenant namespace and node-pool capacity require target inputs'], resourceIds: [], evidenceIds: workloads.flatMap(w => w.evidenceIds) });
  for (const workload of workloads) {
    if (graph.deploymentTarget?.kind === 'cortex-platform') workload.owner = 'Cortex tenant operator / Argo CD / Helm';
    nodes.push({ id: workload.id, name: workload.name, kind: 'application', technology: workload.controller, layer: 'runtime', basis: 'repository', owner: workload.owner, details: [`${workload.replicas ?? 'Unspecified'} pods`, `${workload.containers.filter(c => c.role === 'application').length} application container(s) per pod`, workload.namespace], resourceIds: workload.resourceIds, evidenceIds: workload.evidenceIds, workloadIds: [workload.id] });
  }
  for (const resource of resources) {
    if (workloads.some(w => w.resourceIds.includes(resource.id)) || resource.attributes.diagramRole === 'deployment-metadata' || resource.origin === 'code') continue;
    let config: ObjectValue = {}, overrides: ObjectValue = {};
    try { config = JSON.parse(resource.attributes.config ?? '{}'); overrides = JSON.parse(resource.attributes.instanceOverrides ?? '{}').params ?? {}; } catch { /* Only parsed facts are displayed. */ }
    const params = { ...config.defaultParams, ...overrides };
    const details: string[] = [];
    if (resource.attributes.sizing) {
      try { for (const [key, expression] of Object.entries(JSON.parse(resource.attributes.sizing))) {
        const { value, defaulted } = resolveSizing(resource, expression);
        const name = ['sku', 'sku_name'].includes(key) ? 'SKU' : key === 'storage_mb' ? 'Storage' : key.replaceAll('_', ' ');
        const display = key === 'storage_mb' && typeof value === 'number' ? `${value / 1024} GiB` : value;
        details.push(`${name}: ${display}${defaulted ? ' (default)' : ''}`);
      } } catch { /* Keep malformed metadata out of displayed facts. */ }
    }
    if (resource.attributes.cardinality) details.push(resource.attributes.cardinality);
    if (resource.attributes.highAvailability) details.push(resource.attributes.highAvailability);
    for (const [key, label] of [['sku', 'SKU'], ['replicaCount', 'Replicas'], ['partitionCount', 'Partitions'], ['instances', 'Instances']] as const) if (params[key] !== undefined) details.push(`${label}: ${params[key]}`);
    if (config.queueNames) details.push(`${config.queueNames.length} declared queues`);
    if (resource.attributes.provider === 'cortex-postgresql') {
      details.push('Cortex PostgreSQL provider; database pod count is not declared here');
      details.push('Proposed HA: 1 primary + 2 standbys; provider contract must implement this policy');
    }
    if (resource.attributes.provider === 'cortex-redis') details.push('Separate from the Azure cache capability; replica count is provider-owned');
    if (resource.kind === 'secret') details.push(resource.origin === 'external' ? 'Existing secret reference; supplying vault/identity must be verified' : 'Operator-produced connection Secret');
    if (/ingress/i.test(resource.technology)) for (const edge of graph.connections.filter(e => e.from === resource.id && /routes HTTP/.test(e.relationship))) {
      const target = workloads.find(w => w.id === edge.to);
      if (target) details.push(`Routes ${target.containers.find(c => c.role === 'application')?.name ?? target.name}${target.servicePort ? ` :${target.servicePort}` : ''}`);
    }
    const layer = /cdn_frontdoor|frontDoorWebApplicationFirewallPolicies/i.test(resource.technology) ? 'edge'
      : /ingress|\/(?:Service|HTTPRoute|Gateway)$/i.test(resource.technology) ? 'routing'
      : /^(?:azurerm_(?:kubernetes_cluster|container_registry|monitor_|log_analytics|application_insights|dashboard_grafana|private_|role_assignment|policy_|resource_group|subnet|route_table|network_security_group)|random_|time_|null_)/.test(resource.technology) ? 'operations'
      : ['database', 'cache', 'storage'].includes(resource.kind) ? 'data' : ['secret', 'configuration', 'vault', 'identity'].includes(resource.kind) ? 'operations' : resource.kind === 'application' ? 'runtime' : 'integration';
    nodes.push({ id: resource.id, name: resource.name, kind: resource.kind, technology: resource.technology, layer, basis: resource.origin === 'external' ? 'external' : 'repository', owner: resource.attributes.platformOwnership ?? resource.attributes.deploymentOwner ?? (resource.attributes.declaration ? 'Terraform / selected state owner' : 'Selected deployment definition'), details, resourceIds: [resource.id], evidenceIds: resource.evidence, pricing: deploymentPricing(resource.attributes.provider, config, params) });
  }
  const nodeIds = new Set(nodes.map(n => n.id));
  const connections: DeploymentTopology['connections'] = graph.connections.filter(e => nodeIds.has(e.from) && nodeIds.has(e.to)).map(e => ({ id: e.id, from: e.from, to: e.to, purpose: e.relationship, basis: 'repository', evidenceIds: e.evidence }));
  if (graph.deploymentTarget?.kind === 'cortex-platform') for (const w of workloads) connections.push({ id: `platform-host:${w.id}`, from: 'existing-cortex-platform', to: w.id, purpose: 'Hosts selected Helm workload; cluster capacity requires verification', basis: 'external', evidenceIds: w.evidenceIds });
  const ingress = nodes.filter(n => n.layer === 'routing' && /ingress/i.test(n.technology));
  if (cortex && workloads.length) {
    const ev = [...new Set(ingress.flatMap(n => n.evidenceIds))];
    nodes.push({ id: 'existing-cortex-platform', name: 'Cortex cluster & controllers', kind: 'platform', technology: 'Existing Kubernetes · Cortex · Crossplane', layer: 'operations', basis: 'external', owner: 'Environment platform owner', details: ['Cluster identity and node pools are platform inputs', 'Operator and capability versions must be verified'], resourceIds: [], evidenceIds: workloads.flatMap(w => w.evidenceIds) });
    controls.push({ id: 'placement', name: 'Pod placement', decision: 'retain', recommendation: 'Keep each declared Cortex component in its own Deployment. Retain its application container and init containers in the same pod template; do not combine independent services into one pod.', rationale: 'The selected ApplicationDefinition declares independent components with separate images, ports, replicas and capability dependencies. No shared application pod is declared.', evidenceIds: workloads.flatMap(w => w.evidenceIds) });
    controls.push({ id: 'cluster', name: 'Cluster and node pools', decision: 'verify', recommendation: 'Reuse the environment’s Cortex cluster and existing operator/Crossplane installation. Supply the cluster identity, ingress endpoint, node-pool capacity and capability-provider versions before rollout.', rationale: 'The application contract owns application components and capabilities; it does not provision an AKS cluster, node pools or the Cortex platform.', evidenceIds: workloads.flatMap(w => w.evidenceIds) });
    controls.push({ id: 'api-gateway', name: 'API gateway', decision: 'retain', recommendation: 'Use the declared tenant ingress to route frontend traffic and the BFF API/WebSocket endpoints. Keep the LLM gateway as a separate internal service. No additional Azure API Management instance is selected.', rationale: 'Ingress and BFF routing are declared. A separate APIM service would add another gateway without an evidenced requirement for API subscriptions, policies or developer publishing.', evidenceIds: ev });
    controls.push({ id: 'database-ha', name: 'Database replicas and recovery', decision: 'verify', recommendation: 'Recommend three PostgreSQL instances (one primary and two standbys), cross-node placement and tested backup/restore. Bind that policy through the actual Cortex PostgreSQL capability contract before rollout.', rationale: 'The main database capability is declared, but its implementation, instance count, backup location and RPO/RTO are not specified in these application manifests. This is proposed sizing, not an observed replica count or an Azure Flexible Server migration.', evidenceIds: nodes.filter(n => /cortex-postgresql/.test(n.technology)).flatMap(n => n.evidenceIds) });
    controls.push({ id: 'firewall', name: 'Network firewall', decision: 'verify', recommendation: 'Retain the cluster’s existing egress controls and add workload-level allow-list network policies after resolving capability endpoints, DNS and identity flows. Add a dedicated Azure Firewall only when the platform requires central outbound inspection.', rationale: 'A Web Application Firewall protects HTTP entry traffic; it does not define pod egress. The selected application files do not establish an Azure Firewall, VNet routes or a private ingress endpoint.', evidenceIds: ev });
    if (ingress.length && !audit.some(c => c.id === 'edge-protection' && c.status !== 'missing')) {
      const id = 'target-edge-waf';
      nodes.push({ id, name: cloud.edge, kind: 'network', technology: cloud.edge, layer: 'edge', basis: 'recommendation', owner: cloudProvider === 'azure' ? 'Terraform / Bicep' : 'Native cloud infrastructure proposal', details: ['HTTPS entry and WAF policy', 'Origin endpoint and DNS are deployment inputs', 'Restrict ingress to this Front Door'], resourceIds: [], evidenceIds: ev });
      for (const target of ingress) connections.push({ id: `${id}:${target.id}`, from: id, to: target.id, purpose: 'HTTPS · protected origin', basis: 'recommendation', evidenceIds: ev });
      controls.push({ id: 'edge-waf', name: cloud.edge, decision: 'add', recommendation: 'Place Azure Front Door Premium with WAF before the existing tenant ingress. Validate the ingress origin hostname, TLS, forwarded host, WebSockets and origin access restrictions before changing DNS.', rationale: 'The repository exposes a public application domain and BFF. This adds edge protection without changing application pod ownership; it is a recommendation, not a discovered Azure resource.', evidenceIds: ev });
    }
    const appSecrets = nodes.filter(n => n.kind === 'secret' && n.basis === 'external' && /app-secrets$/.test(n.name));
    if (appSecrets.length && !audit.some(c => c.id === 'secret-store' && c.status !== 'missing')) {
      nodes.push({ id: 'target-vault', name: cloud.vault, kind: 'vault', technology: `${cloud.vault} · External Secrets Operator`, layer: 'operations', basis: 'recommendation', owner: cloudProvider === 'azure' ? 'Terraform / Bicep + secret controller' : 'Native cloud infrastructure proposal + secret controller', details: ['Private endpoint + existing private DNS zone', 'Federated workload identity + scoped RBAC', 'Existing Kubernetes Secret names retained'], resourceIds: [], evidenceIds: appSecrets.flatMap(s => s.evidenceIds) });
      for (const secret of appSecrets) connections.push({ id: `target-vault:${secret.id}`, from: 'target-vault', to: secret.id, purpose: 'Secret sync through platform identity', basis: 'recommendation', evidenceIds: secret.evidenceIds });
      controls.push({ id: 'key-vault', name: `${cloud.vault} and secret delivery`, decision: 'add', recommendation: 'Back the declared application Secret with a private Key Vault. Recommend External Secrets Operator with a dedicated federated workload identity and scoped secret-read permission. The bundle includes the vault, private endpoint, RBAC, federation, SecretStore and ExternalSecret mappings. Validate/install the controller and review existing secret ownership before rollout.', rationale: 'The app declares Secret names and keys, but the provider and cloud identity are outside the selected application files. Private DNS/subnet identifiers and the cluster OIDC issuer are required deployment inputs.', evidenceIds: appSecrets.flatMap(s => s.evidenceIds) });
    }
  }
  // Preserve reviewed additions for other deployment owners; never turn every source observation into a pod.
  for (const component of plan?.components ?? []) if (component.basis === 'recommendation' && component.deployment !== 'repository-only' && !component.resourceIds.some(id => ids.has(id))) {
    if (nodes.some(n => n.id === component.id || (n.kind === component.kind && n.technology === component.technology))) continue;
    if (/front.?door|cloudfront|cloud armor/i.test(component.technology) && nodes.some(n => n.id === 'target-edge-waf')) continue;
    if (/key.?vault|secrets? manager/i.test(component.technology) && (nodes.some(n => n.id === 'target-vault') || audit.some(c => c.id === 'secret-store' && c.status !== 'missing'))) continue;
    nodes.push({ id: component.id, name: component.name, kind: component.kind, technology: component.technology, layer: component.kind === 'application' ? 'runtime' : ['database', 'cache', 'storage'].includes(component.kind) ? 'data' : component.kind === 'network' ? 'routing' : 'operations', basis: 'recommendation', owner: component.deployment === 'external' ? 'External owner' : 'Selected target design', details: [component.rationale], resourceIds: [], evidenceIds: component.evidenceIds });
  }
  for (const control of controls) {
    if (control.id === 'firewall') { const existing = audit.find(c => c.id === 'network-policy'); if (existing && existing.status !== 'missing') { control.recommendation = existing.action; control.rationale = `Existing network-policy evidence: ${existing.files.join(', ')}`; control.evidenceIds = existing.evidenceIds; } }
    if (cloudProvider !== 'azure') {
      control.recommendation = control.recommendation.replaceAll('Azure Front Door Premium', cloud.edge).replaceAll('Azure API Management', cloud.gateway).replaceAll('Azure Firewall', cloud.firewall).replaceAll('Key Vault', cloud.vault).replaceAll('Front Door', cloud.edge);
      if (control.id === 'key-vault') control.recommendation = `Use ${cloud.vault} with ${cloud.identity} to deliver the declared secret keys through the existing secret controller. Implement and validate this cloud-specific provider contract before rollout.`;
    }
  }
  if (cloudProvider !== 'azure' && resources.some(r => /azure|azurerm|Microsoft\./i.test(r.technology + JSON.stringify(r.attributes)))) limitations.push(`The repository has Azure-specific resources or provider contracts. ${cloud.name} is the proposed target; existing Azure dependencies remain explicit until compatible replacements and application changes are implemented.`);
  if (cortex) limitations.push('Cortex capability providers may create additional database, Redis, SpiceDB and control-plane pods. Their versions and sizing contracts must be verified; the application replica total is not the whole cluster total.');
  if (!workloads.length) limitations.push('No supported pod template is declared in this scope. Container/pod placement and replica counts must be supplied by the selected hosting design; source modules are not automatically separate workloads.');
  return { version: 1, architectureId: graph.id, planId: plan?.id, unitIds, owner, namespaces: [...new Set(workloads.map(w => w.namespace))], workloads, nodes, connections, controls,
    totals: deploymentTotals(workloads), limitations };
}
