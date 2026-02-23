import { NextResponse } from 'next/server';
import { PipelineContext, IngestionAgent } from '@launchpilot/core';

export async function POST(request: Request) {
  try {
    const { repoUrl } = await request.json();
    if (!repoUrl) {
      return NextResponse.json({ error: 'repoUrl is required' }, { status: 400 });
    }

    const context = new PipelineContext({ nonInteractive: true });
    const agent = new IngestionAgent();
    const blueprint = await agent.execute({ repoUrl }, context);

    return NextResponse.json({ blueprint });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
