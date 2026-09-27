import { NextResponse } from 'next/server';
import { nanoid } from 'nanoid';
import { extractRepoName } from '@launchpilot/core';
import type { CloudProvider, StrategyTier, BaaSMigrationChoice } from '@launchpilot/core';
import { createDeployment } from '@/lib/db';
import { runDeployment } from '@/lib/deploy-runner';

export async function POST(request: Request) {
  try {
    const { repoUrl, provider, strategyTier, migrationChoice, live } = await request.json() as {
      repoUrl: string;
      provider: CloudProvider;
      strategyTier: StrategyTier;
      migrationChoice?: BaaSMigrationChoice;
      live: boolean;
    };

    if (!repoUrl || !provider || !strategyTier) {
      return NextResponse.json(
        { error: 'repoUrl, provider, and strategyTier are required' },
        { status: 400 },
      );
    }
    if (live) return NextResponse.json({ error: 'Live deployment of generic sizing scenarios is disabled. Generate and validate the selected architecture bundle from the repository review.' }, { status: 400 });

    const id = nanoid(12);
    const repoName = extractRepoName(repoUrl);

    // Create DB record
    createDeployment({
      id,
      repoUrl,
      repoName,
      provider,
      strategyTier,
      live: live ?? false,
    });

    // Fire-and-forget — runs asynchronously, streams events via SSE
    runDeployment(id, { repoUrl, provider, strategyTier, migrationChoice, live: live ?? false });

    return NextResponse.json({ id });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
