'use client';
import { useState } from 'react';
import type { ArchitectureReviewJob } from '@launchpilot/core';
import { Button } from '@/components/ui/button';
export function ReviewStatus({ job, notice, resuming, onResume }: { job?: ArchitectureReviewJob; notice?: string | null; resuming?: boolean; onResume: () => Promise<void> }) {
  const [error, setError] = useState('');
  const interrupted = !job || job.status === 'failed' || job.status !== 'complete' && Date.now() - Date.parse(job.updatedAt) > 60000;
  if (job?.status === 'complete' && !notice && !error) return null;
  return <div aria-label="Automatic architecture review" className={`flex flex-wrap items-center justify-between gap-3 rounded-lg px-3 py-2 text-xs ${interrupted ? 'border border-amber-200 bg-amber-50 text-amber-950' : 'bg-slate-50 text-slate-600'}`}>
    <div><p className="inline font-medium">{interrupted ? 'AI review paused — your deployment design is saved' : job?.status === 'complete' ? 'AI review complete' : 'AI review in progress'}</p><p className="ml-2 inline">{interrupted ? 'Retry resumes saved checkpoints.' : job?.step}</p>
      {(job?.error || notice || error) && <details className="mt-1"><summary className="cursor-pointer">Review status details</summary><p className="mt-1 break-words">{error || notice || job?.error}</p>{job && <p>{job.completedCalls} completed requests · {job.reusedCalls} reused checkpoints</p>}</details>}
    </div>
    {interrupted && <Button type="button" variant="outline" size="sm" disabled={resuming} onClick={async () => { setError(''); try { await onResume(); } catch (e) { setError(e instanceof Error ? e.message : 'Could not resume review'); } }}>{resuming ? 'Resuming AI review…' : 'Retry AI review'}</Button>}
  </div>;
}
