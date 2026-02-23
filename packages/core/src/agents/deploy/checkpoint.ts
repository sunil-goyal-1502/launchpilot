import { Checkpoint, CheckpointStatus } from '../../types/index';
import { nanoid } from 'nanoid';

export function createCheckpoint(name: string, description: string): Checkpoint {
  return {
    id: `chk-${nanoid(8)}`,
    name,
    description,
    status: 'pending',
  };
}

export function startCheckpoint(checkpoint: Checkpoint): Checkpoint {
  return {
    ...checkpoint,
    status: 'in_progress',
    startedAt: new Date(),
  };
}

export function completeCheckpoint(checkpoint: Checkpoint, output: string): Checkpoint {
  return {
    ...checkpoint,
    status: 'completed',
    completedAt: new Date(),
    output,
  };
}

export function failCheckpoint(checkpoint: Checkpoint, error: string): Checkpoint {
  return {
    ...checkpoint,
    status: 'failed',
    completedAt: new Date(),
    error,
  };
}

export function isTerminal(status: CheckpointStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'skipped';
}
