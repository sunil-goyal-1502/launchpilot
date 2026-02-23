import { BaseAgent } from '../base-agent';
import { PipelineContext } from '../../orchestrator/context';
import { ApplicationBlueprint, CloudProvider, ScalingStrategy, SecurityPolicy, SecurityTier } from '../../types/index';
import { generateWAFPolicy } from './policies/waf-policy';
import { generateNetworkPolicy } from './policies/network-policy';
import { generateTLSPolicy } from './policies/tls-policy';
import { generateIAMPolicy } from './policies/iam-policy';
import { generateSecretsPolicy } from './policies/secrets-policy';
import { scanVulnerabilities } from './vulnerability-scanner';
import { simulateWork } from '../../utils/timer';

export interface SecurityInput {
  blueprint: ApplicationBlueprint;
  strategy: ScalingStrategy;
  provider: CloudProvider;
}

export class SecurityAgent extends BaseAgent<SecurityInput, SecurityPolicy> {
  readonly name = 'SecurityAgent';
  readonly description = 'Generates security policies and scans for vulnerabilities';

  async execute(input: SecurityInput, context: PipelineContext): Promise<SecurityPolicy> {
    const { blueprint, strategy, provider } = input;
    const tier: SecurityTier = strategy.securityTier;

    const policy = await this.timed(context, 'generatePolicies', async () => {
      await simulateWork(800, 400);

      const waf = generateWAFPolicy(tier);
      const network = generateNetworkPolicy(tier);
      const tls = generateTLSPolicy(tier, provider);
      const iam = generateIAMPolicy(tier, provider);
      const secrets = generateSecretsPolicy(tier, provider, blueprint.envVars);
      const vulnerabilities = scanVulnerabilities(blueprint.frameworks);

      return {
        tier,
        waf,
        network,
        tls,
        iam,
        secrets,
        vulnerabilities,
      };
    });

    context.set('securityPolicy', policy);

    return policy;
  }
}
