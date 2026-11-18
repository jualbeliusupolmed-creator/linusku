export interface BusStop {
  id: string;
  name: string;
  area: string;
  lat: number;
  lng: number;
  sequenceOrder: number;
}

export type OccupancyLevel = 'low' | 'medium' | 'full';

export type SourceType = 'driver' | 'device' | 'simulator' | 'crowd';

export interface LinusOperatingSettings {
  serviceDays: number[];
  openingTime: string;
  closingTime: string;
  timeZone: string;
}

export interface ETASettings {
  minSpeedKmh: number;
  maxSpeedKmh: number;
  staleThresholdSeconds: number;
}

export interface MapSettings {
  tileProvider: 'carto_voyager' | 'pmtiles_r2' | 'osm';
  fallbackToOsm: boolean;
}

export interface FeatureFlags {
  crowdReportingEnabled: boolean;
  simulationMode: boolean;
  maintenanceMode: boolean;
}

export interface GeofenceSettings {
  campusBounds: {
    minLat: number;
    maxLat: number;
    minLng: number;
    maxLng: number;
  };
  maxDistanceFromRouteKm: number;
}

export interface LinuskuSettings {
  service: LinusOperatingSettings;
  eta: ETASettings;
  map: MapSettings;
  features: FeatureFlags;
  geofence: GeofenceSettings;
}

export const DEFAULT_OPERATING_SETTINGS: LinusOperatingSettings = {
  serviceDays: [1, 2, 3, 4, 5],
  openingTime: '07:00',
  closingTime: '17:00',
  timeZone: 'Asia/Jakarta',
};

export const DEFAULT_ETA_SETTINGS: ETASettings = {
  minSpeedKmh: 12,
  maxSpeedKmh: 80,
  staleThresholdSeconds: 45,
};

export const DEFAULT_MAP_SETTINGS: MapSettings = {
  tileProvider: 'carto_voyager',
  fallbackToOsm: true,
};

export const DEFAULT_FEATURE_FLAGS: FeatureFlags = {
  crowdReportingEnabled: true,
  simulationMode: false,
  maintenanceMode: false,
};

export const DEFAULT_GEOFENCE_SETTINGS: GeofenceSettings = {
  campusBounds: {
    minLat: 3.550,
    maxLat: 3.575,
    minLng: 98.648,
    maxLng: 98.665,
  },
  maxDistanceFromRouteKm: 0.3,
};

export const DEFAULT_LINUSKU_SETTINGS: LinuskuSettings = {
  service: DEFAULT_OPERATING_SETTINGS,
  eta: DEFAULT_ETA_SETTINGS,
  map: DEFAULT_MAP_SETTINGS,
  features: DEFAULT_FEATURE_FLAGS,
  geofence: DEFAULT_GEOFENCE_SETTINGS,
};

function settingsRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function settingValue(
  value: Record<string, unknown>,
  camelCaseKey: string,
  snakeCaseKey: string
): unknown {
  return value[camelCaseKey] ?? value[snakeCaseKey];
}

function settingTime(value: unknown, fallback: string): string {
  if (typeof value !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(value)) {
    return fallback;
  }
  return value.slice(0, 5);
}

export function mergeLinuskuSettings(
  values: Readonly<Record<string, unknown>>
): LinuskuSettings {
  const service = settingsRecord(values.service);
  const eta = settingsRecord(values.eta);
  const map = settingsRecord(values.map);
  const features = settingsRecord(values.features);
  const geofence = settingsRecord(values.geofence);
  const campusBounds = settingsRecord(geofence.campusBounds ?? geofence.campus_bounds);
  const serviceDays = settingValue(service, 'serviceDays', 'service_days');
  const timeZone = service.timeZone ?? service.time_zone;
  const minSpeedKmh = settingValue(eta, 'minSpeedKmh', 'min_speed_kmh');
  const maxSpeedKmh = settingValue(eta, 'maxSpeedKmh', 'max_speed_kmh');
  const staleThresholdSeconds = settingValue(
    eta,
    'staleThresholdSeconds',
    'stale_threshold_seconds'
  );
  const tileProvider = settingValue(map, 'tileProvider', 'tile_provider');
  const fallbackToOsm = settingValue(map, 'fallbackToOsm', 'fallback_to_osm');
  const crowdReportingEnabled = settingValue(
    features,
    'crowdReportingEnabled',
    'crowd_reporting_enabled'
  );
  const simulationMode = settingValue(features, 'simulationMode', 'simulation_mode');
  const maintenanceMode = settingValue(
    features,
    'maintenanceMode',
    'maintenance_mode'
  );
  const minLat = settingValue(campusBounds, 'minLat', 'min_lat');
  const maxLat = settingValue(campusBounds, 'maxLat', 'max_lat');
  const minLng = settingValue(campusBounds, 'minLng', 'min_lng');
  const maxLng = settingValue(campusBounds, 'maxLng', 'max_lng');
  const maxDistanceFromRouteKm = settingValue(
    geofence,
    'maxDistanceFromRouteKm',
    'max_distance_from_route_km'
  );
  const normalizedDays =
    Array.isArray(serviceDays) &&
    serviceDays.length > 0 &&
    serviceDays.every(
      (day) => Number.isInteger(day) && Number(day) >= 1 && Number(day) <= 7
    ) &&
    new Set(serviceDays).size === serviceDays.length
      ? serviceDays as number[]
      : DEFAULT_OPERATING_SETTINGS.serviceDays;
  const validBounds =
    typeof minLat === 'number' &&
    typeof maxLat === 'number' &&
    typeof minLng === 'number' &&
    typeof maxLng === 'number' &&
    Number.isFinite(minLat) &&
    Number.isFinite(maxLat) &&
    Number.isFinite(minLng) &&
    Number.isFinite(maxLng) &&
    minLat < maxLat &&
    minLng < maxLng;

  let validTimeZone = DEFAULT_OPERATING_SETTINGS.timeZone;
  if (typeof timeZone === 'string') {
    try {
      new Intl.DateTimeFormat('en', { timeZone });
      validTimeZone = timeZone;
    } catch {
      validTimeZone = DEFAULT_OPERATING_SETTINGS.timeZone;
    }
  }

  return {
    service: {
      serviceDays: normalizedDays,
      openingTime: settingTime(
        settingValue(service, 'openingTime', 'opening_time'),
        DEFAULT_OPERATING_SETTINGS.openingTime
      ),
      closingTime: settingTime(
        settingValue(service, 'closingTime', 'closing_time'),
        DEFAULT_OPERATING_SETTINGS.closingTime
      ),
      timeZone: validTimeZone,
    },
    eta: {
      minSpeedKmh:
        typeof minSpeedKmh === 'number' &&
        Number.isFinite(minSpeedKmh) &&
        minSpeedKmh > 0
          ? minSpeedKmh
          : DEFAULT_ETA_SETTINGS.minSpeedKmh,
      maxSpeedKmh:
        typeof maxSpeedKmh === 'number' &&
        Number.isFinite(maxSpeedKmh) &&
        maxSpeedKmh > 0
          ? maxSpeedKmh
          : DEFAULT_ETA_SETTINGS.maxSpeedKmh,
      staleThresholdSeconds:
        typeof staleThresholdSeconds === 'number' &&
        Number.isFinite(staleThresholdSeconds) &&
        staleThresholdSeconds > 0
          ? staleThresholdSeconds
          : DEFAULT_ETA_SETTINGS.staleThresholdSeconds,
    },
    map: {
      tileProvider:
        tileProvider === 'carto_voyager' ||
        tileProvider === 'pmtiles_r2' ||
        tileProvider === 'osm'
          ? tileProvider
          : DEFAULT_MAP_SETTINGS.tileProvider,
      fallbackToOsm:
        typeof fallbackToOsm === 'boolean'
          ? fallbackToOsm
          : DEFAULT_MAP_SETTINGS.fallbackToOsm,
    },
    features: {
      crowdReportingEnabled:
        typeof crowdReportingEnabled === 'boolean'
          ? crowdReportingEnabled
          : DEFAULT_FEATURE_FLAGS.crowdReportingEnabled,
      simulationMode:
        typeof simulationMode === 'boolean'
          ? simulationMode
          : DEFAULT_FEATURE_FLAGS.simulationMode,
      maintenanceMode:
        typeof maintenanceMode === 'boolean'
          ? maintenanceMode
          : DEFAULT_FEATURE_FLAGS.maintenanceMode,
    },
    geofence: {
      campusBounds: validBounds
        ? {
            minLat: minLat as number,
            maxLat: maxLat as number,
            minLng: minLng as number,
            maxLng: maxLng as number,
          }
        : DEFAULT_GEOFENCE_SETTINGS.campusBounds,
      maxDistanceFromRouteKm:
        typeof maxDistanceFromRouteKm === 'number' &&
        Number.isFinite(maxDistanceFromRouteKm) &&
        maxDistanceFromRouteKm > 0
          ? maxDistanceFromRouteKm
          : DEFAULT_GEOFENCE_SETTINGS.maxDistanceFromRouteKm,
    },
  };
}

export interface BusPosition {
  busId: string;
  name: string;
  lat: number;
  lng: number;
  speedKmh: number;
  heading: number;
  occupancy: OccupancyLevel;
  sourceType: SourceType;
  updatedAt: string;
}

export interface BusPositionHistory {
  id: number;
  busId: string;
  lat: number;
  lng: number;
  speedKmh: number;
  heading: number;
  occupancy: OccupancyLevel;
  sourceType: SourceType;
  recordedAt: string;
}

export interface AdminAuditLog {
  id: number;
  adminId: string;
  action: string;
  targetTable: string;
  targetId: string | null;
  oldValue: Record<string, unknown> | null;
  newValue: Record<string, unknown> | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
}

export interface DriverSession {
  id: string;
  driverId: string;
  busId: string | null;
  sessionToken: string;
  deviceInfo: Record<string, unknown> | null;
  ipAddress: string | null;
  startedAt: string;
  endedAt: string | null;
  lastGpsAt: string | null;
  gpsCount: number;
  status: 'active' | 'ended' | 'expired';
}

/**
 * Daftar halte utama Bus Lintas USU (Linus) di Kampus Padang Bulan
 * disusun berurutan mengikuti loop jalan kampus (Pintu 1 -> Dr. Mansyur -> Tri Dharma -> Bioteknologi -> Perpustakaan -> Universitas).
 */
export const USU_STOPS: BusStop[] = [
  {
    id: 'halte-pintu-1',
    name: 'Halte Pintu 1 / Gelanggang',
    area: 'Jl. Universitas (Pintu 1)',
    lat: 3.5656,
    lng: 98.6594,
    sequenceOrder: 1,
  },
  {
    id: 'halte-fk',
    name: 'Halte FK / RS USU',
    area: 'Jl. Dr. Mansyur',
    lat: 3.5673,
    lng: 98.6552,
    sequenceOrder: 2,
  },
  {
    id: 'halte-biro',
    name: 'Halte Biro Rektor / Pancasila',
    area: 'Jl. Dr. T. Mansyur',
    lat: 3.5668,
    lng: 98.6528,
    sequenceOrder: 3,
  },
  {
    id: 'halte-vokasi',
    name: 'Halte Fakultas Vokasi / Pintu 4',
    area: 'Jl. Tri Dharma',
    lat: 3.5618,
    lng: 98.6519,
    sequenceOrder: 4,
  },
  {
    id: 'halte-fmipa',
    name: 'Halte FMIPA & Fasilkom-TI',
    area: 'Jl. Bioteknologi',
    lat: 3.5592,
    lng: 98.6542,
    sequenceOrder: 5,
  },
  {
    id: 'halte-feb',
    name: 'Halte FEB USU',
    area: 'Jl. Prof. T.M. Hanafiah',
    lat: 3.5598,
    lng: 98.6562,
    sequenceOrder: 6,
  },
  {
    id: 'halte-perpus',
    name: 'Halte Perpustakaan USU',
    area: 'Jl. Perpustakaan',
    lat: 3.5612,
    lng: 98.6568,
    sequenceOrder: 7,
  },
  {
    id: 'halte-fisip',
    name: 'Halte FISIP & FIB',
    area: 'Jl. Sivitas Akademika',
    lat: 3.5625,
    lng: 98.6572,
    sequenceOrder: 8,
  },
  {
    id: 'halte-teknik',
    name: 'Halte Fakultas Teknik',
    area: 'Jl. Almamater',
    lat: 3.5618,
    lng: 98.6586,
    sequenceOrder: 9,
  },
  {
    id: 'halte-hukum',
    name: 'Halte Fakultas Hukum',
    area: 'Jl. Universitas',
    lat: 3.5639,
    lng: 98.659,
    sequenceOrder: 10,
  },
];

export const ROUTE_POLYLINE: [number, number][] = [
  ...USU_STOPS.map((stop): [number, number] => [stop.lat, stop.lng]),
  [USU_STOPS[0].lat, USU_STOPS[0].lng],
];

export const USU_CENTER: [number, number] = [3.563, 98.6556];

/**
 * Batas tampilan peta khusus Kampus USU Padang Bulan + ~100-150m di sekelilingnya.
 * Digunakan untuk maxBounds peta dan membatasi request tile di luar kampus.
 */
export const USU_MAP_BOUNDS: [[number, number], [number, number]] = [
  [3.5572, 98.6472],
  [3.5695, 98.6612],
];

export const CAMPUS_BOUNDS = DEFAULT_GEOFENCE_SETTINGS.campusBounds;

export function isInsideCampus(lat: number, lng: number, bounds = CAMPUS_BOUNDS): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= bounds.minLat &&
    lat <= bounds.maxLat &&
    lng >= bounds.minLng &&
    lng <= bounds.maxLng
  );
}

/**
 * Validates if a coordinate is within campus bounds using settings from DB
 */
export function isInsideCampusWithSettings(
  lat: number,
  lng: number,
  settings: LinuskuSettings = DEFAULT_LINUSKU_SETTINGS
): boolean {
  return isInsideCampus(lat, lng, settings.geofence.campusBounds);
}

/**
 * Validates if a coordinate is near the route using settings from DB
 */
export function isNearRouteWithSettings(
  lat: number,
  lng: number,
  settings: LinuskuSettings = DEFAULT_LINUSKU_SETTINGS,
  polyline: [number, number][] = ROUTE_POLYLINE
): boolean {
  const projection = projectToRoute(lat, lng, polyline);
  return projection.distanceKm <= settings.geofence.maxDistanceFromRouteKm;
}

export function findNearestStop(
  lat: number,
  lng: number,
  stops: BusStop[] = USU_STOPS
): { stop: BusStop; distanceKm: number; distanceMeters: number } {
  const availableStops = stops.length > 0 ? stops : USU_STOPS;
  return availableStops.map((stop) => {
    const straightDistanceKm = haversineDistanceKm(
      lat,
      lng,
      stop.lat,
      stop.lng
    );
    return {
      stop,
      distanceKm: straightDistanceKm,
      distanceMeters: Math.round(straightDistanceKm * 1250),
    };
  }).sort((a, b) => a.distanceMeters - b.distanceMeters)[0];
}

export function getLinusOperatingStatus(
  now = new Date(),
  settings: LinusOperatingSettings = DEFAULT_OPERATING_SETTINGS
) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: settings.timeZone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const get = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? '';
  const weekday = get('weekday');
  const hour = Number(get('hour'));
  const minute = Number(get('minute'));
  const totalMinutes = hour * 60 + minute;
  const weekdayNumber: Record<string, number> = {
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
    Sun: 7,
  };
  const openingMinutes =
    Number(settings.openingTime.slice(0, 2)) * 60 +
    Number(settings.openingTime.slice(3, 5));
  const closingMinutes =
    Number(settings.closingTime.slice(0, 2)) * 60 +
    Number(settings.closingTime.slice(3, 5));
  const isOpen =
    settings.serviceDays.includes(weekdayNumber[weekday]) &&
    totalMinutes >= openingMinutes &&
    totalMinutes < closingMinutes;
  const dayNames = [
    '',
    'Senin',
    'Selasa',
    'Rabu',
    'Kamis',
    'Jumat',
    'Sabtu',
    'Minggu',
  ];
  const serviceDayLabel =
    settings.serviceDays.length === 5 &&
    settings.serviceDays.every((day, index) => day === index + 1)
      ? 'Senin sampai Jumat'
      : settings.serviceDays.map((day) => dayNames[day]).join(', ');
  const formatTime = (time: string) => time.replace(':', '.');
  const hoursLabel = `${formatTime(settings.openingTime)} sampai ${formatTime(settings.closingTime)} WIB`;

  return {
    isOpen,
    label: isOpen
      ? 'Jam operasional'
      : 'Di luar jam operasional',
    detail: isOpen
      ? `${serviceDayLabel}, ${hoursLabel}`
      : `Linus beroperasi ${serviceDayLabel}, ${hoursLabel}`,
  };
}

/**
 * Menghitung jarak Haversine antar dua koordinat dalam kilometer.
 */
export function haversineDistanceKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Menghitung estimasi waktu tiba (menit) ke halte tertentu.
 * Uses settings for min/max speed if provided.
 */
export function estimateEtaMinutes(
  bus: Pick<BusPosition, 'lat' | 'lng' | 'speedKmh'>,
  stop: BusStop,
  polyline: [number, number][] = ROUTE_POLYLINE,
  etaSettings: ETASettings = DEFAULT_ETA_SETTINGS
): number {
  const roadDistanceKm = routeDistanceToStopKm(
    bus.lat,
    bus.lng,
    stop,
    polyline
  );
  const effectiveSpeed = Math.min(
    Math.max(bus.speedKmh || etaSettings.minSpeedKmh, etaSettings.minSpeedKmh),
    etaSettings.maxSpeedKmh
  );
  const minutes = Math.round((roadDistanceKm / effectiveSpeed) * 60);
  return Math.max(minutes, 1);
}

function getRouteMetrics(polyline: [number, number][]) {
  const segmentLengthsKm = polyline.slice(1).map((point, index) => {
    const previous = polyline[index];
    return haversineDistanceKm(previous[0], previous[1], point[0], point[1]);
  });

  return {
    segmentLengthsKm,
    totalRouteKm: segmentLengthsKm.reduce((total, length) => total + length, 0),
  };
}

export function projectToRoute(
  lat: number,
  lng: number,
  polyline: [number, number][] = ROUTE_POLYLINE
): { lat: number; lng: number; progress: number; distanceKm: number } {
  const activeLine = polyline.length >= 2 ? polyline : ROUTE_POLYLINE;
  const { segmentLengthsKm, totalRouteKm } = getRouteMetrics(activeLine);

  let best = {
    lat: activeLine[0][0],
    lng: activeLine[0][1],
    progress: 0,
    distanceKm: Number.POSITIVE_INFINITY,
  };

  let distanceAlongRouteKm = 0;
  const totalSegments = activeLine.length - 1;

  for (let i = 0; i < totalSegments; i++) {
    const [lat1, lng1] = activeLine[i];
    const [lat2, lng2] = activeLine[i + 1];
    const dx = lng2 - lng1;
    const dy = lat2 - lat1;
    const lengthSquared = dx * dx + dy * dy;
    const t =
      lengthSquared === 0
        ? 0
        : Math.max(
            0,
            Math.min(
              1,
              ((lng - lng1) * dx + (lat - lat1) * dy) / lengthSquared
            )
          );
    const projectedLat = lat1 + dy * t;
    const projectedLng = lng1 + dx * t;
    const distanceKm = haversineDistanceKm(
      lat,
      lng,
      projectedLat,
      projectedLng
    );
    if (distanceKm < best.distanceKm) {
      best = {
        lat: projectedLat,
        lng: projectedLng,
        progress:
          totalRouteKm > 0
            ? (distanceAlongRouteKm + segmentLengthsKm[i] * t) / totalRouteKm
            : 0,
        distanceKm,
      };
    }
    distanceAlongRouteKm += segmentLengthsKm[i];
  }
  return best;
}

export function routeDistanceToStopKm(
  lat: number,
  lng: number,
  stop: BusStop,
  polyline: [number, number][] = ROUTE_POLYLINE
): number {
  const activeLine = polyline.length >= 2 ? polyline : ROUTE_POLYLINE;
  const bus = projectToRoute(lat, lng, activeLine);
  const stopPoint = projectToRoute(stop.lat, stop.lng, activeLine);
  let progressDelta = stopPoint.progress - bus.progress;
  if (progressDelta < 0) progressDelta += 1;
  const { totalRouteKm } = getRouteMetrics(activeLine);

  return Math.max(0, totalRouteKm * progressDelta);
}

/**
 * Menghitung posisi interpolasi di sepanjang rute jalan aspal melingkar.
 */
export function interpolateAlongRoute(
  progress: number,
  polyline: [number, number][] = ROUTE_POLYLINE
): {
  lat: number;
  lng: number;
  heading: number;
} {
  const activeLine = polyline.length >= 2 ? polyline : ROUTE_POLYLINE;
  const totalSegments = activeLine.length - 1;
  const { segmentLengthsKm, totalRouteKm } = getRouteMetrics(activeLine);
  const wrapped = ((progress % 1) + 1) % 1;
  const targetDistanceKm = wrapped * totalRouteKm;
  let distanceAlongRouteKm = 0;
  let index = totalSegments - 1;
  let t = 1;

  for (let i = 0; i < totalSegments; i++) {
    const segmentLengthKm = segmentLengthsKm[i];
    if (
      targetDistanceKm <= distanceAlongRouteKm + segmentLengthKm ||
      i === totalSegments - 1
    ) {
      index = i;
      t =
        segmentLengthKm > 0
          ? (targetDistanceKm - distanceAlongRouteKm) / segmentLengthKm
          : 0;
      break;
    }
    distanceAlongRouteKm += segmentLengthKm;
  }

  const [lat1, lng1] = activeLine[index];
  const [lat2, lng2] = activeLine[index + 1];

  const lat = lat1 + (lat2 - lat1) * t;
  const lng = lng1 + (lng2 - lng1) * t;
  const heading = (Math.atan2(lng2 - lng1, lat2 - lat1) * 180) / Math.PI;

  return { lat, lng, heading };
}
