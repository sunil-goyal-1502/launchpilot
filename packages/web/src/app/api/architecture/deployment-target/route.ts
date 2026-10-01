import { after, NextResponse } from 'next/server';
import { z } from 'zod';
import { selectCortexPlatformTarget } from '@launchpilot/core';
import { loadArchitecture, saveArchitecture, saveSelectedDeployment } from '@/lib/architecture-store';
import { prepareArchitectureReview, runArchitectureReview } from '@/lib/architecture-review';
import { prepareConnectedCortexTarget } from '@/lib/cortex-connection';

export const runtime = 'nodejs';
export const maxDuration = 900;
const id = z.string().regex(/^[a-f0-9]{64}$/);
export async function POST(request: Request) {
  try {
    const body = await request.json();
    if (body.source === 'connection') {
      const { source: _, ...input } = z.object({ source: z.literal('connection'), applicationArchitectureId: id,
        applicationId: z.string().regex(/^[a-z][a-z0-9-]{0,62}$/), definitionName: z.string().regex(/^[a-z][a-z0-9.-]{0,199}$/).optional(),
        environment: z.string().regex(/^[a-z][a-z0-9-]{0,79}$/),
      }).strict().parse(body);
      const result = await prepareConnectedCortexTarget(input);
      after(() => runArchitectureReview(result.review.job.id));
      return NextResponse.json({ architectureId: result.graph.id, deploymentTarget: result.graph.deploymentTarget, review: result.review, url: result.url }, { status: 202 });
    }
    const input = z.object({ applicationArchitectureId: id, platformArchitectureId: id,
      applicationId: z.string().regex(/^[a-z][a-z0-9-]{0,62}$/), definitionName: z.string().min(1).max(200),
      environment: z.string().min(1).max(80), unitIds: z.array(z.string()).min(1).max(100),
    }).strict().parse(body);
    const [application, platform] = await Promise.all([loadArchitecture(input.applicationArchitectureId), loadArchitecture(input.platformArchitectureId)]);
    const graph = selectCortexPlatformTarget(application, platform, input);
    await saveArchitecture(graph);
    const review = await prepareArchitectureReview(graph, graph.deploymentUnits.map(u => u.id), undefined, 'azure', input.environment);
    await saveSelectedDeployment(application.id, graph.id, review.design.id);
    after(() => runArchitectureReview(review.job.id));
    return NextResponse.json({ architectureId: graph.id, deploymentTarget: graph.deploymentTarget, review,
      url: `/architecture/${graph.id}?design=${review.design.id}` }, { status: review.job.status === 'complete' ? 200 : 202 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Deployment target selection failed' }, { status: 422 });
  }
}
