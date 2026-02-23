'use client';

import { useState, useEffect, useCallback } from 'react';
import type { DeploymentEvent } from '@/lib/store';

interface Checkpoint {
  name: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  output?: string;
  error?: string;
}

interface StreamState {
  phase: string;
  checkpoints: Checkpoint[];
  logs: string[];
  result: Record<string, unknown> | null;
  error: string | null;
  isComplete: boolean;
  blueprint: Record<string, unknown> | null;
  strategy: Record<string, unknown> | null;
  security: Record<string, unknown> | null;
}

export function useDeploymentStream(id: string | null) {
  const [state, setState] = useState<StreamState>({
    phase: 'pending',
    checkpoints: [],
    logs: [],
    result: null,
    error: null,
    isComplete: false,
    blueprint: null,
    strategy: null,
    security: null,
  });

  useEffect(() => {
    if (!id) return;

    const source = new EventSource(`/api/deploy/${id}/stream`);

    source.onmessage = (e) => {
      const event: DeploymentEvent = JSON.parse(e.data);

      setState((prev) => {
        const next = { ...prev };

        switch (event.type) {
          case 'phase':
            next.phase = event.data.phase as string;
            break;

          case 'checkpoint': {
            const cp = event.data.checkpoint as Checkpoint;
            const idx = event.data.index as number;
            const newCheckpoints = [...prev.checkpoints];
            newCheckpoints[idx] = cp;
            next.checkpoints = newCheckpoints;
            break;
          }

          case 'blueprint':
            next.blueprint = event.data.blueprint as Record<string, unknown>;
            break;

          case 'strategy':
            next.strategy = event.data.selectedStrategy as Record<string, unknown>;
            break;

          case 'security':
            next.security = event.data.security as Record<string, unknown>;
            break;

          case 'log':
            next.logs = [...prev.logs, event.data.message as string];
            break;

          case 'complete':
            next.result = event.data.result as Record<string, unknown>;
            next.isComplete = true;
            next.phase = 'completed';
            break;

          case 'error':
            next.error = event.data.error as string;
            next.isComplete = true;
            next.phase = 'failed';
            break;
        }

        return next;
      });
    };

    source.onerror = () => {
      source.close();
    };

    return () => source.close();
  }, [id]);

  const completedCount = state.checkpoints.filter(c => c.status === 'completed').length;
  const totalCount = state.checkpoints.length;
  const progress = totalCount > 0 ? (completedCount / totalCount) * 100 : 0;

  return {
    ...state,
    completedCount,
    totalCount,
    progress,
  };
}
