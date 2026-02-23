import { NextResponse } from 'next/server';
import { getDeployment, updateDeploymentStatus } from '@/lib/db';
import { TerraformExecutor } from '@launchpilot/core';

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const deployment = getDeployment(id);

  if (!deployment) {
    return NextResponse.json({ error: 'Deployment not found' }, { status: 404 });
  }

  if (!deployment.live) {
    return NextResponse.json({ error: 'Only live deployments can be destroyed' }, { status: 400 });
  }

  if (!deployment.result_json) {
    return NextResponse.json({ error: 'No deployment result found' }, { status: 400 });
  }

  try {
    const result = JSON.parse(deployment.result_json);
    if (!result.infraDir) {
      return NextResponse.json({ error: 'No infrastructure directory found' }, { status: 400 });
    }

    const executor = new TerraformExecutor({
      workDir: result.infraDir,
      onEvent: () => {},
    });

    await executor.destroy();
    updateDeploymentStatus(id, 'destroyed');

    return NextResponse.json({ success: true });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
