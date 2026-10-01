import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, posix } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parse, parseAllDocuments, stringify } from 'yaml';
import { scanRepositoryArchitecture } from './scanner';
import { resolveCortexDefinitions, type ResolvedCortexDefinition } from './cortex-definitions';
import { declarationBlocks } from './blocks';
import { hash } from './files';
import { appendCortexOutputWiring } from './cortex-wiring';
const execFileAsync = promisify(execFile);

/** Helm's release namespace is apply context even when a template omits it.
 * Normalize known namespaced kinds in the REVIEW preview so cross-chart
 * Service/secret references do not become false external dependencies.
 * Leave cluster-scoped and unknown custom kinds untouched.
 */
export function normalizeCortexPreview(rendered: string, namespace: string) {
  const namespaced = new Set(['Deployment', 'StatefulSet', 'DaemonSet', 'Pod', 'Job', 'CronJob', 'Service', 'Ingress', 'HTTPRoute', 'ConfigMap', 'Secret', 'ServiceAccount', 'HorizontalPodAutoscaler', 'PodDisruptionBudget', 'NetworkPolicy', 'SecretStore', 'ExternalSecret']);
  return parseAllDocuments(rendered).map(doc => {
    if (doc.errors.length) throw new Error('Helm returned invalid YAML; no deployment preview was saved.');
    if (namespaced.has(String(doc.get('kind'))) && !doc.getIn(['metadata', 'namespace'])) doc.setIn(['metadata', 'namespace'], namespace);
    return doc.toString();
  }).join('\n---\n');
}

/** Render the exact registered definition and dependency closure. Never apply it.
 * The caller supplies a private directory populated from one verified Git commit.
 * Unknown tenant/operator inputs stay explicit; no cluster lookups are made.
 */
export async function prepareCortexPlatform(config: {
  snapshotPath: string; revision: string; repoUrl: string; applicationId: string;
  definitionName: string; environment: string; helmBin?: string;
  definitions?: ResolvedCortexDefinition[];
}) {
  if (!/^[a-f0-9]{40}$/.test(config.revision)) throw new Error('Pin Cortex to a verified Git commit before rendering.');
  if (![config.applicationId, config.definitionName, config.environment].every(v => /^[a-z][a-z0-9.-]{0,199}$/.test(v) && !v.includes('..'))) throw new Error('Invalid Cortex deployment selection.');
const root = config.snapshotPath, read = (file: string) => readFile(join(root, file), 'utf8');
const definitions = config.definitions ?? await resolveCortexDefinitions(read, `gitops/${config.environment}/application-definitions/kustomization.yaml`);
const primary = definitions.find(d => d.value.metadata?.name === config.definitionName && d.value.spec?.applicationId === config.applicationId);
if (!primary) throw new Error('The chosen current definition is not registered in this environment.');
const selected = [primary];
for (let i = 0; i < selected.length; i++) for (const ref of selected[i].value.spec.dependencies ?? []) {
  if (!ref.definitionRef?.name) throw new Error('Unresolved application dependency.');
  const dependency = definitions.find(d => d.value.metadata?.name === ref.definitionRef.name);
  if (!dependency) throw new Error(`Dependency ${ref.definitionRef.name} is not registered in this environment.`);
  if (!selected.includes(dependency)) selected.push(dependency);
}
const previewDirectory = `review/${config.environment}`;
await mkdir(join(root, previewDirectory), { recursive: true });
await writeFile(join(root, previewDirectory, 'definitions.yaml'), selected.map(d => stringify(d.value)).join('---\n'));
const charts: NonNullable<import('../types/architecture').RepositoryArchitecture['deploymentPreparation']>['charts'] = [];
const renderedSources = new Map<string, string[]>();
const unresolvedInputs = new Set<string>(['tenant namespace', 'tenant ID', 'route hostname', 'operator-injected infrastructure outputs']);
for (const definition of selected) {
  const app = definition.value.spec.applicationId;
  if (!/^[a-z][a-z0-9-]{0,62}$/.test(app)) throw new Error('Invalid application ID in the Cortex dependency contract.');
  if (definition.value.spec.infrastructure?.mode !== 'Terraform') throw new Error(`Resolve the ${app} infrastructure contract before creating a combined Cortex plan.`);
  const chart = `services/${app}/chart`;
  const valuesFiles = [definition.value.spec.deployment?.serviceValuesRef, definition.value.spec.deployment?.platformValuesRef].filter(Boolean) as string[];
  if (!valuesFiles.length || valuesFiles.some(f => typeof f !== 'string' || f.startsWith('/') || f.includes('\\') || f.split('/').includes('..'))) throw new Error('Use repository-relative, environment-selected chart values.');
  const outputText = await read(`infra/tenant/app/${app}/outputs.tf`);
  const output = declarationBlocks(outputText, 'terraform').find(b => b.keyword === 'output' && b.labels[0] === 'configmap');
  if (!output) throw new Error(`${app} has no declared infrastructure output contract.`);
  const defaults = parse(await read(`${chart}/values.yaml`));
  const keys = [...new Set([...output.body.matchAll(/^\s{4}([A-Za-z_]\w*)\s*=/gm)].map(m => m[1]).concat(Object.entries(defaults.appInfra ?? {}).filter(([, value]) => value === '').map(([key]) => key)))];
  const appInfra = Object.fromEntries(keys.map(key => [key, `UNRESOLVED_${key}`]));
  keys.forEach(key => unresolvedInputs.add(`${app}.appInfra.${key}`));
  // These values are deliberately invalid deployment inputs. The preview is
  // evidence of chart structure/counts, never an applyable manifest bundle.
  const base = definition.value.spec.deployment?.values ?? {};
  const inline = {
    ...base,
    global: { ...base.global, namespace: 'launchpilot-preview' }, appInfra: { ...base.appInfra, ...appInfra },
    workloadIdentity: { ...base.workloadIdentity, tenantId: 'launchpilot-preview', applicationId: app },
    deploymentContext: { ...base.deploymentContext, tenantId: 'launchpilot-preview', parentApplicationId: config.applicationId, applicationId: app, actor: 'launchpilot-preview' },
    route: { ...base.route, hostname: 'launchpilot-preview.invalid' },
  };
  const inlinePath = join(root, previewDirectory, `${app}.inputs.json`);
  await writeFile(inlinePath, JSON.stringify(inline));
  const renderedFile = `${previewDirectory}/${app}.preview.yaml`;
  let rendered: string;
  try {
    ({ stdout: rendered } = await execFileAsync(config.helmBin ?? process.env.LAUNCHPILOT_HELM_BIN ?? 'helm', ['template', app, join(root, chart), '--namespace', 'launchpilot-preview',
      ...valuesFiles.flatMap(f => ['-f', join(root, f)]), '-f', inlinePath], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 60000 }));
  } catch (error) {
    throw new Error((error as NodeJS.ErrnoException).code === 'ENOENT'
      ? 'Helm is required on the LaunchPilot server to prepare Cortex artifacts. Set LAUNCHPILOT_HELM_BIN to its executable path.'
      : `Helm could not render ${chart} with the registered ${config.environment} values. No partial deployment plan was selected.`);
  }
  rendered = normalizeCortexPreview(rendered, 'launchpilot-preview');
  await writeFile(join(root, renderedFile), '# REVIEW ONLY: tenant and infrastructure inputs are unresolved; do not apply.\n' + rendered);
  renderedSources.set(renderedFile, ['# REVIEW ONLY', ...rendered.split('\n')]);
  charts.push({ applicationId: app, path: chart, valuesFiles, renderedFile });
}
const platform = await scanRepositoryArchitecture(root, config.repoUrl);
platform.revision = config.revision;
for (const chart of charts) appendCortexOutputWiring(platform, {
  applicationId: chart.applicationId, outputFile: `infra/tenant/app/${chart.applicationId}/outputs.tf`, outputs: await read(`infra/tenant/app/${chart.applicationId}/outputs.tf`),
  renderedFile: chart.renderedFile, rendered: await read(chart.renderedFile),
  terraform: await Promise.all(platform.coverage.files.filter(f => f.path.startsWith(`infra/tenant/app/${chart.applicationId}/`) && f.path.endsWith('.tf')).map(async f => ({ file: f.path, content: await read(f.path) }))),
});
for (const ev of platform.evidence) {
  const chart = charts.find(c => c.renderedFile === ev.file);
  if (chart) {
    const source = renderedSources.get(ev.file)?.slice(0, ev.line).reverse().find(line => line.startsWith('# Source: '))?.slice('# Source: '.length).split('/').slice(1).join('/');
    ev.derivedFrom = [...new Set([`${chart.path}/Chart.yaml`, `${chart.path}/values.yaml`, ...chart.valuesFiles, ...(source ? [`${chart.path}/${source}`] : [])])];
  }
  else if (ev.file === `${previewDirectory}/definitions.yaml`) ev.derivedFrom = [...new Set(selected.flatMap(d => d.files))];
}
platform.deploymentPreparation = { applicationId: config.applicationId, definitionName: config.definitionName, environment: config.environment,
  definitionFiles: [...new Set(selected.flatMap(d => d.files))], charts, previewOnly: true, unresolvedInputs: [...unresolvedInputs] };
const appRoots = selected.map(d => `infra/tenant/app/${d.value.spec.applicationId}`);
const tenantModules = declarationBlocks(await read('infra/tenant/apps.tf'), 'terraform').filter(block => block.keyword === 'module');
const activeModules = new Set(tenantModules.filter(block => {
  const source = /^\s*source\s*=\s*"([^"\n]+)"/m.exec(block.body)?.[1];
  return source && appRoots.includes(posix.normalize(posix.join('infra/tenant', source)));
}).map(block => `module.${block.labels[0]}`));
if (activeModules.size !== selected.length) throw new Error('Each selected Cortex application must have one matching local tenant Terraform module; resolve ambiguous or missing module ownership before planning.');
const wiringFiles: string[] = [];
for (const file of platform.coverage.files.filter(f => /^infra\/tenant\/[^/]+\.tf$/.test(f.path))) {
  const blocks = declarationBlocks(await read(file.path), 'terraform');
  if (blocks.some(block => ['resource', 'data'].includes(block.keyword) && [...block.body.matchAll(/\bmodule\.[A-Za-z_]\w*/g)].some(match => activeModules.has(match[0])))) wiringFiles.push(file.path);
}
const selectedFiles = new Set([
  ...charts.flatMap(c => [c.renderedFile, ...c.valuesFiles, ...platform.coverage.files.filter(f => f.path.startsWith(c.path + '/') && !/\/values-[^/]+\.yaml$/.test(f.path)).map(f => f.path)]),
  `${previewDirectory}/definitions.yaml`,
  ...platform.coverage.files.filter(f => appRoots.some(p => f.path.startsWith(p + '/'))).map(f => f.path),
  ...wiringFiles, 'infra/tenant/apps.tf',
]);
const ids = new Set(platform.resources.filter(r => r.evidence.some(id => platform.evidence.some(e => e.id === id && selectedFiles.has(e.file)))
  && (r.attributes.declaration !== 'module' || activeModules.has(r.name))).map(r => r.id));
// Retained platform foundations are repository-declared dependencies, not
// additional resources to create in the application's Terraform state.
for (const r of platform.resources.filter(r => ['infra/base', 'infra/frontdoor-edge'].includes(r.scope))) {
  r.origin = 'external'; r.attributes.platformOwnership = 'Existing Cortex platform; verify in the selected target';
  if (!/frontdoor|firewall_policy/.test(r.technology)) continue;
  ids.add(r.id); r.evidence.forEach(id => { const ev = platform.evidence.find(e => e.id === id); if (ev) selectedFiles.add(ev.file); });
}
platform.deploymentUnits = [{ id: `kubernetes:current-cortex/${config.environment}`, name: `Current Cortex / ${config.environment}`, root: `current-cortex/${config.environment}`,
  format: 'kubernetes', files: [...selectedFiles], resourceIds: [...ids], exportFormats: [] }];
platform.id = hash(JSON.stringify({ preparationVersion: 3, snapshot: platform.id, revision: config.revision, preparation: platform.deploymentPreparation, files: [...selectedFiles], resourceIds: [...ids].sort() }));
return platform;
}
