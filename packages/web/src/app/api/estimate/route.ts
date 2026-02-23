import { NextResponse } from 'next/server';
import {
  PipelineContext, IngestionAgent, InfraPlannerAgent, SecurityAgent, calculateCost,
} from '@launchpilot/core';
import type { CloudProvider, BaaSMigrationChoice } from '@launchpilot/core';

export async function POST(request: Request) {
  try {
    const { repoUrl, provider, migrationChoice } = await request.json() as {
      repoUrl: string;
      provider: CloudProvider;
      migrationChoice?: BaaSMigrationChoice;
    };

    if (!repoUrl || !provider) {
      return NextResponse.json({ error: 'repoUrl and provider are required' }, { status: 400 });
    }

    const context = new PipelineContext({ nonInteractive: true });

    // Analyze
    const ingestionAgent = new IngestionAgent();
    const blueprint = await ingestionAgent.execute({ repoUrl }, context);

    // Generate strategies
    const infraAgent = new InfraPlannerAgent();
    const { strategies } = await infraAgent.execute({ blueprint, provider, migrationChoice }, context);

    // Security
    const securityAgent = new SecurityAgent();
    const security = await securityAgent.execute(
      { blueprint, strategy: strategies[1]!, provider },
      context,
    );

    // Calculate costs per tier
    const costs: Record<string, unknown> = {};
    for (const s of strategies) {
      costs[s.tier] = calculateCost(s);
    }

    return NextResponse.json({ strategies, security, costs });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
