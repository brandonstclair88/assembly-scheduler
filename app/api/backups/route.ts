import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const noStore = { headers: { 'Cache-Control': 'no-store' } };

export async function GET(request: Request) {
  try {
    const { listServerBackups, getServerBackup } = await import('../../../lib/db');
    const url = new URL(request.url);
    const id = url.searchParams.get('id');
    if (id) {
      const data = await getServerBackup(Number(id));
      if (!data) return NextResponse.json({ ok: false, error: 'Backup not found.' }, { status: 404, ...noStore });
      return NextResponse.json({ ok: true, data }, noStore);
    }
    const backups = await listServerBackups();
    return NextResponse.json({ ok: true, backups }, noStore);
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message || 'Failed to load backups.' }, { status: 500, ...noStore });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const { createServerBackup, restoreServerBackup } = await import('../../../lib/db');
    if (body?.restoreId) {
      const result = await restoreServerBackup(Number(body.restoreId));
      if (!result.ok) return NextResponse.json({ ok: false, error: 'Backup not found.' }, { status: 404, ...noStore });
      return NextResponse.json({ ok: true, updatedAt: result.updatedAt }, noStore);
    }
    const reason = typeof body?.reason === 'string' && body.reason ? body.reason.slice(0, 40) : 'manual';
    await createServerBackup(reason);
    return NextResponse.json({ ok: true }, noStore);
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message || 'Failed to create backup.' }, { status: 500, ...noStore });
  }
}

export async function DELETE(request: Request) {
  try {
    const url = new URL(request.url);
    const id = url.searchParams.get('id');
    if (!id) return NextResponse.json({ ok: false, error: 'Missing id.' }, { status: 400, ...noStore });
    const { deleteServerBackup } = await import('../../../lib/db');
    await deleteServerBackup(Number(id));
    return NextResponse.json({ ok: true }, noStore);
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message || 'Failed to delete backup.' }, { status: 500, ...noStore });
  }
}
