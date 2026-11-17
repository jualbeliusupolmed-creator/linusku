'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  Bus,
  MapPin,
  Play,
  ShieldCheck,
  Smartphone,
  Square,
} from 'lucide-react';
import {
  OccupancyLevel,
  interpolateAlongRoute,
  isInsideCampus,
  haversineDistanceKm,
} from '@/data/usuRoutes';
import { getSupabaseClient, isSupabaseConfigured } from '@/lib/supabase';

const BUS_OPTIONS = ['LINUS-01', 'LINUS-02', 'LINUS-03'];
const MIN_PUBLISH_INTERVAL_MS = 3000;

interface WakeLockSentinelLike {
  release: () => Promise<void>;
}

export default function DriverPage() {
  const [busId, setBusId] = useState(BUS_OPTIONS[0]);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [sessionEmail, setSessionEmail] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [occupancy, setOccupancy] = useState<OccupancyLevel>('medium');
  const [isTracking, setIsTracking] = useState(false);
  const [useMockGps, setUseMockGps] = useState(true);
  const [wakeLockActive, setWakeLockActive] = useState(false);
  const [lastCoords, setLastCoords] = useState<{
    lat: number;
    lng: number;
    speedKmh: number;
  } | null>(null);
  const [statusMessage, setStatusMessage] = useState(
    'Siap mengirim koordinat armada ke peta LINUSKU.'
  );

  const watchIdRef = useRef<number | null>(null);
  const mockTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const wakeLockRef = useRef<WakeLockSentinelLike | null>(null);
  const lastPublishRef = useRef<{
    lat: number;
    lng: number;
    at: number;
  } | null>(null);

  const requestWakeLock = useCallback(async () => {
    if (typeof navigator === 'undefined' || !('wakeLock' in navigator)) {
      return;
    }
    try {
      const navWithWakeLock = navigator as Navigator & {
        wakeLock?: {
          request: (type: 'screen') => Promise<WakeLockSentinelLike>;
        };
      };
      if (navWithWakeLock.wakeLock) {
        wakeLockRef.current = await navWithWakeLock.wakeLock.request('screen');
        setWakeLockActive(true);
      }
    } catch {
      setWakeLockActive(false);
    }
  }, []);

  const releaseWakeLock = useCallback(async () => {
    if (wakeLockRef.current) {
      try {
        await wakeLockRef.current.release();
      } catch {
        // Ignore release error
      }
      wakeLockRef.current = null;
    }
    setWakeLockActive(false);
  }, []);

  useEffect(() => {
    const supabase = getSupabaseClient();
    if (!supabase) {
      setAuthLoading(false);
      return;
    }

    const loadDriverBus = async (userId: string | undefined) => {
      if (!userId) return;
      const { data } = await supabase
        .from('buses')
        .select('id')
        .eq('driver_id', userId)
        .eq('is_active', true)
        .maybeSingle();

      if (data?.id) {
        setBusId(data.id);
      }
    };

    supabase.auth.getSession().then(({ data }) => {
      setSessionEmail(data.session?.user.email ?? null);
      loadDriverBus(data.session?.user.id);
      setAuthLoading(false);
    });

    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setSessionEmail(session?.user.email ?? null);
      loadDriverBus(session?.user.id);
      setAuthLoading(false);
    });

    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && isTracking) {
        requestWakeLock();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [isTracking, requestWakeLock]);

  const signIn = async () => {
    const supabase = getSupabaseClient();
    if (!supabase) {
      setStatusMessage('Konfigurasi Supabase diperlukan untuk mode login.');
      return;
    }
    setAuthLoading(true);
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    setAuthLoading(false);
    if (error) {
      setStatusMessage(`Login gagal: ${error.message}`);
    } else {
      setStatusMessage('Login berhasil. Siap menyiarkan lokasi armada.');
    }
  };

  const stopTracking = useCallback(() => {
    if (watchIdRef.current !== null && typeof navigator !== 'undefined') {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    if (mockTimerRef.current) {
      clearInterval(mockTimerRef.current);
      mockTimerRef.current = null;
    }
    releaseWakeLock();
    setIsTracking(false);
    setStatusMessage('Pengiriman GPS dihentikan.');
  }, [releaseWakeLock]);

  const signOut = async () => {
    stopTracking();
    const supabase = getSupabaseClient();
    await supabase?.auth.signOut();
  };

  const publishPosition = async (
    lat: number,
    lng: number,
    speedKmh: number,
    heading: number,
    sourceType: 'driver' | 'simulator'
  ) => {
    if (!isInsideCampus(lat, lng)) {
      setStatusMessage('Lokasi di luar batas Kampus USU dan tidak dikirim.');
      return;
    }

    const now = Date.now();
    if (lastPublishRef.current) {
      const elapsedMs = now - lastPublishRef.current.at;
      if (sourceType === 'driver' && elapsedMs < MIN_PUBLISH_INTERVAL_MS) {
        return;
      }

      const elapsedHours = elapsedMs / (1000 * 60 * 60);
      const distanceKm = haversineDistanceKm(
        lastPublishRef.current.lat,
        lastPublishRef.current.lng,
        lat,
        lng
      );
      const impliedSpeed = elapsedHours > 0 ? distanceKm / elapsedHours : 0;
      if (impliedSpeed > 80) {
        setStatusMessage(
          'Perubahan lokasi tidak wajar (>80 km/j) dan ditolak untuk anti-spoofing.'
        );
        return;
      }
    }

    lastPublishRef.current = { lat, lng, at: now };
    setLastCoords({ lat, lng, speedKmh });

    const supabase = getSupabaseClient();
    if (!supabase) {
      setStatusMessage(
        'Mode Uji Lokal — koordinat diperbarui (hubungkan Supabase untuk siaran publik).'
      );
      return;
    }

    const { error } = await supabase.from('bus_positions').upsert({
      bus_id: busId,
      lat,
      lng,
      speed_kmh: Math.min(Math.max(speedKmh, 0), 80),
      heading,
      occupancy,
      source_type: sourceType,
      updated_at: new Date(now).toISOString(),
    });

    if (error) {
      setStatusMessage(`Gagal kirim ke Supabase: ${error.message}`);
    } else {
      setStatusMessage(
        `Tersiar ke server (${new Date(now).toLocaleTimeString('id-ID')})`
      );
    }
  };

  const startTracking = async () => {
    if (!sessionEmail && isSupabaseConfigured) {
      setStatusMessage('Login driver diperlukan sebelum memulai pelacakan.');
      return;
    }

    setIsTracking(true);
    await requestWakeLock();

    if (useMockGps) {
      let progress = 0;
      setStatusMessage('Mode Simulasi GPS Kampus USU berjalan...');
      mockTimerRef.current = setInterval(() => {
        progress += 0.012;
        const pos = interpolateAlongRoute(progress);
        publishPosition(pos.lat, pos.lng, 20, pos.heading, 'simulator');
      }, 3000);
      return;
    }

    if (!navigator.geolocation) {
      setStatusMessage('Browser tidak mendukung Geolocation.');
      setIsTracking(false);
      await releaseWakeLock();
      return;
    }

    setStatusMessage('Mengambil lokasi GPS perangkat...');
    watchIdRef.current = navigator.geolocation.watchPosition(
      (position) => {
        const { latitude, longitude, speed, heading } = position.coords;
        const speedKmh = speed ? Math.round(speed * 3.6) : 18;
        publishPosition(
          latitude,
          longitude,
          speedKmh,
          heading ?? 0,
          'driver'
        );
      },
      (err) => {
        setStatusMessage(`Error GPS: ${err.message}`);
        stopTracking();
      },
      { enableHighAccuracy: true, maximumAge: 3000, timeout: 10000 }
    );
  };

  useEffect(() => {
    return () => stopTracking();
  }, [stopTracking]);

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-8 text-slate-900">
      <div className="mx-auto max-w-md space-y-5">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900"
        >
          <ArrowLeft className="h-4 w-4" />
          Kembali ke Peta Penumpang
        </Link>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-600 text-white">
                <Bus className="h-5 w-5" />
              </div>
              <div>
                <h1 className="text-lg font-bold">Mode Tracker Driver</h1>
                <p className="text-xs text-slate-500">
                  {isSupabaseConfigured
                    ? 'Terhubung ke Supabase Auth & RLS'
                    : 'Mode Simulasi Lokal (Tanpa DB)'}
                </p>
              </div>
            </div>

            {isTracking && (
              <span
                className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${
                  wakeLockActive
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                    : 'border-slate-200 bg-slate-100 text-slate-600'
                }`}
              >
                <Smartphone className="h-3 w-3" />
                {wakeLockActive ? 'Layar Terjaga' : 'GPS Aktif'}
              </span>
            )}
          </div>

          <div className="mt-5 space-y-4">
            {isSupabaseConfigured && !sessionEmail ? (
              <div className="space-y-3 rounded-xl border border-slate-200 p-3.5">
                <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-800">
                  <ShieldCheck className="h-4 w-4 text-emerald-600" />
                  Login Petugas Resmi
                </p>
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="Email petugas / supir"
                  autoComplete="email"
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-emerald-500"
                />
                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Password"
                  autoComplete="current-password"
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-emerald-500"
                />
                <button
                  type="button"
                  onClick={signIn}
                  disabled={authLoading}
                  className="w-full rounded-xl bg-slate-900 py-2 text-sm font-semibold text-white disabled:opacity-50"
                >
                  {authLoading ? 'Memverifikasi...' : 'Masuk sebagai Driver'}
                </button>
              </div>
            ) : (
              isSupabaseConfigured && (
                <div className="flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2">
                  <span className="text-xs font-semibold text-emerald-800">
                    {sessionEmail}
                  </span>
                  <button
                    type="button"
                    onClick={signOut}
                    className="text-xs font-semibold text-rose-700 hover:underline"
                  >
                    Keluar
                  </button>
                </div>
              )
            )}

            <div>
              <label className="block text-xs font-semibold text-slate-700">
                Pilih Armada Bus
              </label>
              <select
                value={busId}
                disabled={isTracking}
                onChange={(e) => setBusId(e.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium outline-none focus:border-emerald-500"
              >
                {BUS_OPTIONS.map((id) => (
                  <option key={id} value={id}>
                    {id}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700">
                Status Kepadatan Penumpang
              </label>
              <div className="mt-1.5 grid grid-cols-3 gap-2">
                {(
                  [
                    { key: 'low', label: 'Lega' },
                    { key: 'medium', label: 'Sedang' },
                    { key: 'full', label: 'Penuh' },
                  ] as const
                ).map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => setOccupancy(item.key)}
                    className={`rounded-xl border py-2 text-xs font-semibold transition ${
                      occupancy === item.key
                        ? 'border-emerald-600 bg-emerald-50 text-emerald-700'
                        : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            <label className="flex items-center gap-2 text-xs text-slate-600">
              <input
                type="checkbox"
                checked={useMockGps}
                disabled={isTracking}
                onChange={(e) => setUseMockGps(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-emerald-600"
              />
              Gunakan simulasi rute kampus (untuk tes dari laptop)
            </label>

            {!isTracking ? (
              <button
                type="button"
                onClick={startTracking}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-700"
              >
                <Play className="h-4 w-4" />
                Mulai Share Lokasi
              </button>
            ) : (
              <button
                type="button"
                onClick={stopTracking}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-rose-600 py-2.5 text-sm font-semibold text-white transition hover:bg-rose-700"
              >
                <Square className="h-4 w-4" />
                Hentikan Share Lokasi
              </button>
            )}
          </div>

          <div className="mt-5 rounded-xl bg-slate-50 p-3 text-xs text-slate-600">
            <p className="font-semibold text-slate-800">{statusMessage}</p>
            {lastCoords && (
              <p className="mt-1 flex items-center gap-1 text-[11px] text-slate-500">
                <MapPin className="h-3.5 w-3.5 text-emerald-600" />
                {lastCoords.lat.toFixed(5)}, {lastCoords.lng.toFixed(5)} •{' '}
                {lastCoords.speedKmh} km/j
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
