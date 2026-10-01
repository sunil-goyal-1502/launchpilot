import { parseAllDocuments } from 'yaml';
import type { RepositoryArchitecture } from '../types/architecture';
import { declarationBlocks } from './blocks';
import { hash } from './files';

/** Trace markers through the real Terraform output -> operator appInfra ->
 * rendered consumer contract before values are redacted. Only identifiers and
 * source references enter the graph; values and credential material never do.
 */
export function appendCortexOutputWiring(graph: RepositoryArchitecture, input: {
  applicationId: string; outputFile: string; outputs: string; renderedFile: string; rendered: string;
  terraform: Array<{ file: string; content: string }>;
}) {
  const root = `infra/tenant/app/${input.applicationId}`;
  const output = declarationBlocks(input.outputs, 'terraform').find(b => b.keyword === 'output' && b.labels[0] === 'configmap');
  if (!output) throw new Error('Cortex configmap output contract is missing.');
  const resources = graph.resources.filter(r => r.scope === root);
  const localNames = new Map<string, string[]>();
  for (const file of input.terraform) for (const b of declarationBlocks(file.content, 'terraform').filter(b => b.keyword === 'resource')) {
    const name = /^\s{2}name\s*=\s*(local\.\w+)\s*(?:#.*)?$/m.exec(b.body)?.[1];
    const resource = resources.find(r => r.name === `${b.labels[0]}.${b.labels[1]}`);
    if (name && resource) localNames.set(name, [...(localNames.get(name) ?? []), resource.id]);
  }
  const producers = new Map<string, { ids: string[]; evidenceId: string }>();
  for (const match of output.body.matchAll(/^\s{4}(\w+)\s*=\s*([^\n]+)/gm)) {
    const key = match[1], expression = match[2];
    const names = [...expression.matchAll(/\b(?:data\.)?(?:azurerm|azapi)_\w+\.\w+/g)].map(m => m[0]);
    const ids = new Set(resources.filter(r => names.includes(r.name)).map(r => r.id));
    // An endpoint built from one resource's exact name expression still has an
    // evidenced producer. Shared/ambiguous local names remain unresolved.
    for (const ref of expression.matchAll(/\blocal\.\w+/g)) {
      const candidates = localNames.get(ref[0]) ?? [];
      if (candidates.length === 1) ids.add(candidates[0]);
    }
    const line = input.outputs.slice(0, output.start + input.outputs.slice(output.start, output.end).indexOf(output.body) + match.index! + match[0].indexOf(key)).split('\n').length;
    const evidenceId = 'ev-' + hash(`${input.outputFile}:${key}:cortex-output`).slice(0,16);
    graph.evidence.push({ id: evidenceId, file: input.outputFile, line, endLine: line, kind: 'configuration', summary: `${input.applicationId}.appInfra.${key} is supplied by the tenant Terraform configmap output and Cortex operator projection` });
    producers.set(key, { ids: [...ids], evidenceId });
  }
  const visit = (value: unknown, path: string[], values: Array<{ key: string; path: string[] }>) => {
    if (typeof value === 'string') for (const marker of value.matchAll(/UNRESOLVED_([A-Za-z_]\w*)/g)) values.push({ key: marker[1], path });
    else if (Array.isArray(value)) value.forEach((v,i) => visit(v, [...path,String(i)], values));
    else if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) visit(child, [...path,key], values);
  };
  for (const document of parseAllDocuments(input.rendered)) {
    if (document.errors.length) throw new Error('Cannot trace malformed Helm output.');
    const value = document.toJS({ maxAliasCount: 50 });
    if (!value?.kind || !value.metadata?.name) continue;
    const consumer = graph.resources.find(r => r.name === value.metadata.name && r.technology.endsWith('/'+value.kind) && r.evidence.some(id => graph.evidence.some(e => e.id === id && e.file === input.renderedFile)));
    if (!consumer) continue;
    const markers: Array<{ key: string; path: string[] }> = [];
    visit(value, [], markers);
    for (const { key, path } of markers) {
      const producer = producers.get(key), evidence = [...consumer.evidence, ...(producer ? [producer.evidenceId] : [])];
      const bindingId = `binding:${consumer.id}:appInfra.${key}:${path.join('.')}`;
      if (!graph.bindings.some(b => b.id === bindingId)) graph.bindings.push({ id: bindingId, consumerId: consumer.id, key: `appInfra.${key}`, source: 'expression', sourceKey: key, ...(producer?.ids.length === 1 ? { sourceId: producer.ids[0] } : {}), sensitive: false, evidence, resolved: producer?.ids.length === 1 });
      for (const target of producer?.ids ?? []) {
        const id = 'edge-' + hash(`${consumer.id}:${target}:appInfra.${key}`).slice(0,16);
        if (!graph.connections.some(e => e.id === id)) graph.connections.push({ id, from: consumer.id, to: target, relationship: `Consumes appInfra.${key} through Cortex output projection`, evidence });
      }
    }
  }
}
