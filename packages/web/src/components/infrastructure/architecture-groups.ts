import type { ArchitectureResource, ArchitectureConnection } from '@launchpilot/core';

export interface ResourceGroup extends ArchitectureResource { memberIds: string[]; facets: string[] }
export interface GroupConnection extends ArchitectureConnection { connectionIds: string[] }

export function connectionCategory(relationship: string) {
  if (/^declares |^instantiates |^platform \(|startup dependency|mounts storage/.test(relationship)) return 'platform';
  if (/^identity \(|uses identity|authenticates|grants|assigns/.test(relationship)) return 'identity';
  if (/^loads |^supplies |secret|mounts configuration/.test(relationship)) return 'configuration';
  return 'traffic';
}

/** Several env keys on one path are one connector; original connections remain inspectable. */
export function summarizeConnections(connections: GroupConnection[]) {
  const summarized = new Map<string, GroupConnection>();
  for (const edge of connections) {
    const category = connectionCategory(edge.relationship), signature = JSON.stringify([edge.from, edge.to, category]);
    const old = summarized.get(signature);
    if (old) {
      old.evidence = [...new Set([...old.evidence, ...edge.evidence])];
      old.connectionIds = [...new Set([...old.connectionIds, ...edge.connectionIds])];
      if (old.relationship !== edge.relationship) {
        const configVerb = /^(loads |reads |mounts secrets)/.test(old.relationship) ? 'loads' : 'supplies';
        const identityVerb = /^(uses identity|authenticates)/.test(old.relationship) ? 'uses identity' : 'identity';
        old.relationship = category === 'configuration' ? `${configVerb} configuration (${old.connectionIds.length} paths)` : category === 'traffic' ? `connects (${old.connectionIds.length} paths)` : `${category === 'identity' ? identityVerb : category} (${old.connectionIds.length} paths)`;
      }
    } else summarized.set(signature, { ...edge, evidence: [...edge.evidence], connectionIds: [...edge.connectionIds] });
  }
  return [...summarized.values()];
}

/** Overview categories are navigation groups, never claims that different resources are identical. */
export function overviewArchitecture(resources: ResourceGroup[], connections: GroupConnection[]) {
  const groups = new Map<string, ResourceGroup>(), owner = new Map<string, string>();
  for (const resource of resources) {
    if (resource.attributes.diagramRole === 'deployment-metadata') continue;
    const key = resource.kind === 'application' ? resource.attributes.exposed === 'true' ? 'exposed' : 'workloads'
      : ['database', 'cache', 'storage'].includes(resource.kind) ? 'data'
      : ['queue', 'streaming'].includes(resource.kind) || /storage-event-route/.test(resource.technology) ? 'messaging'
      : ['secret', 'configuration', 'vault'].includes(resource.kind) ? 'configuration'
      : resource.kind === 'identity' ? 'identity' : resource.kind === 'service' ? 'services' : resource.id;
    const names: Record<string, string> = { exposed: 'Exposed workloads', workloads: 'Internal workloads', data: 'Data stores', messaging: 'Messaging & events', configuration: 'Configuration & secrets', identity: 'Identity & authorization', services: 'AI & supporting services' };
    const kinds: Record<string, ArchitectureResource['kind']> = { data: 'database', messaging: 'queue', configuration: 'configuration' };
    const id = names[key] ? `overview:${resource.scope}:${key}` : resource.id;
    owner.set(resource.id, id);
    let group = groups.get(id);
    if (!group) {
      group = { ...resource, id, name: names[key] ?? resource.name, kind: kinds[key] ?? resource.kind, technology: names[key] ? 'Component group' : resource.technology, memberIds: [], evidence: [], facets: [], attributes: { ...resource.attributes, overview: 'true' } };
      groups.set(id, group);
    }
    group.memberIds.push(...resource.memberIds);
    group.evidence = [...new Set([...group.evidence, ...resource.evidence])];
    group.facets.push(resource.name);
  }
  for (const group of groups.values()) if (group.technology === 'Component group') {
    group.name += ` (${group.facets.length})`;
    group.technology = `${group.facets.length} components · select to explore`;
    group.attributes = { overview: 'true', components: group.facets.join(', ') };
  }
  const edges = connections.flatMap(edge => {
    const from = owner.get(edge.from), to = owner.get(edge.to);
    return from && to && from !== to ? [{ ...edge, from, to }] : [];
  });
  return { resources: [...groups.values()], connections: summarizeConnections(edges) };
}

/** Presentation aggregation only: the evidence graph and its resource identities stay intact. */
export function groupArchitectureResources(resources: ArchitectureResource[], allConnections: ArchitectureConnection[], combine = true) {
  const byId = new Map(resources.map(r => [r.id, r]));
  const owner = new Map(resources.map(r => [r.id, r.id]));
  const workload = (id: string) => byId.get(id)?.kind === 'application';
  const unique = (ids: string[]) => [...new Set(ids)];
  const root = (id: string) => owner.get(id) ?? id;
  const attach = (facet: ArchitectureResource, candidates: string[]) => {
    const owners = unique(candidates.map(root));
    if (owners.length === 1 && workload(owners[0]) && byId.get(owners[0])?.scope === facet.scope) owner.set(facet.id, owners[0]);
  };
  if (combine) {
    for (const r of resources.filter(r => /\/Service$/.test(r.technology))) {
      attach(r, allConnections.filter(e => e.from === r.id && e.relationship === 'selects pods by labels').map(e => e.to));
    }
    for (const r of resources.filter(r => /\/Ingress$/.test(r.technology))) {
      attach(r, allConnections.filter(e => e.from === r.id && e.relationship === 'routes HTTP to').map(e => e.to));
    }
    for (const r of resources.filter(r => /\/ServiceAccount$/.test(r.technology))) {
      attach(r, allConnections.filter(e => e.to === r.id && e.relationship === 'uses identity').map(e => e.from));
    }
    // Source code only joins a workload when the scanner proved its build-context ownership.
    for (const r of resources.filter(r => r.origin === 'code' && r.kind === 'application')) {
      const candidates = unique(allConnections.filter(e => e.to === r.id && /to code in build context$/.test(e.relationship)).map(e => root(e.from)));
      if (candidates.length === 1 && workload(candidates[0])) owner.set(r.id, candidates[0]);
    }
  }
  const groups = new Map<string, ResourceGroup>();
  for (const r of resources) {
    const id = root(r.id), primary = byId.get(id)!;
    let group = groups.get(id);
    if (!group) { group = { ...primary, evidence: [], memberIds: [], facets: [] }; groups.set(id, group); }
    group.memberIds.push(r.id); group.evidence = unique([...group.evidence, ...r.evidence]);
    const role = r.technology.split('/').at(-1)!;
    group.facets.push(/^(Ingress|Service|Deployment|StatefulSet|DaemonSet|ServiceAccount|Job|CronJob|Pod)$/.test(role) ? role : r.origin === 'code' ? r.name : r.technology);
  }
  const connections = new Map<string, GroupConnection>();
  const internalConnections: ArchitectureConnection[] = [];
  for (const edge of allConnections) {
    if (!byId.has(edge.from) || !byId.has(edge.to)) continue;
    const from = root(edge.from), to = root(edge.to);
    if (from === to) { internalConnections.push(edge); continue; }
    const signature = JSON.stringify([from, to, edge.relationship]);
    const existing = connections.get(signature);
    if (existing) { existing.connectionIds.push(edge.id); existing.evidence = unique([...existing.evidence, ...edge.evidence]); }
    else connections.set(signature, { ...edge, from, to, connectionIds: [edge.id] });
  }
  return { resources: [...groups.values()], connections: summarizeConnections([...connections.values()]), internalConnections };
}
