import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, mkdtemp, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { resolveCortexDefinitions, prepareCortexPlatform, selectCortexPlatformTarget } from '@launchpilot/core';
import { loadArchitecture, once, saveArchitecture, saveSelectedDeployment } from './architecture-store';
import { prepareArchitectureReview } from './architecture-review';

const run = promisify(execFile);
const root = () => process.env.LAUNCHPILOT_CORTEX_DIR || join(dirname(process.env.LAUNCHPILOT_ARCHITECTURE_DIR || join(process.cwd(), 'data', 'architectures')), 'platform-sources');
export const cortexConnectionSchema = z.object({
  repoUrl: z.string().regex(/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/?$/, 'Use an HTTPS GitHub repository URL without credentials.').transform(v => v.replace(/\/$/, '').replace(/\.git$/, '')),
  ref: z.string().min(1).max(200).regex(/^[A-Za-z0-9][A-Za-z0-9_./-]*$/).refine(v => !v.includes('..') && !v.includes('//') && !v.endsWith('/') && !v.endsWith('.') && !v.endsWith('.lock'), 'Use a branch name.'),
}).strict();
export interface CortexDefinitionChoice { environment: string; applicationId: string; definitionName: string; version: string; mode: string }
export type CortexConnection = z.infer<typeof cortexConnectionSchema> & {
  checkedAt?: string; revision?: string; error?: string; definitions?: CortexDefinitionChoice[];
};
export async function readCortexConnection(): Promise<CortexConnection> {
  try { return JSON.parse(await readFile(join(root(), 'connection.json'), 'utf8')); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('The Cortex connection settings could not be read.');
    return cortexConnectionSchema.parse({ repoUrl: process.env.LAUNCHPILOT_CORTEX_REPO || 'https://github.com/Cortex-Inception/cortex', ref: process.env.LAUNCHPILOT_CORTEX_REF || 'main' });
  }
}
async function saveConnection(value: CortexConnection) {
  await mkdir(root(), { recursive: true, mode: 0o700 });
  const tmp = join(root(), `.connection-${randomUUID()}.json`);
  await writeFile(tmp, JSON.stringify(value), { mode: 0o600 });
  await rename(tmp, join(root(), 'connection.json'));
}
const git = async (args: string[]) => (await run('git', args, { encoding: 'utf8', timeout: 120000, maxBuffer: 16 * 1024 * 1024,
  env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' } })).stdout;
export interface CortexSource { revision: string; files: string[]; read: (file: string) => Promise<string> }

/** Export must use the reviewed commit, even if the connected branch has moved. */
export async function readPinnedCortexSource(target: { repoUrl: string; revision: string }): Promise<CortexSource> {
  const { repoUrl } = cortexConnectionSchema.parse({ repoUrl: target.repoUrl, ref: 'main' });
  if (!/^[a-f0-9]{40}$/.test(target.revision)) throw new Error('The saved Cortex revision is invalid.');
  const objects = join(root(), 'git', createHash('sha256').update(repoUrl).digest('hex'));
  const args = ['--git-dir', objects, '-c', 'core.hooksPath=/dev/null'];
  let records: string;
  try { records = await git([...args, 'ls-tree', '-rz', '--full-tree', target.revision]); }
  catch { throw new Error('The pinned Cortex artifacts are unavailable on this server. Refresh Cortex to create a new review; export never silently switches commits.'); }
  const files = records.split('\0').filter(Boolean).flatMap(record => {
    const [meta, file] = record.split('\t');
    return /^100(?:644|755) blob /.test(meta) && file && !file.startsWith('/') && !file.split('/').includes('..') ? [file] : [];
  });
  return { revision: target.revision, files, read: async file => {
    if (!files.includes(file)) throw new Error('Missing regular file in the pinned Cortex contract: ' + file);
    const content = await git([...args, 'show', `${target.revision}:${file}`]);
    if (content.includes('\0') || Buffer.byteLength(content) > 2 * 1024 * 1024) throw new Error('Unsupported Cortex artifact: ' + file);
    return content;
  } };
}

/** Fetch into an isolated bare object store. Never check out, run hooks, update
 * a user's checkout, follow submodules, or serialize credentials to the browser.
 * A failed freshness check never silently substitutes cached artifacts.
 */
async function fetchSource(config: z.infer<typeof cortexConnectionSchema>): Promise<CortexSource> {
  const key = createHash('sha256').update(config.repoUrl).digest('hex');
  const objects = join(root(), 'git', key);
  await mkdir(objects, { recursive: true, mode: 0o700 });
  await git(['init', '--bare', objects]);
  const ref = `refs/launchpilot/${randomUUID()}`;
  const args = ['--git-dir', objects, '-c', 'core.hooksPath=/dev/null'];
  try {
    try { await git([...args, 'fetch', '--no-tags', '--depth=1', config.repoUrl, `+refs/heads/${config.ref}:${ref}`]); }
    catch {
      // gh's existing server login is also used for other private project repos.
      // The helper sends credentials through Git's credential protocol, not argv.
      await git([...args, '-c', 'credential.helper=', '-c', 'credential.helper=!gh auth git-credential', 'fetch', '--no-tags', '--depth=1', config.repoUrl, `+refs/heads/${config.ref}:${ref}`]);
    }
    const revision = (await git([...args, 'rev-parse', `${ref}^{commit}`])).trim();
    if (!/^[a-f0-9]{40}$/.test(revision)) throw new Error('Invalid Git revision');
    const records = (await git([...args, 'ls-tree', '-rz', '--full-tree', revision])).split('\0').filter(Boolean);
    const blobs = new Set<string>();
    for (const entry of records) {
      const [meta, file] = entry.split('\t');
      if (/^100(?:644|755) blob /.test(meta) && file && !file.startsWith('/') && !file.split('/').includes('..')) blobs.add(file);
    }
    return { revision, files: [...blobs], read: async file => {
      if (!blobs.has(file)) throw new Error(`Cortex artifact is not a regular tracked file: ${file}`);
      const text = await git([...args, 'show', `${revision}:${file}`]);
      if (Buffer.byteLength(text) > 2 * 1024 * 1024 || text.includes('\0')) throw new Error(`Cortex artifact exceeds the text-file limit: ${file}`);
      return text;
    } };
  } catch { throw new Error('Could not fetch the Cortex branch. Check the repository, branch and LaunchPilot server Git/GitHub access. The previous saved deployment remains pinned.'); }
}

export async function cortexCatalog(source: CortexSource) {
  const definitions: CortexDefinitionChoice[] = [];
  for (const entry of source.files.filter(f => /^gitops\/[a-z][a-z0-9-]*\/application-definitions\/kustomization\.yaml$/.test(f))) {
    const environment = entry.split('/')[1];
    for (const { value } of await resolveCortexDefinitions(source.read, entry)) {
      if (value.kind !== 'ApplicationDefinition' || !value.spec?.applicationId) continue;
      definitions.push({ environment, applicationId: value.spec.applicationId, definitionName: value.metadata.name, version: String(value.spec.version ?? ''), mode: String(value.spec.infrastructure?.mode ?? '') });
    }
  }
  if (!definitions.length) throw new Error('No environment-registered Cortex application definitions were found on this branch.');
  return definitions.sort((a, b) => `${a.environment}:${a.applicationId}:${a.definitionName}`.localeCompare(`${b.environment}:${b.applicationId}:${b.definitionName}`));
}

export async function syncCortexConnection(input?: z.infer<typeof cortexConnectionSchema>, acquire = fetchSource) {
  const previous = await readCortexConnection();
  const config = cortexConnectionSchema.parse(input ?? { repoUrl: previous.repoUrl, ref: previous.ref });
  return once(`cortex-sync:${JSON.stringify(config)}`, async () => {
    const checkedAt = new Date().toISOString();
    try {
      const source = await acquire(config);
      const connection: CortexConnection = { ...config, checkedAt, revision: source.revision, definitions: await cortexCatalog(source) };
      await saveConnection(connection);
      return { connection, source };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Cortex synchronization failed';
      await saveConnection({ ...(previous.repoUrl === config.repoUrl && previous.ref === config.ref ? previous : {}), ...config, checkedAt, error: message });
      throw new Error(message);
    }
  });
}

/** Latest *registered* release, not the largest version found elsewhere in Git. */
export function chooseCortexDefinition(choices: CortexDefinitionChoice[], applicationId: string, environment: string, definitionName?: string) {
  const candidates = choices.filter(d => d.applicationId === applicationId && d.environment === environment);
  if (definitionName) {
    const exact = candidates.find(d => d.definitionName === definitionName);
    if (!exact) throw new Error('This Cortex definition is not registered for the selected application and environment on the latest branch.');
    return exact;
  }
  if (!candidates.length) throw new Error('Cortex has no registered definition for this application and environment.');
  if (candidates.length === 1) return candidates[0];
  if (candidates.some(d => !/^\d+\.\d+\.\d+$/.test(d.version))) throw new Error('Choose a registered Cortex definition; its release versions are ambiguous.');
  candidates.sort((a,b) => { const av=a.version.split('.').map(Number), bv=b.version.split('.').map(Number); return bv[0]-av[0] || bv[1]-av[1] || bv[2]-av[2]; });
  if (candidates[0].version === candidates[1].version) throw new Error('Choose a registered Cortex definition; multiple definitions have the same version.');
  return candidates[0];
}

export async function prepareConnectedCortexTarget(input: { applicationArchitectureId: string; applicationId: string; environment: string; definitionName?: string }) {
  const original = await loadArchitecture(input.applicationArchitectureId);
  const application = original.deploymentTarget ? await loadArchitecture(original.deploymentTarget.applicationArchitectureId) : original;
  const { connection, source } = await syncCortexConnection();
  const definition = chooseCortexDefinition(connection.definitions!, input.applicationId, input.environment, input.definitionName);
  if (definition.mode !== 'Terraform') throw new Error(`The selected Cortex definition uses ${definition.mode || 'an unspecified infrastructure contract'}; this connector currently supports its Terraform + Helm contract.`);
  const resolved = await resolveCortexDefinitions(source.read, `gitops/${input.environment}/application-definitions/kustomization.yaml`);
  const selected = [resolved.find(d => d.value.metadata?.name === definition.definitionName)!];
  for (let i=0; i<selected.length; i++) for (const dependency of selected[i].value.spec.dependencies ?? []) {
    const next = resolved.find(d => d.value.metadata?.name === dependency.definitionRef?.name);
    if (!next) throw new Error('An application dependency is not registered in this Cortex environment.');
    if (!selected.includes(next)) selected.push(next);
  }
  const apps = selected.map(d => String(d.value.spec.applicationId));
  const definitionFiles = new Set(selected.flatMap(d => d.files));
  const valuesFiles = new Set(selected.flatMap(d => [d.value.spec.deployment?.serviceValuesRef, d.value.spec.deployment?.platformValuesRef].filter(Boolean)));
  const paths = source.files.filter(f =>
    definitionFiles.has(f) || valuesFiles.has(f)
    || apps.some(app => f.startsWith(`services/${app}/chart/`) || f.startsWith(`infra/tenant/app/${app}/`))
    || /^infra\/tenant\/[^/]+\.tf$/.test(f)
    || /^infra\/(?:base|frontdoor-edge)\/[^/]+\.tf$/.test(f)
    || f === '.github/workflows/tenant-infra.yml'
    || /^platform\/services\/tenant-operator\/internal\/controller\/applicationdeployment.*\.go$/.test(f));
  if (paths.length > 3000) throw new Error('Cortex artifact coverage exceeds the preparation limit; no partial plan was created.');
  const workspace = await mkdtemp(join(root(), 'prepare-'));
  try {
    for (const file of paths) {
      const content = await source.read(file);
      const dest = join(workspace, file);
      await mkdir(dirname(dest), { recursive: true, mode: 0o700 });
      await writeFile(dest, content, { mode: 0o600 });
    }
    const platform = await prepareCortexPlatform({ snapshotPath: workspace, revision: source.revision, repoUrl: connection.repoUrl,
      applicationId: input.applicationId, definitionName: definition.definitionName, environment: input.environment, definitions: resolved });
    await saveArchitecture(platform);
    const graph = selectCortexPlatformTarget(application, platform, { ...input, definitionName: definition.definitionName, unitIds: platform.deploymentUnits.map(u => u.id) });
    graph.deploymentTarget!.ref = connection.ref;
    graph.deploymentTarget!.checkedAt = connection.checkedAt;
    await saveArchitecture(graph);
    const review = await prepareArchitectureReview(graph, graph.deploymentUnits.map(u => u.id), undefined, 'azure', input.environment);
    await saveSelectedDeployment(application.id, graph.id, review.design.id);
    if (original.id !== application.id && original.id !== graph.id) await saveSelectedDeployment(original.id, graph.id, review.design.id);
    return { graph, review, connection, url: `/architecture/${graph.id}?design=${review.design.id}` };
  } finally { await rm(workspace, { recursive: true, force: true }); }
}
