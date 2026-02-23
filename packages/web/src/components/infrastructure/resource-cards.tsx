'use client';

import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Server, Database, Globe, Shield, Layers, Zap, MessageSquare } from 'lucide-react';

interface Resource {
  type: string;
  name: string;
  id?: string;
  status?: string;
}

const RESOURCE_ICONS: Record<string, typeof Server> = {
  'VPC': Globe,
  'Security Group': Shield,
  'ECS Cluster': Server,
  'ECS Service': Server,
  'RDS Instance': Database,
  'ALB': Layers,
  'CloudFront': Globe,
  'ElastiCache': Zap,
  'SQS Queue': MessageSquare,
};

export function ResourceCards({ resources }: { resources: Resource[] }) {
  if (resources.length === 0) {
    return <p className="text-sm text-muted-foreground">No resources to display.</p>;
  }

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
      {resources.map((r, i) => {
        const Icon = RESOURCE_ICONS[r.type] ?? Server;
        return (
          <Card key={i}>
            <CardContent className="flex items-start gap-3 pt-4">
              <Icon className="mt-0.5 h-5 w-5 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{r.type}</p>
                <p className="truncate text-xs text-muted-foreground">{r.name}</p>
                {r.id && <p className="truncate text-xs text-muted-foreground">{r.id}</p>}
                {r.status && <Badge variant="outline" className="mt-1 text-xs">{r.status}</Badge>}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
