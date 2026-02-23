'use client';

import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/shared/status-badge';
import { ProviderBadge } from '@/components/shared/provider-badge';
import { TierBadge } from '@/components/shared/tier-badge';
import type { DeploymentStatus } from '@/lib/api-client';

export function RecentDeployments({ deployments }: { deployments: DeploymentStatus[] }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Recent Deployments</CardTitle>
        <Link href="/deployments">
          <Button variant="ghost" size="sm">View all</Button>
        </Link>
      </CardHeader>
      <CardContent>
        {deployments.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            No deployments yet. <Link href="/deploy" className="text-primary hover:underline">Start one</Link>
          </div>
        ) : (
          <div className="space-y-3">
            {deployments.slice(0, 5).map(d => (
              <Link
                key={d.id}
                href={`/deployments/${d.id}`}
                className="flex items-center justify-between rounded-lg border p-3 transition-colors hover:bg-accent"
              >
                <div className="flex items-center gap-3">
                  <StatusBadge status={d.status} />
                  <div>
                    <p className="text-sm font-medium">{d.repo_name}</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(d.created_at).toLocaleString()}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <ProviderBadge provider={d.provider} />
                  <TierBadge tier={d.strategy_tier} />
                  {d.cost_total != null && (
                    <span className="text-sm font-medium">${d.cost_total.toFixed(0)}/mo</span>
                  )}
                </div>
              </Link>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
