import { ICloudProvider } from './cloud-provider';
import { CloudProvider, ApplicationBlueprint, ScalingStrategy, SecurityPolicy, DeployResult } from '../types/index';
import { PipelineContext } from '../orchestrator/context';
import { InfraPlannerAgent } from '../agents/infra-planner/infra-planner-agent';
import { SecurityAgent } from '../agents/security/security-agent';
import { DeployAgent } from '../agents/deploy/deploy-agent';

export class GCPProvider implements ICloudProvider {
  readonly provider = CloudProvider.GCP;
  readonly name = 'Google Cloud Platform';

  async planInfra(blueprint: ApplicationBlueprint, context: PipelineContext): Promise<ScalingStrategy[]> {
    const agent = new InfraPlannerAgent();
    const result = await agent.execute({ blueprint, provider: this.provider }, context);
    return result.strategies;
  }

  async generateSecurity(blueprint: ApplicationBlueprint, strategy: ScalingStrategy, context: PipelineContext): Promise<SecurityPolicy> {
    const agent = new SecurityAgent();
    return agent.execute({ blueprint, strategy, provider: this.provider }, context);
  }

  async deploy(repoName: string, strategy: ScalingStrategy, security: SecurityPolicy, context: PipelineContext): Promise<DeployResult> {
    const agent = new DeployAgent();
    return agent.execute({ repoName, provider: this.provider, strategy, security }, context);
  }
}
