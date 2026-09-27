import { dirname } from 'node:path';
import { parseAllDocuments } from 'yaml';
import type { Node as YAMLNode } from 'yaml';
import type { RepositoryArchitecture, ArchitectureResource, ResourceKind } from '../types/architecture';
import { hash, safeName, sensitiveKey, type RepoFile } from './files';
import { redactDeploymentObject } from './redaction';

type ObjectValue = Record<string, any>;
export const isCortexDefinition = (data: ObjectValue) => typeof data?.apiVersion === 'string' && data.apiVersion.startsWith('cortex.cortex.ai/') && ['ApplicationDefinition', 'CortexApp'].includes(data.kind);
const deploymentRoot = (path: string) => dirname(path).replace(/\/(?:definitions|instances)$/, '');

/** Read declared Cortex component/capability contracts, without executing the operator or claiming runtime state. */
export function appendCortexArchitecture(graph: RepositoryArchitecture, files: RepoFile[], classify: (type: string) => ResourceKind) {
  const documents = files.flatMap(file => parseAllDocuments(file.content).filter(d => !d.errors.length).map(doc => ({ file, doc, value: doc.toJS({ maxAliasCount: 50 }) as ObjectValue }))).filter(d => isCortexDefinition(d.value));
  type Declaration = typeof documents[number];
  const ref = (d: Declaration, path: Array<string | number>, summary: string) => {
    const node = d.doc.getIn(path, true) as YAMLNode | undefined;
    const line = d.file.content.slice(0, node?.range?.[0] ?? 0).split('\n').length;
    const endLine = d.file.content.slice(0, node?.range?.[1] ?? d.file.content.length).split('\n').length;
    const id = 'ev-' + hash(`${d.file.path}:${line}:${endLine}:${summary}`).slice(0, 16);
    if (!graph.evidence.some(e => e.id === id)) graph.evidence.push({ id, file: d.file.path, line, endLine, summary, kind: 'deployment' });
    return id;
  };
  const edge = (from: string, to: string, relationship: string, evidence: string[]) => {
    const id = 'edge-' + hash(`${from}:${to}:${relationship}`).slice(0, 16);
    const old = graph.connections.find(e => e.id === id);
    if (old) old.evidence = [...new Set([...old.evidence, ...evidence])]; else graph.connections.push({ id, from, to, relationship, evidence });
  };
  const finding = (scope: string, message: string, evidence: string[]) => graph.gaps.push({ id: 'gap-' + hash(scope + message).slice(0, 16), code: 'cortex-contract', scope, severity: 'warning', message, evidence });
  const definitions = documents.filter(d => d.value.kind === 'ApplicationDefinition');
  const instances = documents.filter(d => d.value.kind === 'CortexApp');
  const matched = new Set<Declaration>();
  const expand = (definition: Declaration, instance?: Declaration) => {
    const root = deploymentRoot((instance ?? definition).file.path);
    const appName = safeName(instance?.value.metadata?.name, safeName(definition.value.metadata?.name));
    const namespace = safeName(instance?.value.metadata?.namespace, '(deployment namespace)');
    const scope = `${root}::${namespace}:${appName}`;
    const prefix = `cortex:${scope}`;
    const ids: string[] = [];
    const add = (suffix: string, name: string, kind: ResourceKind, technology: string, evidence: string[], attributes: Record<string, string> = {}, origin: ArchitectureResource['origin'] = 'declared') => {
      const id = `${prefix}:${suffix}`;
      const old = graph.resources.find(r => r.id === id);
      if (old) old.evidence = [...new Set([...old.evidence, ...evidence])];
      else graph.resources.push({ id, name: safeName(name), kind, technology, scope, origin, evidence, attributes: { ...attributes, namespace, deploymentOwner: 'Cortex' } });
      if (!ids.includes(id)) ids.push(id);
      return id;
    };
    const substitutions: Record<string, string> = instance ? { CORTEX_APP_NAME: appName, CORTEX_NAMESPACE: namespace, CORTEX_TENANT: safeName(instance.value.spec?.tenant), ...(instance.value.spec?.domain ? { CORTEX_APP_DOMAIN: instance.value.spec.domain } : {}) } : {};
    const resolve = (value: unknown) => typeof value === 'string' ? value.replace(/\$\((\w+)\)/g, (token, name) => substitutions[name] ?? token) : '';
    const definitionRef = ref(definition, ['metadata'], `Cortex application definition ${definition.value.metadata?.name}`);
    const definitionId = add('definition', safeName(definition.value.metadata?.name), 'module', 'Cortex ApplicationDefinition', [definitionRef], { diagramRole: 'deployment-metadata' });
    const instanceRef = instance ? ref(instance, ['spec', 'definitionRef'], `CortexApp ${appName} references ${definition.value.metadata?.name} within ${root}`) : undefined;
    if (instance && instanceRef) {
      const instanceId = add('instance', appName, 'module', 'CortexApp instance', [instanceRef], { diagramRole: 'deployment-metadata', domain: safeName(instance.value.spec?.domain), tenant: safeName(instance.value.spec?.tenant) });
      edge(instanceId, definitionId, 'instantiates application definition', [instanceRef, definitionRef]);
    }
    const spec = definition.value.spec ?? {};
    const capabilities = new Map<string, string>();
    const components = new Map<string, string>();
    const secrets = new Map<string, string>();
    const configs = new Map<string, string>();
    for (const [i, capability] of (spec.capabilities ?? []).entries()) {
      const ev = ref(definition, ['spec', 'capabilities', i], `Declares Cortex capability ${capability.id} provided by ${capability.name}`);
      const overrides = instance?.value.spec?.capabilityProvisioningConfig?.[capability.id];
      const refs = overrides ? [ev, ref(instance!, ['spec', 'capabilityProvisioningConfig', capability.id], `Instance settings for capability ${capability.id}`)] : [ev];
      const kind = /app-config/.test(capability.name) ? 'configuration' : /service-bus/.test(capability.name) ? 'queue' : /storage-event-route/.test(capability.name) ? 'network' : /spicedb/.test(capability.name) ? 'identity' : classify(capability.name);
      const attributes = { capabilityId: safeName(capability.id), provider: safeName(capability.name), config: JSON.stringify(redactDeploymentObject(capability.config ?? {})), ...(overrides ? { instanceOverrides: JSON.stringify(redactDeploymentObject(overrides)) } : {}) };
      const id = add(`capability:${capability.id}`, capability.id, kind === 'unknown' ? 'service' : kind, `${safeName(capability.name)} (Cortex capability)`, refs, attributes);
      capabilities.set(capability.id, id); edge(definitionId, id, 'declares capability', [ev]);
    }
    // Resolve queue destinations by an exact declared queue name, within this instance only.
    for (const [i, capability] of (spec.capabilities ?? []).entries()) {
      const queue = capability.config?.serviceBusQueueName;
      if (!queue) continue;
      const matches = (spec.capabilities ?? []).filter((candidate: ObjectValue) => candidate.config?.queueNames?.some((name: string) => resolve(name) === resolve(queue)));
      if (matches.length === 1) edge(capabilities.get(capability.id)!, capabilities.get(matches[0].id)!, 'routes events to declared queue', [ref(definition, ['spec', 'capabilities', i, 'config', 'serviceBusQueueName'], 'Event route references a declared Service Bus queue')]);
    }
    for (const [i, component] of (spec.components ?? []).entries()) {
      const ev = ref(definition, ['spec', 'components', i], `Declares Cortex workload ${component.name}`);
      const overlay = instance?.value.spec?.componentConfig?.[component.name];
      const tag = instance?.value.spec?.componentImageTags?.[component.name];
      const refs = [ev, ...(overlay ? [ref(instance!, ['spec', 'componentConfig', component.name], `Instance configuration overlay for ${component.name}`)] : []), ...(tag ? [ref(instance!, ['spec', 'componentImageTags', component.name], `Instance image tag for ${component.name}`)] : [])];
      const id = add(`component:${component.name}`, component.name, 'application', 'Cortex container workload', refs, { image: safeName(component.image), ...(tag ? { imageTagOverride: safeName(String(tag)) } : {}), exposed: String(component.expose === true), containerPort: String(component.containerPort ?? ''), replicas: String(component.replicas ?? ''), runtime: safeName(component.runtime, 'container') });
      components.set(component.name, id); edge(definitionId, id, 'declares workload', [ev]);
    }
    for (const [i, config] of (spec.configMaps ?? []).entries()) {
      const name = resolve(config.name), ev = ref(definition, ['spec', 'configMaps', i], `Cortex-generated ConfigMap ${name}`);
      configs.set(name, add(`config:${name}`, name, 'configuration', 'Cortex-generated Kubernetes ConfigMap', [ev], { keys: Object.keys(config.data ?? {}).join(', ') }));
    }
    for (const [capabilityId, injection] of Object.entries<ObjectValue>(spec.secretInjection ?? {})) {
      const name = resolve(injection.secretName), ev = ref(definition, ['spec', 'secretInjection', capabilityId], `Capability ${capabilityId} delivers secret ${name}`);
      const id = add(`secret:${name}`, name, 'secret', 'Cortex capability connection Secret', [ev], { capabilityId });
      secrets.set(name, id);
      const cap = capabilities.get(capabilityId);
      if (cap) edge(cap, id, 'publishes capability connection secret', [ev]);
    }
    const binding = (consumerId: string, key: string, value: unknown, evidence: string[], sourceId?: string, sourceKey?: string, config = false) => {
      const id = `binding:${consumerId}:${key}`;
      const expression = typeof value === 'string' && /\$\(|\$\{|\{\{/.test(value);
      const old = graph.bindings.find(b => b.id === id);
      if (old) { old.evidence = [...new Set([...old.evidence, ...evidence])]; return; }
      const instanceResolved = expression && !!instance && !/\$\(|\$\{|\{\{/.test(resolve(value));
      const refs = instanceResolved ? [...evidence, ref(instance!, ['metadata'], 'Instance provides Cortex application name and namespace')] : evidence;
      graph.bindings.push({ id, consumerId, key, source: sourceId ? config ? 'config-map' : 'secret' : expression ? 'expression' : 'literal', sourceId, sourceKey, sensitive: sensitiveKey(key) || !!sourceId && !config, evidence: refs, resolved: sourceId ? graph.resources.find(r => r.id === sourceId)?.origin !== 'external' : !expression || !!instanceResolved });
      if (sourceId) edge(sourceId, consumerId, `supplies ${key}${sourceKey ? ` from key ${sourceKey}` : ''}`, evidence);
    };
    for (const [i, component] of (spec.components ?? []).entries()) {
      const id = components.get(component.name)!;
      const uses = component.uses ?? [];
      const env = new Map<string, { item: ObjectValue; evidence: string[] }>();
      for (const [j, item] of (component.env ?? []).entries()) env.set(item.name, { item, evidence: [ref(definition, ['spec', 'components', i, 'env', j], `${component.name} reads ${item.name}`)] });
      for (const [j, item] of (instance?.value.spec?.componentConfig?.[component.name]?.env ?? []).entries()) {
        env.set(item.name, { item, evidence: [...(env.get(item.name)?.evidence ?? []), ref(instance!, ['spec', 'componentConfig', component.name, 'env', j], `Instance overrides ${component.name}.${item.name}`)] });
      }
      for (const capabilityId of uses) {
        const cap = capabilities.get(capabilityId), ev = ref(definition, ['spec', 'components', i, 'uses'], `${component.name} uses capability ${capabilityId}`);
        if (!cap) { finding(scope, `Workload ${component.name} references undeclared capability ${capabilityId}.`, [ev]); continue; }
        edge(id, cap, `uses capability ${capabilityId}`, [ev]);
        const injection = spec.secretInjection?.[capabilityId];
        const secret = injection && secrets.get(resolve(injection.secretName));
        for (const item of injection?.env ?? []) if (secret && !env.has(item.name)) binding(id, item.name, undefined, [ev, ref(definition, ['spec', 'secretInjection', capabilityId], `Secret injection ${capabilityId}.${item.key} into ${item.name}`)], secret, item.key);
        if (!injection) finding(scope, `Capability ${capabilityId} is consumed by ${component.name}; its operator-provided connection variables are not declared in secretInjection. Preserve the Cortex provider contract and verify the external capability implementation.`, [ev]);
      }
      for (const [name, entry] of env) {
        const secretRef = entry.item.valueFrom?.secretKeyRef, configRef = entry.item.valueFrom?.configMapKeyRef;
        let sourceId: string | undefined;
        const sourceName = resolve(secretRef?.name ?? configRef?.name);
        if (secretRef || configRef) {
          sourceId = (secretRef ? secrets : configs).get(sourceName);
          if (!sourceId) {
            sourceId = add(`${secretRef ? 'secret' : 'config'}:${sourceName}`, sourceName, secretRef ? 'secret' : 'configuration', `Referenced Kubernetes ${secretRef ? 'Secret' : 'ConfigMap'}`, entry.evidence, {}, 'external');
            (secretRef ? secrets : configs).set(sourceName, sourceId);
            finding(scope, `Preserve external ${secretRef ? 'Secret' : 'ConfigMap'} ${sourceName}; its delivery source is not declared by this Cortex definition.`, entry.evidence);
          }
        }
        // Preserve an explicit reference to an injected variable, including connection templates.
        if (!sourceId && typeof entry.item.value === 'string') {
          for (const capabilityId of uses) {
            const injection = spec.secretInjection?.[capabilityId];
            const item = injection?.env?.find((e: ObjectValue) => entry.item.value.includes(`$(${e.name})`));
            if (item) { sourceId = secrets.get(resolve(injection.secretName)); break; }
          }
        }
        binding(id, name, entry.item.value, entry.evidence, sourceId, secretRef?.key ?? configRef?.key, !!configRef);
        try {
          const host = new URL(resolve(entry.item.value)).hostname;
          for (const [name, target] of components) if (host === `${appName}-${name}` || host === `${appName}-${name}.${namespace}.svc.cluster.local`) edge(id, target, `connects using ${entry.item.name}`, entry.evidence);
        } catch { /* Unresolved expressions are configuration evidence, not invented endpoints. */ }
      }
      for (const mount of component.volumeMounts ?? []) {
        const volume = (spec.volumes ?? []).find((v: ObjectValue) => v.name === mount.name);
        const configId = volume?.configMap && configs.get(resolve(volume.configMap.name));
        if (configId) edge(configId, id, `mounts configuration at ${safeName(mount.mountPath)}`, [ref(definition, ['spec', 'components', i, 'volumeMounts'], `${component.name} mounts ${mount.name}`)]);
      }
    }
    if (instance?.value.spec?.domain) {
      const ev = ref(instance, ['spec', 'domain'], `Declared Cortex ingress domain ${instance.value.spec.domain}`);
      const ingress = add('ingress', safeName(instance.value.spec.domain), 'network', 'Cortex ingress routing', [ev], { routingMode: safeName(instance.value.spec.routing?.mode) });
      for (const component of spec.components ?? []) if (component.expose === true) edge(ingress, components.get(component.name)!, 'routes HTTP to exposed component', [ev, ref(definition, ['spec', 'components', (spec.components ?? []).indexOf(component), 'expose'], `Exposes ${component.name}`)]);
    }
    const unitId = `cortex:${root}`;
    const old = graph.deploymentUnits.find(u => u.id === unitId);
    const unitFiles = [definition.file.path, ...(instance ? [instance.file.path] : [])];
    if (old) { old.resourceIds = [...new Set([...old.resourceIds, ...ids])]; old.files = [...new Set([...old.files, ...unitFiles])]; }
    else graph.deploymentUnits.push({ id: unitId, format: 'cortex', name: root, root, files: unitFiles, resourceIds: ids, exportFormats: [] });
  };
  for (const instance of instances) {
    const matches = definitions.filter(d => d.value.metadata?.name === instance.value.spec?.definitionRef?.name && deploymentRoot(d.file.path) === deploymentRoot(instance.file.path));
    if (matches.length === 1) { matched.add(matches[0]); expand(matches[0], instance); }
    else {
      const scope = deploymentRoot(instance.file.path), ev = ref(instance, ['spec', 'definitionRef'], 'Unresolved Cortex definition reference');
      const id = `cortex:${instance.file.path}:unresolved-instance`;
      graph.resources.push({ id, name: safeName(instance.value.metadata?.name), kind: 'module', technology: 'Unresolved CortexApp instance', scope, origin: 'declared', evidence: [ev], attributes: { definitionRef: safeName(instance.value.spec?.definitionRef?.name) } });
      graph.deploymentUnits.push({ id: `cortex:${scope}:unresolved`, format: 'cortex', name: scope, root: scope, files: [instance.file.path], resourceIds: [id], exportFormats: [] });
      finding(scope, `CortexApp ${instance.value.metadata?.name} has ${matches.length ? 'ambiguous' : 'unresolved'} definitionRef ${instance.value.spec?.definitionRef?.name} within this deployment directory.`, [ev]);
    }
  }
  for (const definition of definitions) if (!matched.has(definition)) expand(definition);
}
