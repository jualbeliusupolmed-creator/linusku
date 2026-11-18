import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/adminAuth';

export async function DELETE(request: NextRequest) {
  const authorization = await requireAdmin(request);
  if (!authorization.ok) return authorization.response;
  const reportId = new URL(request.url).searchParams.get('id')?.trim() ?? '';
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      reportId
    )
  ) {
    return NextResponse.json(
      { error: 'ID laporan tidak valid.' },
      { status: 400 }
    );
  }

  const { error } = await authorization.client
    .from('crowd_reports')
    .delete()
    .eq('id', reportId);
  if (error) {
    return NextResponse.json(
      { error: `Laporan belum dapat dihapus: ${error.message}` },
      { status: 503 }
    );
  }
  return NextResponse.json({ ok: true });
}
