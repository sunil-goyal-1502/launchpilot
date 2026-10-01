import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cortexCatalog, cortexConnectionSchema, chooseCortexDefinition, syncCortexConnection, readCortexConnection, type CortexSource } from '../../../packages/web/src/lib/cortex-connection';
let directory: string;
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'lp-cortex-connection-')); vi.stubEnv('LAUNCHPILOT_CORTEX_DIR', directory); });
afterEach(async () => { vi.unstubAllEnvs(); await rm(directory, { recursive: true, force: true }); });
const files: Record<string, string> = {
  'gitops/prod/application-definitions/kustomization.yaml': 'apiVersion: kustomize.config.k8s.io/v1beta1\nkind: Kustomization\nresources: [../../_application-definitions/app]\n',
  'gitops/_application-definitions/app/kustomization.yaml': 'apiVersion: kustomize.config.k8s.io/v1beta1\nkind: Kustomization\nresources: [definition.yaml]\n',
  'gitops/_application-definitions/app/definition.yaml': 'apiVersion: cortex.cortex.ai/v1alpha1\nkind: ApplicationDefinition\nmetadata: {name: app-0-0-2}\nspec: {applicationId: app, version: 0.0.2, infrastructure: {mode: Terraform}}\n',
  'gitops/_application-definitions/not-promoted/definition.yaml': 'apiVersion: cortex.cortex.ai/v1alpha1\nkind: ApplicationDefinition\nmetadata: {name: app-9-0-0}\nspec: {applicationId: app, version: 9.0.0, infrastructure: {mode: Terraform}}\n',
};
const source = (revision: string): CortexSource => ({ revision, files: Object.keys(files), read: async path => { if (!(path in files)) throw new Error('missing'); return files[path]; } });
describe('Cortex connection and freshness', () => {
  it('keeps only environment-registered releases in the catalog', async () => {
    const choices = await cortexCatalog(source('a'.repeat(40)));
    expect(choices).toEqual([{ environment: 'prod', applicationId: 'app', definitionName: 'app-0-0-2', version: '0.0.2', mode: 'Terraform' }]);
    expect(chooseCortexDefinition(choices, 'app', 'prod').definitionName).toBe('app-0-0-2');
    expect(() => chooseCortexDefinition(choices, 'app', 'qa')).toThrow('no registered');
    expect(() => chooseCortexDefinition(choices, 'app', 'prod', 'app-9-0-0')).toThrow('not registered');
  });
  it('fetches again before each new plan and never silently reuses stale artifacts after failure', async () => {
    const acquire = vi.fn().mockResolvedValueOnce(source('a'.repeat(40))).mockResolvedValueOnce(source('b'.repeat(40))).mockRejectedValueOnce(new Error('Git unavailable'));
    const config = { repoUrl: 'https://github.com/Cortex-Inception/cortex', ref: 'main' };
    const first = await syncCortexConnection(config, acquire);
    const second = await syncCortexConnection(undefined, acquire);
    expect(first.source.revision).toBe('a'.repeat(40));
    expect(second.source.revision).toBe('b'.repeat(40));
    await expect(syncCortexConnection(undefined, acquire)).rejects.toThrow('Git unavailable');
    expect(await readCortexConnection()).toMatchObject({ revision: 'b'.repeat(40), error: 'Git unavailable', ref: 'main' });
    expect(acquire).toHaveBeenCalledTimes(3);
  });
  it('selects a semantic registered release and requires a choice for ambiguous releases', () => {
    const definition = { environment: 'prod', applicationId: 'app', mode: 'Terraform' };
    const choices = [{ ...definition, definitionName: 'app-0-0-9', version: '0.0.9' }, { ...definition, definitionName: 'app-0-0-10', version: '0.0.10' }];
    expect(chooseCortexDefinition(choices, 'app', 'prod').version).toBe('0.0.10');
    expect(() => chooseCortexDefinition([...choices, { ...choices[1], definitionName: 'duplicate' }], 'app', 'prod')).toThrow('same version');
  });
  it('rejects credential-bearing URLs, local repositories and option/ref injection', () => {
    for (const repoUrl of ['https://token@github.com/org/repo', 'file:///tmp/repo', 'https://github.com/org/repo?token=x', 'https://other.example/org/repo']) expect(cortexConnectionSchema.safeParse({ repoUrl, ref: 'main' }).success).toBe(false);
    for (const ref of ['--upload-pack=evil', 'main:other', '../main', 'main.lock', 'main\n']) expect(cortexConnectionSchema.safeParse({ repoUrl: 'https://github.com/org/repo', ref }).success).toBe(false);
  });
});
