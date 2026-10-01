import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { dirname, join, posix } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parse, parseAllDocuments } from 'yaml';
import type { RepositoryArchitecture } from '../types/architecture';
import type { ArchitectureDesign } from './design';
import { inspectArchitectureDesign, materializeArchitectureDesign } from './design';
import type { GroundedArchitecturePlan } from './planner';
import { selectArchitectureScope } from './planner';
import { resolveCortexDefinitions } from './cortex-definitions';
import { compileNativeCortexEdits } from './cortex-native-design';
import { declarationBlocks } from './blocks';
import { hash, isSecretFile } from './files';
import { nativeCortexValidationRuntime } from './cortex-native-runtime';

const run = promisify(execFile);
const json = (value: unknown) => JSON.stringify(value, null, 2) + '\n';
export interface PinnedCortexArtifacts { revision: string; files: string[]; read(file: string): Promise<string> }
const safePath = (path: string) => path && !path.startsWith('/') && !path.includes('\\') && !path.split('/').includes('..');

/** Include the complete local module closure, including modules with count=0.
 * Preserve the platform's separate Terraform states; never flatten their resources.
 */
export async function collectCortexTerraform(source: PinnedCortexArtifacts, roots: string[]) {
  const files: Record<string, string> = {}, visited = new Set<string>();
  async function module(root: string) {
    if (!safePath(root)) throw new Error('Unsafe Terraform module path');
    if (visited.has(root)) return;
    visited.add(root);
    const paths = source.files.filter(f => f.startsWith(root + '/') && !f.slice(root.length + 1).includes('/') && /\.(tf|hcl)$/.test(f));
    if (!paths.some(f => f.endsWith('.tf'))) throw new Error('Missing Terraform module: ' + root);
    for (const file of paths) {
      const content = files[file] = await source.read(file);
      for (const block of declarationBlocks(content, 'terraform').filter(b => b.keyword === 'module')) {
        const local = /^\s*source\s*=\s*"([^"\n]+)"/m.exec(block.body)?.[1];
        if (!local?.startsWith('.')) throw new Error(`Module ${block.labels[0]} in ${file} requires a separately pinned external module; export did not download or execute it.`);
        await module(posix.normalize(posix.join(root, local)));
      }
      // Static file/template references remain at their original relative paths.
      for (const match of content.matchAll(/\b(?:file|templatefile)\s*\(\s*"([^"\n]+)"/g)) {
        const path = posix.normalize(posix.join(root, match[1].replace(/^\$\{path.module\}\//, '')));
        if (!safePath(path) || path.includes('${') || isSecretFile(path)) throw new Error('Resolve the Terraform file input before export: ' + file);
        files[path] ??= await source.read(path);
      }
    }
  }
  for (const root of roots) await module(root);
  return files;
}

function merge(base: any, update: any): any {
  if (!update || typeof update !== 'object' || Array.isArray(update)) return update;
  const out = { ...base };
  for (const [key, value] of Object.entries(update)) out[key] = value && typeof value === 'object' && !Array.isArray(value) ? merge(out[key], value) : value;
  return out;
}

/** Compile a saved Cortex selection from the same pinned source that was planned.
 * Preview inputs are kept in review/ only; deployable CRs are rendered separately
 * from required tenant inputs. Secret values and TF state are never collected.
 */
export async function buildNativeCortexBundle(graph: RepositoryArchitecture, design: ArchitectureDesign, source: PinnedCortexArtifacts, plan?: GroundedArchitecturePlan) {
  const target = graph.deploymentTarget, prep = graph.deploymentPreparation;
  if (target?.kind !== 'cortex-platform' || !prep || source.revision !== target.revision) throw new Error('Native export requires the exact reviewed Cortex commit.');
  const issues = inspectArchitectureDesign(graph, design, plan).filter(i => i.severity === 'blocker');
  if (issues.length) throw new Error(issues.map(i => i.message).join('\n'));
  const topology = materializeArchitectureDesign(graph, design, plan), { overrides } = compileNativeCortexEdits(graph, design, topology);
  const scope = selectArchitectureScope(graph, design.unitIds, design.environment);
  const roots = ['infra/tenant', ...['infra/base', 'infra/frontdoor-edge'].filter(root => source.files.includes(root + '/providers.tf') || source.files.includes(root + '/main.tf'))];
  const originals = await collectCortexTerraform(source, roots);
  const definitions = await resolveCortexDefinitions(source.read, `gitops/${target.environment}/application-definitions/kustomization.yaml`);
  const selected = [definitions.find(d => d.value.metadata?.name === target.definitionName)!];
  if (!selected[0]) throw new Error('The reviewed definition is absent from the pinned environment.');
  for (let i = 0; i < selected.length; i++) for (const dependency of selected[i].value.spec.dependencies ?? []) {
    const next = definitions.find(d => d.value.metadata?.name === dependency.definitionRef?.name);
    if (!next) throw new Error('Unresolved Cortex dependency in the pinned source.');
    if (!selected.includes(next)) selected.push(next);
  }
  if (JSON.stringify(selected.map(d => d.value.spec.applicationId).sort()) !== JSON.stringify(prep.charts.map(c => c.applicationId).sort())) throw new Error('Chart/dependency coverage changed; refresh the Cortex plan.');
  const paths = new Set([...selected.flatMap(d => d.files), ...prep.charts.flatMap(c => [...source.files.filter(f => f.startsWith(c.path + '/')), ...c.valuesFiles]),
    ...source.files.filter(f => f.startsWith('.github/') || f.startsWith('scripts/') || /^platform\/services\/tenant-operator\/(?:api\/v1alpha1\/|config\/crd\/bases\/|internal\/controller\/)/.test(f) && /\.go$|\.yaml$/.test(f))]);
  for (const path of paths) {
    if (!safePath(path) || isSecretFile(path)) continue;
    originals[path] ??= await source.read(path);
  }
  // Export code/contracts, not credentials. Reject recognized credential literals.
  for (const [file, content] of Object.entries(originals)) if (/-----BEGIN [\w ]*PRIVATE KEY-----|\bgh[pousr]_[A-Za-z0-9]{20,}|\bsk-[A-Za-z0-9_-]{24,}|\bAKIA[A-Z0-9]{16}\b/.test(content)) throw new Error(`Credential-like content in ${file}; remove it from the source before exporting.`);
  const files: Record<string, string> = Object.fromEntries(Object.entries(originals).map(([path, content]) => [`cortex/${path}`, content]));
  const directory = await mkdtemp(join(tmpdir(), 'launchpilot-native-'));
  const charts: Array<{ applicationId: string; path: string; values: string[]; inline: string; renderedHash: string }> = [];
  try {
    for (const [file, content] of Object.entries(files)) { await mkdir(dirname(join(directory, file)), { recursive: true }); await writeFile(join(directory, file), content, { mode: 0o600 }); }
    for (const chart of prep.charts) {
      const definition = selected.find(d => d.value.spec.applicationId === chart.applicationId)!.value;
      const output = declarationBlocks(originals[`infra/tenant/app/${chart.applicationId}/outputs.tf`], 'terraform').find(b => b.keyword === 'output' && b.labels[0] === 'configmap');
      if (!output) throw new Error('Missing application output contract');
      const defaults = parse(originals[`${chart.path}/values.yaml`]);
      const keys = [...new Set([...output.body.matchAll(/^\s{4}([A-Za-z_]\w*)\s*=/gm)].map(m => m[1]).concat(Object.entries(defaults.appInfra ?? {}).filter(([, value]) => value === '').map(([key]) => key)))];
      const appInfra = Object.fromEntries(keys.map(key => [key, `UNRESOLVED_${key}`]));
      const base = merge(definition.spec.deployment?.values ?? {}, overrides[chart.applicationId] ?? {});
      const inline = { ...base, global: { ...base.global, namespace: 'launchpilot-preview' }, appInfra: { ...base.appInfra, ...appInfra }, workloadIdentity: { ...base.workloadIdentity, tenantId: 'launchpilot-preview', applicationId: chart.applicationId }, deploymentContext: { ...base.deploymentContext, tenantId: 'launchpilot-preview', parentApplicationId: target.applicationId, applicationId: chart.applicationId, actor: 'launchpilot-preview' }, route: { ...base.route, hostname: 'launchpilot-preview.invalid' } };
      const input = `review/${chart.applicationId}.inputs.json`;
      files[input] = json(inline);
      await mkdir(join(directory, 'review'), { recursive: true }); await writeFile(join(directory, input), files[input], { mode: 0o600 });
      const values = chart.valuesFiles.map(f => `cortex/${f}`);
      const args = ['template', chart.applicationId, `cortex/${chart.path}`, '--namespace', 'launchpilot-preview', ...values.flatMap(f => ['-f', f]), '-f', input];
      let rendered: string;
      try { rendered = (await run(process.env.LAUNCHPILOT_HELM_BIN || 'helm', args, { cwd: directory, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 60000 })).stdout; }
      catch { throw new Error(`Helm could not render ${chart.applicationId} with the saved edits. Check the chart/value contract; no incomplete bundle was exported.`); }
      const documents = parseAllDocuments(rendered).map(d => { if (d.errors.length) throw new Error('Invalid Helm output'); return d.toJS(); });
      const actual = documents.filter(d => ['Deployment', 'StatefulSet', 'DaemonSet', 'Pod', 'Job', 'CronJob'].includes(d?.kind));
      const expected = topology.workloads.filter(w => w.file === `cortex/${chart.renderedFile}` || w.file === chart.renderedFile);
      if (actual.length !== expected.length) throw new Error(`Workload coverage mismatch in ${chart.applicationId}; rendered ${actual.length}, diagram ${expected.length}.`);
      for (const workload of expected) {
        // Display labels can be edited; deployed identities stay in repository evidence.
        const name = graph.resources.find(r => workload.resourceIds.includes(r.id) && r.attributes.kind === workload.controller)?.name ?? workload.name;
        const found = actual.find(d => d.kind === workload.controller && d.metadata?.name === name);
        if (!found || ['Deployment', 'StatefulSet'].includes(found.kind) && (found.spec.replicas ?? 1) !== workload.replicas) throw new Error(`The Helm output does not implement the selected replicas for ${name}. A chart default or autoscaler may override the requested count.`);
      }
      files[`review/${chart.applicationId}.preview.yaml`] = '# REVIEW ONLY: unresolved tenant inputs; never apply this preview.\n' + rendered;
      charts.push({ applicationId: chart.applicationId, path: `cortex/${chart.path}`, values, inline: input, renderedHash: hash(rendered) });
      files[`deployment/${chart.applicationId}.template.json`] = json({ apiVersion: definition.apiVersion, kind: 'ApplicationDeployment', metadata: { name: chart.applicationId, namespace: '__TENANT_NAMESPACE__' }, spec: { type: 'Helm', applicationId: chart.applicationId, definitionRef: { name: definition.metadata.name }, helm: { requiresPerAppInfra: true, serviceValuesRef: definition.spec.deployment.serviceValuesRef, platformValuesRef: definition.spec.deployment.platformValuesRef, values: json(base), ...(definition.spec.capabilities?.cookiePolicy ? { cookiePolicy: definition.spec.capabilities.cookiePolicy } : {}), ...(definition.spec.capabilities?.appRoles ? { appRoles: definition.spec.capabilities.appRoles } : {}) } } });
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
  files['cortex-selection.json'] = json({ ...target, designRevision: design.revision, applications: selected.map(d => d.value.spec.applicationId), overrides, nativeTerraformRoots: roots, externalStateRoots: roots.filter(r => r !== 'infra/tenant'), aiReviewComplete: !!plan });
  files['architecture-design.json'] = json(design); files['deployment-topology.json'] = json(topology); files['evidence.json'] = json(graph);
  if (plan) files['plan.json'] = json(plan);
  files['repository-resource-ownership.json'] = json(scope.resources.map(r => ({ resourceId: r.id, name: r.name, origin: r.origin, ownership: r.origin === 'code' ? 'Source-code requirement; not a separate deployed workload' : r.origin === 'external' ? 'Existing platform dependency; state ownership retained' : 'Pinned native Terraform / Helm contract', files: [...new Set(graph.evidence.filter(e => r.evidence.includes(e.id)).flatMap(e => (e.derivedFrom ?? [e.file.replace(/^cortex\//, '')])).filter(f => !!originals[f]))] })));
  files['configuration-coverage.json'] = json(scope.bindings.map(b => ({ ...b, contract: b.resolved ? 'Evidenced source contract retained; runtime verification required' : 'Unresolved source requirement; no invented value' })));
  files['deployment-inputs.example.json'] = json({ tenantName: null, namespace: null, context: null, verifiedOperatorRevision: null, verifiedWorkflowRevision: null, applicationDeploymentNames: Object.fromEntries(prep.charts.map(c => [c.applicationId, null])) });
  files['render-deployment.mjs'] = nativeDeploymentRenderer;
  files['validate.mjs'] = nativeCortexValidationRuntime;
  files['.gitignore'] = '**/.terraform/\n**/*.tfstate*\n**/*.tfvars*\nprivate-*\ndeployment-inputs.json\nrendered-deployment.json\n';
  files['README.md'] = `# Native Cortex deployment\n\nCortex ${target.repoUrl} at ${target.revision}, ${target.environment}, ${target.definitionName}. Saved design revision ${design.revision}: ${topology.totals.applicationPods} steady-state pods. This bundle preserves the tenant Terraform → output ConfigMaps → tenant operator → Argo CD / Helm contract, including dependency charts and cross-application permissions.\n\n## Selected implementation\n\nThe complete local Terraform module closure is under cortex/infra, including disabled local modules required by terraform init. Only the selected applications are requested; do not replace an existing tenant's apps_enabled list with a subset. The native tenant workflow derives the full tenant application set. Base and Front Door remain separate platform states and are included for evidence and validation, not for recreation in tenant state. The pinned workflow and controller sources preserve output projection and ownership. Workload replica edits are compiled into ApplicationDeployment.spec.helm.values and checked against the diagram by re-rendering Helm. Other runtime edits require an implemented source contract before export.\n\n## Validation\n\nRun node validate.mjs. Generation runs Terraform initialization without a backend, terraform validate for every included state root, Helm lint/render and rendered-output integrity checks. See validation-report.json for actual results. Local checks do not prove cloud policies, quotas, state alignment, credentials, cluster admission or runtime health. The preview files deliberately contain unresolved tenant values and must never be applied. Native cloud planning, test deployment and runtime checks remain outstanding; the bundle is not labelled deployment validated. Bicep is not a second owner of these Terraform-managed resources.\n\n## Deployment through the existing owner\n\n1. Use the existing Cortex tenant and platform setup. Verify tenant namespace, image pull access, network/private DNS, workload identity, platform gateway, node-pool selectors/capacity and the selected environment's Azure credentials/state backend. The indexer scheduling/resources are retained exactly; no invented worker capacity is supplied.\n2. Reconcile the reviewed commit with the live Cortex release. The operator's Argo revision is a platform setting, not a per-application pin. Both the operator's chart source and the tenant-infra workflow must use the reviewed source revision (or an explicitly re-reviewed release). Do not modify a shared operator revision to deploy one app without platform review.\n3. Copy deployment-inputs.example.json to a private path and provide actual existing tenant inputs and stable ApplicationDeployment names. For existing deployments, use their current metadata names; do not create duplicates. Run node render-deployment.mjs /private/path/inputs.json > rendered-deployment.json. This renders only; it makes no cloud or cluster changes. It preserves the existing Helm values-file references and passes saved replica overrides through the supported CR contract.\n4. Review the rendered CRs and run kubectl --context YOUR_CONTEXT --namespace YOUR_NAMESPACE apply --server-side --dry-run=server -f rendered-deployment.json. The required ApplicationDeployment CRD is preserved under cortex/platform/services/tenant-operator/config/crd/bases. Confirm admission, tenant ownership and infrastructure mode. Apply through the existing Cortex/GitOps process only after approval of the actual change. The tenant owner schedules the original tenant-infra workflow; do not run a second independent terraform apply against its state.\n5. Verify tenant-infra workflow completion, app-infra-* ConfigMaps (including peer keys), secret/identity readiness, Argo sync/health, migration jobs, controller replicas, requests/limits, service health and data paths. Review plan.json if present for additional recommendations; evidence.json and configuration-coverage.json retain every scoped observation. AI review ${plan ? 'completed' : 'is still outstanding and must be reviewed before production rollout'}.\n\nNo tenant identity, cloud resources or successful deployment are inferred from the repository. Credential files, state and live secret values are not included.\n`;
  const fingerprints = Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)).map(([file, content]) => [file, hash(content)]));
  files['validation-spec.json'] = json({ version: 1, contract: 'cortex-native', architectureId: graph.id, designRevision: design.revision, bundleHash: hash(JSON.stringify(fingerprints)), files: fingerprints, terraformRoots: roots.map(r => `cortex/${r}`), charts });
  return files;
}

const nativeDeploymentRenderer = String.raw`import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = dirname(fileURLToPath(import.meta.url));
const selection = JSON.parse(await readFile(join(root, 'cortex-selection.json'), 'utf8'));
const inputs = JSON.parse(await readFile(process.argv[2], 'utf8'));
if (!/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(inputs.tenantName ?? '') || inputs.namespace !== 'tenant-' + inputs.tenantName || inputs.namespace.length > 63) throw new Error('Supply the actual existing tenant name and matching tenant namespace.');
if (inputs.verifiedOperatorRevision !== selection.revision || inputs.verifiedWorkflowRevision !== selection.revision) throw new Error('The operator and workflow source revisions must match the reviewed Cortex commit. Refresh/review after a release change.');
const items = [];
for (const app of selection.applications) {
 const name = inputs.applicationDeploymentNames?.[app];
 if (typeof name !== 'string' || name.length > 63 || !/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(name)) throw new Error('Supply the actual ApplicationDeployment name for ' + app + '; existing deployments must not be duplicated.');
 const item = JSON.parse(await readFile(join(root, 'deployment', app + '.template.json'), 'utf8'));
 item.metadata.name = name; item.metadata.namespace = inputs.namespace; items.push(item);
}
console.log(JSON.stringify({apiVersion:'v1', kind:'List', items}, null, 2));
`;
