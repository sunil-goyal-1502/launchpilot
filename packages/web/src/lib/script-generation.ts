import type { ArchitectureReviewJob, DesignIssue } from '@launchpilot/core';

export interface GenerationPrerequisites {
  hasPlan: boolean;
  nativeCortex?: boolean;
  saving?: boolean;
  environment?: string;
  reviewJob?: ArchitectureReviewJob;
  issues: DesignIssue[];
}

/** Cloud validation targets are optional; evidence completeness is not. */
export function scriptGenerationBlocker({ hasPlan, nativeCortex, saving, environment, reviewJob, issues }: GenerationPrerequisites, now = Date.now()) {
  if (saving) return { title: 'Saving architecture changes', message: 'Script generation will be available after this revision is saved.', details: [], canResume: false };
  const scope = environment ? `the ${environment} architecture` : 'the architecture';
  if (!hasPlan && !nativeCortex) {
    if (!reviewJob || reviewJob.status === 'failed' || reviewJob.status === 'complete' || now - Date.parse(reviewJob.updatedAt) > 60000) return {
      title: 'Architecture review needs attention',
      message: `The automated AI review of ${scope} has not finished. Use Retry AI review to continue from saved checkpoints. There is no manual “complete review” step; selecting a validation target will not resolve this review failure.`,
      details: reviewJob?.error ? [reviewJob.error] : [], canResume: true,
    };
    return { title: 'AI review is running', message: `The AI review of ${scope} completes automatically. You can keep inspecting and editing the diagram.`, details: reviewJob?.step ? [reviewJob.step] : [], canResume: false };
  }
  const blockers = issues.filter(issue => issue.severity === 'blocker');
  if (blockers.length) return { title: 'Resolve the design blockers', message: `${blockers.length} design issue(s) need an implementation before scripts can be generated.`, details: blockers.map(issue => issue.message), canResume: false };
  return null;
}
