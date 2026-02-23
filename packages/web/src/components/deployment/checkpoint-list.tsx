'use client';

import { CheckCircle2, Circle, Loader2, XCircle } from 'lucide-react';

interface Checkpoint {
  name: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  output?: string;
  error?: string;
}

export function CheckpointList({ checkpoints }: { checkpoints: Checkpoint[] }) {
  if (checkpoints.length === 0) {
    return <p className="text-sm text-muted-foreground">Waiting for checkpoints...</p>;
  }

  return (
    <div className="space-y-2">
      {checkpoints.map((cp, i) => (
        <div key={i} className="flex items-start gap-3">
          <div className="mt-0.5">
            {cp.status === 'completed' && <CheckCircle2 className="h-5 w-5 text-green-500" />}
            {cp.status === 'in_progress' && <Loader2 className="h-5 w-5 animate-spin text-blue-500" />}
            {cp.status === 'failed' && <XCircle className="h-5 w-5 text-red-500" />}
            {cp.status === 'pending' && <Circle className="h-5 w-5 text-muted-foreground" />}
          </div>
          <div className="flex-1">
            <p className={`text-sm ${cp.status === 'in_progress' ? 'font-medium' : ''}`}>
              {cp.name}
            </p>
            {cp.error && (
              <p className="text-xs text-red-600">{cp.error}</p>
            )}
            {cp.output && (
              <p className="text-xs text-muted-foreground">{cp.output}</p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
