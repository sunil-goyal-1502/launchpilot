import { after, NextResponse } from 'next/server';
import { z } from 'zod';
import { loadArchitecture } from '@/lib/architecture-store';
import { prepareArchitectureReview, runArchitectureReview, retryArchitectureReview } from '@/lib/architecture-review';

export const runtime = 'nodejs';
export const maxDuration = 900;
/** Compatibility endpoint: enqueue/resume the existing snapshot review, never hold a browser request for a model pass. */
export async function POST(request: Request) {
  try {
    const input = z.object({ architectureId: z.string().regex(/^[a-f0-9]{64}$/), unitIds: z.array(z.string()).max(100), provider: z.enum(['azure', 'aws', 'gcp']).default('azure'), regenerate: z.boolean().optional() }).strict().parse(await request.json());
    const result = await prepareArchitectureReview(await loadArchitecture(input.architectureId), input.unitIds, undefined, input.provider);
    if (input.regenerate && result.job.status === 'failed') await retryArchitectureReview(result.job.id);
    after(() => runArchitectureReview(result.job.id));
    return NextResponse.json(result, { status: result.plan ? 200 : 202 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Architecture review unavailable' }, { status: 422 });
  }
}
