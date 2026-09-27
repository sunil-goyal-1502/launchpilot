'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { DesignEdit, ArchitectureCloud } from '@launchpilot/core';
import type { ArchitectureReviewResponse } from '@/lib/api-client';

export function useArchitectureReview(architectureId: string, unitIds: string[], enabled: boolean, initial?: ArchitectureReviewResponse, planId?: string, cloudProvider: ArchitectureCloud = 'azure', environment?: string) {
  const units = JSON.stringify([...unitIds].sort());
  const scope = JSON.stringify({ units, cloudProvider, environment });
  const sameScope = (design: ArchitectureReviewResponse['design']) => JSON.stringify([...design.unitIds].sort()) === units && (design.cloudProvider ?? 'azure') === cloudProvider && (!environment || !design.environment || design.environment === environment);
  const [review, setReview] = useState<ArchitectureReviewResponse | null>(initial ?? null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const current = useRef(review);
  const requestScope = useRef('');
  const apply = useCallback((value: ArchitectureReviewResponse) => {
    if (value.design.architectureId !== architectureId || !sameScope(value.design)) return;
    if (current.current?.design.id === value.design.id && current.current.design.revision > value.design.revision) return;
    current.current = value; setReview(value);
  }, [architectureId, scope]);
  useEffect(() => {
    const key = architectureId + scope;
    requestScope.current = key;
    const matches = current.current?.design.architectureId === architectureId && sameScope(current.current.design);
    if (!matches) { current.current = null; setReview(null); }
    setNotice(null);
    if (!enabled) return;
    let cancelled = false, timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    async function poll() {
      try {
        const id = current.current?.design.id;
        const response = await fetch(id ? `/api/architecture/design?id=${id}` : '/api/architecture/design', id ? { cache: 'no-store', signal: controller.signal } : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ architectureId, unitIds: JSON.parse(units), cloudProvider, environment, ...(planId ? { planId } : {}) }), signal: controller.signal });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? 'Unable to load the saved architecture review');
        if (cancelled || requestScope.current !== key) return;
        apply(result); setNotice(null);
        // Poll even after completion to detect edits from other open tabs, without any new model work.
        timer = setTimeout(poll, result.job.status === 'running' || result.job.status === 'queued' ? 2500 : 12000);
      } catch (error) {
        if (cancelled) return;
        setNotice(error instanceof TypeError ? 'Connection interrupted. Reconnecting to the saved architecture review; no repository rescan is needed.' : error instanceof Error ? error.message : 'Reconnecting to the saved review');
        timer = setTimeout(poll, 4000);
      }
    }
    // Switching environment must not enqueue transient combinations while the user selects scope.
    if (current.current) void poll(); else timer = setTimeout(poll, 400);
    return () => { cancelled = true; controller.abort(); if (timer) clearTimeout(timer); };
  }, [architectureId, scope, enabled, apply, planId]);

  const save = useCallback(async (edit: DesignEdit | 'undo' | 'reset') => {
    const snapshot = current.current;
    if (!snapshot) throw new Error('The architecture draft is still being saved');
    const key = requestScope.current;
    setSaving(true);
    try {
      const response = await fetch('/api/architecture/design', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: snapshot.design.id, revision: snapshot.design.revision, edit }) });
      const result = await response.json();
      if (!response.ok) {
        if (response.status === 409) {
          const latest = await fetch(`/api/architecture/design?id=${snapshot.design.id}`, { cache: 'no-store' });
          if (latest.ok && requestScope.current === key) apply(await latest.json());
        }
        throw new Error(result.error ?? 'The architecture change could not be saved');
      }
      if (requestScope.current === key) { apply(result); setNotice(null); }
    } finally { setSaving(false); }
  }, [apply]);
  const resume = useCallback(async () => {
    if (!current.current) return;
    try {
      const response = await fetch('/api/architecture/design', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: current.current.design.id }) });
      const result = await response.json();
      if (!response.ok) { setNotice(result.error); return; }
      apply(result);
    } catch { setNotice('Connection interrupted. The saved proposal and review checkpoints are preserved; retry when connected.'); }
  }, [apply]);
  const matching = review?.design.architectureId === architectureId && sameScope(review.design);
  return { review: matching ? review : null, notice, saving, save, resume };
}
