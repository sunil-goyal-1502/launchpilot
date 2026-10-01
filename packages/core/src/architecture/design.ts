import { z } from 'zod';
import type { RepositoryArchitecture } from '../types/architecture';
import type { GroundedArchitecturePlan } from './planner';
import { buildDeploymentTopology, deploymentPricing, deploymentTotals, type DeploymentTopology } from './deployment-topology';
import { compileCortexDesign } from './cortex-design';
import { deploymentEnvironments, environmentName, type ArchitectureCloud } from './experience';
import { compileNativeCortexEdits } from './cortex-native-design';

const identifier = z.string().min(1).max(600);
const label = z.string().trim().min(1).max(240);
export const componentKinds = ['application', 'database', 'cache', 'storage', 'queue', 'service', 'network', 'vault', 'identity', 'configuration', 'observability', 'platform', 'secret', 'streaming', 'module', 'unknown', 'custom'] as const;
const layer = z.enum(['edge', 'routing', 'runtime', 'data', 'integration', 'operations']);
const fields = z.object({ name: label, kind: z.enum(componentKinds), technology: label, layer, owner: label, description: z.string().max(4000) }).strict();
const workload = z.object({ componentName: z.string().regex(/^[a-z][a-z0-9-]{0,62}$/), image: z.string().min(1).max(500), replicas: z.number().int().min(0).max(1000), port: z.number().int().min(1).max(65535), exposed: z.boolean() }).strict();
const capability = z.object({ templateResourceId: identifier, capabilityId: z.string().regex(/^[a-z][a-z0-9-]{0,62}$/), config: z.record(z.unknown()), parameters: z.record(z.unknown()) }).strict();
const connection = z.object({ id: identifier, from: identifier, to: identifier, purpose: z.string().trim().min(1).max(1000), binding: z.object({ type: z.enum(['environment', 'capability', 'design']), key: z.string().max(200).optional(), protocol: z.enum(['http', 'https', 'tcp']).optional(), port: z.number().int().min(1).max(65535).optional() }).strict() }).strict();
export const designEditSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('add-component'), id: identifier, fields, workload: workload.optional(), capability: capability.optional() }).strict(),
  z.object({ type: z.literal('update-component'), id: identifier, fields: fields.partial(), replicas: z.number().int().min(0).max(1000).optional(), image: z.string().min(1).max(500).optional() }).strict(),
  z.object({ type: z.literal('remove-component'), id: identifier }).strict(),
  z.object({ type: z.literal('put-connection'), connection }).strict(),
  z.object({ type: z.literal('remove-connection'), id: identifier }).strict(),
]);
export type DesignEdit = z.infer<typeof designEditSchema>;
export interface ArchitectureDesign {
  version: 1; id: string; architectureId: string; unitIds: string[]; revision: number;
  proposalVersion?: 2; cloudProvider?: ArchitectureCloud; environment?: string; basePlanId?: string; edits: DesignEdit[]; createdAt: string; updatedAt: string;
}
export interface ArchitectureReviewJob {
  id: string; architectureId: string; unitIds: string[]; designId: string; cloudProvider?: ArchitectureCloud; environment?: string;
  status: 'queued' | 'running' | 'complete' | 'failed';
  step: string; completedCalls: number; reusedCalls: number; attempt: number;
  updatedAt: string; startedAt?: string; completedAt?: string; error?: string; planId?: string;
}
export interface DesignIssue { id: string; severity: 'warning' | 'blocker'; message: string; componentId?: string }

/** Environment selection is visible in the analysis form; never merge unrelated deployment roots. */
export function chooseDeploymentScope(graph: RepositoryArchitecture, environment = 'production') {
  const environments = deploymentEnvironments(graph);
  const target = environments.find(e => e.id === environmentName(environment)) ?? (environments.length === 1 ? environments[0] : undefined);
  if (target) return { unitIds: target.unitIds, environment: target.id, reason: `Selected ${target.label} from repository deployment definitions.`, requiresChoice: false };
  return { unitIds: [], reason: 'Choose one of the environments identified in the repository.', requiresChoice: true };
}

/** Replay user intent on an immutable evidence-backed baseline. Background model reviews never replace edits. */
export function materializeArchitectureDesign(graph: RepositoryArchitecture, design: ArchitectureDesign, plan?: GroundedArchitecturePlan): DeploymentTopology {
  if (design.architectureId !== graph.id || plan && ((plan.provider ?? 'azure') !== (design.cloudProvider ?? 'azure') || plan.architectureId !== graph.id || JSON.stringify([...plan.unitIds].sort()) !== JSON.stringify([...design.unitIds].sort()))) throw new Error('Design, evidence and recommendation scope do not match');
  const topology = buildDeploymentTopology(graph, design.unitIds, plan, design.cloudProvider ?? 'azure', design.environment);
  for (const raw of design.edits) {
    const edit = designEditSchema.parse(raw);
    if (edit.type === 'add-component') {
      if (topology.nodes.some(n => n.id === edit.id)) throw new Error('A component with that ID already exists');
      if (edit.fields.kind === 'application' && !edit.workload) throw new Error('Application components need an image, pod count and port');
      if (edit.capability) {
        const source = graph.resources.find(r => r.id === edit.capability!.templateResourceId);
        if (!source?.attributes.provider || !topology.unitIds.some(id => graph.deploymentUnits.find(u => u.id === id)?.resourceIds.includes(source.id))) throw new Error('Choose a capability contract from this deployment scope');
        if (topology.nodes.some(n => n.id.endsWith(`:capability:${edit.capability!.capabilityId}`) || n.name === edit.capability!.capabilityId) || design.edits.some(e => e.type === 'add-component' && e.capability?.capabilityId === edit.capability!.capabilityId && topology.nodes.some(n => n.id === e.id))) throw new Error('Use a unique capability ID');
        if (edit.workload) throw new Error('A component must be either a workload or a capability');
        if (/\[REDACTED/.test(JSON.stringify(edit.capability))) throw new Error('Capability configuration includes redacted values; use explicit external secret references');
      }
      topology.nodes.push({ ...edit.fields, id: edit.id, basis: 'user', details: [edit.fields.description], resourceIds: [], evidenceIds: [], ...(edit.workload ? { workloadIds: [edit.id] } : {}), ...(edit.capability ? { pricing: deploymentPricing(graph.resources.find(r => r.id === edit.capability!.templateResourceId)?.attributes.provider, edit.capability.config, { ...(edit.capability.config.defaultParams as object ?? {}), ...edit.capability.parameters }) } : {}) });
      if (edit.workload) {
        if (topology.workloads.some(w => w.containers.some(c => c.name === edit.workload!.componentName && c.role === 'application'))) throw new Error('Use a unique workload component name');
        topology.workloads.push({ id: edit.id, name: edit.fields.name, controller: 'User-proposed Cortex component', namespace: topology.namespaces.length === 1 ? topology.namespaces[0] : '(select target namespace)', owner: edit.fields.owner, replicas: edit.workload.replicas, replicaBasis: 'user', exposed: edit.workload.exposed, servicePort: edit.workload.port, containers: [{ name: edit.workload.componentName, image: edit.workload.image, role: 'application', ports: [edit.workload.port], requests: {}, limits: {} }], resourceIds: [], evidenceIds: [], file: 'user-design', pointer: edit.id });
        if (edit.workload.exposed) for (const ingress of topology.nodes.filter(n => /ingress/i.test(n.technology))) topology.connections.push({ id: `user-ingress:${edit.id}`, from: ingress.id, to: edit.id, purpose: 'routes HTTP to exposed component', basis: 'user', evidenceIds: [] });
      }
    } else if (edit.type === 'update-component') {
      const node = topology.nodes.find(n => n.id === edit.id);
      if (!node) throw new Error('The component no longer exists in this scope');
      const { description, ...values } = edit.fields;
      Object.assign(node, values, { basis: 'user' });
      if (description !== undefined) node.details = [description];
      const target = topology.workloads.find(w => w.id === edit.id);
      if ((edit.replicas !== undefined || edit.image !== undefined) && !target) throw new Error('Only a workload has pod replicas or a container image');
      if (target) {
        if (edit.fields.name) target.name = edit.fields.name;
        if (edit.replicas !== undefined) { target.replicas = edit.replicas; target.replicaBasis = 'user'; }
        if (edit.image) {
          if (target.containers.filter(c => c.role === 'application').length !== 1) throw new Error('This pod has multiple application containers. Select a container in its deployment manifest before changing images.');
          target.containers.filter(c => c.role === 'application').forEach(c => { c.image = edit.image!; });
        }
        node.details = [`${target.replicas ?? 'Unspecified'} proposed pods`, ...node.details.filter(d => !/pods$/.test(d))];
      }
    } else if (edit.type === 'remove-component') {
      if (!topology.nodes.some(n => n.id === edit.id)) throw new Error('The component no longer exists');
      topology.nodes = topology.nodes.filter(n => n.id !== edit.id);
      topology.workloads = topology.workloads.filter(w => w.id !== edit.id);
      topology.connections = topology.connections.filter(e => e.from !== edit.id && e.to !== edit.id);
    } else if (edit.type === 'put-connection') {
      const e = edit.connection;
      if (e.from === e.to || [e.from, e.to].some(id => !topology.nodes.some(n => n.id === id))) throw new Error('Connections require two distinct components in this design');
      if (e.binding.type === 'environment' && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(e.binding.key ?? '')) throw new Error('Environment connections require a valid configuration key');
      if (topology.connections.some(old => old.id !== e.id && old.from === e.from && old.to === e.to && old.purpose === e.purpose)) throw new Error('This connection already exists');
      topology.connections = topology.connections.filter(old => old.id !== e.id);
      topology.connections.push({ id: e.id, from: e.from, to: e.to, purpose: e.purpose, basis: 'user', evidenceIds: [] });
    } else {
      const removed = topology.connections.find(e => e.id === edit.id);
      if (!removed) throw new Error('The connection no longer exists');
      if (/routes HTTP to exposed component/.test(removed.purpose)) {
        const target = topology.workloads.find(w => w.id === removed.to); if (target) target.exposed = false;
      }
      topology.connections = topology.connections.filter(e => e.id !== edit.id);
    }
  }
  topology.totals = deploymentTotals(topology.workloads);
  for (const [id, controlId] of [['target-edge-waf', 'edge-waf'], ['target-vault', 'key-vault']]) if (!topology.nodes.some(n => n.id === id)) {
    const control = topology.controls.find(c => c.id === controlId);
    if (control) { control.decision = 'not-selected'; control.recommendation = 'Removed from the proposed architecture by the user. Confirm replacement protection and delivery with the platform owner.'; }
  }
  return topology;
}

export function inspectArchitectureDesign(graph: RepositoryArchitecture, design: ArchitectureDesign, plan?: GroundedArchitecturePlan): DesignIssue[] {
  const topology = materializeArchitectureDesign(graph, design, plan), issues: DesignIssue[] = [];
  if (graph.deploymentTarget?.kind === 'cortex-platform') issues.push(...compileNativeCortexEdits(graph, design, topology).issues);
  if ((design.cloudProvider ?? 'azure') !== 'azure') issues.push({ id: 'cloud-export', severity: 'blocker', message: 'Terraform/Bicep export validation currently supports Azure. This cloud proposal requires its native Terraform compiler; Bicep is Azure-only.' });
  const base = buildDeploymentTopology(graph, design.unitIds, plan, design.cloudProvider ?? 'azure', design.environment);
  for (const removed of base.nodes.filter(n => !topology.nodes.some(t => t.id === n.id))) {
    const affected = graph.bindings.filter(b => !!b.sourceId && removed.resourceIds.includes(b.sourceId) && topology.nodes.some(n => n.resourceIds.includes(b.consumerId)));
    if (affected.length) issues.push({ id: `removed-provider:${removed.id}`, severity: 'blocker', componentId: removed.id, message: `${removed.name} supplied ${affected.length} configuration binding(s) to retained components. Provide a replacement configuration source before infrastructure export.` });
    const capabilities = base.connections.filter(e => e.to === removed.id && /uses capability/.test(e.purpose) && topology.nodes.some(n => n.id === e.from));
    if (capabilities.length) issues.push({ id: `removed-capability:${removed.id}`, severity: 'warning', componentId: removed.id, message: `${removed.name} was used by ${capabilities.length} retained workload(s). Its removal changes their runtime dependencies; verify the replacement or application change.` });
  }
  for (const node of topology.nodes) if (node.basis === 'user' && !base.nodes.some(n => n.id === node.id) && node.kind !== 'application' && !design.edits.some(e => e.type === 'add-component' && e.id === node.id && e.capability) && !/external|existing/i.test(node.owner)) issues.push({ id: `implementation:${node.id}`, severity: 'blocker', componentId: node.id, message: `${node.name} is saved in the design and needs an infrastructure implementation before a deployable bundle can be generated. Choose a repository capability contract, or represent an existing/external dependency.` });
  for (const edit of design.edits) if (edit.type === 'put-connection' && edit.connection.binding.type === 'design' && topology.connections.some(e => e.id === edit.connection.id)) issues.push({ id: `connection:${edit.connection.id}`, severity: 'warning', message: `“${edit.connection.purpose}” records a design relationship. Select an environment-variable or capability binding if it must alter workload configuration.` });
  for (const node of topology.nodes) {
    const original = base.nodes.find(n => n.id === node.id);
    if (original && ['kind', 'technology', 'owner'].some(key => node[key as 'kind' | 'technology' | 'owner'] !== original[key as 'kind' | 'technology' | 'owner'])) issues.push({ id: `migration:${node.id}`, severity: 'blocker', componentId: node.id, message: `${node.name} changes an existing component’s type, technology or deployment owner. Add its replacement with a supported provider contract before exporting this migration.` });
  }
  const units = graph.deploymentUnits.filter(u => design.unitIds.includes(u.id));
  if (units.length && units.every(u => u.format === 'cortex')) {
    issues.push(...compileCortexDesign(graph, design, topology).issues);
    for (const node of topology.nodes.filter(n => n.basis === 'recommendation' && !['target-edge-waf', 'target-vault'].includes(n.id) && !/external/i.test(n.owner))) issues.push({ id: `implementation:${node.id}`, severity: 'blocker', componentId: node.id, message: `${node.name} needs a reviewed infrastructure implementation. Remove it or implement its provider contract before infrastructure export.` });
  } else if (design.edits.length && graph.deploymentTarget?.kind !== 'cortex-platform') issues.push({ id: 'export-owner', severity: 'blocker', message: 'This edited design is saved. Infrastructure export of edits currently supports Cortex deployment contracts; this deployment owner needs an edit compiler before Terraform/Bicep can represent these changes.' });
  return issues;
}
