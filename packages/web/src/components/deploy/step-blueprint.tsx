'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft } from 'lucide-react';
import type { ApplicationBlueprint, CloudProvider, ArchitectureCloud, AIAnalysis } from '@launchpilot/core';
import { EvidenceArchitecture } from '@/components/infrastructure/evidence-architecture';
import type { ArchitectureReviewResponse } from '@/lib/api-client';

interface StepBlueprintProps {
  blueprint: ApplicationBlueprint;
  cloudProvider: ArchitectureCloud;
  aiAnalysis?: AIAnalysis | null;
  aiError?: string;
  architectureReview?: ArchitectureReviewResponse;
  architectureUnitIds?: string[];
  onNext: (provider: CloudProvider) => void;
  loading: boolean;
  onBack: () => void;
}

export function StepBlueprint({ blueprint, cloudProvider, aiAnalysis, aiError, architectureReview, architectureUnitIds, onNext, loading, onBack }: StepBlueprintProps) {
  return (
    <div className="space-y-6">
      {blueprint.architecture && <EvidenceArchitecture key={blueprint.architecture.id} graph={blueprint.architecture} initialCloud={cloudProvider} initialReview={architectureReview} initialUnitIds={architectureUnitIds} />}
      <details className="rounded-lg border p-4"><summary className="cursor-pointer text-sm font-medium">Code analysis and technology stack</summary>
      <Card className="mt-4">
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

      {aiError && <p role="alert" className="rounded-lg border p-4 text-sm">AI review unavailable: {aiError}</p>}
      {aiAnalysis && (
        <Card>
          <CardHeader>
            <CardTitle>AI Code Review</CardTitle>
            <CardDescription>{aiAnalysis.tokenUsage.model} · {aiAnalysis.analyzedFiles} files reviewed · {aiAnalysis.architecturePattern}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <p>{aiAnalysis.appPurpose}</p>
            {aiAnalysis.securityConcerns.length > 0 && (
              <div>
                <h3 className="font-medium">Security concerns</h3>
                <ul className="mt-2 space-y-3">
                  {aiAnalysis.securityConcerns.map((item, i) => (
                    <li key={i}>
                      <Badge variant="outline">{item.severity}</Badge> {item.description}
                      <p className="text-muted-foreground">{item.file ? `${item.file}: ` : ''}{item.recommendation}</p>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      </details>

      <div className="flex justify-between">
        <Button variant="ghost" onClick={onBack}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Back
        </Button>
      </div>
    </div>
  );
}
