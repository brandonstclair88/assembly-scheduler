import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const { readSchedulerData, databaseInfo } = await import('../../../lib/db');
    const data = await readSchedulerData();
    return NextResponse.json(
      { ok: true, data, database: databaseInfo() },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message || 'Failed to load scheduler database.' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { writeSchedulerData } = await import('../../../lib/db');
    await writeSchedulerData(body);
    return NextResponse.json(
      { ok: true },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message || 'Failed to save scheduler database.' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}
