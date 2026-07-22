import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const { readSchedulerData, databaseInfo } = await import('../../../lib/db');
    const { data, updatedAt } = await readSchedulerData();
    return NextResponse.json(
      { ok: true, data, updatedAt, database: databaseInfo() },
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
    const payload = body?.data !== undefined ? body.data : body;
    const baseUpdatedAt = typeof body?.baseUpdatedAt === 'string' ? body.baseUpdatedAt : '';
    const result = await writeSchedulerData(payload, baseUpdatedAt);
    if (!result.ok) {
      return NextResponse.json(
        {
          ok: false,
          conflict: true,
          currentUpdatedAt: (result as any).currentUpdatedAt || '',
          error: 'The schedule was changed somewhere else (another browser or device) after this page loaded. Reload the page to pick up the latest data before saving again.',
        },
        { status: 409, headers: { 'Cache-Control': 'no-store' } }
      );
    }
    return NextResponse.json(
      { ok: true, updatedAt: result.updatedAt },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message || 'Failed to save scheduler database.' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}
