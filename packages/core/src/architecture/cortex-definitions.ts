import { posix } from 'node:path';
import { parseAllDocuments } from 'yaml';

type ObjectValue = Record<string, any>;
export interface ResolvedCortexDefinition { value: ObjectValue; files: string[] }

/** Resolve the repository's local, inline JSON-patch definition overlays.
 * Unsupported transformers fail explicitly instead of approximating Kustomize.
 * No remote files, Helm plugins, executable functions or cluster lookups.
 */
export async function resolveCortexDefinitions(read: (file: string) => Promise<string>, entry: string): Promise<ResolvedCortexDefinition[]> {
  const active = new Set<string>();
  const path = (parent: string, child: string) => {
    if (!child || child.startsWith('/') || child.includes('://') || child.includes('\\')) throw new Error('Definition sources must be local repository paths.');
    const result = posix.normalize(posix.join(parent, child));
    if (result === '..' || result.startsWith('../')) throw new Error('Definition source escapes the repository.');
    return result;
  };
  const parse = (content: string, file: string) => parseAllDocuments(content).map(d => {
    if (d.errors.length) throw new Error(`Invalid definition YAML: ${file}`);
    return d.toJS({ maxAliasCount: 50 }) as ObjectValue;
  }).filter(Boolean);
  const visit = async (file: string): Promise<ResolvedCortexDefinition[]> => {
    const visitedPath = file;
    if (active.has(file)) throw new Error('Cyclic definition source: ' + file);
    if (active.size > 40) throw new Error('Definition nesting limit exceeded.');
    active.add(file);
    try {
      let content: string;
      try { content = await read(file); }
      catch { file = path(file, 'kustomization.yaml'); content = await read(file); }
      const docs = parse(content, file);
      if (docs.length !== 1 || docs[0].kind !== 'Kustomization') return docs.map(value => ({ value, files: [file] }));
      const spec = docs[0];
      const allowed = new Set(['apiVersion', 'kind', 'resources', 'patches']);
      const unsupported = Object.keys(spec).filter(k => !allowed.has(k));
      if (unsupported.length) throw new Error(`Resolve ${file} with Kustomize before import; unsupported transformers: ${unsupported.join(', ')}`);
      const result: ResolvedCortexDefinition[] = [];
      for (const source of spec.resources ?? []) result.push(...await visit(path(posix.dirname(file), source)));
      for (const patch of spec.patches ?? []) {
        if (!patch.target || typeof patch.patch !== 'string' || Object.keys(patch).some(k => !['target', 'patch'].includes(k))) throw new Error('Only targeted inline definition patches are supported.');
        if (Object.keys(patch.target).some(k => !['group', 'version', 'kind', 'name', 'namespace'].includes(k))) throw new Error('Resolve selector-based definition patches with Kustomize before import.');
        const operations = parse(patch.patch, file)[0];
        if (!Array.isArray(operations)) throw new Error('Definition patches must be JSON-patch operations.');
        for (const definition of result) {
          const value = definition.value, [group, version] = String(value.apiVersion).split('/');
          const labels: ObjectValue = { group, version, kind: value.kind, name: value.metadata?.name, namespace: value.metadata?.namespace };
          if (!Object.entries(patch.target).every(([key, expected]) => new RegExp(`^(?:${expected})$`).test(String(labels[key] ?? '')))) continue;
          for (const operation of operations) applyDefinitionPatch(value, operation);
          definition.files = [...new Set([...definition.files, file])];
        }
      }
      for (const definition of result) definition.files = [...new Set([...definition.files, file])];
      return result;
    } finally { active.delete(visitedPath); }
  };
  return visit(path('.', entry));
}

function applyDefinitionPatch(value: ObjectValue, operation: ObjectValue) {
  if (!['add', 'replace', 'remove'].includes(operation.op) || typeof operation.path !== 'string' || !operation.path.startsWith('/')) throw new Error('Unsupported definition patch operation.');
  const keys = operation.path.slice(1).split('/').map((k: string) => k.replace(/~1/g, '/').replace(/~0/g, '~'));
  if (keys.some((k: string) => ['__proto__', 'prototype', 'constructor'].includes(k))) throw new Error('Unsafe definition patch path.');
  let parent: any = value;
  for (const key of keys.slice(0, -1)) {
    if (!parent || typeof parent !== 'object' || !Object.hasOwn(parent, key)) throw new Error('Definition patch parent does not exist: ' + operation.path);
    parent = parent[key];
  }
  const key = keys.at(-1)!;
  if (!parent || typeof parent !== 'object' || operation.op !== 'add' && !Object.hasOwn(parent, key)) throw new Error('Definition patch target does not exist: ' + operation.path);
  if (Array.isArray(parent)) {
    const index = key === '-' && operation.op === 'add' ? parent.length : /^\d+$/.test(key) ? Number(key) : NaN;
    if (!Number.isSafeInteger(index) || index < 0 || index > parent.length || operation.op !== 'add' && index === parent.length) throw new Error('Invalid array definition patch path.');
    parent.splice(index, operation.op === 'add' ? 0 : 1, ...(operation.op === 'remove' ? [] : [structuredClone(operation.value)]));
  } else if (operation.op === 'remove') delete parent[key];
  else parent[key] = structuredClone(operation.value);
}
