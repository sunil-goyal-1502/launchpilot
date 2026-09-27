import type { RepositoryArchitecture } from '../types/architecture';
import type { ArchitectureDesign, DesignIssue } from './design';
import { buildDeploymentTopology, deploymentDocuments, type DeploymentTopology } from './deployment-topology';

type Obj = Record<string, any>;
/** Compile user intent onto copies of the exact Cortex contracts. Never rewrite source evidence. */
export function compileCortexDesign(graph: RepositoryArchitecture, design: ArchitectureDesign, topology: DeploymentTopology) {
  const documents = deploymentDocuments(graph, design.unitIds).filter(d => ['ApplicationDefinition', 'CortexApp'].includes(d.value.kind));
  const issues: DesignIssue[] = [];
  const instances = documents.filter(d => d.value.kind === 'CortexApp');
  const instance = instances[0]?.value;
  const definition = documents.find(d => d.value.kind === 'ApplicationDefinition' && d.value.metadata?.name === instance?.spec?.definitionRef?.name)?.value;
  const blocker = (id: string, message: string) => issues.push({ id: `export:${id}`, severity: 'blocker', message });
  if (instances.length !== 1 || !definition) {
    if (design.edits.length) blocker('scope', 'Select one resolved Cortex application instance to export architecture changes.');
    return { documents, issues, removedResourceIds: [] as string[], configurationChanges: [] as Obj[] };
  }
  const base = buildDeploymentTopology(graph, design.unitIds);
  const spec = definition.spec, config = instance.spec;
  const names = new Map(base.workloads.map(w => [w.id, w.containers.find(c => c.role === 'application')!.name]));
  const capabilities = new Map(base.nodes.flatMap(n => {
    const resource = graph.resources.find(r => n.resourceIds.includes(r.id) && r.attributes.capabilityId && r.attributes.provider);
    return resource ? [[n.id, resource.attributes.capabilityId] as const] : [];
  }));
  const nodeExists = (id: string) => topology.nodes.some(n => n.id === id);
  const component = (id: string) => spec.components.find((c: Obj) => c.name === names.get(id)) as Obj | undefined;
  const overlay = (id: string) => config.componentConfig?.[names.get(id)!] as Obj | undefined;
  const configurationChanges: Obj[] = [];
  const setEnv = (id: string, key: string, value?: string) => {
    const c = component(id); if (!c) return;
    c.env = (c.env ?? []).filter((e: Obj) => e.name !== key);
    const o = overlay(id); if (o?.env) o.env = o.env.filter((e: Obj) => e.name !== key);
    if (value !== undefined) c.env.push({ name: key, value });
    configurationChanges.push({ consumerId: id, name: key, action: value === undefined ? 'removed by user' : 'set by user', ...(value === undefined ? {} : { value }) });
  };
  // Add/modify workload templates first so new connections can reference them.
  for (const edit of design.edits) {
    if (edit.type === 'add-component' && edit.capability && nodeExists(edit.id)) {
      const source = graph.resources.find(r => r.id === edit.capability!.templateResourceId)!;
      const cap = edit.capability;
      capabilities.set(edit.id, cap.capabilityId);
      spec.capabilities ??= [];
      spec.capabilities.push({ id: cap.capabilityId, name: source.attributes.provider, config: structuredClone(cap.config) });
      config.capabilityProvisioningConfig ??= {};
      config.capabilityProvisioningConfig[cap.capabilityId] = { params: structuredClone(cap.parameters) };
      issues.push({ id: `contract:${edit.id}`, severity: 'warning', componentId: edit.id, message: `${cap.capabilityId} uses the repository’s ${source.attributes.provider} provider contract. Verify unique resource names, provider outputs and connection-secret injection before rollout.` });
    }
    if (edit.type === 'add-component' && edit.workload && nodeExists(edit.id)) {
      const w = edit.workload;
      names.set(edit.id, w.componentName);
      spec.components.push({ name: w.componentName, image: w.image, replicas: w.replicas, containerPort: w.port, servicePort: w.port, expose: w.exposed, uses: [], env: [] });
    }
    if (edit.type === 'update-component' && nodeExists(edit.id)) {
      const c = component(edit.id); if (!c) continue;
      if (edit.replicas !== undefined) { c.replicas = edit.replicas; if (overlay(edit.id)) delete overlay(edit.id)!.replicas; }
      if (edit.image !== undefined) { c.image = edit.image; if (overlay(edit.id)) delete overlay(edit.id)!.image; if (config.componentImageTags) delete config.componentImageTags[c.name]; }
    }
  }
  const removedResourceIds: string[] = [];
  for (const node of base.nodes.filter(n => !nodeExists(n.id))) {
    removedResourceIds.push(...node.resourceIds);
    const name = names.get(node.id), cap = capabilities.get(node.id);
    if (name) {
      spec.components = spec.components.filter((c: Obj) => c.name !== name);
      for (const key of ['componentConfig', 'componentImageTags']) if (config[key]) delete config[key][name];
    } else if (cap) {
      spec.capabilities = (spec.capabilities ?? []).filter((c: Obj) => c.id !== cap);
      if (spec.secretInjection) delete spec.secretInjection[cap];
      if (config.capabilityProvisioningConfig) delete config.capabilityProvisioningConfig[cap];
      for (const c of spec.components) {
        c.uses = (c.uses ?? []).filter((id: string) => id !== cap);
        if (config.componentConfig?.[c.name]?.uses) config.componentConfig[c.name].uses = config.componentConfig[c.name].uses.filter((id: string) => id !== cap);
      }
    } else if (!['target-edge-waf', 'target-vault'].includes(node.id)) {
      blocker(node.id, `Removing ${node.name} needs changes to its configuration, routing or platform owner. Restore it or supply an implemented replacement before infrastructure export.`);
    }
  }
  const latest = new Map<string, Extract<ArchitectureDesign['edits'][number], {type:'put-connection'}>['connection']>();
  for (const edit of design.edits) if (edit.type === 'put-connection') latest.set(edit.connection.id, edit.connection);
  const changed = base.connections.filter(e => !topology.connections.some(t => t.id === e.id && t.basis !== 'user'));
  const priorUrls = new Map<string, string>();
  for (const e of changed) {
    const c = component(e.from), key = e.purpose.match(/^connects using (\w+)/)?.[1];
    if (key && c) {
      const previous = [...(c.env ?? []), ...(overlay(e.from)?.env ?? [])].filter((v: Obj) => v.name === key).at(-1)?.value;
      if (typeof previous === 'string') priorUrls.set(e.id, previous);
      setEnv(e.from, key);
    } else if (e.purpose.startsWith('uses capability ') && c) {
      const cap = capabilities.get(e.to);
      c.uses = (c.uses ?? []).filter((v: string) => v !== cap);
      if (overlay(e.from)?.uses) overlay(e.from)!.uses = overlay(e.from)!.uses.filter((v: string) => v !== cap);
    } else if (/routes HTTP to exposed component/.test(e.purpose) && names.has(e.to)) {
      const target = component(e.to); if (target) { target.expose = false; if (overlay(e.to)) delete overlay(e.to)!.expose; }
    } else if (nodeExists(e.from) && nodeExists(e.to) && e.basis === 'repository') {
      blocker(e.id, `Changing “${e.purpose}” requires an explicit configuration or platform implementation. The existing connection will not be silently exported.`);
    }
  }
  for (const e of latest.values()) {
    if (!topology.connections.some(t => t.id === e.id)) continue;
    if (e.binding.type === 'environment') {
      const from = component(e.from), to = component(e.to), target = topology.workloads.find(w => w.id === e.to);
      const targetPort = e.binding.port ?? target?.servicePort ?? target?.containers.find(c => c.role === 'application')?.ports[0];
      if (!from || !to || !targetPort) { blocker(e.id, `“${e.purpose}” needs two workload endpoints and an explicit destination port for its URL binding.`); continue; }
      let suffix = '';
      try { const old = new URL(priorUrls.get(e.id) ?? ''); suffix = (old.pathname === '/' ? '' : old.pathname) + old.search + old.hash; } catch { /* A new connection has no existing path. */ }
      setEnv(e.from, e.binding.key!, `${e.binding.protocol ?? 'http'}://$(CORTEX_APP_NAME)-${to.name}:${targetPort}${suffix}`);
    } else if (e.binding.type === 'capability') {
      const c = component(e.from), cap = capabilities.get(e.to);
      if (!c || !cap || !(spec.capabilities ?? []).some((v: Obj) => v.id === cap)) { blocker(e.id, `“${e.purpose}” must connect a workload to a declared Cortex capability.`); continue; }
      c.uses = [...new Set([...(c.uses ?? []), cap])];
      if (overlay(e.from)?.uses) overlay(e.from)!.uses = [...new Set([...overlay(e.from)!.uses, cap])];
    } else if (base.connections.some(b => b.id === e.id && b.basis === 'repository')) {
      blocker(e.id, `“${e.purpose}” replaces a runtime connection. Select a runtime binding so its configuration can be exported.`);
    }
  }
  // Edge and vault connectors configure real resources, so require their reviewed endpoint contract.
  for (const id of ['target-edge-waf', 'target-vault']) if (nodeExists(id)) {
    const before = base.connections.filter(e => e.from === id || e.to === id);
    if (before.some(e => !topology.connections.some(t => t.id === e.id && t.from === e.from && t.to === e.to && t.basis !== 'user')) || topology.connections.some(e => e.basis === 'user' && (e.from === id || e.to === id))) blocker(id, `The ${id === 'target-vault' ? 'vault secret delivery' : 'Front Door origin'} connection was changed. Its controller/origin mapping needs implementation before export.`);
  }
  for (const workload of topology.workloads) {
    const c = component(workload.id);
    if (c && c.expose !== workload.exposed) { c.expose = workload.exposed; if (overlay(workload.id)) delete overlay(workload.id)!.expose; }
  }
  return { documents, issues, removedResourceIds, configurationChanges };
}
