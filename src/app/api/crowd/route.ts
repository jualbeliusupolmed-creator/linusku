import { NextRequest, NextResponse } from 'next/server';
import {
  isInsideCampus,
  projectToRoute,
  type OccupancyLevel,
} from '@/data/usuRoutes';
import { saveCrowdReport } from '@/lib/crowdReports';
import {
  getSupabaseAdminClient,
  isSupabaseAdminConfigured,
} from '@/lib/supabaseServer';
import { isSupabaseConfigured } from '@/lib/supabase';

const RATE_LIMIT_MS = 30000;
const MAX_RATE_LIMIT_KEYS = 1000;
const MAX_DISTANCE_FROM_ROUTE_KM = 0.3;
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
  if (projectToRoute(lat, lng).distanceKm > MAX_DISTANCE_FROM_ROUTE_KM) {
    return NextResponse.json(
      { error: 'Lokasi harus berada dekat rute Linus.' },
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
  if (recentRequests.size >= MAX_RATE_LIMIT_KEYS) {
    for (const [requestKey, requestTime] of recentRequests) {
      if (now - requestTime >= RATE_LIMIT_MS) recentRequests.delete(requestKey);
      if (recentRequests.size < MAX_RATE_LIMIT_KEYS) break;
    }
  }
  recentRequests.set(key, now);
  if (!isSupabaseAdminConfigured) {
    if (isSupabaseConfigured) {
      return NextResponse.json(
        { error: 'Layanan laporan sedang disiapkan. Coba lagi nanti.' },
        { status: 503 }
      );
    }
    saveCrowdReport({ busId, lat, lng, occupancy, updatedAt });
    return NextResponse.json({
      ok: true,
      mode: 'local',
      busId,
      occupancy,
      updatedAt,
    });
  }

  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    return NextResponse.json(
      { error: 'Layanan laporan belum dikonfigurasi.' },
      { status: 503 }
    );
  }

  const [{ error }] = await Promise.all([
    supabase.from('crowd_reports').insert({
      bus_id: busId,
      lat,
      lng,
      occupancy,
      created_at: updatedAt,
    }),
    supabase
      .from('crowd_reports')
      .delete()
      .lt('created_at', new Date(now - 24 * 60 * 60 * 1000).toISOString()),
  ]);
  if (error) {
    return NextResponse.json(
      { error: 'Laporan belum dapat disimpan. Coba lagi sebentar.' },
      { status: 503 }
    );
  }

  return NextResponse.json({
    ok: true,
    busId,
    occupancy,
    updatedAt,
  });
}
