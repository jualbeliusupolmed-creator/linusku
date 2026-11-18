'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Bell,
  BellRing,
  Bus,
  Clock,
  Copy,
  ExternalLink,
  MapPin,
  Navigation,
  Radio,
  RefreshCw,
  Search,
  Share2,
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
  DEFAULT_SCHEDULE_SETTINGS,
  ETASettings,
  LinusOperatingSettings,
  LinuskuSettings,
  ScheduleSettings,
  USU_STOPS,
  estimateEtaDetails,
  estimateEtaMinutes,
  findNearestStop,
  getLinusOperatingStatus,
  getNextDepartureTimes,
} from '@/data/usuRoutes';
import {
  askNotificationPermission,
  copyEtaUrl,
  generateNextDepartureNotifications,
  getFavoriteStopIds,
  getNotificationPermissionState,
  isPassengerNotificationsOptedIn,
  setPassengerNotificationsOptedIn,
  setFavoriteStopIds as persistFavoriteStopIds,
  shareEtaUrl,
  toggleFavoriteStop as updateFavoriteStop,
  type NotificationPermissionState,
  type NextDeparture,
} from '@/lib/passengerNotifications';
import { getSupabaseClient } from '@/lib/supabase';

const LinusMap = dynamic(() => import('@/components/LinusMap'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center rounded-2xl bg-slate-100 text-sm text-slate-500">
      Memuat peta Kampus USU…
    </div>
  ),
});

const STORAGE_SELECTED_STOP_KEY = 'linusku:selectedStopId';
const POLL_INTERVAL_MS = 4000;
const NOTIFICATION_THRESHOLD_MINUTES = 10;

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
  const [currentLocation, setCurrentLocation] = useState<{
    lat: number;
    lng: number;
  } | null>(null);
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
  const [scheduleSettings, setScheduleSettings] = useState<ScheduleSettings>(
    DEFAULT_SCHEDULE_SETTINGS
  );
  const [pushNotificationsEnabled, setPushNotificationsEnabled] = useState(
    DEFAULT_FEATURE_FLAGS.pushNotificationsEnabled ?? false
  );
  const [notificationPermission, setNotificationPermission] =
    useState<NotificationPermissionState>('default');
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [notificationStatus, setNotificationStatus] = useState('');
  const [shareStatus, setShareStatus] = useState('');
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
          setScheduleSettings(payload.settings.schedule);
          setPushNotificationsEnabled(
            payload.settings.features.pushNotificationsEnabled ?? false
          );
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
      const queryStop = new URLSearchParams(window.location.search).get('stop');
      const savedStop = window.localStorage.getItem(STORAGE_SELECTED_STOP_KEY);
      const requestedStop = queryStop ?? savedStop;
      if (requestedStop && stops.some((stop) => stop.id === requestedStop)) {
        setSelectedStopId(requestedStop);
      }
      setFavoriteStopIds(getFavoriteStopIds());
      setNotificationPermission(getNotificationPermissionState());
      setNotificationsEnabled(isPassengerNotificationsOptedIn());
    } catch {
      setFavoriteStopIds([]);
      setNotificationPermission('unsupported');
    }
  }, [stops]);

  useEffect(() => {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    let active = true;
    void supabase.auth.getSession().then(async ({ data }) => {
      const token = data.session?.access_token;
      if (!token || !active) return;
      const response = await fetch('/api/passenger/preferences', {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      });
      if (!response.ok) return;
      const payload = await response.json() as { favoriteStopIds?: string[] };
      if (active && Array.isArray(payload.favoriteStopIds)) {
        setFavoriteStopIds(payload.favoriteStopIds);
        persistFavoriteStopIds(payload.favoriteStopIds);
      }
    }).catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const handleSelectStop = (stopId: string) => {
    setSelectedStopId(stopId);
    try {
      window.localStorage.setItem(STORAGE_SELECTED_STOP_KEY, stopId);
      const url = new URL(window.location.href);
      url.searchParams.set('stop', stopId);
      window.history.replaceState(null, '', url);
    } catch {
      setStatusMessage('Tujuan pilihan belum dapat disimpan pada tautan halaman.');
    }
  };

  const toggleFavoriteStop = (stopId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const next = updateFavoriteStop(stopId);
    setFavoriteStopIds(next);
    const supabase = getSupabaseClient();
    if (supabase) {
      void supabase.auth.getSession().then(({ data }) => {
        const token = data.session?.access_token;
        if (!token) return;
        void fetch('/api/passenger/preferences', {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ favoriteStopIds: next }),
        });
      }).catch(() => undefined);
    }
  };

  const toggleNotifications = async () => {
    if (notificationsEnabled) {
      setPassengerNotificationsOptedIn(false);
      setNotificationsEnabled(false);
      setNotificationStatus('Notifikasi keberangkatan dinonaktifkan.');
      return;
    }
    const permission = await askNotificationPermission();
    setNotificationPermission(permission);
    if (permission !== 'granted') {
      setNotificationStatus(
        permission === 'denied'
          ? 'Izin notifikasi ditolak browser.'
          : 'Izin notifikasi belum diberikan browser.'
      );
      return;
    }
    const saved = setPassengerNotificationsOptedIn(true);
    setNotificationsEnabled(saved);
    setNotificationStatus(
      saved
        ? 'Notifikasi keberangkatan aktif untuk halte favorit.'
        : 'Preferensi notifikasi tidak dapat disimpan di perangkat ini.'
    );
  };

  const copySelectedEtaUrl = async () => {
    const result = await copyEtaUrl(selectedStop.id);
    setShareStatus(result.message);
  };

  const shareSelectedEtaUrl = async () => {
    const result = await shareEtaUrl(selectedStop.id);
    setShareStatus(result.message);
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
        warnings?: string[];
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
      setStatusMessage(payload.warnings?.[0] ?? '');
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
        setCurrentLocation({ lat, lng });
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
              stopId: selectedStop.id,
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

  const shareCrowdAtStop = async () => {
    if (maintenanceMode || !crowdReportingEnabled) {
      setCrowdStatus('Laporan komunitas sedang tidak tersedia.');
      return;
    }
    if (!crowdBusId) {
      setCrowdStatus('Belum ada armada aktif untuk laporan.');
      return;
    }
    setCrowdStatus('Mengirim laporan halte…');
    try {
      const response = await fetch('/api/crowd', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lat: selectedStop.lat,
          lng: selectedStop.lng,
          busId: crowdBusId,
          stopId: selectedStop.id,
          occupancy: crowdOccupancy,
        }),
      });
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      if (!response.ok) {
        setCrowdStatus(payload?.error ?? 'Laporan halte gagal dikirim.');
        return;
      }
      setCrowdStatus(`Laporan ${selectedStop.name} berhasil dikirim.`);
      void fetchPositions(false);
    } catch {
      setCrowdStatus('Laporan halte tidak dapat dikirim saat ini.');
    }
  };

  const selectedStop: BusStop = useMemo(() => {
    return stops.find((s) => s.id === selectedStopId) ?? stops[0] ?? USU_STOPS[0];
  }, [selectedStopId, stops]);

  const nextDeparture = useMemo(
    () => getNextDepartureTimes(scheduleSettings, new Date(), 1)[0] ?? null,
    [scheduleSettings]
  );

  const activePolyline =
    routePolyline.length >= 2 ? routePolyline : undefined;

  const stopEtas = useMemo(() => {
    return buses
      .map((bus) => {
        const details = estimateEtaDetails(bus, selectedStop, {
          polyline: activePolyline,
          etaSettings,
          scheduleSettings,
        });
        return {
          bus,
          etaMinutes: details.minutes,
          details,
        };
      })
      .filter(({ bus }) =>
        Date.now() - new Date(bus.updatedAt).getTime() <
        etaSettings.staleThresholdSeconds * 1000
      )
      .sort((a, b) => a.etaMinutes - b.etaMinutes);
  }, [buses, selectedStop, activePolyline, etaSettings, scheduleSettings]);

  const notificationDepartures = useMemo<NextDeparture[]>(() => {
    const targetStopIds = Array.from(
      new Set([selectedStop.id, ...favoriteStopIds])
    );
    return targetStopIds.flatMap((stopId) => {
      const stop = stops.find((item) => item.id === stopId);
      if (!stop) return [];
      const nearest = buses
        .map((bus) => ({
          bus,
          details: estimateEtaDetails(bus, stop, {
            polyline: activePolyline,
            etaSettings,
            scheduleSettings,
          }),
        }))
        .sort((left, right) => left.details.minutes - right.details.minutes)[0];
      if (!nearest) return [];
      return [{
        stopId: stop.id,
        stopName: stop.name,
        busId: nearest.bus.busId,
        busName: nearest.bus.name,
        etaMinutes: nearest.details.minutes,
      }];
    });
  }, [
    activePolyline,
    buses,
    etaSettings,
    favoriteStopIds,
    scheduleSettings,
    selectedStop.id,
    stops,
  ]);

  useEffect(() => {
    if (
      !pushNotificationsEnabled ||
      !notificationsEnabled ||
      notificationPermission !== 'granted' ||
      notificationDepartures.length === 0
    ) {
      return;
    }
    let active = true;
    void generateNextDepartureNotifications(notificationDepartures, {
      thresholdMinutes: NOTIFICATION_THRESHOLD_MINUTES,
      stopIds: favoriteStopIds.length ? favoriteStopIds : [selectedStop.id],
      limit: 5,
    }).then((results) => {
      if (!active) return;
      const sent = results.find((result) => result.status === 'sent');
      if (sent) {
        setNotificationStatus(
          `Notifikasi dikirim untuk ${sent.departure?.stopName ?? selectedStop.name}.`
        );
      }
    });
    return () => {
      active = false;
    };
  }, [
    favoriteStopIds,
    notificationDepartures,
    notificationPermission,
    notificationsEnabled,
    pushNotificationsEnabled,
    selectedStop.id,
    selectedStop.name,
  ]);

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
            <span className="brand-mark"><img src="/icon.svg" alt="" /></span>
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
              <span>{!operatingStatus.isOpen ? 'Di luar jam operasional' : feedMode === 'live' ? 'Bus nyata aktif' : feedMode === 'community' ? 'Laporan mahasiswa' : feedMode === 'simulation' ? 'Simulasi bus' : 'Data tidak tersedia'}</span>
            </span>
          </div>
        </div>
      </header>

      <div className="operations-strip">
        <div
          className={`operating-banner ${
            operationsError || statusMessage || !operatingStatus.isOpen ? 'is-warning' : ''
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
                  : statusMessage
                    ? 'Peringatan data'
                    : operatingStatus.label}
            </strong>
            <small>
              {maintenanceMode
                ? 'Pelaporan sementara dihentikan.'
                : operationsError
                  ? 'Online belum tersedia.'
                  : statusMessage || operatingStatus.detail}
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
              onLocateMe={findNearestFromLocation}
              isLocating={locationStatus.startsWith('Membaca')}
              currentLocation={currentLocation}
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
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void toggleNotifications()}
                  disabled={!pushNotificationsEnabled || notificationPermission === 'unsupported'}
                  aria-pressed={notificationsEnabled}
                  aria-label={notificationsEnabled ? 'Matikan notifikasi halte' : 'Aktifkan notifikasi halte'}
                  title={notificationsEnabled ? 'Matikan notifikasi halte' : 'Aktifkan notifikasi halte'}
                  className="arrival-action"
                >
                  {notificationsEnabled ? <BellRing size={15} aria-hidden="true" /> : <Bell size={15} aria-hidden="true" />}
                </button>
                <button
                  type="button"
                  onClick={() => void copySelectedEtaUrl()}
                  aria-label="Salin tautan halte"
                  title="Salin tautan halte"
                  className="arrival-action"
                >
                  <Copy size={15} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={() => void shareSelectedEtaUrl()}
                  aria-label="Bagikan halte"
                  title="Bagikan halte"
                  className="arrival-action"
                >
                  <Share2 size={15} aria-hidden="true" />
                </button>
              </div>
            </div>
            {(notificationStatus || shareStatus) && (
              <p className="mt-2 text-xs text-slate-600" role="status" aria-live="polite">
                {[notificationStatus, shareStatus].filter(Boolean).join(' · ')}
              </p>
            )}
            {operatingStatus.isOpen && nextDeparture && (
              <p className="mt-2 text-xs text-slate-600">
                Keberangkatan berikutnya{' '}
                {new Intl.DateTimeFormat('id-ID', {
                  hour: '2-digit',
                  minute: '2-digit',
                  timeZone: scheduleSettings.timeZone,
                }).format(new Date(nextDeparture))}
              </p>
            )}
            {!operatingStatus.isOpen && (
              <p className="service-status-note" role="status">
                Bus tidak beroperasi sekarang. Waktu dan jarak di bawah hanya simulasi.
              </p>
            )}

            {stopEtas.length === 0 ? (
              <p className="arrival-row">
                {feedMode === 'offline' ? 'Data posisi belum tersedia. Coba segarkan kembali.' : 'Belum ada armada Linus aktif.'}
              </p>
            ) : (
              stopEtas.map(({ bus, etaMinutes }, index) => {
                const isStale =
                  Date.now() - new Date(bus.updatedAt).getTime() >
                  etaSettings.staleThresholdSeconds * 1000;
                return (
                  <div className="arrival-row" key={bus.busId}>
                    <div className="arrival-bus-info">
                      <div className="bus-name">
                        <img className="bus-name-mark" src="/icon.svg" alt="" aria-hidden="true" />
                        {bus.busId}
                        {index === 0 && <span className="nearest-badge">Terdekat</span>}
                      </div>
                      <span className={`occupancy-chip ${bus.occupancy}`}>
                        <Users size={12} aria-hidden="true" />
                        {occupancyBadge[bus.occupancy].label}
                      </span>
                      <small className="arrival-source">
                        {!operatingStatus.isOpen
                          ? 'Contoh simulasi'
                          : bus.sourceType === 'driver'
                            ? 'Posisi GPS driver'
                            : bus.sourceType === 'crowd'
                              ? 'Laporan mahasiswa'
                              : 'Posisi simulasi'} · {new Date(bus.updatedAt).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}
                      </small>
                      {isStale && (
                        <small className="mt-1 block font-semibold text-amber-700">Data posisi lama</small>
                      )}
                    </div>
                    <div className="eta">
                      {etaMinutes <= 1 ? 'Dekat' : etaMinutes}
                      <small>{etaMinutes <= 1 ? 'saat ini' : 'menit'}</small>
                    </div>
                  </div>
                );
              })
            )}
          </section>

          <section className="utility-panel" aria-label="Lokasi dan pelaporan penumpang">
            <div className="utility-heading">
              <strong>Laporkan posisi</strong>
              <small>Pilih armada dan kepadatan</small>
            </div>
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
                Pilih bus
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
                  !operatingStatus.isOpen ||
                  !crowdReportingEnabled ||
                  crowdStatus.startsWith('Membaca') ||
                  fleet.length === 0
                }
              >
                <MapPin size={16} />
                {operatingStatus.isOpen ? 'Kirim lokasi saya' : 'Aktif saat bus beroperasi'}
              </button>
              <button
                type="button"
                className="crowd-button"
                onClick={() => void shareCrowdAtStop()}
                disabled={
                  maintenanceMode ||
                  !operatingStatus.isOpen ||
                  !crowdReportingEnabled ||
                  crowdStatus.startsWith('Mengirim') ||
                  fleet.length === 0
                }
              >
                <MapPin size={16} />
                {operatingStatus.isOpen ? 'Laporkan kepadatan halte' : 'Pelaporan belum tersedia'}
              </button>
            </div>
            <p className="utility-status utility-explanation">
              Saat mengirim, lokasi perangkat ini dan tingkat kepadatan yang dipilih akan dibagikan sebagai laporan posisi bus. Kirim hanya saat kamu sedang berada di Linus.
            </p>
            {crowdStatus && (
              <p className="utility-status" role="status">{crowdStatus}</p>
            )}
          </section>

          <section className="stops-panel" id="halte" aria-labelledby="stops-title">
            <div className="stops-head">
              <h2 id="stops-title">Pilih halte</h2>
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
                  <div key={stop.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-stretch">
                    <button
                      type="button"
                      onClick={() => handleSelectStop(stop.id)}
                      className={`stop-button active:translate-y-px focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${isSelected ? 'is-selected' : ''}`}
                    >
                      <span>
                        <span className="stop-name">
                          <MapPin size={13} aria-hidden="true" /> {stop.name}
                        </span>
                        <span className="stop-area">{stop.area}</span>
                      </span>
                      {nearest !== null && (
                        <span className="stop-nearest">
                          {!operatingStatus.isOpen
                            ? `${Math.max(0, nearest)} menit contoh`
                            : nearest <= 1
                              ? 'Sudah dekat'
                              : `${nearest} menit`}
                        </span>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={(event) => toggleFavoriteStop(stop.id, event)}
                      aria-pressed={isFavorite}
                      aria-label={isFavorite ? `Hapus ${stop.name} dari favorit` : `Tambahkan ${stop.name} ke favorit`}
                      className={`min-h-11 border-b border-slate-200 px-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-600 ${isFavorite ? 'text-amber-600' : 'text-slate-400 hover:text-amber-600'}`}
                    >
                      <Star size={16} fill={isFavorite ? 'currentColor' : 'none'} aria-hidden="true" />
                    </button>
                  </div>
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
          <a href="/" className="is-active active:translate-y-px focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"><img src="/icon.svg" alt="" />Linusku</a>
          <a href="#peta" className="active:translate-y-px focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"><MapPin size={18} />Peta</a>
          <a href="#halte" className="active:translate-y-px focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"><MapPin size={18} />Halte</a>
        </div>
      </nav>
    </div>
  );
}
