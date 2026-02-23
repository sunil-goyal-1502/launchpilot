'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Label } from '@/components/ui/label';
import { ArrowLeft, Rocket, Loader2, AlertTriangle } from 'lucide-react';
import { ProviderBadge } from '@/components/shared/provider-badge';
import { TierBadge } from '@/components/shared/tier-badge';
import type { ApplicationBlueprint, ScalingStrategy, SecurityPolicy, CostBreakdown } from '@launchpilot/core';

interface StepConfirmProps {
  repoUrl: string;
  blueprint: ApplicationBlueprint;
  strategy: ScalingStrategy;
  security: SecurityPolicy | null;
  costs: Record<string, CostBreakdown> | null;
  live: boolean;
  onToggleLive: (live: boolean) => void;
  onDeploy: () => void;
  onBack: () => void;
  loading: boolean;
}

export function StepConfirm({
  repoUrl, blueprint, strategy, security, costs,
  live, onToggleLive, onDeploy, onBack, loading,
}: StepConfirmProps) {
  const cost = costs?.[strategy.tier];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Deployment Summary</CardTitle>
          <CardDescription>Review your configuration before deploying</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Summary grid */}
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="font-medium text-muted-foreground">Repository</p>
              <p className="truncate">{repoUrl}</p>
            </div>
            <div>
              <p className="font-medium text-muted-foreground">Runtime</p>
              <p>{blueprint.runtime} / {blueprint.appType}</p>
            </div>
            <div>
              <p className="font-medium text-muted-foreground">Cloud Provider</p>
              <ProviderBadge provider={strategy.provider} />
            </div>
            <div>
              <p className="font-medium text-muted-foreground">Strategy</p>
              <TierBadge tier={strategy.tier} />
            </div>
            <div>
              <p className="font-medium text-muted-foreground">Compute</p>
              <p>{strategy.compute.instanceType} x{strategy.compute.count}</p>
            </div>
            <div>
              <p className="font-medium text-muted-foreground">Security</p>
              <p>{security?.tier ?? strategy.securityTier}</p>
            </div>
          </div>

          {cost && (
            <>
              <Separator />
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Estimated Monthly Cost</span>
                <span className="text-2xl font-bold">${cost.total.toFixed(0)}<span className="text-sm font-normal text-muted-foreground">/mo</span></span>
              </div>
            </>
          )}

          <Separator />

          {/* Live toggle */}
          <div className="flex items-center justify-between rounded-lg border p-4">
            <div>
              <Label className="text-sm font-medium">Live Deployment</Label>
              <p className="text-xs text-muted-foreground">
                {live ? 'Real AWS resources will be created via Terraform' : 'Simulation mode — no real resources'}
              </p>
            </div>
            <Button
              variant={live ? 'destructive' : 'outline'}
              size="sm"
              onClick={() => onToggleLive(!live)}
            >
              {live ? 'Live ON' : 'Simulation'}
            </Button>
          </div>

          {live && (
            <div className="flex items-start gap-3 rounded-lg border border-yellow-200 bg-yellow-50 p-4">
              <AlertTriangle className="mt-0.5 h-5 w-5 text-yellow-600" />
              <div className="text-sm">
                <p className="font-medium text-yellow-800">Warning: Live Deployment</p>
                <p className="text-yellow-700">
                  Real AWS resources will be created. Costs will be incurred.
                  Ensure Terraform CLI and AWS credentials are configured.
                </p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex justify-between">
        <Button variant="ghost" onClick={onBack}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Back
        </Button>
        <Button onClick={onDeploy} disabled={loading} size="lg">
          {loading ? (
            <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Starting...</>
          ) : (
            <><Rocket className="mr-2 h-4 w-4" /> {live ? 'Deploy Live' : 'Deploy (Simulation)'}</>
          )}
        </Button>
      </div>
    </div>
  );
}
