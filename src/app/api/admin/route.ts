import { NextRequest, NextResponse } from 'next/server';
import { isAdminEmailAllowed, requireAdmin } from '@/lib/adminAuth';

export async function GET(request: NextRequest) {
  const authorization = await requireAdmin(request);
  if (!authorization.ok) return authorization.response;

  const now = Date.now();
  const [
    busesResult,
    stopsResult,
    positionsResult,
    reportsResult,
    settingsResult,
    usersResult,
  ] = await Promise.all([
    authorization.client
      .from('buses')
      .select('id, name, plate_number, capacity, is_active, driver_id, created_at')
      .order('id'),
    authorization.client
      .from('stops')
      .select('id, name, area, lat, lng, sequence_order')
      .order('sequence_order'),
    authorization.client
      .from('bus_positions')
      .select('bus_id, lat, lng, speed_kmh, heading, occupancy, source_type, updated_at')
      .order('updated_at', { ascending: false }),
    authorization.client
      .from('crowd_reports')
      .select('id, bus_id, stop_id, lat, lng, occupancy, created_at', {
        count: 'exact',
      })
      .gte('created_at', new Date(now - 24 * 60 * 60 * 1000).toISOString())
      .order('created_at', { ascending: false })
      .limit(50),
    authorization.client
      .from('linusku_settings')
      .select('service_days, opening_time, closing_time, updated_at')
      .eq('key', 'service')
      .maybeSingle(),
    authorization.client.auth.admin.listUsers({ page: 1, perPage: 1000 }),
  ]);

  const failedQuery = [
    ['armada', busesResult.error],
    ['halte', stopsResult.error],
    ['posisi bus', positionsResult.error],
    ['laporan crowd', reportsResult.error],
    ['jadwal operasional', settingsResult.error],
    ['akun pengguna', usersResult.error],
  ].find(([, error]) => error);

  if (failedQuery) {
    const [resource, error] = failedQuery;
    const detail =
      typeof error === 'string' ? error : error?.message ?? 'kesalahan server';
    return NextResponse.json(
      { error: `Gagal memuat ${resource}: ${detail}` },
      { status: 503 }
    );
  }

  const buses = busesResult.data ?? [];
  const users = usersResult.data.users.map((user) => {
    const assignedBus = buses.find((bus) => bus.driver_id === user.id);
    return {
      id: user.id,
      email: user.email ?? '',
      fullName:
        typeof user.user_metadata?.full_name === 'string'
          ? user.user_metadata.full_name
          : '',
      occupancy:
        user.user_metadata?.linusku_occupancy === 'low' ||
        user.user_metadata?.linusku_occupancy === 'full'
          ? user.user_metadata.linusku_occupancy
          : 'medium',
      createdAt: user.created_at,
      lastSignInAt: user.last_sign_in_at ?? null,
      bannedUntil: user.banned_until ?? null,
      assignedBusId: assignedBus?.id ?? null,
      isAdmin: isAdminEmailAllowed(user.email),
      provider:
        typeof user.app_metadata?.provider === 'string'
          ? user.app_metadata.provider
          : 'email',
    };
  });

  if (!settingsResult.data) {
    return NextResponse.json(
      { error: 'Pengaturan operasional belum tersedia. Jalankan skema LINUSKU terbaru.' },
      { status: 503 }
    );
  }

  return NextResponse.json({
    buses,
    stops: stopsResult.data ?? [],
    positions: positionsResult.data ?? [],
    reports: reportsResult.data ?? [],
    reportCount24h: reportsResult.count ?? 0,
    settings: settingsResult.data,
    users,
    loadedAt: new Date(now).toISOString(),
  });
}
