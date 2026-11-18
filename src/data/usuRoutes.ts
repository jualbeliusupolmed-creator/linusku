export interface BusStop {
  id: string;
  name: string;
  area: string;
  lat: number;
  lng: number;
  sequenceOrder: number;
}

export type OccupancyLevel = 'low' | 'medium' | 'full';

export interface LinusOperatingSettings {
  serviceDays: number[];
  openingTime: string;
  closingTime: string;
  timeZone: string;
}

export const DEFAULT_OPERATING_SETTINGS: LinusOperatingSettings = {
  serviceDays: [1, 2, 3, 4, 5],
  openingTime: '07:00',
  closingTime: '17:00',
  timeZone: 'Asia/Jakarta',
};

export interface BusPosition {
  busId: string;
  name: string;
  lat: number;
  lng: number;
  speedKmh: number;
  heading: number;
  occupancy: OccupancyLevel;
  sourceType: 'driver' | 'crowd' | 'simulator';
  updatedAt: string;
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

export const CAMPUS_BOUNDS = {
  minLat: 3.550,
  maxLat: 3.575,
  minLng: 98.648,
  maxLng: 98.665,
};

export function isInsideCampus(lat: number, lng: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= CAMPUS_BOUNDS.minLat &&
    lat <= CAMPUS_BOUNDS.maxLat &&
    lng >= CAMPUS_BOUNDS.minLng &&
    lng <= CAMPUS_BOUNDS.maxLng
  );
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
 */
export function estimateEtaMinutes(
  bus: Pick<BusPosition, 'lat' | 'lng' | 'speedKmh'>,
  stop: BusStop,
  polyline: [number, number][] = ROUTE_POLYLINE
): number {
  const roadDistanceKm = routeDistanceToStopKm(
    bus.lat,
    bus.lng,
    stop,
    polyline
  );
  const effectiveSpeed = Math.max(bus.speedKmh || 18, 12);
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
