import { after, NextResponse } from 'next/server';
import { z } from 'zod';
import { zipArchitectureBundle, isValidationComplete } from '@launchpilot/core';
import { loadValidationJob, loadValidationBundle, loadLatestValidation, loadArchitectureDesign } from '@/lib/architecture-store';
import { prepareArchitectureValidation, runArchitectureValidation, validationTargets, validationTargetFingerprint } from '@/lib/architecture-validation';

export const runtime = 'nodejs';
export const maxDuration = 3600;
const id = z.string().regex(/^[a-f0-9]{64}$/);
const targetFields = { targetId: z.string().optional(), targetFingerprint: id.optional(), deployTest: z.boolean().optional() };
export async function POST(request: Request) {
  try {
    const parsed = z.union([z.object({ planId: id, ...targetFields }).strict(), z.object({ designId: id, revision: z.number().int().min(0), ...targetFields }).strict()]).safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: 'Select a saved architecture revision before generating scripts.' }, { status: 400 });
    const job = await prepareArchitectureValidation(parsed.data);
    after(() => runArchitectureValidation(job.id));
    return NextResponse.json({ job }, { status: 202, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Infrastructure generation failed';
    return NextResponse.json({ error: message }, { status: message.startsWith('REVISION_CONFLICT:') ? 409 : 422 });
  }
}

export async function GET(request: Request) {
  try {
    const query = new URL(request.url).searchParams;
    if (query.get('targets') === '1') {
      const targets = (await validationTargets()).map(t => ({ id: t.id, name: t.name, environment: t.environment, architectureId: t.architectureId, unitIds: t.unitIds, subscriptionId: t.subscriptionId, resourceGroupName: t.resourceGroupName, location: t.location, context: t.kubernetes?.context, namespace: t.kubernetes?.namespace, allowTestDeployment: t.allowTestDeployment, testDeploymentMethod: t.testDeploymentMethod, fingerprint: validationTargetFingerprint(t) }));
      return NextResponse.json({ targets }, { headers: { 'Cache-Control': 'no-store' } });
    }
    if (query.has('designId')) {
      const design = await loadArchitectureDesign(id.parse(query.get('designId')));
      let job = null;
      try { const latest = await loadLatestValidation(design.id); if (latest.revision === design.revision) job = latest; } catch { /* No validation for this saved revision yet. */ }
      if (job && ['queued', 'running'].includes(job.status)) after(() => runArchitectureValidation(job!.id));
      return NextResponse.json({ job }, { headers: { 'Cache-Control': 'no-store' } });
    }
    const job = await loadValidationJob(id.parse(query.get('id')));
    const download = query.get('download');
    if (!download) {
      if (['queued', 'running'].includes(job.status)) after(() => runArchitectureValidation(job.id));
      return NextResponse.json({ job }, { headers: { 'Cache-Control': 'no-store' } });
    }
    if (!['validated', 'review'].includes(download)) throw new Error('Select a validated bundle or a review bundle.');
    if (job.designId && (await loadArchitectureDesign(job.designId)).revision !== job.revision) return NextResponse.json({ error: 'This report belongs to an older design revision. Generate and validate the current revision.' }, { status: 409 });
    if (!job.report || ['queued', 'running'].includes(job.status)) return NextResponse.json({ error: 'Validation must finish before downloading its results.' }, { status: 409 });
    if (download === 'validated' && (job.status !== 'passed' || !isValidationComplete(job.report))) return NextResponse.json({ error: 'Required checks have not all passed. The review bundle includes the outstanding validation results.' }, { status: 409 });
    if (download === 'validated' && job.targetId) {
      const target = (await validationTargets()).find(t => t.id === job.targetId);
      if (!target || validationTargetFingerprint(target) !== job.targetFingerprint) return NextResponse.json({ error: 'The validation target changed after this report. Validate again using the current target.' }, { status: 409 });
    }
    const files = { ...await loadValidationBundle(job.id), 'validation-report.json': JSON.stringify(job.report, null, 2) + '\n' };
    const marker = job.status === 'passed' && isValidationComplete(job.report) ? 'validated' : 'VALIDATION-INCOMPLETE';
    return new Response(Buffer.from(zipArchitectureBundle(files)), { headers: {
      'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="launchpilot-${(job.designId ?? job.planId).slice(0, 12)}${job.revision === undefined ? '' : '-r' + job.revision}-${marker}.zip"`, 'Cache-Control': 'no-store',
    } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Validation results are unavailable' }, { status: 422 });
  }
}
