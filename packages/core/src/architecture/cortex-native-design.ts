import type { RepositoryArchitecture } from '../types/architecture';
import type { ArchitectureDesign, DesignIssue } from './design';
import type { DeploymentTopology } from './deployment-topology';

/** Translate only controls whose Helm value path is proven by the saved template.
 * Re-rendering at export verifies the path actually changes the selected workload.
 */
export function compileNativeCortexEdits(graph: RepositoryArchitecture, design: ArchitectureDesign, topology: DeploymentTopology) {
  const issues: DesignIssue[] = [], overrides: Record<string, Record<string, unknown>> = {};
  const reject = (id: string, message: string) => issues.push({ id: `native-edit:${id}`, severity: 'blocker', message });
  for (const node of topology.nodes) if (node.basis === 'recommendation' && !/external/i.test(node.owner)) reject(node.id, `${node.name} needs a native Cortex implementation before it can be included in this export.`);
  for (const [index, edit] of design.edits.entries()) {
    if (edit.type === 'update-component') {
      if (edit.image !== undefined) reject(String(index), 'This chart image change needs its repository-specific image/value contract. Update the chart and refresh Cortex before exporting.');
      if (edit.replicas === undefined) continue;
      const workload = topology.workloads.find(w => w.id === edit.id);
      if (!workload || !['Deployment', 'StatefulSet'].includes(workload.controller) || workload.minReplicas !== undefined) { reject(String(index), 'This controller needs an explicit scaling contract; an HPA, DaemonSet or batch job cannot be changed with a fixed pod count.'); continue; }
      const evidence = graph.evidence.filter(e => workload.evidenceIds.includes(e.id));
      const templates = [...new Set(evidence.flatMap(e => e.derivedFrom ?? []).filter(f => f.includes('/templates/')))];
      const candidates = templates.flatMap(file => {
        const content = graph.deploymentContext.find(d => d.file === `cortex/${file}` || d.file === file)?.content;
        if (!content || (content.match(/^kind:\s*(?:Deployment|StatefulSet)\s*$/gm) ?? []).length !== 1) return [];
        const matches = [...content.matchAll(/^\s*replicas:\s*\{\{-?\s*\.Values\.([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)(?:\s*\|\s*default\s+\d+)?\s*-?\}\}\s*$/gm)];
        return matches.length === 1 ? [{ file, path: matches[0][1] }] : [];
      });
      const mapping = candidates.length === 1 ? candidates[0] : undefined;
      const chart = graph.deploymentPreparation?.charts.find(c => mapping?.file.startsWith(c.path + '/'));
      if (!mapping || !chart) { reject(String(index), `The replicas setting for ${workload.name} has no unambiguous Helm value path. Update its chart and refresh Cortex.`); continue; }
      let target = overrides[chart.applicationId] ??= {};
      const keys = mapping.path.split('.');
      for (const key of keys.slice(0, -1)) target = (target[key] ??= {}) as Record<string, unknown>;
      target[keys.at(-1)!] = edit.replicas;
    } else if (edit.type === 'put-connection' && edit.connection.binding.type === 'design') {
      // Annotation-only relationships are retained in the design, not deployed as networking.
    } else {
      reject(String(index), 'This component or runtime connection change needs a corresponding Cortex chart/Terraform implementation. The saved design is retained; update the source contract and refresh Cortex before exporting it.');
    }
  }
  return { issues, overrides };
}
