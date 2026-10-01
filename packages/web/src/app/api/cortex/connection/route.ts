import { NextResponse } from 'next/server';
import { cortexConnectionSchema, readCortexConnection, syncCortexConnection } from '@/lib/cortex-connection';
export const runtime = 'nodejs';
export const maxDuration = 300;
export async function GET() {
  return NextResponse.json(await readCortexConnection(), { headers: { 'Cache-Control': 'no-store' } });
}
export async function POST() {
  try { return NextResponse.json((await syncCortexConnection()).connection); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Cortex connection failed' }, { status: 422 }); }
}
export async function PUT(request: Request) {
  try { return NextResponse.json((await syncCortexConnection(cortexConnectionSchema.parse(await request.json()))).connection); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Cortex connection failed' }, { status: 422 }); }
}
