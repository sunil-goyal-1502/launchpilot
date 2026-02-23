'use client';

import { use, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { StatusBadge } from '@/components/shared/status-badge';
import { ProviderBadge } from '@/components/shared/provider-badge';
import { TierBadge } from '@/components/shared/tier-badge';
import { ResourceCards } from '@/components/infrastructure/resource-cards';
import { DestroyDialog } from '@/components/infrastructure/destroy-dialog';
import { ExternalLink } from 'lucide-react';
import type { DeploymentStatus } from '@/lib/api-client';

export default function DeploymentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [deployment, setDeployment] = useState<DeploymentStatus | null>(null);

  useEffect(() => {
    fetch(`/api/deploy/${id}`)
      .then(r => r.json())
      .then(setDeployment)
      .catch(() => {});
  }, [id]);

  if (!deployment) {
    return <div className="py-20 text-center text-muted-foreground">Loading...</div>;
  }

  const result = deployment.result_json ? JSON.parse(deployment.result_json) : null;
  const blueprint = deployment.blueprint_json ? JSON.parse(deployment.blueprint_json) : null;
  const strategy = deployment.strategy_json ? JSON.parse(deployment.strategy_json) : null;
  const security = deployment.security_json ? JSON.parse(deployment.security_json) : null;
  const isLive = deployment.live === 1;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <h2 className="text-2xl font-bold">{deployment.repo_name}</h2>
          <div className="flex items-center gap-2">
            <StatusBadge status={deployment.status} />
            <ProviderBadge provider={deployment.provider} />
            <TierBadge tier={deployment.strategy_tier} />
            {isLive && <Badge variant="outline" className="bg-yellow-50 text-yellow-800">Live</Badge>}
          </div>
        </div>
        {isLive && deployment.status === 'completed' && (
          <DestroyDialog deploymentId={id} onDestroyed={() => router.refresh()} />
        )}
      </div>

      {/* Quick info */}
      <Card>
        <CardContent className="grid grid-cols-2 gap-4 pt-6 text-sm md:grid-cols-4">
          <div>
            <p className="font-medium text-muted-foreground">URL</p>
            {result?.url ? (
              <a href={result.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-blue-600 hover:underline">
                {result.url} <ExternalLink className="h-3 w-3" />
              </a>
            ) : <p>—</p>}
          </div>
          <div>
            <p className="font-medium text-muted-foreground">Cost</p>
            <p>{deployment.cost_total != null ? `$${deployment.cost_total.toFixed(0)}/mo` : '—'}</p>
          </div>
          <div>
            <p className="font-medium text-muted-foreground">Created</p>
            <p>{new Date(deployment.created_at).toLocaleString()}</p>
          </div>
          <div>
            <p className="font-medium text-muted-foreground">Duration</p>
            <p>
              {deployment.started_at && deployment.completed_at
                ? `${((new Date(deployment.completed_at).getTime() - new Date(deployment.started_at).getTime()) / 1000).toFixed(1)}s`
                : '—'}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Tabs */}
      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="resources">Resources</TabsTrigger>
          <TabsTrigger value="security">Security</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <Card>
            <CardHeader><CardTitle>Blueprint</CardTitle></CardHeader>
            <CardContent>
              {blueprint ? (
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div><span className="text-muted-foreground">Runtime:</span> {blueprint.runtime}</div>
                  <div><span className="text-muted-foreground">App Type:</span> {blueprint.appType}</div>
                  <div><span className="text-muted-foreground">Frameworks:</span> {blueprint.frameworks?.join(', ')}</div>
                  <div><span className="text-muted-foreground">Databases:</span> {blueprint.databases?.join(', ') || 'None'}</div>
                  <div><span className="text-muted-foreground">Complexity:</span> {blueprint.complexity}</div>
                </div>
              ) : <p className="text-sm text-muted-foreground">Not available</p>}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="resources">
          <Card>
            <CardHeader><CardTitle>Deployed Resources</CardTitle></CardHeader>
            <CardContent>
              <ResourceCards resources={result?.resources ?? []} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="security">
          <Card>
            <CardHeader><CardTitle>Security Policy</CardTitle></CardHeader>
            <CardContent>
              {security ? (
                <div className="space-y-3 text-sm">
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">Tier:</span>
                    <Badge>{security.tier}</Badge>
                  </div>
                  <div>
                    <span className="text-muted-foreground">WAF:</span>{' '}
                    {security.waf?.enabled ? `Enabled (${security.waf.rules?.length ?? 0} rules)` : 'Disabled'}
                  </div>
                  <div>
                    <span className="text-muted-foreground">TLS:</span>{' '}
                    {security.tls?.minVersion ?? '—'} {security.tls?.hstsEnabled ? '+ HSTS' : ''}
                  </div>
                  <div>
                    <span className="text-muted-foreground">VPC:</span>{' '}
                    {security.network?.vpcEnabled ? 'Private subnets enabled' : 'Disabled'}
                  </div>
                  <div>
                    <span className="text-muted-foreground">Secrets:</span>{' '}
                    {security.secrets?.provider ?? '—'} {security.secrets?.rotationEnabled ? '(rotation enabled)' : ''}
                  </div>
                </div>
              ) : <p className="text-sm text-muted-foreground">Not available</p>}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Error display */}
      {deployment.error && (
        <Card className="border-red-200">
          <CardContent className="pt-6">
            <p className="text-sm text-red-600">{deployment.error}</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
