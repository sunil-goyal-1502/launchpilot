import type { RepositoryArchitecture, ArchitectureDeploymentTarget } from '../types/architecture';
import { hash } from './files';
import { selectArchitectureScope } from './planner';
import { environmentName } from './experience';

/** Link immutable application evidence to an explicitly selected platform
 * snapshot. Never mutate/relabel the legacy snapshot, or reuse its plan/cache.
 * Environment rendering and repository acquisition happen before this step.
 */
export function selectCortexPlatformTarget(application: RepositoryArchitecture, platform: RepositoryArchitecture, input: {
  applicationId: string; definitionName: string; environment: string; unitIds: string[];
}): RepositoryArchitecture {
  if (!platform.revision || !/^[a-f0-9]{40}$/.test(platform.revision)) throw new Error('The Cortex deployment source must be pinned to a Git commit.');
  if (application.coverage.truncated || platform.coverage.truncated) throw new Error('Complete the repository snapshots before selecting a deployment target.');
  const environment = environmentName(input.environment);
  const scope = selectArchitectureScope(platform, input.unitIds, environment);
  const definition = scope.resources.find(r => r.name === input.definitionName && r.attributes.applicationId === input.applicationId
    && r.attributes.deploymentOwner === 'Cortex tenant operator / Argo CD');
  if (!definition) throw new Error('Select a current Cortex ApplicationDefinition from the selected platform snapshot.');
  if (scope.deploymentUnits.some(u => u.format === 'cortex')) throw new Error('A current Cortex target cannot include legacy CortexApp deployment units.');
  if (definition.attributes.infrastructureMode !== 'Terraform') throw new Error('This Cortex selection requires the declared Terraform infrastructure contract.');

  const selectedIds = new Set(scope.deploymentUnits.flatMap(u => u.resourceIds));
  const source = application.resources.filter(r => r.origin === 'code');
  const deployment = scope.resources.filter(r => r.origin !== 'code' || selectedIds.has(r.id));
  const target: ArchitectureDeploymentTarget = { kind: 'cortex-platform', applicationId: input.applicationId, definitionName: input.definitionName, unitIds: [...input.unitIds].sort(), environment,
    repoUrl: platform.repoUrl, revision: platform.revision, architectureId: platform.id, applicationArchitectureId: application.id };
  const graph: RepositoryArchitecture = {
    version: 1, id: hash(JSON.stringify({ version: 1, target, application: application.id })),
    repoUrl: application.repoUrl, revision: application.revision, scannedAt: new Date().toISOString(), deploymentTarget: target,
    deploymentPreparation: platform.deploymentPreparation,
    sources: [
      { role: 'application', repoUrl: application.repoUrl, revision: application.revision, architectureId: application.id },
      { role: 'deployment', repoUrl: platform.repoUrl, revision: platform.revision, architectureId: platform.id },
    ], resources: [], bindings: [], connections: [], evidence: [], gaps: [], recommendations: [], deploymentUnits: [], deploymentContext: [],
    coverage: { filesScanned: application.coverage.filesScanned + platform.coverage.filesScanned,
      deploymentFiles: platform.coverage.deploymentFiles, files: [], excluded: [], limits: platform.coverage.limits, truncated: false, runtimeVerified: false },
  };
  for (const [prefix, original, resources] of [['application', application, source], ['cortex', scope, deployment]] as const) {
    const ids = new Set(resources.map(r => r.id)), id = (value: string) => `${prefix}:${value}`;
    const file = (value: string) => `${prefix}/${value}`;
    const bindings = original.bindings.filter(b => ids.has(b.consumerId));
    const connections = original.connections.filter(e => ids.has(e.from) && ids.has(e.to));
    const refs = new Set([...resources.flatMap(r => r.evidence), ...bindings.flatMap(b => b.evidence), ...connections.flatMap(e => e.evidence)]);
    const retainedEvidence = original.evidence.filter(e => prefix === 'cortex' || refs.has(e.id));
    retainedEvidence.forEach(e => refs.add(e.id));
    graph.resources.push(...resources.map(r => ({ ...r, id: id(r.id), scope: file(r.scope), evidence: r.evidence.map(id), attributes: { ...r.attributes, sourceRepository: original.repoUrl } })));
    graph.evidence.push(...retainedEvidence.map(e => ({ ...e, id: id(e.id), file: file(e.file), sourceFile: e.derivedFrom ? undefined : e.sourceFile ?? e.file, repoUrl: e.repoUrl ?? original.repoUrl, revision: e.revision ?? original.revision })));
    graph.connections.push(...connections.map(e => ({ ...e, id: id(e.id), from: id(e.from), to: id(e.to), evidence: e.evidence.map(id) })));
    graph.bindings.push(...bindings.map(b => ({ ...b, id: id(b.id), consumerId: id(b.consumerId), evidence: b.evidence.map(id),
      sourceId: b.sourceId && ids.has(b.sourceId) ? id(b.sourceId) : undefined,
      resolved: b.sourceId && !ids.has(b.sourceId) ? false : b.resolved })));
    graph.gaps.push(...original.gaps.filter(g => !g.evidence.length || g.evidence.every(e => refs.has(e))).map(g => ({ ...g, id: id(g.id), evidence: g.evidence.map(id), scope: g.scope ? file(g.scope) : undefined })));
    graph.coverage.files.push(...original.coverage.files.map(f => ({ ...f, path: file(f.path) })));
    graph.coverage.excluded.push(...original.coverage.excluded.map(f => ({ ...f, path: file(f.path) })));
    if (prefix === 'cortex') {
      graph.deploymentUnits = original.deploymentUnits.map(u => ({ ...u, id: id(u.id), root: file(u.root), files: u.files.map(file), resourceIds: u.resourceIds.filter(r => ids.has(r)).map(id) }));
      graph.deploymentContext = original.deploymentContext.map(c => ({ ...c, file: file(c.file) }));
      graph.relatedDeploymentContext = original.relatedDeploymentContext?.map(c => ({ ...c, file: file(c.file) }));
    }
  }
  return graph;
}
