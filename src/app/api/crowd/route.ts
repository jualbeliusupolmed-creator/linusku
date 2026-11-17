import { NextRequest, NextResponse } from 'next/server';
import {
  isInsideCampus,
  type OccupancyLevel,
} from '@/data/usuRoutes';
import { saveCrowdReport } from '@/lib/crowdReports';
import { getSupabaseClient, isSupabaseConfigured } from '@/lib/supabase';

const RATE_LIMIT_MS = 30000;
const recentRequests = new Map<string, number>();

export async function POST(request: NextRequest) {
  const forwarded = request.headers.get('x-forwarded-for');
  const key = forwarded?.split(',')[0]?.trim() ?? 'local';
  const now = Date.now();
  const previous = recentRequests.get(key) ?? 0;

  if (now - previous < RATE_LIMIT_MS) {
    return NextResponse.json(
      { error: 'Tunggu sebentar sebelum mengirim laporan lagi.' },
      { status: 429, headers: { 'Retry-After': '30' } }
    );
  }

  const body = await request.json().catch(() => null);
  const lat = Number(body?.lat);
  const lng = Number(body?.lng);
  const occupancy = body?.occupancy as OccupancyLevel;
  const busId = String(body?.busId ?? '').trim();

  if (!isInsideCampus(lat, lng)) {
    return NextResponse.json(
      { error: 'Lokasi harus berada di dalam Kampus USU.' },
      { status: 400 }
    );
  }
  if (!['LINUS-01', 'LINUS-02', 'LINUS-03'].includes(busId)) {
    return NextResponse.json(
      { error: 'Pilih armada Linus yang valid.' },
      { status: 400 }
    );
  }
  if (!['low', 'medium', 'full'].includes(occupancy)) {
    return NextResponse.json(
      { error: 'Status kepadatan tidak valid.' },
      { status: 400 }
    );
  }

  const updatedAt = new Date().toISOString();
  saveCrowdReport({ busId, lat, lng, occupancy, updatedAt });

  if (isSupabaseConfigured) {
    const supabase = getSupabaseClient();
    if (supabase) {
      const { error } = await supabase.from('crowd_reports').insert({
        bus_id: busId,
        lat,
        lng,
        occupancy,
        created_at: updatedAt,
      });
      if (error) {
        return NextResponse.json(
          { error: 'Laporan diterima sementara, tetapi belum tersimpan.' },
          { status: 503 }
        );
      }
    }
  }

  recentRequests.set(key, now);
  return NextResponse.json({
    ok: true,
    busId,
    occupancy,
    updatedAt,
  });
}
