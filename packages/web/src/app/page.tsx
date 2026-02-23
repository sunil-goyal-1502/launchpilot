'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { StatsCards } from '@/components/dashboard/stats-cards';
import { RecentDeployments } from '@/components/dashboard/recent-deployments';
import { Plus } from 'lucide-react';
import type { DeploymentStatus } from '@/lib/api-client';

export default function DashboardPage() {
  const [deployments, setDeployments] = useState<DeploymentStatus[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch('/api/deployments')
      .then(r => r.json())
      .then((data: DeploymentStatus[]) => { setDeployments(data); setLoaded(true); })
      .catch(() => setLoaded(true));
  }, []);

  const total = deployments.length;
  const active = deployments.filter(d => ['analyzing', 'planning', 'deploying'].includes(d.status)).length;
  const totalCost = deployments.reduce((sum, d) => sum + (d.cost_total ?? 0), 0);
  const completed = deployments.filter(d => d.status === 'completed').length;
  const attempted = deployments.filter(d => ['completed', 'failed'].includes(d.status)).length;
  const successRate = attempted > 0 ? (completed / attempted) * 100 : 0;

  if (!loaded) {
    return <div className="flex items-center justify-center py-20 text-muted-foreground">Loading...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Welcome to LaunchPilot</h2>
          <p className="text-muted-foreground">Deploy vibe-coded apps to production infrastructure</p>
        </div>
        <Link href="/deploy">
          <Button>
            <Plus className="mr-2 h-4 w-4" /> New Deployment
          </Button>
        </Link>
      </div>

      <StatsCards total={total} active={active} totalCost={totalCost} successRate={successRate} />
      <RecentDeployments deployments={deployments} />
    </div>
  );
}
