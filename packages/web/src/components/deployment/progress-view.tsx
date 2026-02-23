'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CheckpointList } from './checkpoint-list';
import { LogOutput } from './log-output';
import { StatusBadge } from '@/components/shared/status-badge';
import { useDeploymentStream } from '@/hooks/use-deployment-stream';
import { ExternalLink, Clock, CheckCircle2, XCircle } from 'lucide-react';
import Link from 'next/link';

export function ProgressView({ deploymentId }: { deploymentId: string }) {
  const stream = useDeploymentStream(deploymentId);
  const [elapsed, setElapsed] = useState(0);

  // Live timer
  useEffect(() => {
    if (stream.isComplete) return;
    const interval = setInterval(() => setElapsed(e => e + 1), 1000);
    return () => clearInterval(interval);
  }, [stream.isComplete]);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {/* Status header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <StatusBadge status={stream.phase} />
          <div className="flex items-center gap-1 text-sm text-muted-foreground">
            <Clock className="h-4 w-4" />
            {formatTime(elapsed)}
          </div>
        </div>
        <div className="text-sm text-muted-foreground">
          {stream.completedCount}/{stream.totalCount} checkpoints
        </div>
      </div>

      {/* Progress bar */}
      <Progress value={stream.progress} className="h-3" />

      {/* Completion card */}
      {stream.isComplete && (
        <Card className={stream.error ? 'border-red-200' : 'border-green-200'}>
          <CardContent className="flex items-start gap-4 pt-6">
            {stream.error ? (
              <>
                <XCircle className="h-8 w-8 text-red-500" />
                <div>
                  <p className="font-medium text-red-800">Deployment Failed</p>
                  <p className="text-sm text-red-600">{stream.error}</p>
                </div>
              </>
            ) : (
              <>
                <CheckCircle2 className="h-8 w-8 text-green-500" />
                <div className="space-y-2">
                  <p className="font-medium text-green-800">Deployment Complete</p>
                  {typeof stream.result?.url === 'string' && (
                    <a
                      href={stream.result.url as string}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-sm text-blue-600 hover:underline"
                    >
                      {stream.result.url as string}
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                  <Link href={`/deployments/${deploymentId}`}>
                    <Button variant="outline" size="sm" className="mt-2">
                      View Details
                    </Button>
                  </Link>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* Checkpoints + Logs tabs */}
      <Tabs defaultValue="checkpoints">
        <TabsList>
          <TabsTrigger value="checkpoints">Checkpoints</TabsTrigger>
          <TabsTrigger value="logs">Logs ({stream.logs.length})</TabsTrigger>
        </TabsList>
        <TabsContent value="checkpoints">
          <Card>
            <CardContent className="pt-6">
              <CheckpointList checkpoints={stream.checkpoints} />
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="logs">
          <LogOutput logs={stream.logs} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
