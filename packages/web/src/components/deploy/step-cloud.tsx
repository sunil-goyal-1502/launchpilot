'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, Server, Database, Shield, DollarSign } from 'lucide-react';
import type { ScalingStrategy, CostBreakdown } from '@launchpilot/core';

interface StepCloudProps {
  strategies: ScalingStrategy[];
  costs: Record<string, CostBreakdown> | null;
  onSelect: (strategy: ScalingStrategy) => void;
  onBack: () => void;
}

const TIER_META: Record<string, { label: string; description: string; accent: string }> = {
  low: { label: 'Starter', description: 'For side projects and MVPs', accent: 'border-emerald-500' },
  medium: { label: 'Production', description: 'For growing applications', accent: 'border-blue-500' },
  high: { label: 'Enterprise', description: 'For high-traffic systems', accent: 'border-violet-500' },
};

export function StepCloud({ strategies, costs, onSelect, onBack }: StepCloudProps) {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Select Scaling Strategy</CardTitle>
          <CardDescription>Compare infrastructure tiers and estimated monthly costs</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-4">
            {strategies.map(s => {
              const meta = TIER_META[s.tier] ?? { label: s.tier, description: '', accent: 'border-gray-300' };
              const cost = costs?.[s.tier];
              return (
                <Card
                  key={s.tier}
                  className={`cursor-pointer border-2 transition-all hover:shadow-md ${meta.accent}`}
                  onClick={() => onSelect(s)}
                >
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base">{meta.label}</CardTitle>
                      {s.tier === 'medium' && <Badge>Recommended</Badge>}
                    </div>
                    <CardDescription>{meta.description}</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm">
                    {/* Compute */}
                    <div className="flex items-center gap-2">
                      <Server className="h-4 w-4 text-muted-foreground" />
                      <span>{s.compute.instanceType} x{s.compute.count}</span>
                    </div>

                    {/* Database */}
                    {s.database && (
                      <div className="flex items-center gap-2">
                        <Database className="h-4 w-4 text-muted-foreground" />
                        <span>{s.database.engine} ({s.database.instanceType})</span>
                      </div>
                    )}

                    {/* Security */}
                    <div className="flex items-center gap-2">
                      <Shield className="h-4 w-4 text-muted-foreground" />
                      <span>{s.securityTier}</span>
                    </div>

                    {/* Network features */}
                    <div className="flex flex-wrap gap-1">
                      {s.network.loadBalancer && <Badge variant="outline" className="text-xs">LB</Badge>}
                      {s.network.cdn && <Badge variant="outline" className="text-xs">CDN</Badge>}
                      {s.network.waf && <Badge variant="outline" className="text-xs">WAF</Badge>}
                      {s.cache && <Badge variant="outline" className="text-xs">Cache</Badge>}
                      {s.queue && <Badge variant="outline" className="text-xs">Queue</Badge>}
                    </div>

                    {/* Cost */}
                    {cost && (
                      <div className="flex items-center gap-2 border-t pt-3">
                        <DollarSign className="h-4 w-4 text-muted-foreground" />
                        <span className="text-lg font-bold">${cost.total.toFixed(0)}</span>
                        <span className="text-muted-foreground">/mo</span>
                      </div>
                    )}

                    <div className="text-xs text-muted-foreground">
                      {s.estimatedUsers} users
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-between">
        <Button variant="ghost" onClick={onBack}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Back
        </Button>
      </div>
    </div>
  );
}
