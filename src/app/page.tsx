'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Bus,
  Clock,
  ExternalLink,
  MapPin,
  Navigation,
  Radio,
  RefreshCw,
  Search,
  ShoppingBag,
  Star,
  Users,
} from 'lucide-react';
import {
  BusPosition,
  BusStop,
  DEFAULT_ETA_SETTINGS,
  DEFAULT_FEATURE_FLAGS,
  DEFAULT_MAP_SETTINGS,
  DEFAULT_OPERATING_SETTINGS,
  ETASettings,
  LinusOperatingSettings,
  LinuskuSettings,
  USU_STOPS,
  estimateEtaMinutes,
  findNearestStop,
  getLinusOperatingStatus,
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
  const [buses, setBuses] = useState<BusPosition[]>([]);
  const [stops, setStops] = useState<BusStop[]>(USU_STOPS);
  const [fleet, setFleet] = useState<Array<{ id: string; name: string }>>([
    { id: 'LINUS-01', name: 'LINUS-01' },
    { id: 'LINUS-02', name: 'LINUS-02' },
    { id: 'LINUS-03', name: 'LINUS-03' },
  ]);

  const [selectedStopId, setSelectedStopId] = useState<string>(USU_STOPS[0].id);
  const [routePolyline, setRoutePolyline] = useState<[number, number][]>([]);
  const [favoriteStopIds, setFavoriteStopIds] = useState<string[]>([]);
  const [stopQuery, setStopQuery] = useState('');
  const [feedMode, setFeedMode] = useState<'live' | 'community' | 'simulation' | 'offline'>('offline');
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
  const [stopsError, setStopsError] = useState('');
  const [settingsError, setSettingsError] = useState('');
  const [fleetError, setFleetError] = useState('');
  const [serviceSettings, setServiceSettings] =
    useState<LinusOperatingSettings>(DEFAULT_OPERATING_SETTINGS);
  const [etaSettings, setEtaSettings] =
    useState<ETASettings>(DEFAULT_ETA_SETTINGS);
  const [mapSettings, setMapSettings] = useState(DEFAULT_MAP_SETTINGS);
  const [maintenanceMode, setMaintenanceMode] = useState(
    DEFAULT_FEATURE_FLAGS.maintenanceMode
  );
  const [crowdReportingEnabled, setCrowdReportingEnabled] = useState(
    DEFAULT_FEATURE_FLAGS.crowdReportingEnabled
  );
  const [operatingStatus, setOperatingStatus] = useState(
    getLinusOperatingStatus()
  );

  // Muat pengaturan yang diubah admin beserta geometri rute terbaru.
  useEffect(() => {
    let active = true;

    const loadStops = async () => {
      try {
        const response = await fetch('/api/stops');
        const payload = (await response.json()) as {
          stops?: BusStop[];
          error?: string;
        };
        if (!response.ok || !payload.stops?.length) {
          throw new Error(payload.error ?? 'Daftar halte kosong.');
        }
        if (!active) return;
        setStops(payload.stops);
        setSelectedStopId((current) =>
          payload.stops?.some((stop) => stop.id === current)
            ? current
            : payload.stops?.[0].id ?? USU_STOPS[0].id
        );
        setStopsError('');
      } catch {
        if (active) {
          setStopsError('Daftar halte online tidak dapat dimuat. Coba segarkan halaman.');
        }
      }
    };

    const loadFleet = async () => {
      try {
        const response = await fetch('/api/fleet');
        const payload = (await response.json()) as {
          buses?: Array<{ id: string; name: string }>;
          error?: string;
        };
        if (!response.ok || !Array.isArray(payload.buses)) {
          throw new Error(payload.error ?? 'Daftar armada tidak tersedia.');
        }
        if (active) {
          setFleet(payload.buses);
          setCrowdBusId((current) =>
            payload.buses?.some((bus) => bus.id === current)
              ? current
              : payload.buses?.[0].id ?? ''
          );
          setFleetError('');
        }
      } catch (error) {
        if (active) {
          setFleet([]);
          setCrowdBusId('');
          setFleetError(
            error instanceof Error
              ? error.message
              : 'Daftar armada belum dapat dimuat.'
          );
        }
      }
    };

    const loadSettings = async () => {
      try {
        const response = await fetch('/api/settings');
        const payload = (await response.json()) as {
          settings?: LinuskuSettings;
          error?: string;
        };
        if (!response.ok || !payload.settings) {
          throw new Error(payload.error ?? 'Jadwal belum tersedia.');
        }
        if (active) {
          setServiceSettings(payload.settings.service);
          setEtaSettings(payload.settings.eta);
          setMapSettings(payload.settings.map);
          setMaintenanceMode(payload.settings.features.maintenanceMode);
          setCrowdReportingEnabled(
            payload.settings.features.crowdReportingEnabled
          );
          setSettingsError('');
        }
      } catch {
        if (active) {
          setSettingsError('Jadwal online tidak dapat dimuat. Jadwal bawaan ditampilkan.');
        }
      }
    };

    const loadRoute = async () => {
      try {
        const response = await fetch('/api/route');
        const payload = (await response.json()) as {
          points?: [number, number][];
          error?: string;
        };
        if (!response.ok || !payload.points || payload.points.length < 2) {
          throw new Error(payload.error ?? 'Geometri rute belum tersedia.');
        }
        if (active) setRoutePolyline(payload.points);
      } catch {
        if (active) {
          setStatusMessage('Geometri jalan rute belum dapat dimuat. Halte tetap ditampilkan.');
        }
      }
    };

    void loadStops();
    void loadFleet();
    void loadSettings();
    void loadRoute();
    return () => {
      active = false;
    };
  }, []);

  // Muat halte terakhir & daftar halte favorit dari localStorage
  useEffect(() => {
    try {
      const savedStop = window.localStorage.getItem(STORAGE_SELECTED_STOP_KEY);
      if (savedStop && stops.some((s) => s.id === savedStop)) {
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
  }, [stops]);

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
        mode?: 'live' | 'community' | 'simulation' | 'offline';
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
      setFeedMode('offline');
      setStatusMessage('Koneksi posisi terputus. Data yang tampil mungkin sudah lama.');
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
      setOperatingStatus(getLinusOperatingStatus(new Date(), serviceSettings));
    }, 60000);
    setOperatingStatus(getLinusOperatingStatus(new Date(), serviceSettings));
    return () => clearInterval(timer);
  }, [serviceSettings]);

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
        const nearest = findNearestStop(lat, lng, stops);
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
    if (maintenanceMode || !crowdReportingEnabled) {
      setCrowdStatus(
        maintenanceMode
          ? 'Laporan sementara dihentikan selama pemeliharaan.'
          : 'Fitur laporan mahasiswa sedang dinonaktifkan.'
      );
      return;
    }
    if (!crowdBusId) {
      setCrowdStatus('Belum ada armada aktif untuk laporan.');
      return;
    }
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
    return stops.find((s) => s.id === selectedStopId) ?? stops[0] ?? USU_STOPS[0];
  }, [selectedStopId, stops]);

  const activePolyline =
    routePolyline.length >= 2 ? routePolyline : undefined;

  const stopEtas = useMemo(() => {
    return buses
      .map((bus) => ({
        bus,
        etaMinutes: estimateEtaMinutes(bus, selectedStop, activePolyline, etaSettings),
      }))
      .sort((a, b) => a.etaMinutes - b.etaMinutes);
  }, [buses, selectedStop, activePolyline, etaSettings]);

  const filteredStops = useMemo(() => {
    const q = stopQuery.trim().toLowerCase();
    const matching = q
      ? stops.filter(
          (s) =>
            s.name.toLowerCase().includes(q) ||
            s.area.toLowerCase().includes(q)
        )
      : stops;

    return [...matching].sort((a, b) => {
      const aFav = favoriteStopIds.includes(a.id) ? 0 : 1;
      const bFav = favoriteStopIds.includes(b.id) ? 0 : 1;
      if (aFav !== bFav) return aFav - bFav;
      return a.sequenceOrder - b.sequenceOrder;
    });
  }, [stopQuery, favoriteStopIds, stops]);
  const operationsError = settingsError || stopsError || fleetError;

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
              <span>{feedMode === 'live' ? 'Live Kampus' : feedMode === 'community' ? 'Laporan komunitas' : feedMode === 'simulation' ? 'Mode Simulasi' : 'Data tidak tersedia'}</span>
            </span>
          </div>
        </div>
      </header>

      <div className="operations-strip">
        <div
          className={`operating-banner ${
            operationsError || !operatingStatus.isOpen ? 'is-warning' : ''
          }`}
          role="status"
          aria-live="polite"
        >
          <Clock size={16} aria-hidden="true" />
          <span>
            <strong>
              {maintenanceMode
                ? 'Pemeliharaan'
                : operationsError
                  ? 'Jadwal bawaan'
                  : operatingStatus.label}
            </strong>
            <small>
              {maintenanceMode
                ? 'Pelaporan sementara dihentikan.'
                : operationsError
                  ? 'Online belum tersedia.'
                  : operatingStatus.detail}
            </small>
          </span>
        </div>
        <a
          className="marketplace-button"
          href="https://www.kampuskita.my.id/jual-beli"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Buka marketplace KampusKita"
        >
          <ShoppingBag size={18} aria-hidden="true" />
          <span>
            <strong>Marketplace</strong>
            <small>Jual-beli KampusKita</small>
          </span>
          <ExternalLink size={15} aria-hidden="true" />
        </a>
      </div>

      <main className="app-main">
        <section className="map-column" id="peta" aria-label="Peta rute Linus">
          <div className="map-frame">
            <LinusMap
              buses={buses}
              stops={stops}
              routePolyline={activePolyline}
              etaSettings={etaSettings}
              mapSettings={mapSettings}
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
              <span className="route-chip">
                <Clock size={14} aria-hidden="true" />
                {serviceSettings.openingTime.replace(':', '.')}-
                {serviceSettings.closingTime.replace(':', '.')}
              </span>
            </div>

            {stopEtas.length === 0 ? (
              <p className="arrival-row">
                {feedMode === 'offline' ? 'Data posisi belum tersedia. Coba segarkan kembali.' : 'Belum ada armada Linus aktif.'}
              </p>
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
                    <small className="block text-slate-500">
                      {bus.sourceType === 'driver' ? 'GPS driver' : bus.sourceType === 'crowd' ? 'Laporan mahasiswa' : 'Simulasi'} · diperbarui {new Date(bus.updatedAt).toLocaleTimeString('id-ID')}
                    </small>
                  </div>
                  <div className="eta">
                    {etaMinutes}
                    <small>menit · estimasi<br />{Math.round(bus.speedKmh)} km/j</small>
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
                  disabled={fleet.length === 0}
                  onChange={(event) => setCrowdBusId(event.target.value)}
                  className="crowd-select"
                >
                  {fleet.length === 0 && <option value="">Tidak ada armada aktif</option>}
                  {fleet.map((bus) => (
                    <option value={bus.id} key={bus.id}>{bus.name}</option>
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
                disabled={
                  maintenanceMode ||
                  !crowdReportingEnabled ||
                  crowdStatus.startsWith('Membaca') ||
                  fleet.length === 0
                }
              >
                <MapPin size={16} />
                Bagikan lokasi
              </button>
            </div>
            <p className="utility-status">
              Saat mengirim, lokasi perangkat ini dan tingkat kepadatan yang dipilih akan dibagikan sebagai laporan posisi bus. Kirim hanya saat kamu sedang berada di Linus.
            </p>
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
                  ? Math.min(...buses.map((b) => estimateEtaMinutes(b, stop, activePolyline, etaSettings)))
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
          <a href="#halte" className="active:translate-y-px focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"><MapPin size={18} />Halte</a>
        </div>
      </nav>
    </div>
  );
}
