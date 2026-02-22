import { BaseAgent } from '../base-agent.js';
import { PipelineContext } from '../../orchestrator/context.js';
import { ApplicationBlueprint, CloudProvider, ScalingStrategy, SecurityPolicy, SecurityTier } from '../../types/index.js';
import { generateWAFPolicy } from './policies/waf-policy.js';
import { generateNetworkPolicy } from './policies/network-policy.js';
import { generateTLSPolicy } from './policies/tls-policy.js';
import { generateIAMPolicy } from './policies/iam-policy.js';
import { generateSecretsPolicy } from './policies/secrets-policy.js';
import { scanVulnerabilities } from './vulnerability-scanner.js';
import { simulateWork } from '../../utils/timer.js';

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
