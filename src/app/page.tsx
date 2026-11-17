'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Bus,
  Clock,
  MapPin,
  Navigation,
  Radio,
  RefreshCw,
  Search,
  Star,
  Users,
} from 'lucide-react';
import {
  BusPosition,
  BusStop,
  USU_STOPS,
  estimateEtaMinutes,
  findNearestStop,
  getLinusOperatingStatus,
  interpolateAlongRoute,
  isInsideCampus,
} from '@/data/usuRoutes';

const LinusMap = dynamic(() => import('@/components/LinusMap'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center rounded-2xl bg-slate-100 text-sm text-slate-500">
      Memuat peta Kampus USU…
    </div>
  ),
});

const STORAGE_SELECTED_STOP_KEY = 'linusku:selectedStopId';
const STORAGE_FAVORITE_STOPS_KEY = 'linusku:favoriteStopIds';
const POLL_INTERVAL_MS = 4000;

const INITIAL_SIMULATED_BUSES: Array<{
  busId: string;
  name: string;
  offset: number;
  speedKmh: number;
  occupancy: BusPosition['occupancy'];
}> = [
  {
    busId: 'LINUS-01',
    name: 'Linus 01 Rute Kampus',
    offset: 0.05,
    speedKmh: 20,
    occupancy: 'medium',
  },
  {
    busId: 'LINUS-02',
    name: 'Linus 02 Rute Kampus',
    offset: 0.42,
    speedKmh: 18,
    occupancy: 'low',
  },
  {
    busId: 'LINUS-03',
    name: 'Linus 03 Rute Kampus',
    offset: 0.74,
    speedKmh: 22,
    occupancy: 'full',
  },
];

const occupancyBadge: Record<
  BusPosition['occupancy'],
  { label: string; classes: string }
> = {
  low: {
    label: 'Lega',
    classes: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  },
  medium: {
    label: 'Sedang',
    classes: 'bg-amber-50 text-amber-700 border-amber-200',
  },
  full: {
    label: 'Penuh',
    classes: 'bg-rose-50 text-rose-700 border-rose-200',
  },
};

export default function HomePage() {
  const [buses, setBuses] = useState<BusPosition[]>(() => {
    const now = new Date().toISOString();
    return INITIAL_SIMULATED_BUSES.map((item) => {
      const pos = interpolateAlongRoute(item.offset);
      return {
        busId: item.busId,
        name: item.name,
        lat: pos.lat,
        lng: pos.lng,
        speedKmh: item.speedKmh,
        heading: pos.heading,
        occupancy: item.occupancy,
        sourceType: 'simulator',
        updatedAt: now,
      };
    });
  });

  const [selectedStopId, setSelectedStopId] = useState<string>(USU_STOPS[0].id);
  const [routePolyline, setRoutePolyline] = useState<[number, number][]>([]);
  const [favoriteStopIds, setFavoriteStopIds] = useState<string[]>([]);
  const [stopQuery, setStopQuery] = useState('');
  const [feedMode, setFeedMode] = useState<'live' | 'simulation'>('simulation');
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [nearestInfo, setNearestInfo] = useState<{
    stopName: string;
    distanceMeters: number;
  } | null>(null);
  const [locationStatus, setLocationStatus] = useState('');
  const [crowdBusId, setCrowdBusId] = useState('LINUS-01');
  const [crowdOccupancy, setCrowdOccupancy] =
    useState<BusPosition['occupancy']>('medium');
  const [crowdStatus, setCrowdStatus] = useState('');
  const [operatingStatus, setOperatingStatus] = useState(
    getLinusOperatingStatus()
  );

  // Muat geometri jalan aspal kampus USU sekali saat halaman dibuka
  useEffect(() => {
    fetch('/api/route')
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { points?: [number, number][] } | null) => {
        if (data?.points && data.points.length >= 2) {
          setRoutePolyline(data.points);
        }
      })
      .catch(() => {
        // Fallback otomatis ke ROUTE_POLYLINE bawaan
      });
  }, []);

  // Muat halte terakhir & daftar halte favorit dari localStorage
  useEffect(() => {
    try {
      const savedStop = window.localStorage.getItem(STORAGE_SELECTED_STOP_KEY);
      if (savedStop && USU_STOPS.some((s) => s.id === savedStop)) {
        setSelectedStopId(savedStop);
      }
      const savedFavs = window.localStorage.getItem(STORAGE_FAVORITE_STOPS_KEY);
      if (savedFavs) {
        const parsed = JSON.parse(savedFavs);
        if (Array.isArray(parsed)) {
          setFavoriteStopIds(parsed.filter((id) => typeof id === 'string'));
        }
      }
    } catch {
      // Ignore storage error in private mode
    }
  }, []);

  const handleSelectStop = (stopId: string) => {
    setSelectedStopId(stopId);
    try {
      window.localStorage.setItem(STORAGE_SELECTED_STOP_KEY, stopId);
    } catch {
      // Ignore storage error
    }
  };

  const toggleFavoriteStop = (stopId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setFavoriteStopIds((prev) => {
      const next = prev.includes(stopId)
        ? prev.filter((id) => id !== stopId)
        : [...prev, stopId];
      try {
        window.localStorage.setItem(
          STORAGE_FAVORITE_STOPS_KEY,
          JSON.stringify(next)
        );
      } catch {
        // Ignore storage error
      }
      return next;
    });
  };

  const fetchPositions = useCallback(async (showSpinner = false) => {
    if (showSpinner) setIsRefreshing(true);
    try {
      const res = await fetch('/api/positions', {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const payload = (await res.json()) as {
        buses?: BusPosition[];
        mode?: 'live' | 'simulation';
        cachedAt?: string;
        error?: string;
      };

      if (payload.buses) {
        setBuses(payload.buses);
      }
      if (payload.mode) {
        setFeedMode(payload.mode);
      }
      setLastSyncedAt(
        new Date(payload.cachedAt ?? Date.now()).toLocaleTimeString('id-ID')
      );
      setStatusMessage('');
    } catch {
      setStatusMessage('Menggunakan estimasi lokal (menunggu jaringan)…');
    } finally {
      if (showSpinner) setIsRefreshing(false);
    }
  }, []);

  // Polling hemat kuota ke /api/positions (otomatis jeda saat tab di-background)
  useEffect(() => {
    fetchPositions(false);

    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        fetchPositions(false);
      }
    }, POLL_INTERVAL_MS);

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        fetchPositions(false);
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [fetchPositions]);

  useEffect(() => {
    const timer = setInterval(() => {
      setOperatingStatus(getLinusOperatingStatus());
    }, 60000);
    setOperatingStatus(getLinusOperatingStatus());
    return () => clearInterval(timer);
  }, []);

  const findNearestFromLocation = () => {
    if (!navigator.geolocation) {
      setLocationStatus('Browser tidak mendukung lokasi.');
      return;
    }
    setLocationStatus('Membaca lokasi…');
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        if (!isInsideCampus(lat, lng)) {
          setLocationStatus('Lokasimu berada di luar Kampus USU.');
          return;
        }
        const nearest = findNearestStop(lat, lng);
        handleSelectStop(nearest.stop.id);
        setNearestInfo({
          stopName: nearest.stop.name,
          distanceMeters: nearest.distanceMeters,
        });
        setLocationStatus(
          `~${nearest.distanceMeters} m menuju ${nearest.stop.name}`
        );
      },
      () => {
        setLocationStatus('Izin lokasi ditolak atau lokasi tidak tersedia.');
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
    );
  };

  const shareCrowdLocation = () => {
    if (!navigator.geolocation) {
      setCrowdStatus('Browser tidak mendukung lokasi.');
      return;
    }
    setCrowdStatus('Membaca lokasi bus…');
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        try {
          const response = await fetch('/api/crowd', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              lat: position.coords.latitude,
              lng: position.coords.longitude,
              busId: crowdBusId,
              occupancy: crowdOccupancy,
            }),
          });
          const payload = await response.json();
          if (!response.ok) {
            setCrowdStatus(payload.error ?? 'Laporan gagal dikirim.');
            return;
          }
          setCrowdStatus('Lokasi dan kepadatan berhasil dibagikan.');
          fetchPositions(false);
        } catch {
          setCrowdStatus('Tidak dapat mengirim laporan saat ini.');
        }
      },
      () => {
        setCrowdStatus('Izin lokasi ditolak atau lokasi tidak tersedia.');
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 5000 }
    );
  };

  const selectedStop: BusStop = useMemo(() => {
    return USU_STOPS.find((s) => s.id === selectedStopId) ?? USU_STOPS[0];
  }, [selectedStopId]);

  const activePolyline =
    routePolyline.length >= 2 ? routePolyline : undefined;

  const stopEtas = useMemo(() => {
    return buses
      .map((bus) => ({
        bus,
        etaMinutes: estimateEtaMinutes(bus, selectedStop, activePolyline),
      }))
      .sort((a, b) => a.etaMinutes - b.etaMinutes);
  }, [buses, selectedStop, activePolyline]);

  const filteredStops = useMemo(() => {
    const q = stopQuery.trim().toLowerCase();
    const matching = q
      ? USU_STOPS.filter(
          (s) =>
            s.name.toLowerCase().includes(q) ||
            s.area.toLowerCase().includes(q)
        )
      : USU_STOPS;

    return [...matching].sort((a, b) => {
      const aFav = favoriteStopIds.includes(a.id) ? 0 : 1;
      const bFav = favoriteStopIds.includes(b.id) ? 0 : 1;
      if (aFav !== bFav) return aFav - bFav;
      return a.sequenceOrder - b.sequenceOrder;
    });
  }, [stopQuery, favoriteStopIds]);

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-inner">
          <Link href="/" className="brand" aria-label="LINUSKU, kembali ke beranda">
            <span className="brand-mark"><Bus size={20} /></span>
            <span>
              <span className="brand-name">LINUSKU</span>
              <span className="brand-place">Universitas Sumatera Utara</span>
            </span>
          </Link>

          <div className="topbar-actions">
            {statusMessage && (
              <span className="visually-hidden" role="status">{statusMessage}</span>
            )}
            <button
              type="button"
              onClick={() => fetchPositions(true)}
              title="Segarkan posisi bus"
              className="live-chip active:translate-y-px disabled:cursor-not-allowed disabled:opacity-55 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
              disabled={isRefreshing}
            >
              <RefreshCw size={16} />
              <span>{lastSyncedAt ?? 'Segarkan'}</span>
            </button>
            <span className={`live-chip focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${feedMode === 'live' ? 'is-live' : ''}`} role="status">
              <Radio size={16} />
              <span>{feedMode === 'live' ? 'Live Kampus' : 'Mode Simulasi'}</span>
            </span>
            <Link href="/driver" className="driver-link active:translate-y-px focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">
              <Navigation size={16} />
              <span>Mode Driver</span>
            </Link>
          </div>
        </div>
      </header>

      {!operatingStatus.isOpen && (
        <div className="operating-banner" role="status">
          <Clock size={15} />
          <span>
            <strong>{operatingStatus.label}</strong>
            <small>{operatingStatus.detail}</small>
          </span>
        </div>
      )}

      <main className="app-main">
        <section className="map-column" id="peta" aria-label="Peta rute Linus">
          <div className="map-frame">
            <LinusMap
              buses={buses}
              routePolyline={activePolyline}
              selectedStopId={selectedStop.id}
              onSelectStop={(stop) => handleSelectStop(stop.id)}
            />
          </div>
        </section>

        <aside className="board-column" aria-label="Informasi kedatangan dan halte">
          <section className="arrival-board" aria-labelledby="arrival-title">
            <div className="arrival-head">
              <div>
                <h2 id="arrival-title">{selectedStop.name}</h2>
                <p className="stop-area">{selectedStop.area}</p>
              </div>
              <span className="route-chip"><Clock size={14} />07.00 sampai 17.00</span>
            </div>

            {stopEtas.length === 0 ? (
              <p className="arrival-row">Belum ada armada Linus aktif.</p>
            ) : (
              stopEtas.map(({ bus, etaMinutes }) => (
                <div className="arrival-row" key={bus.busId}>
                  <div>
                    <div className="bus-name">
                      <Bus size={18} />
                      {bus.busId}
                    </div>
                    <span className={`occupancy-chip ${bus.occupancy}`}>
                      <Users size={13} />
                      {occupancyBadge[bus.occupancy].label}
                    </span>
                  </div>
                  <div className="eta">
                    {etaMinutes}
                    <small>menit<br />{Math.round(bus.speedKmh)} km/j</small>
                  </div>
                </div>
              ))
            )}
          </section>

          <section className="utility-panel" aria-label="Lokasi dan pelaporan penumpang">
            <button
              type="button"
              className="nearest-button"
              onClick={findNearestFromLocation}
              disabled={Boolean(locationStatus.startsWith('Membaca'))}
            >
              <Navigation size={16} />
              Halte terdekat dari lokasiku
            </button>
            {(nearestInfo || locationStatus) && (
              <p className="utility-status" role="status">
                {locationStatus}
              </p>
            )}

            <div className="crowd-row">
              <label>
                Armadaku
                <select
                  value={crowdBusId}
                  onChange={(event) => setCrowdBusId(event.target.value)}
                  className="crowd-select"
                >
                  {['LINUS-01', 'LINUS-02', 'LINUS-03'].map((id) => (
                    <option value={id} key={id}>{id}</option>
                  ))}
                </select>
              </label>
              <label>
                Kepadatan
                <select
                  value={crowdOccupancy}
                  onChange={(event) =>
                    setCrowdOccupancy(event.target.value as BusPosition['occupancy'])
                  }
                  className="crowd-select"
                >
                  <option value="low">Lega</option>
                  <option value="medium">Sedang</option>
                  <option value="full">Penuh</option>
                </select>
              </label>
              <button
                type="button"
                className="crowd-button"
                onClick={shareCrowdLocation}
                disabled={crowdStatus.startsWith('Membaca')}
              >
                <MapPin size={16} />
                Bagikan lokasi
              </button>
            </div>
            {crowdStatus && (
              <p className="utility-status" role="status">{crowdStatus}</p>
            )}
          </section>

          <section className="stops-panel" id="halte" aria-labelledby="stops-title">
            <div className="stops-head">
              <h2 id="stops-title">Halte</h2>
              <input
                className="stop-search focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                type="search"
                value={stopQuery}
                onChange={(e) => setStopQuery(e.target.value)}
                placeholder="Cari halte"
                aria-label="Cari halte"
              />
            </div>
            <div className="stop-list">
              {filteredStops.map((stop) => {
                const isSelected = stop.id === selectedStop.id;
                const isFavorite = favoriteStopIds.includes(stop.id);
                const nearest = buses.length
                  ? Math.min(...buses.map((b) => estimateEtaMinutes(b, stop, activePolyline)))
                  : null;
                return (
                  <button
                    type="button"
                    key={stop.id}
                    onClick={() => handleSelectStop(stop.id)}
                    className={`stop-button active:translate-y-px focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${isSelected ? 'is-selected' : ''}`}
                  >
                    <span>
                      <span className="stop-name">
                        {isFavorite ? <Star size={13} aria-hidden="true" /> : <MapPin size={13} aria-hidden="true" />}{' '}
                        {stop.name}
                      </span>
                      <span className="stop-area">{stop.area}</span>
                    </span>
                    {nearest !== null && (
                      <span className="stop-nearest">~{nearest} menit</span>
                    )}
                  </button>
                );
              })}
            </div>
          </section>

          <a
            className="studentplace-banner"
            href="https://studentplace.id"
            target="_blank"
            rel="noreferrer"
            aria-label="Buka StudentPlace"
          >
            <span>
              <strong>Kampus kita, open po</strong>
              <small>Temukan kegiatan dan komunitas USU di StudentPlace</small>
            </span>
            <Navigation size={16} />
          </a>
        </aside>
      </main>

      <nav className="bottom-nav" aria-label="Navigasi utama">
        <div className="bottom-nav-inner">
          <a href="/" className="is-active active:translate-y-px focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"><Bus size={18} />Linusku</a>
          <a href="#peta" className="active:translate-y-px focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"><MapPin size={18} />Peta</a>
          <Link href="/driver" className="active:translate-y-px focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"><Navigation size={18} />Driver</Link>
        </div>
      </nav>
    </div>
  );
}
