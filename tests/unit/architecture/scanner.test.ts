import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scanRepositoryArchitecture } from '../../../packages/core/src/architecture/scanner';
import { readTypeScriptConnections } from '../../../packages/core/src/architecture/source-reader';
import { selectArchitectureScope } from '../../../packages/core/src/architecture/planner';

const fixture = join(process.cwd(), 'tests/fixtures/evidence-app');
const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(d => rm(d, { recursive: true, force: true }))); });
describe('repository resource evidence', () => {
  it('inventories nested deployment definitions and traces code, database, cache and vault delivery without reading secrets', async () => {
    const graph = await scanRepositoryArchitecture(fixture, 'local://fixture');
    expect(new Set(graph.deploymentUnits.map(u => u.format))).toEqual(new Set(['terraform', 'bicep', 'kubernetes', 'compose']));
    expect(graph.resources.some(r => r.kind === 'database' && r.name === 'db')).toBe(true);
    expect(graph.resources.some(r => r.kind === 'cache' && r.name === 'cache')).toBe(true);
    expect(graph.connections.some(e => e.relationship === 'connects using DATABASE_URL (postgres)')).toBe(true);
    expect(graph.connections.some(e => e.relationship === 'passes DATABASE_URL to client constructor/call')).toBe(true);
    expect(graph.connections.some(e => e.relationship === 'supplies CSI secrets')).toBe(true);
    expect(graph.connections.some(e => e.relationship === 'synchronizes secret')).toBe(true);
    expect(graph.connections.some(e => e.relationship === 'mounts secrets through CSI')).toBe(true);
    expect(graph.connections.some(e => e.relationship === 'selects pods by labels')).toBe(true);
    expect(graph.connections.some(e => e.relationship === 'routes HTTP to')).toBe(true);
    expect(graph.bindings.find(b => b.consumerId.startsWith('k8s:') && b.key === 'DATABASE_URL')?.resolved).toBe(true);
    expect(graph.bindings.some(b => b.key.startsWith('FAKE_'))).toBe(false);
    expect(graph.evidence.find(e => e.summary === 'Reads environment variable DATABASE_URL passed to pg')?.line).toBe(4);
    const ids = new Set(graph.resources.map(r => r.id));
    for (const edge of graph.connections) { expect(ids.has(edge.from)).toBe(true); expect(ids.has(edge.to)).toBe(true); expect(edge.evidence.length).toBeGreaterThan(0); }
    expect(graph.coverage.runtimeVerified).toBe(false);
    expect(graph.recommendations).toHaveLength(graph.gaps.length);
  });
  it('keeps scopes separate and includes code/configuration evidence in the selected review', async () => {
    const graph = await scanRepositoryArchitecture(fixture, 'local://fixture');
    const scope = selectArchitectureScope(graph, ['compose:compose.yaml']);
    expect(scope.resources.some(r => r.id.startsWith('k8s:'))).toBe(false);
    expect(scope.deploymentContext.some(f => f.file.endsWith('workload.yaml'))).toBe(false);
    expect(scope.resources.some(r => r.origin === 'code')).toBe(true);
    const kubeScope = selectArchitectureScope(graph, ['kubernetes:deploy/prod']);
    expect(kubeScope.resources.some(r => r.kind === 'vault' && r.name === 'evidence-production-vault')).toBe(true);
    expect(() => selectArchitectureScope(graph, [])).toThrow('Select at least one');
  });
  it('excludes secret files, state and symlinks; redacts embedded values while keeping key names', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lp-evidence-')); dirs.push(dir);
    await mkdir(join(dir, '.github/workflows'), { recursive: true });
    await writeFile(join(dir, '.env'), 'DATABASE_URL=never-read-this-value');
    await writeFile(join(dir, 'private.tfvars'), 'password="never-read-this-either"');
    await writeFile(join(dir, '.github/workflows/deploy.yml'), 'name: deploy\non: push\njobs: {}\n');
    await writeFile(join(dir, 'secrets.yaml'), 'apiVersion: v1\nkind: Secret\nmetadata:\n  name: database\nstringData:\n  url: TOP_SECRET_VALUE\ndata:\n  password: BASE64_SECRET_VALUE\n');
    await writeFile(join(dir, 'compose.yaml'), 'services:\n  api:\n    image: app:v1\n    environment:\n      API_KEY: LITERAL_SECRET_VALUE\n      DATABASE_URL: postgres://user:HIDDEN_PASSWORD@db:5432/app\n');
    await symlink('/etc', join(dir, 'outside'));
    const graph = await scanRepositoryArchitecture(dir, 'local://fixture');
    const serialized = JSON.stringify(graph);
    for (const secret of ['never-read-this-value', 'never-read-this-either', 'TOP_SECRET_VALUE', 'BASE64_SECRET_VALUE', 'LITERAL_SECRET_VALUE', 'HIDDEN_PASSWORD']) expect(serialized).not.toContain(secret);
    expect(graph.coverage.excluded.find(e => e.path === '.env')?.reason).toContain('not read');
    expect(graph.coverage.excluded.find(e => e.path === 'outside')?.reason).toContain('not followed');
    expect(graph.deploymentUnits.some(u => u.format === 'workflow')).toBe(true);
    const limited = await scanRepositoryArchitecture(dir, 'local://fixture', { maxFiles: 1 });
    expect(limited.coverage.truncated).toBe(true);
    expect(limited.gaps.some(g => g.code === 'scan-limit')).toBe(true);
  });
  it('uses JS/TS syntax, not text inside comments or strings, and follows local constructor aliases', () => {
    const result = readTypeScriptConnections('db.ts', `import { Pool } from 'pg';\nconst { DATABASE_URL: url } = process.env;\nconst p = new Pool({connectionString:url});\n// process.env.IGNORE\nconst x = 'process.env.ALSO_IGNORE';`);
    expect(result.reads.map(r => r.key)).toEqual(['DATABASE_URL']);
    expect(result.reads[0].client).toBe('pg');
  });
});
