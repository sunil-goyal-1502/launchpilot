'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, ArrowLeft, ArrowRight } from 'lucide-react';
import type { ApplicationBlueprint, CloudProvider } from '@launchpilot/core';

interface StepBlueprintProps {
  blueprint: ApplicationBlueprint;
  onNext: (provider: CloudProvider) => void;
  loading: boolean;
  onBack: () => void;
}

const PROVIDERS: { id: CloudProvider; name: string; color: string }[] = [
  { id: 'aws' as CloudProvider, name: 'Amazon Web Services', color: 'bg-orange-500' },
  { id: 'gcp' as CloudProvider, name: 'Google Cloud Platform', color: 'bg-blue-500' },
  { id: 'azure' as CloudProvider, name: 'Microsoft Azure', color: 'bg-sky-500' },
];

export function StepBlueprint({ blueprint, onNext, loading, onBack }: StepBlueprintProps) {
  return (
    <div className="space-y-6">
      {/* Blueprint summary */}
      <Card>
        <CardHeader>
          <CardTitle>Application Blueprint</CardTitle>
          <CardDescription>Detected technology stack and configuration</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="font-medium text-muted-foreground">Runtime</p>
              <p>{blueprint.runtime}</p>
            </div>
            <div>
              <p className="font-medium text-muted-foreground">App Type</p>
              <p>{blueprint.appType}</p>
            </div>
            <div>
              <p className="font-medium text-muted-foreground">Frameworks</p>
              <div className="flex flex-wrap gap-1">
                {blueprint.frameworks.map(f => (
                  <Badge key={f.name} variant="secondary">{f.name}</Badge>
                ))}
              </div>
            </div>
            <div>
              <p className="font-medium text-muted-foreground">Databases</p>
              <div className="flex flex-wrap gap-1">
                {blueprint.databases.length > 0
                  ? blueprint.databases.map(d => <Badge key={d.name} variant="secondary">{d.name}</Badge>)
                  : <span className="text-muted-foreground">None detected</span>}
              </div>
            </div>
            <div>
              <p className="font-medium text-muted-foreground">Services</p>
              <div className="flex flex-wrap gap-1">
                {blueprint.services.length > 0
                  ? blueprint.services.map(s => <Badge key={s.name} variant="secondary">{s.name}</Badge>)
                  : <span className="text-muted-foreground">None</span>}
              </div>
            </div>
            <div>
              <p className="font-medium text-muted-foreground">Complexity</p>
              <p>{blueprint.complexity}</p>
            </div>
          </div>

          {blueprint.baas?.isBaaSApp && (
            <div className="mt-4 rounded-lg border border-yellow-200 bg-yellow-50 p-3 text-sm">
              <p className="font-medium text-yellow-800">BaaS Detected</p>
              <p className="text-yellow-700">
                Providers: {blueprint.baas.providers.map(p => p.name).join(', ')}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Cloud provider selection */}
      <Card>
        <CardHeader>
          <CardTitle>Select Cloud Provider</CardTitle>
          <CardDescription>Choose where to deploy your infrastructure</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-4">
            {PROVIDERS.map(p => (
              <Button
                key={p.id}
                variant="outline"
                className="h-auto flex-col gap-2 p-6"
                onClick={() => onNext(p.id)}
                disabled={loading}
              >
                <div className={`h-3 w-3 rounded-full ${p.color}`} />
                <span className="font-medium">{p.id.toUpperCase()}</span>
                <span className="text-xs text-muted-foreground">{p.name}</span>
              </Button>
            ))}
          </div>

          {loading && (
            <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Generating infrastructure plans...
            </div>
          )}
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
