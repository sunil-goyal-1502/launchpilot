import type { ArchitectureResource, RepositoryArchitecture } from '../types/architecture';
import { declarationBlocks } from './blocks';

/** Display literal module defaults as defaults, never as evaluated/live Terraform
 * state. A caller override wins; unresolved inputs remain explicit expressions.
 */
export function terraformSizingResolver(graph: RepositoryArchitecture) {
  const files = graph.deploymentContext.filter(f => f.file.endsWith('.tf')).map(f => ({ file: f.file, root: f.file.slice(0, f.file.lastIndexOf('/')), blocks: declarationBlocks(f.content, 'terraform') }));
  const scalar = (input: string | undefined) => {
    const value = input?.trim().replace(/\s+#.*$/, '');
    if (!value || !/^(?:"[^"\n$]*"|-?\d+(?:\.\d+)?|true|false)$/.test(value)) return undefined;
    try { return JSON.parse(value) as string | number | boolean; } catch { return undefined; }
  };
  return (resource: ArchitectureResource, expression: unknown): { value: unknown; defaulted: boolean } => {
    const match = typeof expression === 'string' && /^var\.([A-Za-z_]\w*)$/.exec(expression);
    if (!match) return { value: expression, defaulted: false };
    const moduleRoot = resource.scope;
    const callers = files.flatMap(f => f.blocks.filter(b => b.keyword === 'module').flatMap(b => {
      const source = /^\s*source\s*=\s*"\.\/([^"\n]+)"/m.exec(b.body)?.[1];
      return source && `${f.root}/${source}` === moduleRoot ? [b] : [];
    }));
    if (callers.length !== 1) return { value: expression, defaulted: false };
    const override = new RegExp(`^\\s*${match[1]}\\s*=\\s*([^\\n]+)`, 'm').exec(callers[0].body)?.[1];
    if (override !== undefined) return { value: scalar(override) ?? override.trim(), defaulted: false };
    const declarations = files.filter(f => f.root === moduleRoot).flatMap(f => f.blocks.filter(b => b.keyword === 'variable' && b.labels[0] === match[1]));
    const value = declarations.length === 1 ? scalar(/^\s*default\s*=\s*([^\n]+)/m.exec(declarations[0].body)?.[1]) : undefined;
    return value === undefined ? { value: expression, defaulted: false } : { value, defaulted: true };
  };
}
