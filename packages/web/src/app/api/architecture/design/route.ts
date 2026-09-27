import { after, NextResponse } from 'next/server';
import { z } from 'zod';
import { designEditSchema } from '@launchpilot/core';
import { loadArchitecture } from '@/lib/architecture-store';
import { prepareArchitectureReview, readArchitectureReview, runArchitectureReview, editArchitectureReview, retryArchitectureReview } from '@/lib/architecture-review';

export const runtime = 'nodejs';
export const maxDuration = 900;
const id = z.string().regex(/^[a-f0-9]{64}$/);
function failure(error: unknown) {
  const message = error instanceof Error ? error.message : 'Architecture design request failed';
  return NextResponse.json({ error: message }, { status: message.startsWith('REVISION_CONFLICT:') ? 409 : 422 });
}
export async function POST(request: Request) {
  try {
    const input = z.object({ architectureId: id, unitIds: z.array(z.string()).max(100), planId: id.optional(), cloudProvider: z.enum(['azure', 'aws', 'gcp']).default('azure'), environment: z.string().min(1).max(80).optional() }).strict().parse(await request.json());
    const result = await prepareArchitectureReview(await loadArchitecture(input.architectureId), input.unitIds, input.planId, input.cloudProvider, input.environment);
    after(() => runArchitectureReview(result.job.id));
    return NextResponse.json(result, { status: result.job.status === 'complete' ? 200 : 202 });
  } catch (error) { return failure(error); }
}
export async function GET(request: Request) {
  try {
    const result = await readArchitectureReview(id.parse(new URL(request.url).searchParams.get('id')));
    if (result.job.status === 'queued' || result.job.status === 'running') after(() => runArchitectureReview(result.job.id));
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return failure(error); }
}
export async function PATCH(request: Request) {
  try {
    const input = z.object({ id, revision: z.number().int().nonnegative(), edit: z.union([designEditSchema, z.literal('undo'), z.literal('reset')]) }).strict().parse(await request.json());
    return NextResponse.json(await editArchitectureReview(input.id, input.revision, input.edit));
  } catch (error) { return failure(error); }
}
export async function PUT(request: Request) {
  try {
    const input = z.object({ id }).strict().parse(await request.json());
    await retryArchitectureReview(input.id);
    after(() => runArchitectureReview(input.id));
    return NextResponse.json(await readArchitectureReview(input.id), { status: 202 });
  } catch (error) { return failure(error); }
}
