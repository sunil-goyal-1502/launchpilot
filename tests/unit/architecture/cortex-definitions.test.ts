import { describe, expect, it } from 'vitest';
import { resolveCortexDefinitions } from '../../../packages/core/src/architecture/cortex-definitions';
const read = (files: Record<string, string>) => async (file: string) => {
  if (!(file in files)) throw new Error('Missing file');
  return files[file];
};
const definition = `apiVersion: cortex.cortex.ai/v1alpha1
kind: ApplicationDefinition
metadata:
  name: insight-0-0-2
spec:
  applicationId: insight
  deployment:
    serviceValuesRef: services/insight/chart/values.yaml
  dependencies:
    - definitionRef:
        name: rag-old
    - definitionRef:
        name: no-longer-selected
`;
describe('current Cortex environment definition overlays', () => {
  it('applies nested environment patches in order, replacing dependency arrays and retaining source provenance', async () => {
    const files = {
      'gitops/prod/kustomization.yaml': `kind: Kustomization
resources: [../base]
patches:
  - target: {group: cortex.cortex.ai, kind: ApplicationDefinition, name: insight-0-0-2}
    patch: |
      - op: replace
        path: /spec/deployment/serviceValuesRef
        value: services/insight/chart/values-prod.yaml
      - op: replace
        path: /spec/dependencies
        value: [{definitionRef: {name: rag-ingestion-0-1-0}}]
      - op: add
        path: /spec/deployment/platformValuesRef
        value: gitops/prod/app-values/insight.yaml
`,
      'gitops/base/kustomization.yaml': 'kind: Kustomization\nresources: [definition.yaml]',
      'gitops/base/definition.yaml': definition,
    };
    const [resolved] = await resolveCortexDefinitions(read(files), 'gitops/prod/kustomization.yaml');
    expect(resolved.value.spec.deployment).toEqual({ serviceValuesRef: 'services/insight/chart/values-prod.yaml', platformValuesRef: 'gitops/prod/app-values/insight.yaml' });
    expect(resolved.value.spec.dependencies).toEqual([{ definitionRef: { name: 'rag-ingestion-0-1-0' } }]);
    expect(resolved.files).toEqual(['gitops/base/definition.yaml', 'gitops/base/kustomization.yaml', 'gitops/prod/kustomization.yaml']);
    expect(files['gitops/base/definition.yaml']).toBe(definition);
  });
  it('does not approximate unsupported transforms or read outside the pinned repository', async () => {
    await expect(resolveCortexDefinitions(read({ 'kustomization.yaml': 'kind: Kustomization\nresources: [https://example.test/remote.yaml]' }), 'kustomization.yaml')).rejects.toThrow('local repository');
    await expect(resolveCortexDefinitions(read({ 'kustomization.yaml': 'kind: Kustomization\nresources: [../private.yaml]' }), 'kustomization.yaml')).rejects.toThrow('escapes');
    await expect(resolveCortexDefinitions(read({ 'kustomization.yaml': 'kind: Kustomization\nnamespace: prod\nresources: []' }), 'kustomization.yaml')).rejects.toThrow('unsupported transformers');
    await expect(resolveCortexDefinitions(read({ 'kustomization.yaml': 'kind: Kustomization\nresources: [kustomization.yaml]' }), 'kustomization.yaml')).rejects.toThrow('Cyclic');
  });
  it('fails on a missing patch target path instead of inventing defaults', async () => {
    const files = { 'app.yaml': definition, 'kustomization.yaml': `kind: Kustomization
resources: [app.yaml]
patches:
  - target: {kind: ApplicationDefinition}
    patch: |
      - op: replace
        path: /spec/deployment/missing
        value: prod
` };
    await expect(resolveCortexDefinitions(read(files), 'kustomization.yaml')).rejects.toThrow('target does not exist');
  });
});
