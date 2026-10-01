import type { DeploymentNode, DeploymentTopology, RepositoryArchitecture } from '@launchpilot/core';

export type DeploymentCard = DeploymentNode & { memberIds: string[] };
const supporting = (n: DeploymentNode) => /^(?:random_|time_|null_|azapi_)/.test(n.technology)
  || /^azurerm_(?:private_|role_assignment|federated_|key_vault_(?:secret|key)|postgresql_flexible_server_|redis_cache_access_|storage_(?:container|management)|servicebus_(?:queue|topic|subscription)|app_configuration_key|monitor_diagnostic_|client_config|resources$|network_interface|dns_|resource_group|policy_)/.test(n.technology)
  || /\/(?:NetworkPolicy|ServiceAccount|ExternalSecret|SecretStore|ConfigMap|Secret|HorizontalPodAutoscaler|PodDisruptionBudget|RemoteMCPServer)$/.test(n.technology)
  || ['secret', 'configuration', 'identity', 'module'].includes(n.kind);
const serviceNames: Record<string, string> = {
  azurerm_postgresql_flexible_server: 'PostgreSQL', azurerm_redis_cache: 'Redis cache', azurerm_storage_account: 'Blob storage',
  azurerm_key_vault: 'Key Vault', azurerm_servicebus_namespace: 'Service Bus', azurerm_search_service: 'AI Search',
  azurerm_app_configuration: 'App Configuration', azurerm_cognitive_account: 'AI services',
};

/** A visual projection only: every physical node and connection is retained.
 * Merge Services only when their selector resolves to exactly one workload.
 * Group implementation plumbing; never add pod/resource counts from card count.
 */
export function deploymentPresentation(topology: DeploymentTopology, graph: RepositoryArchitecture) {
  const physical = new Map(topology.nodes.map(n => [n.id, n])), mapping = new Map<string, string>();
  const workloadIds = new Set(topology.workloads.map(w => w.id));
  const scope = (n: DeploymentNode) => {
    const resource = graph.resources.find(r => n.resourceIds.includes(r.id));
    const file = graph.evidence.find(e => n.evidenceIds.includes(e.id))?.file ?? '';
    return /infra\/tenant\/app\/([^/]+)/.exec(resource?.scope ?? '')?.[1]
      ?? /review\/[^/]+\/([^/]+)\.preview\.yaml/.exec(file)?.[1]
      ?? (n.basis === 'external' ? 'shared-platform' : 'deployment');
  };
  for (const n of topology.nodes) {
    if (!/\/Service$/.test(n.technology)) continue;
    const selected = [...new Set(topology.connections.filter(e => e.from === n.id && /selects pods/.test(e.purpose) && workloadIds.has(e.to)).map(e => e.to))];
    if (selected.length === 1) mapping.set(n.id, selected[0]);
  }
  for (const n of topology.nodes) {
    if (mapping.has(n.id) || workloadIds.has(n.id) || n.id === 'existing-cortex-platform') continue;
    if (/cdn_frontdoor|frontDoorWebApplicationFirewallPolicies/i.test(n.technology)) mapping.set(n.id, `group:edge:${n.basis === 'external' ? 'shared-platform' : scope(n)}`);
    else if (n.technology === 'azurerm_cognitive_account') mapping.set(n.id, `group:integration:${scope(n)}:ai`);
    else if (/\/(?:HTTPRoute|Ingress)$/.test(n.technology)) mapping.set(n.id, `group:routing:${scope(n)}`);
    else if (supporting(n)) {
      // A private endpoint/child resource with exactly one declared parent is
      // inspected with that parent. Ambiguous plumbing stays in its own group.
      const parents = [...new Set(topology.connections.filter(e => e.from === n.id && e.to !== n.id).map(e => physical.get(e.to)).filter((p): p is DeploymentNode => !!p && !supporting(p) && !workloadIds.has(p.id) && scope(p) === scope(n)).map(p => p.id))];
      if (parents.length === 1 && !mapping.has(parents[0])) mapping.set(n.id, parents[0]);
      else mapping.set(n.id, `group:operations:${scope(n)}`);
    } else if (n.basis === 'external' && !serviceNames[n.technology]) mapping.set(n.id, `group:${n.layer}:${scope(n)}`);
  }
  const groupId = (id: string) => { const seen = new Set<string>(); while (mapping.has(id) && !seen.has(id)) { seen.add(id); id = mapping.get(id)!; } return id; };
  const groups = new Map<string, DeploymentNode[]>();
  for (const n of topology.nodes) { const id = groupId(n.id); groups.set(id, [...(groups.get(id) ?? []), n]); }
  const cards: DeploymentCard[] = [...groups].map(([id, members]) => {
    const primary = physical.get(id), synthetic = !primary, base = primary ?? members[0];
    const [, layer, owner] = id.split(':');
    const groupName = id.endsWith(':ai') ? 'AI services' : layer === 'edge' ? 'Front Door & WAF' : layer === 'routing' ? 'HTTP routing' : layer === 'operations' ? 'Identity & configuration' : 'Platform dependencies';
    return { ...base, id, layer: synthetic ? layer as DeploymentNode['layer'] : base.layer,
      name: synthetic ? `${owner === 'shared-platform' ? 'Shared' : owner} · ${groupName}` : serviceNames[base.technology] ? `${scope(base)} · ${serviceNames[base.technology]}${base.technology === 'azurerm_cognitive_account' ? ` (${base.name.split('.').at(-1)})` : ''}` : base.name,
      technology: synthetic ? groupName : base.technology, kind: synthetic ? layer === 'edge' || layer === 'routing' ? 'network' : 'platform' : base.kind,
      details: synthetic ? id.endsWith(':ai') ? members.filter(n => n.technology === 'azurerm_cognitive_account').map(n => n.name.split('.').at(-1)!) : [`${members.length} resource declarations`, 'Select to inspect connections and settings'] : base.details,
      memberIds: members.map(n => n.id), resourceIds: [...new Set(members.flatMap(n => n.resourceIds))], evidenceIds: [...new Set(members.flatMap(n => n.evidenceIds))],
    };
  });
  const connections = new Map<string, DeploymentTopology['connections'][number] & { connectionIds: string[] }>();
  for (const e of topology.connections) {
    const from = groupId(e.from), to = groupId(e.to);
    if (!groups.has(from) || !groups.has(to) || from === to) continue;
    const key = `${from}\n${to}`, previous = connections.get(key);
    if (previous) { previous.connectionIds.push(e.id); previous.evidenceIds = [...new Set([...previous.evidenceIds, ...e.evidenceIds])]; }
    else connections.set(key, { ...e, id: key, from, to, connectionIds: [e.id] });
  }
  return { cards, connections: [...connections.values()], cardId: groupId };
}
