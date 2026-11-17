import { NextResponse } from 'next/server';
import {
  BusPosition,
  interpolateAlongRoute,
  isInsideCampus,
} from '@/data/usuRoutes';
import { getCampusRoadPolyline } from '@/lib/campusRoute';
import { getCrowdPositions } from '@/lib/crowdReports';
import { getSupabaseClient, isSupabaseConfigured } from '@/lib/supabase';

const CACHE_TTL_MS = 3000;
const ACTIVE_WINDOW_MS = 45000;

interface CachedPayload {
  buses: BusPosition[];
  mode: 'live' | 'simulation';
  cachedAt: string;
}

let memoryCache: {
  data: CachedPayload;
  expiresAt: number;
} | null = null;

let inflightRequest: Promise<CachedPayload> | null = null;

const SIMULATED_FLEET: Array<{
  busId: string;
  name: string;
  offset: number;
  speedKmh: number;
  occupancy: BusPosition['occupancy'];
}> = [
  {
    busId: 'LINUS-01',
    name: 'Linus 01 — Rute Kampus',
    offset: 0.05,
    speedKmh: 20,
    occupancy: 'medium',
  },
  {
    busId: 'LINUS-02',
    name: 'Linus 02 — Rute Kampus',
    offset: 0.42,
    speedKmh: 18,
    occupancy: 'low',
  },
  {
    busId: 'LINUS-03',
    name: 'Linus 03 — Rute Kampus',
    offset: 0.74,
    speedKmh: 22,
    occupancy: 'full',
  },
];

function buildSimulatedBuses(
  nowMs: number,
  roadPolyline: [number, number][]
): BusPosition[] {
  // 1 putaran penuh simulasi = 12 menit (720.000 ms)
  const cycleProgress = (nowMs % 720000) / 720000;
  const isoNow = new Date(nowMs).toISOString();

  return SIMULATED_FLEET.map((item) => {
    const pos = interpolateAlongRoute(item.offset + cycleProgress, roadPolyline);
    return {
      busId: item.busId,
      name: item.name,
      lat: pos.lat,
      lng: pos.lng,
      speedKmh: item.speedKmh,
      heading: pos.heading,
      occupancy: item.occupancy,
      sourceType: 'simulator',
      updatedAt: isoNow,
    };
  });
}

async function fetchFreshPositions(): Promise<CachedPayload> {
  const nowMs = Date.now();
  const supabase = getSupabaseClient();

  if (!isSupabaseConfigured || !supabase) {
    const { points } = await getCampusRoadPolyline();
    return {
      buses: buildSimulatedBuses(nowMs, points),
      mode: 'simulation',
      cachedAt: new Date(nowMs).toISOString(),
    };
  }

  const cutoffIso = new Date(nowMs - ACTIVE_WINDOW_MS).toISOString();
  const { data, error } = await supabase
    .from('bus_positions')
    .select(
      'bus_id, lat, lng, speed_kmh, heading, occupancy, source_type, updated_at'
    )
    .gte('updated_at', cutoffIso)
    .order('updated_at', { ascending: false });

  if (error || !data) {
    throw new Error(error?.message ?? 'Gagal membaca posisi armada');
  }

  const validBuses: BusPosition[] = data
    .filter((row) => isInsideCampus(row.lat, row.lng))
    .map((row) => ({
      busId: row.bus_id,
      name: `${row.bus_id} — Rute Kampus`,
      lat: row.lat,
      lng: row.lng,
      speedKmh: row.speed_kmh,
      heading: row.heading,
      occupancy: row.occupancy as BusPosition['occupancy'],
      sourceType: row.source_type as BusPosition['sourceType'],
      updatedAt: row.updated_at,
    }));

  const { data: crowdData, error: crowdError } = await supabase
    .from('crowd_reports')
    .select('bus_id, lat, lng, occupancy, created_at')
    .gte('created_at', cutoffIso)
    .not('bus_id', 'is', null)
    .order('created_at', { ascending: false });

  if (crowdError || !crowdData) {
    throw new Error(crowdError?.message ?? 'Gagal membaca laporan crowdsourcing');
  }

  const latestCrowdByBus = new Map<string, BusPosition>();
  for (const row of crowdData) {
    if (
      !row.bus_id ||
      !isInsideCampus(row.lat, row.lng) ||
      latestCrowdByBus.has(row.bus_id)
    ) {
      continue;
    }

    latestCrowdByBus.set(row.bus_id, {
      busId: row.bus_id,
      name: `${row.bus_id} — Rute Kampus`,
      lat: row.lat,
      lng: row.lng,
      speedKmh: 18,
      heading: 0,
      occupancy: row.occupancy as BusPosition['occupancy'],
      sourceType: 'crowd',
      updatedAt: row.created_at,
    });
  }

  const crowdPositions = [
    ...latestCrowdByBus.values(),
    ...getCrowdPositions(),
  ];
  const mergedBuses = validBuses.map((official) => {
    const crowd = crowdPositions.find((item) => item.busId === official.busId);
    if (
      crowd &&
      new Date(crowd.updatedAt).getTime() >
        new Date(official.updatedAt).getTime()
    ) {
      return crowd;
    }
    return official;
  });
  for (const crowd of crowdPositions) {
    if (!mergedBuses.some((bus) => bus.busId === crowd.busId)) {
      mergedBuses.push(crowd);
    }
  }

  return {
    buses: mergedBuses,
    mode: 'live',
    cachedAt: new Date(nowMs).toISOString(),
  };
}

export async function GET() {
  const now = Date.now();

  if (memoryCache && now < memoryCache.expiresAt) {
    return NextResponse.json(memoryCache.data, {
      headers: {
        'Cache-Control': 'public, s-maxage=3, stale-while-revalidate=5',
        'X-Linus-Cache': 'HIT',
      },
    });
  }

  try {
    if (!inflightRequest) {
      inflightRequest = fetchFreshPositions().finally(() => {
        inflightRequest = null;
      });
    }

    const freshData = await inflightRequest;
    memoryCache = {
      data: freshData,
      expiresAt: Date.now() + CACHE_TTL_MS,
    };

    return NextResponse.json(freshData, {
      headers: {
        'Cache-Control': 'public, s-maxage=3, stale-while-revalidate=5',
        'X-Linus-Cache': 'MISS',
      },
    });
  } catch (err) {
    if (memoryCache) {
      return NextResponse.json(memoryCache.data, {
        headers: {
          'Cache-Control': 'public, s-maxage=2, stale-while-revalidate=5',
          'X-Linus-Cache': 'STALE',
        },
      });
    }

    const message =
      err instanceof Error ? err.message : 'Terjadi kesalahan server';
    return NextResponse.json({ error: message, buses: [] }, { status: 500 });
  }
}
