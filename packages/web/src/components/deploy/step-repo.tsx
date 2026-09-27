'use client';

import type { ArchitectureCloud } from '@launchpilot/core';
import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Search, Loader2 } from 'lucide-react';

interface StepRepoProps {
  repoUrl: string;
  onUrlChange: (url: string) => void;
  onAnalyze: (url: string, ai: boolean, environment: string, cloudProvider: ArchitectureCloud) => void;
  initialCloud?: ArchitectureCloud;
  loading: boolean;
}

export function StepRepo({ repoUrl, onUrlChange, onAnalyze, loading, initialCloud = 'azure' }: StepRepoProps) {
  const [url, setUrl] = useState(repoUrl);
  const [ai, setAI] = useState(false);
  const [cloudProvider, setCloudProvider] = useState<ArchitectureCloud>(initialCloud);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (url.trim()) onAnalyze(url.trim(), ai, 'production', cloudProvider);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Enter Repository URL</CardTitle>
        <CardDescription>
          Paste a GitHub repository URL or use local://path for local projects
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="repo-url">Repository URL</Label>
            <Input
              id="repo-url"
              placeholder="https://github.com/user/repo or local:///path/to/project"
              value={url}
              onChange={(e) => { setUrl(e.target.value); onUrlChange(e.target.value); }}
              disabled={loading}
            />
          </div>
          <fieldset className="space-y-2"><legend className="text-sm font-medium">Deployment cloud</legend><div className="grid grid-cols-3 gap-3">{(['azure', 'aws', 'gcp'] as const).map(provider => <label key={provider} className={`flex cursor-pointer items-center gap-2 rounded-lg border p-3 text-sm ${cloudProvider === provider ? 'border-blue-600 bg-blue-50' : ''}`}><input type="radio" name="deployment-cloud" value={provider} checked={cloudProvider === provider} disabled={loading} onChange={() => setCloudProvider(provider)} />{{ azure: 'Azure', aws: 'AWS', gcp: 'Google Cloud' }[provider]}</label>)}</div><p className="text-xs text-muted-foreground">Recommendations and sizing use this cloud. Environments are identified from the repository after analysis.</p></fieldset>
          {cloudProvider !== 'azure' && <p className="text-xs text-muted-foreground">Architecture planning and sizing support this cloud. Validated infrastructure export currently supports Azure.</p>}
          <label className="flex items-start gap-3 text-sm">
            <input type="checkbox" checked={ai} onChange={e => setAI(e.target.checked)} disabled={loading} className="mt-1" />
            <span>
              <span className="font-medium">Include additional AI code review</span>
              <span className="block text-muted-foreground">Add source-level security and implementation findings. Architecture recommendations are included automatically.</span>
            </span>
          </label>
          <Button type="submit" disabled={!url.trim() || loading}>
            {loading ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Analyzing...</>
            ) : (
              <><Search className="mr-2 h-4 w-4" /> Analyze Repository</>
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
