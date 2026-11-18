import {
  USU_STOPS,
  type BusStop,
} from '@/data/usuRoutes';

const ROUTE_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 jam

let cachedRoadPolyline: {
  signature: string;
  points: [number, number][];
  source: 'osrm' | 'fallback';
  expiresAt: number;
} | null = null;

/**
 * Mengambil geometri rute jalan aspal sebenarnya di Kampus USU Padang Bulan
 * dari OpenStreetMap (OSRM), di-cache 24 jam di server agar nol beban ke API eksternal.
 */
export async function getCampusRoadPolyline(): Promise<{
  points: [number, number][];
  source: 'osrm' | 'fallback';
}>;
export async function getCampusRoadPolyline(
  stops: BusStop[]
): Promise<{
  points: [number, number][];
  source: 'osrm' | 'fallback';
}>;
export async function getCampusRoadPolyline(
  stops: BusStop[] = USU_STOPS
): Promise<{
  points: [number, number][];
  source: 'osrm' | 'fallback';
}> {
  const now = Date.now();
  const routeStops = stops.length >= 2 ? stops : USU_STOPS;
  const signature = routeStops
    .map((stop) => `${stop.id}:${stop.lat},${stop.lng}`)
    .join('|');

  if (
    cachedRoadPolyline &&
    cachedRoadPolyline.signature === signature &&
    now < cachedRoadPolyline.expiresAt
  ) {
    return {
      points: cachedRoadPolyline.points,
      source: cachedRoadPolyline.source,
    };
  }

  try {
    const waypoints = [...routeStops, routeStops[0]]
      .map((stop) => `${stop.lng},${stop.lat}`)
      .join(';');

    const url = `https://router.project-osrm.org/route/v1/driving/${waypoints}?overview=full&geometries=geojson`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    clearTimeout(timeout);

    if (!res.ok) {
      throw new Error(`OSRM HTTP ${res.status}`);
    }

    const data = (await res.json()) as {
      code?: string;
      routes?: Array<{
        geometry?: {
          coordinates?: [number, number][];
        };
      }>;
    };

    const coords = data.routes?.[0]?.geometry?.coordinates;
    if (!coords || coords.length < 10) {
      throw new Error('OSRM geometry empty');
    }

    // OSRM mengembalikan [lng, lat], Leaflet memakai [lat, lng]
    const leafletPoints: [number, number][] = coords.map(([lng, lat]) => [
      lat,
      lng,
    ]);

    cachedRoadPolyline = {
      signature,
      points: leafletPoints,
      source: 'osrm',
      expiresAt: now + ROUTE_CACHE_TTL_MS,
    };

    return { points: leafletPoints, source: 'osrm' };
  } catch {
    const fallbackPoints: [number, number][] = [
      ...routeStops.map((stop): [number, number] => [stop.lat, stop.lng]),
      [routeStops[0].lat, routeStops[0].lng],
    ];
    cachedRoadPolyline = {
      signature,
      points: fallbackPoints,
      source: 'fallback',
      expiresAt: now + 60 * 1000, // coba ulang 1 menit lagi jika gagal
    };
    return { points: fallbackPoints, source: 'fallback' };
  }
}
