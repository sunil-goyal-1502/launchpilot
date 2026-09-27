import type { ArchitectureCloud } from '@launchpilot/core';
import { notFound } from 'next/navigation';
import { loadArchitecture, loadArchitecturePlan } from '@/lib/architecture-store';
import { EvidenceArchitecture } from '@/components/infrastructure/evidence-architecture';
import { readArchitectureReview } from '@/lib/architecture-review';

export const dynamic = 'force-dynamic';
export default async function ArchitectureReviewPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ plan?: string; design?: string; unit?: string | string[]; cloud?: ArchitectureCloud; environment?: string }> }) {
  const { id } = await params;
  const { plan: planId, design: designId, unit, cloud, environment } = await searchParams;
  try {
    const graph = await loadArchitecture(id);
    const review = designId ? await readArchitectureReview(designId) : undefined;
    if (review && review.design.architectureId !== graph.id) notFound();
    const plan = review?.plan ?? (planId ? await loadArchitecturePlan(planId) : undefined);
    if (plan && plan.architectureId !== graph.id) notFound();
    const units = unit ? (Array.isArray(unit) ? unit : [unit]).filter(id => graph.deploymentUnits.some(u => u.id === id)) : undefined;
    return <main className="mx-auto max-w-[1900px] space-y-4 p-6"><p className="break-all text-sm text-muted-foreground">{graph.repoUrl}</p><EvidenceArchitecture initialCloud={cloud && ['azure', 'aws', 'gcp'].includes(cloud) ? cloud : 'azure'} initialEnvironment={environment} graph={graph} initialPlan={plan ?? undefined} initialUnitIds={review?.design.unitIds ?? units} initialReview={review} /></main>;
  } catch { notFound(); }
}
