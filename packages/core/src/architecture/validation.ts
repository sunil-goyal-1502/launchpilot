import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { dirname, join, isAbsolute, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { parseAllDocuments } from 'yaml';
import { validationRuntimeSource } from './validation-runtime';
import { validationTargetSchema, validationReportSchema, isValidationComplete, type ValidationReport, type ValidationTarget } from './validation-types';
import type { DeploymentTopology } from './deployment-topology';

const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const json = (value: unknown) => JSON.stringify(value, null, 2) + '\n';
export function prepareValidationBundle(input: Record<string, string>): Record<string, string> {
  const files = { ...input };
  for (const name of Object.keys(files)) if (isAbsolute(name) || name.split('/').includes('..') || name.startsWith('validation-') || name === 'validate.mjs') throw new Error('Unsafe or reserved generated file: ' + name);
  const graph = JSON.parse(files['evidence.json']), plan = JSON.parse(files['plan.json']);
  const topology: DeploymentTopology = JSON.parse(files['deployment-topology.json']);
  const design = files['architecture-design.json'] ? JSON.parse(files['architecture-design.json']) : undefined;
  const template = JSON.parse(files['architecture.arm.json']);
  const documents: Array<{ file: string; value: any }> = [];
  for (const [file, content] of Object.entries(files)) if (/^support\/.+\.(json|ya?ml)$/.test(file) && !file.endsWith('.template.json')) {
    for (const doc of parseAllDocuments(content)) {
      if (doc.errors.length) throw new Error('Invalid supporting manifest: ' + file);
      const value = doc.toJS({ maxAliasCount: 50 });
      for (const item of value?.kind === 'List' ? value.items : [value]) if (item?.apiVersion && item?.kind) documents.push({ file, value: item });
    }
  }
  const manifests = [...new Set(documents.map(d => d.file))];
  const cortexApp = documents.find(d => d.value.kind === 'CortexApp')?.value;
  const requiredSecrets = new Map<string, Set<string>>();
  function collect(value: any) {
    if (!value || typeof value !== 'object') return;
    const ref = value.secretKeyRef ?? value.secretRef;
    if (ref?.name && !ref.optional) {
      const name = String(ref.name).replaceAll('$(CORTEX_APP_NAME)', cortexApp?.metadata.name ?? '$(CORTEX_APP_NAME)');
      if (!requiredSecrets.has(name)) requiredSecrets.set(name, new Set());
      if (ref.key) requiredSecrets.get(name)!.add(ref.key);
    }
    for (const child of Object.values(value)) collect(child);
  }
  documents.forEach(d => collect(d.value));
  const definition = documents.find(d => d.value.kind === 'ApplicationDefinition' && d.value.metadata.name === cortexApp?.spec.definitionRef?.name)?.value;
  for (const injection of Object.values<any>(definition?.spec.secretInjection ?? {})) if (injection.secretName) {
    const name = String(injection.secretName).replaceAll('$(CORTEX_APP_NAME)', cortexApp.metadata.name);
    if (!requiredSecrets.has(name)) requiredSecrets.set(name, new Set());
    for (const entry of injection.env ?? []) if (entry.key) requiredSecrets.get(name)!.add(entry.key);
  }
  const workloads = topology.workloads.map(w => {
    const appContainer = w.containers.find(c => c.role === 'application');
    const component = definition?.spec.components.find((c: any) => c.name === appContainer?.name);
    const effective = { ...component, ...cortexApp?.spec.componentConfig?.[appContainer?.name ?? ''] };
    const environment = component ? [...(effective.env ?? [])] : [];
    for (const capability of effective.uses ?? []) for (const binding of definition?.spec.secretInjection?.[capability]?.env ?? []) {
      const name = definition.spec.secretInjection[capability].secretName.replaceAll('$(CORTEX_APP_NAME)', cortexApp.metadata.name);
      if (!environment.some((e: any) => e.name === binding.name)) environment.push({ name: binding.name, valueFrom: { secretKeyRef: { name, key: binding.key } } });
    }
    // Only compare explicit values; operator-resolved placeholders require the real platform contract.
    const expectedEnvironment = environment.map((entry: any) => ({ name: entry.name, ...(typeof entry.value === 'string' && !/\$\(|\$\{|\[REDACTED/.test(entry.value) ? { value: entry.value } : {}), ...(entry.valueFrom?.secretKeyRef ? { secretKeyRef: { ...entry.valueFrom.secretKeyRef, name: entry.valueFrom.secretKeyRef.name.replaceAll('$(CORTEX_APP_NAME)', cortexApp.metadata.name) } } : {}) }));
    return { id: w.id, name: /Cortex/.test(w.controller) ? `${cortexApp?.metadata.name}-${appContainer?.name}` : w.name, controller: /Cortex/.test(w.controller) ? 'Deployment' : w.controller, replicas: w.replicas, minReplicas: w.minReplicas, maxReplicas: w.maxReplicas, namespace: w.namespace, containers: w.containers, environment: expectedEnvironment, applicationContainer: appContainer?.name };
  });
  const capabilities = topology.nodes.filter(n => /\(Cortex capability\)$/.test(n.technology));
  const requiredHealthComponents = topology.workloads.filter(w => w.exposed).map(w => w.id);
  const requiredReadinessComponents = capabilities.map(n => ({ id: n.id, name: n.name }));
  const platformRequirements = (files['deployment-readiness.json'] ? JSON.parse(files['deployment-readiness.json']).requiredChecks ?? [] : []).map((c: any, index: number) => ({ id: `platform-${index + 1}-${digest(c.name).slice(0, 8)}`, name: c.name, action: c.action }));
  files['validate.mjs'] = validationRuntimeSource;
  files['validation-target.example.json'] = json({ id: 'select-target', name: 'Non-production validation target', environment: 'preprod', architectureId: graph.id, unitIds: plan.unitIds, subscriptionId: null, resourceGroupName: null, location: null, parameters: Object.fromEntries(Object.entries<any>(template.parameters).map(([name, value]) => [name, { value: value.defaultValue ?? null }])), ...(manifests.length ? { kubernetes: { context: null, namespace: topology.namespaces.length === 1 ? topology.namespaces[0] : null } } : {}), allowTestDeployment: false, testDeploymentMethod: 'bicep', healthChecks: requiredHealthComponents.map(id => ({ name: topology.workloads.find(w => w.id === id)!.name, componentIds: [id], url: null, expectedStatus: 200 })), resourceChecks: requiredReadinessComponents.map(c => ({ name: c.name, componentIds: [c.id], resource: null, namespace: topology.namespaces.length === 1 ? topology.namespaces[0] : null, condition: null, expected: 'True' })) });
  const targetExample = JSON.parse(files['validation-target.example.json']);
  targetExample.platformChecks = platformRequirements.map((c: any) => ({ name: c.name, requirementIds: [c.id], source: { type: 'http', url: null }, assertions: [{ pointer: null, equals: null }] }));
  files['validation-target.example.json'] = json(targetExample);
  files['VALIDATION.md'] = '# Validation of this generated revision\n\nRun `node validate.mjs --config /private/path/validation-target.json`. Terraform and Bicep must be installed. Azure CLI and kubectl use the explicitly selected subscription and context. The validator does not switch account defaults. Use LAUNCHPILOT_TERRAFORM_BIN, LAUNCHPILOT_BICEP_BIN, LAUNCHPILOT_AZ_BIN and LAUNCHPILOT_KUBECTL_BIN to select installed tool paths. Node.js 22 or newer is required.\n\nLocal checks always run. Azure Provider validation, what-if, Terraform plan and Kubernetes server-side dry runs require completed target inputs. Missing tools, credentials, inputs, CRDs or unresolved previews cannot pass. Every result is recorded in validation-report.json and tied to the bundle hash and target fingerprint. Editing generated files requires regeneration and revalidation.\n\nA real test deployment additionally requires an explicitly enabled non-production target and `--deploy-test`. It creates a fresh dedicated Azure resource group and applies the exported manifests to the target namespace, using the selected entry point. It never adopts an existing Azure resource group. Review the exact manifests, namespace, images, secret ownership and resource changes before authorizing it. Test resources remain for review; the validator does not delete cloud resources. Do not use a production namespace. Health URLs and dependency readiness conditions must be supplied from the application/platform contract. A deployment test exercises the selected entry point; both entry points receive static and planning checks.\n\nOnly a report whose required checks all passed is fully validated. A review bundle with blocked checks is not deployment validated. Azure/cluster validation can still become stale when policies, credentials, quotas or external resources change. Revalidate immediately before rollout. Secret parameter values must use Key Vault references; credentials, private input files, plan state and raw cloud outputs are not included in this ZIP.\n';
  files['.gitignore'] = (files['.gitignore'] ?? '') + '\nvalidation-target.json\nprivate-*.json\n*.plan\n';
  files['README.md'] = '# Validation results for this revision\n\nSee **validation-report.json** for the actual results of generation-time checks, and **VALIDATION.md** to rerun them. The design and deployment-readiness records below describe the state at template assembly; they are not a substitute for the validation report. A blocked or failed report is not deployment validated.\n\n' + (files['README.md'] ?? '');
  files['VALIDATION.md'] += '\n## Runtime coverage and worker storage\n\n`validation-target.example.json` lists this architecture’s exposed services and every Cortex capability that needs a runtime check. Bind their exact component IDs to health URLs or actual namespaced custom resources and readiness conditions. A single unrelated healthy service does not satisfy the remaining dependencies. Workload checks wait for controller reconciliation, then verify declared replicas (or the HPA range), containers, images, resource requests/limits, explicit environment values and Secret references. Secret checks list keys only. Unknown platform policies, such as backup restoration and provider-owned database replica counts, still require the platform acceptance process; this validator does not invent their implementation.\n\nFor a Terraform deployment test on the web/CLI worker, set `LAUNCHPILOT_VALIDATION_STATE_DIR` to an absolute private persistent directory. Each test has its own retained workspace and state there, including failed applies; state is never included in the ZIP. A standalone `node validate.mjs` run retains Terraform state in its current bundle directory. Choose one deployment entry point per test target. Both formats receive static and planning checks; `deploymentTestMethod` identifies the entry point actually applied.\n\nThe report also records the initialized provider lock hash. Keep the included `.terraform.lock.hcl` for repeatable provider selection. Do not modify generated files to bypass a failed check: regenerate the architecture revision and run validation again.\n';
  files['VALIDATION.md'] += '\n## Platform acceptance gate\n\nEvery requirement from deployment-readiness.json must be covered by platformChecks. Supply actual platform acceptance HTTP JSON endpoints or namespaced Kubernetes resources, with JSON-pointer assertions against their real contract. A Ready condition alone does not prove database HA/restore, network restrictions or source-only configuration. The validator checks the configured evidence automatically and blocks a complete pass when any requirement is uncovered. No presumed passing endpoint or provider schema is generated.\n';
  const hashes = Object.fromEntries(Object.keys(files).sort().map(name => [name, digest(files[name])]));
  const bundleHash = digest(JSON.stringify(hashes));
  files['validation-spec.json'] = json({ version: 1, bundleHash, files: hashes, architectureId: graph.id, unitIds: plan.unitIds, designRevision: design?.revision, manifests, namespaces: topology.namespaces, workloads, requiredSecrets: [...requiredSecrets].map(([name, keys]) => ({ name, keys: [...keys] })), requiredReadinessComponents, requiredHealthComponents, platformRequirements, componentIds: topology.nodes.map(n => n.id), secretSync: !!files['support/secret-sync.template.json'] });
  return files;
}

export async function validateGeneratedBundle(files: Record<string, string>, options: { target?: ValidationTarget; deployTest?: boolean; onProgress?: (report: ValidationReport) => Promise<void>; environment?: NodeJS.ProcessEnv } = {}) {
  if (options.target) validationTargetSchema.parse(options.target);
  if (options.deployTest && !options.target?.allowTestDeployment) throw new Error('The selected target does not authorize a test deployment');
  const environment = { ...process.env, ...options.environment };
  // Terraform test state survives worker restarts and is never exported in the ZIP.
  const durableDirectory = options.deployTest && options.target?.testDeploymentMethod === 'terraform' ? environment.LAUNCHPILOT_VALIDATION_STATE_DIR : undefined;
  if (durableDirectory && !isAbsolute(durableDirectory)) throw new Error('LAUNCHPILOT_VALIDATION_STATE_DIR must be an absolute persistent private directory');
  if (durableDirectory) await mkdir(durableDirectory, { recursive: true, mode: 0o700 });
  const root = await mkdtemp(join(durableDirectory ? resolve(durableDirectory) : tmpdir(), 'launchpilot-export-validation-'));
  let timer: ReturnType<typeof setInterval> | undefined, publishing = Promise.resolve();
  let fingerprint = '';
  async function publish() {
    try {
      const raw = await readFile(join(root, 'validation-report.json'), 'utf8');
      if (fingerprint === raw) return;
      const parsed = validationReportSchema.parse(JSON.parse(raw)); fingerprint = raw;
      await options.onProgress?.(parsed);
    } catch { /* First stage has not written its atomic report yet. */ }
  }
  try {
    for (const [name, content] of Object.entries(files)) { if (isAbsolute(name) || name.split('/').includes('..')) throw new Error('Unsafe bundle path'); await mkdir(dirname(join(root, name)), { recursive: true, mode: 0o700 }); await writeFile(join(root, name), content, { mode: 0o600 }); }
    const args = [join(root, 'validate.mjs')];
    if (options.target) { const config = join(root, 'private-validation-target.json'); await writeFile(config, json(options.target), { mode: 0o600 }); args.push('--config', config); }
    if (options.deployTest) args.push('--deploy-test');
    timer = setInterval(() => { publishing = publishing.then(publish); }, 500);
    await new Promise<void>((resolve, reject) => {
      const child = spawn(process.execPath, args, { cwd: root, shell: false, env: { ...environment, LAUNCHPILOT_VALIDATION_WORKER: '1', LAUNCHPILOT_VALIDATION_DURABLE_STATE: durableDirectory ? '1' : '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
      let errorOutput = '';
      child.stderr.on('data', value => { errorOutput = (errorOutput + value).slice(-3000); }); child.stdout.resume();
      child.on('error', reject);
      child.on('exit', code => [0, 1, 2].includes(code ?? -1) ? resolve() : reject(new Error('Validation worker did not complete: ' + errorOutput)));
    });
    clearInterval(timer); await publishing; await publish();
    const report = validationReportSchema.parse(JSON.parse(await readFile(join(root, 'validation-report.json'), 'utf8')));
    const spec = JSON.parse(files['validation-spec.json']);
    if (report.bundleHash !== spec.bundleHash || report.architectureId !== spec.architectureId || report.designRevision !== spec.designRevision) throw new Error('Validation report does not match the generated architecture revision');
    if (report.status === 'passed' && !isValidationComplete(report)) throw new Error('The validation worker returned an incomplete passing report');
    const result: Record<string, string> = { ...files, 'validation-report.json': json(report) };
    // Preserve the checked provider lock without exporting state or credentials.
    try { result['.terraform.lock.hcl'] = await readFile(join(root, '.terraform.lock.hcl'), 'utf8'); } catch { /* Initialization failed and the report records it. */ }
    return { files: result, report };
  } finally { if (timer) clearInterval(timer); await publishing; if (!durableDirectory) await rm(root, { recursive: true, force: true }); else await rm(join(root, 'private-validation-target.json'), { force: true }); }
}
