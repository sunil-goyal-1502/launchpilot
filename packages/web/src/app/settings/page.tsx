'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { CheckCircle2, XCircle } from 'lucide-react';

interface HealthStatus {
  terraform: boolean;
  aws: boolean;
  terraformVersion?: string;
  awsIdentity?: string;
}

export default function SettingsPage() {
  const [status, setStatus] = useState<HealthStatus | null>(null);

  useEffect(() => {
    // Health check — this is a client-side check since Terraform/AWS are local
    setStatus({ terraform: false, aws: false });
  }, []);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Environment Status</CardTitle>
          <CardDescription>Prerequisites for live deployments</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between rounded-lg border p-4">
            <div>
              <p className="font-medium">Terraform CLI</p>
              <p className="text-sm text-muted-foreground">Required for live deployments</p>
            </div>
            {status?.terraform ? (
              <Badge className="bg-green-100 text-green-800">
                <CheckCircle2 className="mr-1 h-3 w-3" /> {status.terraformVersion}
              </Badge>
            ) : (
              <Badge variant="outline" className="text-muted-foreground">
                <XCircle className="mr-1 h-3 w-3" /> Not checked
              </Badge>
            )}
          </div>

          <div className="flex items-center justify-between rounded-lg border p-4">
            <div>
              <p className="font-medium">AWS Credentials</p>
              <p className="text-sm text-muted-foreground">Required for AWS deployments</p>
            </div>
            {status?.aws ? (
              <Badge className="bg-green-100 text-green-800">
                <CheckCircle2 className="mr-1 h-3 w-3" /> {status.awsIdentity}
              </Badge>
            ) : (
              <Badge variant="outline" className="text-muted-foreground">
                <XCircle className="mr-1 h-3 w-3" /> Not checked
              </Badge>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>About</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Version</span>
            <span>0.1.0</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Core Package</span>
            <span>@launchpilot/core</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Framework</span>
            <span>Next.js + Tailwind + shadcn/ui</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
