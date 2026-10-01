import { after, NextResponse } from 'next/server';
import { PipelineContext, IngestionAgent, AIAnalyzerAgent, resolveProviderConfig, createLLMProvider, cleanupDir, validateRepoUrl, chooseDeploymentScope } from '@launchpilot/core';
import { saveArchitecture } from '@/lib/architecture-store';
import { prepareArchitectureReview, runArchitectureReview } from '@/lib/architecture-review';
import { prepareConnectedCortexTarget } from '@/lib/cortex-connection';
import { z } from 'zod';

export const runtime = 'nodejs';
export const maxDuration = 900;

export async function POST(request: Request) {
  const context = new PipelineContext({ nonInteractive: true });
  try {
    const { repoUrl, ai = false, environment = 'production', cloudProvider = 'azure', cortex } = await request.json();
    if (typeof repoUrl !== 'string' || !validateRepoUrl(repoUrl).valid || typeof ai !== 'boolean' || !['azure', 'aws', 'gcp'].includes(cloudProvider)) {
      return NextResponse.json({ error: 'A valid repoUrl and boolean ai option are required' }, { status: 400 });
    }
    const cortexTarget = cortex === undefined ? undefined : z.object({ applicationId: z.string().regex(/^[a-z][a-z0-9-]{0,62}$/), environment: z.string().regex(/^[a-z][a-z0-9-]{0,79}$/), definitionName: z.string().regex(/^[a-z][a-z0-9.-]{0,199}$/).optional() }).strict().parse(cortex);
    if (cortexTarget && cloudProvider !== 'azure') return NextResponse.json({ error: 'The connected Cortex Terraform contract currently targets Azure.' }, { status: 422 });

    // Only server environment can choose endpoints and credentials.
    const providerConfig = ai ? resolveProviderConfig() : undefined;
    if (providerConfig) createLLMProvider(providerConfig); // Validate before cloning.
    const agent = new IngestionAgent();
    const blueprint = await agent.execute({ repoUrl, deferCleanup: ai }, context);
    if (blueprint.architecture) await saveArchitecture(blueprint.architecture);
    let architectureReview;
    let architectureScope;
    if (blueprint.architecture) {
      if (cortexTarget) {
        const target = await prepareConnectedCortexTarget({ applicationArchitectureId: blueprint.architecture.id, ...cortexTarget });
        blueprint.architecture = target.graph;
        architectureReview = target.review;
        architectureScope = { unitIds: target.graph.deploymentUnits.map(u => u.id), environment: cortexTarget.environment, requiresChoice: false, reason: 'Current Cortex artifacts fetched and pinned before planning' };
        after(() => runArchitectureReview(target.review.job.id));
      } else {
      architectureScope = chooseDeploymentScope(blueprint.architecture, typeof environment === 'string' ? environment : 'production');
      if (!architectureScope.requiresChoice) {
        architectureReview = await prepareArchitectureReview(blueprint.architecture, architectureScope.unitIds, undefined, cloudProvider, architectureScope.environment);
        const reviewId = architectureReview.job.id;
        after(() => runArchitectureReview(reviewId));
      }
      }
    }
    const architecture = blueprint.architecture ? { architectureReview, architectureScope } : {};

    if (providerConfig) {
      const enhanced = await new AIAnalyzerAgent().execute({
        repoUrl, repoPath: context.get<string>('repoPath')!, blueprint, providerConfig,
      }, context);
      return NextResponse.json({ ...enhanced, ...architecture });
    }

    return NextResponse.json({ blueprint, aiAnalysis: null, ...architecture });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: msg }, { status: 500 });
  } finally {
    const repoPath = context.get<string>('repoPath');
    if (repoPath && context.get<boolean>('repoIsTemp')) await cleanupDir(repoPath);
  }
}
