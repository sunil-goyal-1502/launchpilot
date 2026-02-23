import { CloudProvider } from '../types/cloud-provider.types';

export function getCDNLabel(provider: CloudProvider): string {
  switch (provider) {
    case CloudProvider.AWS: return 'CloudFront';
    case CloudProvider.GCP: return 'Cloud CDN';
    case CloudProvider.Azure: return 'Front Door';
  }
}

export function getLBLabel(provider: CloudProvider): string {
  switch (provider) {
    case CloudProvider.AWS: return 'ALB';
    case CloudProvider.GCP: return 'Cloud LB';
    case CloudProvider.Azure: return 'App Gateway';
  }
}

export function getComputeLabel(provider: CloudProvider, _instanceType: string): string {
  switch (provider) {
    case CloudProvider.AWS: return 'EC2';
    case CloudProvider.GCP: return 'GCE';
    case CloudProvider.Azure: return 'VM';
  }
}

export function getDBLabel(provider: CloudProvider): string {
  switch (provider) {
    case CloudProvider.AWS: return 'RDS';
    case CloudProvider.GCP: return 'Cloud SQL';
    case CloudProvider.Azure: return 'Azure SQL';
  }
}

export function getCacheLabel(provider: CloudProvider): string {
  switch (provider) {
    case CloudProvider.AWS: return 'ElastiCache';
    case CloudProvider.GCP: return 'Memorystore';
    case CloudProvider.Azure: return 'Az Cache';
  }
}

export function getQueueLabel(provider: CloudProvider): string {
  switch (provider) {
    case CloudProvider.AWS: return 'SQS';
    case CloudProvider.GCP: return 'Tasks';
    case CloudProvider.Azure: return 'Svc Bus';
  }
}

export function getStreamLabel(provider: CloudProvider): string {
  switch (provider) {
    case CloudProvider.AWS: return 'Kinesis';
    case CloudProvider.GCP: return 'Pub/Sub';
    case CloudProvider.Azure: return 'Evt Hubs';
  }
}
