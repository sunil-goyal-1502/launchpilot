import { CloudProvider } from '../../types/index';
import { nanoid } from 'nanoid';

export function generateDeployUrl(provider: CloudProvider, appName: string): string {
  const slug = appName.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 20);
  const id = nanoid(6).toLowerCase();

  switch (provider) {
    case CloudProvider.AWS:
      return `https://${slug}-${id}.us-east-1.elb.amazonaws.com`;
    case CloudProvider.GCP:
      return `https://${slug}-${id}-uc.a.run.app`;
    case CloudProvider.Azure:
      return `https://${slug}-${id}.azurewebsites.net`;
  }
}

export function generateDashboardUrl(provider: CloudProvider, deployId: string): string {
  switch (provider) {
    case CloudProvider.AWS:
      return `https://us-east-1.console.aws.amazon.com/ecs/v2/clusters/${deployId}`;
    case CloudProvider.GCP:
      return `https://console.cloud.google.com/run/detail/us-central1/${deployId}`;
    case CloudProvider.Azure:
      return `https://portal.azure.com/#resource/subscriptions/xxx/resourceGroups/${deployId}`;
  }
}

export function generateResourceId(provider: CloudProvider, resourceType: string): string {
  const id = nanoid(12).toLowerCase();

  switch (provider) {
    case CloudProvider.AWS:
      switch (resourceType) {
        case 'vpc': return `vpc-${id}`;
        case 'subnet': return `subnet-${id}`;
        case 'sg': return `sg-${id}`;
        case 'instance': return `i-${id}`;
        case 'alb': return `arn:aws:elasticloadbalancing:us-east-1:123456789012:loadbalancer/app/lb-${id}`;
        case 'rds': return `db-${id}`;
        case 'elasticache': return `arn:aws:elasticache:us-east-1:123456789012:cluster:cache-${id}`;
        case 'sqs': return `arn:aws:sqs:us-east-1:123456789012:queue-${id}`;
        case 'kinesis': return `arn:aws:kinesis:us-east-1:123456789012:stream/stream-${id}`;
        default: return `${resourceType}-${id}`;
      }
    case CloudProvider.GCP:
      switch (resourceType) {
        case 'vpc': return `projects/launchpilot/global/networks/vpc-${id}`;
        case 'instance': return `projects/launchpilot/zones/us-central1-a/instances/vm-${id}`;
        case 'sql': return `projects/launchpilot/instances/sql-${id}`;
        default: return `projects/launchpilot/${resourceType}/${id}`;
      }
    case CloudProvider.Azure:
      switch (resourceType) {
        case 'vnet': return `/subscriptions/xxx/resourceGroups/rg-launchpilot/providers/Microsoft.Network/virtualNetworks/vnet-${id}`;
        case 'vm': return `/subscriptions/xxx/resourceGroups/rg-launchpilot/providers/Microsoft.Compute/virtualMachines/vm-${id}`;
        case 'sql': return `/subscriptions/xxx/resourceGroups/rg-launchpilot/providers/Microsoft.Sql/servers/sql-${id}`;
        default: return `/subscriptions/xxx/resourceGroups/rg-launchpilot/${resourceType}/${id}`;
      }
  }
}
