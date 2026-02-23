import { NextResponse } from 'next/server';
import { getDeployment } from '@/lib/db';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const deployment = getDeployment(id);

  if (!deployment) {
    return NextResponse.json({ error: 'Deployment not found' }, { status: 404 });
  }

  return NextResponse.json(deployment);
}
