'use client';

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Search, Loader2 } from 'lucide-react';

interface StepRepoProps {
  repoUrl: string;
  onUrlChange: (url: string) => void;
  onAnalyze: (url: string) => void;
  loading: boolean;
}

export function StepRepo({ repoUrl, onUrlChange, onAnalyze, loading }: StepRepoProps) {
  const [url, setUrl] = useState(repoUrl);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (url.trim()) onAnalyze(url.trim());
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
