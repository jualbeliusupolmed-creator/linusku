import { NextRequest, NextResponse } from 'next/server';
import {
  isInsideCampusWithSettings,
  isNearRouteWithSettings,
  type OccupancyLevel,
  type LinuskuSettings,
  DEFAULT_LINUSKU_SETTINGS,
  mergeLinuskuSettings,
} from '@/data/usuRoutes';
import { saveCrowdReport } from '@/lib/crowdReports';
import {
  getSupabaseAdminClient,
  isSupabaseAdminConfigured,
} from '@/lib/supabaseServer';
import { getSupabaseClient, isSupabaseConfigured } from '@/lib/supabase';

const RATE_LIMIT_MS = 30000;
const MAX_RATE_LIMIT_KEYS = 1000;
const recentRequests = new Map<string, number>();

// Fetch valid bus IDs from database
async function getValidBusIds(): Promise<string[]> {
  const supabase = getSupabaseClient();
  if (!isSupabaseConfigured || !supabase) {
    return ['LINUS-01', 'LINUS-02', 'LINUS-03'];
  }
  const { data } = await supabase
    .from('buses')
    .select('id')
    .eq('is_active', true);
  if (!data) {
    throw new Error('Daftar armada aktif belum dapat dimuat.');
  }
  return data.map((b) => b.id);
}

// Fetch settings for validation
async function getValidationSettings(): Promise<LinuskuSettings> {
  const supabase = getSupabaseClient();
  if (!isSupabaseConfigured || !supabase) {
    return DEFAULT_LINUSKU_SETTINGS;
  }

  const { data, error } = await supabase
    .from('linusku_settings_v2')
    .select('key, value')
    .in('key', ['geofence', 'features']);

  if (
    error &&
    error.code !== 'PGRST205' &&
    error.code !== '42P01'
  ) {
    throw new Error(`Gagal membaca pengaturan laporan: ${error.message}`);
  }
  if (!data || data.length === 0) {
    return DEFAULT_LINUSKU_SETTINGS;
  }

  return mergeLinuskuSettings(
    Object.fromEntries(data.map((row) => [row.key, row.value]))
  );
}

async function getValidStopIds(): Promise<string[]> {
  const supabase = getSupabaseClient();
  if (!isSupabaseConfigured || !supabase) {
    return [];
  }
  const { data } = await supabase.from('stops').select('id');
  if (!data) {
    throw new Error('Daftar halte aktif belum dapat dimuat.');
  }
  return data.map((stop) => stop.id);
}

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
  const stopId = String(body?.stopId ?? '').trim() || null;

  // Fetch settings for validation
  let settings: LinuskuSettings;
  let validBusIds: string[];
  let validStopIds: string[];
  try {
    settings = await getValidationSettings();
    validBusIds = await getValidBusIds();
    validStopIds = stopId ? await getValidStopIds() : [];
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Kesalahan server';
    console.error('[crowd] Could not load report configuration:', message);
    return NextResponse.json(
      { error: 'Pengaturan laporan belum dapat dimuat. Coba lagi nanti.' },
      { status: 503 }
    );
  }

  // Check if crowd reporting is enabled
  if (!settings.features.crowdReportingEnabled) {
    return NextResponse.json(
      { error: 'Fitur laporan komunitas sedang dinonaktifkan.' },
      { status: 403 }
    );
  }
  if (settings.features.maintenanceMode) {
    return NextResponse.json(
      { error: 'Laporan sementara dihentikan selama pemeliharaan.' },
      { status: 503, headers: { 'Retry-After': '300' } }
    );
  }

  if (!isInsideCampusWithSettings(lat, lng, settings)) {
    return NextResponse.json(
      { error: 'Lokasi harus berada di dalam Kampus USU.' },
      { status: 400 }
    );
  }

  if (!isNearRouteWithSettings(lat, lng, settings)) {
    return NextResponse.json(
      { error: 'Lokasi harus berada dekat rute Linus.' },
      { status: 400 }
    );
  }

  if (!validBusIds.includes(busId)) {
    return NextResponse.json(
      { error: 'Pilih armada Linus yang valid.' },
      { status: 400 }
    );
  }

  if (stopId && isSupabaseConfigured && !validStopIds.includes(stopId)) {
    return NextResponse.json(
      { error: 'Halte yang dipilih tidak valid.' },
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

  // Clean up old rate limit entries
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

  // Insert report (cleanup is now handled by pg_cron)
  const { error } = await supabase.from('crowd_reports').insert({
    bus_id: busId,
    stop_id: stopId,
    lat,
    lng,
    occupancy,
    created_at: updatedAt,
  });

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