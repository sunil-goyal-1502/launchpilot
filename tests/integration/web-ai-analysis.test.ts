import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AIAnalyzerAgent, IngestionAgent, cleanupDir } from '@launchpilot/core';
import { POST } from '../../packages/web/src/app/api/analyze/route';
import { after } from 'next/server';
import { prepareArchitectureReview, runArchitectureReview } from '../../packages/web/src/lib/architecture-review';
import { saveArchitecture } from '../../packages/web/src/lib/architecture-store';

vi.mock('@launchpilot/core', async importOriginal => ({ ...await importOriginal<typeof import('@launchpilot/core')>(), cleanupDir: vi.fn() }));
vi.mock('next/server', async importOriginal => ({ ...await importOriginal<typeof import('next/server')>(), after: vi.fn() }));
vi.mock('../../packages/web/src/lib/architecture-review', () => ({ prepareArchitectureReview: vi.fn(), runArchitectureReview: vi.fn() }));
vi.mock('../../packages/web/src/lib/architecture-store', () => ({ saveArchitecture: vi.fn() }));

const blueprint = { repoName: 'fixture' };
const body = (data: unknown) => new Request('http://localhost/api/analyze', { method: 'POST', body: JSON.stringify(data) });
beforeEach(() => {
  vi.stubEnv('LAUNCHPILOT_AI_PROVIDER', 'catalyst');
  vi.stubEnv('CATALYST_AI_GATEWAY_URL', 'https://gateway.example/v1');
  vi.stubEnv('CATALYST_AI_MODEL', 'gpt-5.5');
  vi.stubEnv('CATALYST_AI_GATEWAY_TOKEN', 'server-only-token');
  vi.spyOn(IngestionAgent.prototype, 'execute').mockImplementation(async (_input, context) => {
    context.set('repoPath', '/tmp/launchpilot-test-clone');
    context.set('repoIsTemp', true);
    return blueprint as never;
  });
  vi.spyOn(AIAnalyzerAgent.prototype, 'execute').mockResolvedValue({ blueprint: blueprint as never, aiAnalysis: null, aiError: 'Synthetic timeout' });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.mocked(cleanupDir).mockClear(); });

describe('dashboard AI analysis', () => {
  it('saves one scan, creates the proposal in the initial response and schedules review without a second ingestion', async () => {
    const graph = { id: 'a'.repeat(64), deploymentUnits: [{ id: 'prod', root: 'deploy/prod', name: 'Production', resourceIds: ['api'], files: ['deploy/prod/app.yaml'], format: 'kubernetes' }, { id: 'preprod', root: 'deploy/preprod', name: 'Preprod', resourceIds: ['api'], files: ['deploy/preprod/app.yaml'], format: 'kubernetes' }] };
    const review = { design: { id: 'd'.repeat(64) }, job: { id: 'd'.repeat(64), status: 'queued' }, topology: { nodes: [] } };
    vi.mocked(IngestionAgent.prototype.execute).mockResolvedValue({ ...blueprint, architecture: graph } as never);
    vi.mocked(prepareArchitectureReview).mockResolvedValue(review as never);
    const response = await POST(body({ repoUrl: 'https://github.com/example/repo', environment: 'preprod' }));
    expect(response.status).toBe(200);
    expect((await response.json()).architectureReview).toEqual(review);
    expect(saveArchitecture).toHaveBeenCalledWith(graph);
    expect(prepareArchitectureReview).toHaveBeenCalledWith(graph, ['preprod'], undefined, 'azure', 'preprod');
    expect(IngestionAgent.prototype.execute).toHaveBeenCalledTimes(1);
    const callback = vi.mocked(after).mock.calls.at(-1)![0] as () => Promise<void>;
    await callback();
    expect(runArchitectureReview).toHaveBeenCalledWith(review.job.id);
    expect(IngestionAgent.prototype.execute).toHaveBeenCalledTimes(1);
  });
  it('carries the selected cloud into the first architecture review and rejects unknown clouds before ingestion', async () => {
    const graph = { id: 'a'.repeat(64), deploymentUnits: [] };
    vi.mocked(IngestionAgent.prototype.execute).mockResolvedValue({ ...blueprint, architecture: graph } as never);
    vi.mocked(prepareArchitectureReview).mockResolvedValue({ job: { id: 'd'.repeat(64) } } as never);
    expect((await POST(body({ repoUrl: 'https://github.com/example/repo', cloudProvider: 'gcp' }))).status).toBe(200);
    expect(prepareArchitectureReview).toHaveBeenCalledWith(graph, [], undefined, 'gcp', 'default');
    vi.mocked(IngestionAgent.prototype.execute).mockClear();
    expect((await POST(body({ repoUrl: 'https://github.com/example/repo', cloudProvider: 'unknown' }))).status).toBe(400);
    expect(IngestionAgent.prototype.execute).not.toHaveBeenCalled();
  });
  it('keeps the default analysis deterministic with no model call', async () => {
    const response = await POST(body({ repoUrl: 'https://github.com/example/repo' }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ blueprint, aiAnalysis: null });
    expect(AIAnalyzerAgent.prototype.execute).not.toHaveBeenCalled();
  });

  it('uses server-only gateway config and returns a visible AI failure with the blueprint', async () => {
    const response = await POST(body({ repoUrl: 'https://github.com/example/repo', ai: true,
      gatewayUrl: 'https://untrusted.example', gatewayToken: 'client-token', model: 'untrusted-model' }));
    const input = vi.mocked(AIAnalyzerAgent.prototype.execute).mock.calls[0][0];
    expect(input.providerConfig).toMatchObject({ gatewayUrl: 'https://gateway.example/v1', gatewayToken: 'server-only-token', analysisModel: 'gpt-5.5' });
    const result = await response.json();
    expect(result).toEqual({ blueprint, aiAnalysis: null, aiError: 'Synthetic timeout' });
    expect(JSON.stringify(result)).not.toContain('token');
    expect(cleanupDir).toHaveBeenCalledWith('/tmp/launchpilot-test-clone');
  });

  it('validates AI selection and configuration before cloning', async () => {
    expect((await POST(body({ repoUrl: 'https://github.com/example/repo', ai: 'yes' }))).status).toBe(400);
    vi.stubEnv('CATALYST_AI_MODEL', '');
    expect((await POST(body({ repoUrl: 'https://github.com/example/repo', ai: true }))).status).toBe(500);
    expect(IngestionAgent.prototype.execute).not.toHaveBeenCalled();
  });

  it('cleans up the clone even if the AI analyzer throws', async () => {
    vi.mocked(AIAnalyzerAgent.prototype.execute).mockRejectedValue(new Error('Synthetic failure'));
    const response = await POST(body({ repoUrl: 'https://github.com/example/repo', ai: true }));
    expect(response.status).toBe(500);
    expect(cleanupDir).toHaveBeenCalledWith('/tmp/launchpilot-test-clone');
  });
});
