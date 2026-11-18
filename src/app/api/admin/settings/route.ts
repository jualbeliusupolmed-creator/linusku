import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/adminAuth';
import { getAdminRequestMetadata, logAdminAction } from '@/lib/adminAudit';
import {
  mergeLinuskuSettings,
  type LinuskuSettings,
} from '@/data/usuRoutes';

type SettingsCategory = 'service' | 'eta' | 'map' | 'features' | 'geofence';

type SettingsInput = Partial<LinuskuSettings>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function parseSettings(value: unknown): SettingsInput | null {
  if (!isRecord(value)) return null;
  const input = value;
  const allowedCategories = ['service', 'eta', 'map', 'features', 'geofence'];
  if (
    Object.keys(input).length === 0 ||
    Object.keys(input).some((key) => !allowedCategories.includes(key))
  ) {
    return null;
  }

  const result: SettingsInput = {};
  const service = input.service;
  if (service !== undefined) {
    if (!isRecord(service)) return null;
    const { serviceDays, openingTime, closingTime, timeZone } = service;
    let validTimeZone = 'Asia/Jakarta';
    if (typeof timeZone === 'string') {
      try {
        new Intl.DateTimeFormat('en', { timeZone });
        validTimeZone = timeZone;
      } catch {
        validTimeZone = 'Asia/Jakarta';
      }
    }
    if (
      !Array.isArray(serviceDays) ||
      serviceDays.length === 0 ||
      !serviceDays.every(
        (day) => Number.isInteger(day) && Number(day) >= 1 && Number(day) <= 7
      ) ||
      new Set(serviceDays).size !== serviceDays.length ||
      typeof openingTime !== 'string' ||
      typeof closingTime !== 'string' ||
      !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(openingTime) ||
      !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(closingTime) ||
      openingTime >= closingTime
    ) {
      return null;
    }
    result.service = { serviceDays: serviceDays as number[], openingTime, closingTime, timeZone: validTimeZone };
  }

  const eta = input.eta;
  if (eta !== undefined) {
    if (!isRecord(eta)) return null;
    const { minSpeedKmh, maxSpeedKmh, staleThresholdSeconds } = eta;
    if (
      !isFiniteNumber(minSpeedKmh) ||
      !isFiniteNumber(maxSpeedKmh) ||
      !isFiniteNumber(staleThresholdSeconds) ||
      minSpeedKmh <= 0 ||
      maxSpeedKmh < minSpeedKmh ||
      maxSpeedKmh > 120 ||
      staleThresholdSeconds <= 0 ||
      staleThresholdSeconds > 3600
    ) {
      return null;
    }
    result.eta = { minSpeedKmh, maxSpeedKmh, staleThresholdSeconds };
  }

  const map = input.map;
  if (map !== undefined) {
    if (!isRecord(map)) return null;
    const { tileProvider, fallbackToOsm } = map;
    if (
      (tileProvider !== 'carto_voyager' &&
        tileProvider !== 'pmtiles_r2' &&
        tileProvider !== 'osm') ||
      typeof fallbackToOsm !== 'boolean'
    ) {
      return null;
    }
    result.map = { tileProvider, fallbackToOsm };
  }

  const features = input.features;
  if (features !== undefined) {
    if (!isRecord(features)) return null;
    const { crowdReportingEnabled, simulationMode, maintenanceMode } = features;
    if (
      typeof crowdReportingEnabled !== 'boolean' ||
      typeof simulationMode !== 'boolean' ||
      typeof maintenanceMode !== 'boolean'
    ) {
      return null;
    }
    result.features = { crowdReportingEnabled, simulationMode, maintenanceMode };
  }

  const geofence = input.geofence;
  if (geofence !== undefined) {
    if (!isRecord(geofence) || !isRecord(geofence.campusBounds)) return null;
    const { campusBounds, maxDistanceFromRouteKm } = geofence;
    const { minLat, maxLat, minLng, maxLng } = campusBounds;
    if (
      !isFiniteNumber(minLat) ||
      !isFiniteNumber(maxLat) ||
      !isFiniteNumber(minLng) ||
      !isFiniteNumber(maxLng) ||
      !isFiniteNumber(maxDistanceFromRouteKm) ||
      minLat < -90 ||
      maxLat > 90 ||
      minLng < -180 ||
      maxLng > 180 ||
      minLat >= maxLat ||
      minLng >= maxLng ||
      maxDistanceFromRouteKm <= 0 ||
      maxDistanceFromRouteKm > 10
    ) {
      return null;
    }
    result.geofence = {
      campusBounds: { minLat, maxLat, minLng, maxLng },
      maxDistanceFromRouteKm,
    };
  }

  return result;
}

export async function PUT(request: NextRequest) {
  const authorization = await requireAdmin(request);
  if (!authorization.ok) return authorization.response;

  const body: unknown = await request.json().catch(() => null);
  const input = parseSettings(body);
  if (!input) {
    return NextResponse.json(
      { error: 'Data pengaturan tidak valid.' },
      { status: 400 }
    );
  }

  const adminUser = authorization.user;
  const metadata = getAdminRequestMetadata(request);

  const results: Record<string, unknown> = {};
  let hasError = false;

  for (const [category, value] of Object.entries(input)) {
    const cat = category as SettingsCategory;
    if (!value) continue;

    const { data: oldData, error: oldError } = await authorization.client
      .from('linusku_settings_v2')
      .select('value')
      .eq('key', cat)
      .maybeSingle();
    if (oldError) {
      hasError = true;
      results[cat] = { error: oldError.message };
      continue;
    }

    const { data, error } = await authorization.client
      .from('linusku_settings_v2')
      .upsert(
        {
          key: cat,
          value,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'key' }
      )
      .select('value, updated_at')
      .single();

    if (error) {
      hasError = true;
      results[cat] = { error: error.message };
      continue;
    }

    results[cat] = data;
    await logAdminAction(authorization.client, {
      adminId: adminUser.id,
      action: 'update_settings',
      targetTable: 'linusku_settings_v2',
      targetId: cat,
      oldValue: isRecord(oldData?.value) ? oldData.value : null,
      newValue: { ...value },
      ...metadata,
    });
  }

  if (hasError) {
    return NextResponse.json(
      { error: 'Beberapa pengaturan gagal disimpan.', details: results },
      { status: 503 }
    );
  }

  return NextResponse.json({ settings: results });
}

export async function GET(request: NextRequest) {
  const authorization = await requireAdmin(request);
  if (!authorization.ok) return authorization.response;

  const { data, error } = await authorization.client
    .from('linusku_settings_v2')
    .select('key, value, updated_at')
    .in('key', ['service', 'eta', 'map', 'features', 'geofence']);

  if (error) {
    return NextResponse.json(
      { error: `Gagal memuat pengaturan: ${error.message}` },
      { status: 503 }
    );
  }

  const settingsMap = new Map((data ?? []).map((row) => [row.key, row]));
  const normalized = mergeLinuskuSettings(
    Object.fromEntries((data ?? []).map((row) => [row.key, row.value]))
  );
  const result: Record<string, unknown> = {};

  for (const key of ['service', 'eta', 'map', 'features', 'geofence'] as SettingsCategory[]) {
    const row = settingsMap.get(key);
    result[key] = {
      value: normalized[key],
      updatedAt: row?.updated_at ?? null,
    };
  }

  return NextResponse.json({ settings: result });
}