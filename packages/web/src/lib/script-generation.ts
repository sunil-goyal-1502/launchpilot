import type { ArchitectureReviewJob, DesignIssue } from '@launchpilot/core';

export interface GenerationPrerequisites {
  hasPlan: boolean;
  saving?: boolean;
  environment?: string;
  reviewJob?: ArchitectureReviewJob;
  issues: DesignIssue[];
}

/** Cloud validation targets are optional; evidence completeness is not. */
export function scriptGenerationBlocker({ hasPlan, saving, environment, reviewJob, issues }: GenerationPrerequisites) {
  if (saving) return { title: 'Saving architecture changes', message: 'Script generation will be available after this revision is saved.', details: [], canResume: false };
  const scope = environment ? `the ${environment} architecture` : 'the architecture';
  if (!hasPlan) {
    if (reviewJob?.status === 'failed') return {
      title: 'Architecture review needs attention',
      message: `Finish reviewing ${scope} before generating scripts. Your cloud and environment selections are saved; selecting a validation target will not resolve this review failure.`,
      details: reviewJob.error ? [reviewJob.error] : [], canResume: true,
    };
    return { title: 'Architecture review is in progress', message: `Scripts will be available when ${scope} review finishes.`, details: reviewJob?.step ? [reviewJob.step] : [], canResume: false };
  }
  const blockers = issues.filter(issue => issue.severity === 'blocker');
  if (blockers.length) return { title: 'Resolve the design blockers', message: `${blockers.length} design issue(s) need an implementation before scripts can be generated.`, details: blockers.map(issue => issue.message), canResume: false };
  return null;
}
