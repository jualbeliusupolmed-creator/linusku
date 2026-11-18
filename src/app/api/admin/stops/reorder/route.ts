import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/adminAuth';

export async function POST(request: NextRequest) {
  const authorization = await requireAdmin(request);
  if (!authorization.ok) return authorization.response;
  const body: unknown = await request.json().catch(() => null);
  const ids = (body as { ids?: unknown } | null)?.ids;
  if (
    !Array.isArray(ids) ||
    ids.length < 2 ||
    ids.length > 32 ||
    ids.some((id) => typeof id !== 'string')
  ) {
    return NextResponse.json(
      { error: 'Urutan harus memuat semua ID halte yang valid.' },
      { status: 400 }
    );
  }

  const { error } = await authorization.client.rpc('admin_reorder_stops', {
    p_stop_ids: ids,
  });
  if (error) {
    return NextResponse.json(
      { error: `Urutan halte belum dapat disimpan: ${error.message}` },
      { status: 503 }
    );
  }
  return NextResponse.json({ ok: true });
}
