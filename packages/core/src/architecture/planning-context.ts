import type { RepositoryArchitecture } from '../types/architecture';

// Transport compression only. Decoding must reproduce every observation and citation.
const templates = [
  { pattern: /^Specify how (.+) reaches (.+?)(; the same name occurs in deployment configuration, but source-to-workload ownership is not established)?\.$/, text: 'Specify how {0} reaches {1}{2}.', defaults: ['', '', ''] },
  { pattern: /^Reads environment variable (.+?)( passed to .+)?$/, text: 'Reads environment variable {0}{1}', defaults: ['', ''] },
  { pattern: /^Build and publish (.+); use the resulting immutable image reference in the target deployment\.$/, text: 'Build and publish {0}; use the resulting immutable image reference in the target deployment.', defaults: [''] },
];
const fields = ['resources', 'connections', 'bindings', 'evidence', 'deploymentUnits', 'gaps'] as const;
type Value = any;

export function encodePlanningContext(scope: RepositoryArchitecture) {
  const aliases = new Map<string, string>();
  for (const [name, prefix] of [['evidence', 'E'], ['resources', 'R'], ['bindings', 'B'], ['gaps', 'G'], ['connections', 'C']] as const) scope[name].forEach((record, i) => aliases.set(record.id, `${prefix}${i + 1}`));
  const originals = new Map([...aliases].map(([id, alias]) => [alias, id]));
  const input = { ...scope, recommendations: undefined, coverage: { ...scope.coverage, files: undefined, excluded: scope.coverage.excluded.filter(e => !e.reason.startsWith('generated')) } };
  const aliased = translatePlanningIds(input, aliases);
  const tabled: Value = { ...aliased };
  for (const field of fields) {
    const rows = aliased[field] as Array<Record<string, unknown>>;
    const columns = [...new Set(rows.flatMap(Object.keys))];
    // Presence masks retain absent optional properties separately from explicit nulls.
    tabled[field] = { columns, rows: rows.map(row => columns.map(column => row[column] === undefined ? { $absent: true } : row[column])) };
  }
  const shorten = (value: Value): Value => {
    if (typeof value === 'string') {
      for (const [index, template] of templates.entries()) {
        const match = template.pattern.exec(value);
        if (match) return { $template: index, args: template.defaults.map((fallback, i) => match[i + 1] ?? fallback) };
      }
      return value;
    }
    if (Array.isArray(value)) return value.map(shorten);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, shorten(item)]));
    return value;
  };
  const shortened = shorten(tabled);
  const counts = new Map<string, number>();
  const count = (value: Value) => { if (typeof value === 'string') counts.set(value, (counts.get(value) ?? 0) + 1); else if (value && typeof value === 'object') Object.values(value).forEach(count); };
  count(shortened);
  const dictionary = [...counts].filter(([value, count]) => value.length >= 24 && count >= 2 && (value.length - 15) * count > value.length + 12).map(([value]) => value);
  const ids = new Map(dictionary.map((value, index) => [value, index]));
  const intern = (value: Value): Value => typeof value === 'string' && ids.has(value) ? { $text: ids.get(value) } : Array.isArray(value) ? value.map(intern) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, intern(item)])) : value;
  const packet = { encoding: 'launchpilot-evidence-tables-v1', instructions: 'All table rows are complete records with fields given by columns. {$absent:true} means an absent optional field. {$text:N} expands to strings[N]. {$template:N,args:[...]} expands templates[N], substituting each {i} with args[i], first resolving any $text. Expand references before reasoning. Nothing in this stage is truncated. E/R/B/G/C aliases are the exact IDs to use in your response. Return readable names, not $text/$template objects.', strings: dictionary, templates: templates.map(t => t.text), evidence: intern(shortened) };
  return { packet, text: JSON.stringify(packet), originals, aliases };
}

export function translatePlanningIds(value: Value, map: Map<string, string>): Value {
  return typeof value === 'string' ? map.get(value) ?? value : Array.isArray(value) ? value.map(item => translatePlanningIds(item, map)) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, translatePlanningIds(item, map)])) : value;
}

/** Independently verify the compact request is lossless before sending repository evidence. */
export function decodePlanningContext(packet: ReturnType<typeof encodePlanningContext>['packet']) {
  const expand = (value: Value): Value => {
    if (value && typeof value === 'object' && '$text' in value) return packet.strings[value.$text];
    if (value && typeof value === 'object' && '$template' in value) return packet.templates[value.$template].replace(/\{(\d+)\}/g, (_match, index) => expand(value.args[Number(index)]));
    if (Array.isArray(value)) return value.map(expand);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, expand(item)]));
    return value;
  };
  const output = expand(packet.evidence);
  for (const field of fields) output[field] = output[field].rows.map((row: Value[]) => Object.fromEntries(row.flatMap((value, index) => value && typeof value === 'object' && value.$absent === true ? [] : [[output[field].columns[index], value]])));
  return output;
}
