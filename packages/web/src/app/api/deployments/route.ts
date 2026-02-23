import { NextResponse } from 'next/server';
import { listDeployments } from '@/lib/db';

export async function GET() {
  try {
    const deployments = listDeployments();
    return NextResponse.json(deployments);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
