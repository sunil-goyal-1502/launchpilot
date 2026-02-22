import { CloudProvider, ApplicationBlueprint, ScalingStrategy, SecurityPolicy, DeployResult } from '../types/index.js';
import { PipelineContext } from '../orchestrator/context.js';

export interface ICloudProvider {
  readonly provider: CloudProvider;
  readonly name: string;

  planInfra(blueprint: ApplicationBlueprint, context: PipelineContext): Promise<ScalingStrategy[]>;
  generateSecurity(blueprint: ApplicationBlueprint, strategy: ScalingStrategy, context: PipelineContext): Promise<SecurityPolicy>;
  deploy(repoName: string, strategy: ScalingStrategy, security: SecurityPolicy, context: PipelineContext): Promise<DeployResult>;
}

export async function createCloudProvider(provider: CloudProvider): Promise<ICloudProvider> {
  switch (provider) {
    case CloudProvider.AWS: {
      const { AWSProvider } = await import('./aws-provider.js');
      return new AWSProvider();
    }
    case CloudProvider.GCP: {
      const { GCPProvider } = await import('./gcp-provider.js');
      return new GCPProvider();
    }
    case CloudProvider.Azure: {
      const { AzureProvider } = await import('./azure-provider.js');
      return new AzureProvider();
    }
  }
}
