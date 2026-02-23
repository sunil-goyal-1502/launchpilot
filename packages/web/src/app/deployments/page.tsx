'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusBadge } from '@/components/shared/status-badge';
import { ProviderBadge } from '@/components/shared/provider-badge';
import { TierBadge } from '@/components/shared/tier-badge';
import type { DeploymentStatus } from '@/lib/api-client';

export default function DeploymentsPage() {
  const [deployments, setDeployments] = useState<DeploymentStatus[]>([]);

  useEffect(() => {
    fetch('/api/deployments')
      .then(r => r.json())
      .then(setDeployments)
      .catch(() => {});
  }, []);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>All Deployments</CardTitle>
        </CardHeader>
        <CardContent>
          {deployments.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No deployments yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="pb-2 font-medium">Status</th>
                    <th className="pb-2 font-medium">Repository</th>
                    <th className="pb-2 font-medium">Provider</th>
                    <th className="pb-2 font-medium">Tier</th>
                    <th className="pb-2 font-medium">Cost</th>
                    <th className="pb-2 font-medium">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {deployments.map(d => (
                    <tr key={d.id} className="border-b last:border-0">
                      <td className="py-3">
                        <Link href={`/deployments/${d.id}`}>
                          <StatusBadge status={d.status} />
                        </Link>
                      </td>
                      <td className="py-3">
                        <Link href={`/deployments/${d.id}`} className="font-medium hover:underline">
                          {d.repo_name}
                        </Link>
                      </td>
                      <td className="py-3"><ProviderBadge provider={d.provider} /></td>
                      <td className="py-3"><TierBadge tier={d.strategy_tier} /></td>
                      <td className="py-3">
                        {d.cost_total != null ? `$${d.cost_total.toFixed(0)}/mo` : '—'}
                      </td>
                      <td className="py-3 text-muted-foreground">
                        {new Date(d.created_at).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
