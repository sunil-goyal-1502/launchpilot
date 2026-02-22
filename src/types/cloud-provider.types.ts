export enum CloudProvider {
  AWS = 'aws',
  GCP = 'gcp',
  Azure = 'azure',
}

export interface CloudResource {
  id: string;
  type: string;
  name: string;
  provider: CloudProvider;
  region: string;
  config: Record<string, unknown>;
  monthlyCost: number;
}

export interface CloudRegion {
  id: string;
  name: string;
  provider: CloudProvider;
  location: string;
}

export const DEFAULT_REGIONS: Record<CloudProvider, string> = {
  [CloudProvider.AWS]: 'us-east-1',
  [CloudProvider.GCP]: 'us-central1',
  [CloudProvider.Azure]: 'eastus',
};
