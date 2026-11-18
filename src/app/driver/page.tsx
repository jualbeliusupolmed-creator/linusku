'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import {
  ArrowLeft,
  Bus,
  Check,
  MapPin,
  Play,
  Save,
  ShieldCheck,
  Smartphone,
  Square,
  UserRound,
} from 'lucide-react';
import {
  OccupancyLevel,
  SourceType,
  interpolateAlongRoute,
  isInsideCampus,
  haversineDistanceKm,
} from '@/data/usuRoutes';
import { getSupabaseClient, isSupabaseConfigured } from '@/lib/supabase';

const MIN_PUBLISH_INTERVAL_MS = 3000;
const DRIVER_STORAGE_KEY = 'linusku-driver-auth';
const REMEMBER_PREFERENCE_KEY = 'linusku:driver-remember';
const SIMULATION_BUS_ID = 'LINUS-01';

type DriverView = 'tracking' | 'profile';
type DriverBus = { id: string; name: string };

interface WakeLockSentinelLike {
  release: () => Promise<void>;
}

function getOccupancy(value: unknown): OccupancyLevel {
  return value === 'low' || value === 'full' ? value : 'medium';
}

export default function DriverPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [profilePassword, setProfilePassword] = useState('');
  const [rememberMe, setRememberMe] = useState(true);
  const [rememberPreferenceLoaded, setRememberPreferenceLoaded] = useState(false);
  const [authMode, setAuthMode] = useState<'signin' | 'signup'>('signin');
  const [sessionEmail, setSessionEmail] = useState<string | null>(null);
  const [sessionUserId, setSessionUserId] = useState<string | null>(null);
  const [profileName, setProfileName] = useState('');
  const [isDriver, setIsDriver] = useState(false);
  const [assignedBus, setAssignedBus] = useState<DriverBus | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [profileSaving, setProfileSaving] = useState(false);
  const [activeView, setActiveView] = useState<DriverView>('tracking');
  const [occupancy, setOccupancy] = useState<OccupancyLevel>('medium');
  const [isTracking, setIsTracking] = useState(false);
  const [useMockGps, setUseMockGps] = useState(!isSupabaseConfigured);
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
  const occupancyRef = useRef(occupancy);

  useEffect(() => {
    occupancyRef.current = occupancy;
  }, [occupancy]);

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
    setRememberMe(
      window.localStorage.getItem(REMEMBER_PREFERENCE_KEY) !== 'false'
    );
    setRememberPreferenceLoaded(true);
  }, []);

  useEffect(() => {
    if (!rememberPreferenceLoaded) return;

    const supabase = getSupabaseClient({
      rememberSession: rememberMe,
      storageKey: DRIVER_STORAGE_KEY,
    });
    if (!supabase) {
      setAuthLoading(false);
      return;
    }

    let active = true;
    const loadDriverBus = async (
      userId: string | undefined,
      hasDriverRole: boolean
    ) => {
      if (!userId) {
        setAssignedBus(null);
        return;
      }
      const { data, error } = await supabase
        .from('buses')
        .select('id, name')
        .eq('driver_id', userId)
        .eq('is_active', true)
        .maybeSingle();

      if (!active) return;
      if (error) {
        setAssignedBus(null);
        setStatusMessage(`Penugasan bus tidak dapat dimuat: ${error.message}`);
        return;
      }
      if (data?.id) {
        setAssignedBus({ id: data.id, name: data.name });
        setIsDriver(true);
      } else {
        setAssignedBus(null);
        setIsDriver(hasDriverRole);
        setStatusMessage(
          hasDriverRole
            ? 'Akun driver belum ditugaskan ke armada aktif. Hubungi admin LINUSKU.'
            : 'Profil pengguna dimuat. Hanya admin yang dapat mengubah akun menjadi driver.'
        );
      }
    };

    const applySession = (user: {
      id: string;
      email?: string;
      user_metadata?: Record<string, unknown>;
      app_metadata?: Record<string, unknown>;
    } | null) => {
      setSessionUserId(user?.id ?? null);
      setSessionEmail(user?.email ?? null);
      const hasDriverRole = user?.app_metadata?.linusku_account_type === 'driver';
      setIsDriver(hasDriverRole);
      setProfileName(
        typeof user?.user_metadata?.full_name === 'string'
          ? user.user_metadata.full_name
          : ''
      );
      setOccupancy(getOccupancy(user?.user_metadata?.linusku_occupancy));
      setAssignedBus(null);
      if (!user) setActiveView('tracking');
      void loadDriverBus(user?.id, hasDriverRole);
    };

    supabase.auth.getSession().then(async ({ data, error }) => {
      if (!active) return;
      if (error) setStatusMessage(`Sesi driver tidak dapat dimuat: ${error.message}`);
      const cachedUser = data.session?.user ?? null;
      if (cachedUser) {
        const { data: userData, error: userError } = await supabase.auth.getUser();
        if (!active) return;
        if (userError) {
          setStatusMessage(`Profil driver tidak dapat dimuat: ${userError.message}`);
        }
        applySession(userData.user ?? cachedUser);
      } else {
        applySession(null);
      }
      setAuthLoading(false);
    });

    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      applySession(session?.user ?? null);
      setAuthLoading(false);
    });

    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, [rememberMe, rememberPreferenceLoaded]);

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
    const supabase = getSupabaseClient({
      rememberSession: rememberMe,
      storageKey: DRIVER_STORAGE_KEY,
    });
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

  const register = async () => {
    const supabase = getSupabaseClient({
      rememberSession: rememberMe,
      storageKey: DRIVER_STORAGE_KEY,
    });
    if (!supabase) {
      setStatusMessage('Konfigurasi Supabase diperlukan untuk pendaftaran driver.');
      return;
    }
    if (fullName.trim().length < 2) {
      setStatusMessage('Masukkan nama lengkap untuk membuat akun pengguna.');
      return;
    }
    setAuthLoading(true);
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { data: { full_name: fullName.trim() } },
    });
    setAuthLoading(false);
    if (error) {
      setStatusMessage(`Pendaftaran gagal: ${error.message}`);
    } else if (data.session) {
      setStatusMessage('Akun pengguna dibuat. Hubungi admin jika akun ini perlu dijadikan driver.');
    } else {
      setStatusMessage('Akun dibuat. Verifikasi email; admin mengatur jenis akun dan penugasan driver.');
    }
  };

  const signInWithGoogle = async () => {
    const supabase = getSupabaseClient({
      rememberSession: rememberMe,
      storageKey: DRIVER_STORAGE_KEY,
    });
    if (!supabase) {
      setStatusMessage('Konfigurasi Supabase diperlukan untuk login Google.');
      return;
    }
    setAuthLoading(true);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: new URL(window.location.pathname, window.location.origin).toString(),
      },
    });
    if (error) {
      setStatusMessage(`Login Google gagal: ${error.message}`);
      setAuthLoading(false);
    }
  };

  const handleAuthSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (authMode === 'signup') void register();
    else void signIn();
  };

  const saveProfile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const supabase = getSupabaseClient({
      rememberSession: rememberMe,
      storageKey: DRIVER_STORAGE_KEY,
    });
    const cleanName = profileName.trim();
    if (!supabase || cleanName.length < 2) {
      setStatusMessage('Nama lengkap minimal 2 karakter.');
      return;
    }
    if (profilePassword && profilePassword.length < 8) {
      setStatusMessage('Password baru harus memiliki minimal 8 karakter.');
      return;
    }

    setProfileSaving(true);
    const { data, error } = await supabase.auth.updateUser({
      data: {
        full_name: cleanName,
        ...(isDriver ? { linusku_occupancy: occupancy } : {}),
      },
      ...(profilePassword ? { password: profilePassword } : {}),
    });
    setProfileSaving(false);
    if (error) {
      setStatusMessage(`Profil belum dapat disimpan: ${error.message}`);
      return;
    }

    setProfileName(cleanName);
    setProfilePassword('');
    setStatusMessage(
      'Profil tersimpan. Perubahan kepadatan dipakai pada pembaruan GPS berikutnya.'
    );
    if (data.user.email) setSessionEmail(data.user.email);
  };

  const setRememberPreference = (checked: boolean) => {
    setRememberMe(checked);
    window.localStorage.setItem(REMEMBER_PREFERENCE_KEY, String(checked));
  };

  const refreshProfile = async () => {
    const supabase = getSupabaseClient({
      rememberSession: rememberMe,
      storageKey: DRIVER_STORAGE_KEY,
    });
    if (!supabase) return;
    const { data, error } = await supabase.auth.getUser();
    if (error) {
      setStatusMessage(`Profil driver tidak dapat dimuat: ${error.message}`);
      return;
    }
    const hasDriverRole =
      data.user.app_metadata.linusku_account_type === 'driver';
    setIsDriver(hasDriverRole);
    setProfileName(
      typeof data.user.user_metadata?.full_name === 'string'
        ? data.user.user_metadata.full_name
        : ''
    );
    setOccupancy(getOccupancy(data.user.user_metadata?.linusku_occupancy));
    const { data: bus, error: busError } = await supabase
      .from('buses')
      .select('id, name')
      .eq('driver_id', data.user.id)
      .eq('is_active', true)
      .maybeSingle();
    if (busError) {
      setStatusMessage(`Penugasan bus tidak dapat dimuat: ${busError.message}`);
      return;
    }
    setAssignedBus(bus ? { id: bus.id, name: bus.name } : null);
    if (bus) setIsDriver(true);
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
    const supabase = getSupabaseClient({
      rememberSession: rememberMe,
      storageKey: DRIVER_STORAGE_KEY,
    });
    const { error } = (await supabase?.auth.signOut()) ?? { error: null };
    if (error) setStatusMessage(`Keluar gagal: ${error.message}`);
  };

  const publishPosition = async (
    lat: number,
    lng: number,
    speedKmh: number,
    heading: number,
    sourceType: SourceType
  ) => {
    if (isSupabaseConfigured && !assignedBus) {
      setStatusMessage('Akun belum ditugaskan ke armada aktif. Hubungi admin LINUSKU.');
      return;
    }
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

    const supabase = getSupabaseClient({
      rememberSession: rememberMe,
      storageKey: DRIVER_STORAGE_KEY,
    });
    if (!supabase) {
      setStatusMessage(
        'Mode Uji Lokal, koordinat diperbarui (hubungkan Supabase untuk siaran publik).'
      );
      return;
    }

    const { error } = await supabase.from('bus_positions').upsert({
      bus_id: assignedBus?.id ?? SIMULATION_BUS_ID,
      lat,
      lng,
      speed_kmh: Math.min(Math.max(speedKmh, 0), 80),
      heading,
      occupancy: occupancyRef.current,
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
    if (useMockGps && isSupabaseConfigured) {
      setStatusMessage('Simulasi GPS tidak dapat disiarkan ke peta publik. Matikan simulasi untuk memakai GPS perangkat.');
      return;
    }
    if (!sessionUserId && isSupabaseConfigured) {
      setStatusMessage('Login driver diperlukan sebelum memulai pelacakan.');
      return;
    }
    if (isSupabaseConfigured && !isDriver) {
      setStatusMessage('Akun pengguna tidak dapat mengirim GPS. Minta admin mengubah jenis akun.');
      return;
    }
    if (isSupabaseConfigured && !assignedBus) {
      setStatusMessage('Akun belum ditugaskan ke armada aktif. Hubungi admin LINUSKU.');
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
                <h1 className="text-lg font-bold">
                  {sessionEmail && !isDriver ? 'Profil LINUSKU' : 'Mode Tracker Driver'}
                </h1>
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

          {isSupabaseConfigured && sessionEmail && (
            <>
              <div className="mt-5 flex items-center justify-between gap-3 border-y border-slate-200 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-900">
                    {profileName || sessionEmail}
                  </p>
                  <p className="truncate text-xs text-slate-500">
                    {assignedBus
                      ? `${assignedBus.name} · ${assignedBus.id}`
                      : 'Belum ada armada aktif yang ditugaskan'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={signOut}
                  className="shrink-0 rounded-lg px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-700"
                >
                  Keluar
                </button>
              </div>
              <div
                className="mt-3 grid grid-cols-2 gap-2"
                role="tablist"
                aria-label={isDriver ? 'Menu driver' : 'Menu profil'}
              >
                {(isDriver
                  ? [
                      { id: 'tracking' as const, label: 'Pelacakan', icon: Bus },
                      { id: 'profile' as const, label: 'Profil saya', icon: UserRound },
                    ]
                  : [{ id: 'profile' as const, label: 'Profil saya', icon: UserRound }]
                ).map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.id}
                      id={`driver-tab-${item.id}`}
                      type="button"
                      role="tab"
                      aria-selected={activeView === item.id}
                      aria-controls="driver-panel"
                      onClick={() => {
                        setActiveView(item.id);
                        if (item.id === 'profile') void refreshProfile();
                      }}
                      className={`flex min-h-11 items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 ${
                        activeView === item.id
                          ? 'border-emerald-700 bg-emerald-50 text-emerald-800'
                          : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      <Icon className="h-4 w-4" />
                      {item.label}
                    </button>
                  );
                })}
              </div>
            </>
          )}

          <div
            id="driver-panel"
            className="mt-5 space-y-4"
            role={sessionEmail && isSupabaseConfigured ? 'tabpanel' : undefined}
            aria-labelledby={
              sessionEmail && isSupabaseConfigured
                ? `driver-tab-${activeView}`
                : undefined
            }
          >
            {isSupabaseConfigured && authLoading && !sessionEmail ? (
              <p className="rounded-lg bg-slate-50 p-4 text-sm text-slate-600" role="status">
                Memeriksa sesi driver…
              </p>
            ) : isSupabaseConfigured && !sessionEmail ? (
              <form
                onSubmit={handleAuthSubmit}
                className="space-y-4"
              >
                <div>
                  <h2 className="flex items-center gap-2 text-lg font-bold text-slate-900">
                    <ShieldCheck className="h-5 w-5 text-emerald-700" />
                    {authMode === 'signup' ? 'Daftar akun LINUSKU' : 'Masuk ke LINUSKU'}
                  </h2>
                  <p className="mt-1 text-sm text-slate-600">
                    Jenis akun dan akses driver hanya dapat diatur admin.
                  </p>
                </div>
                {authMode === 'signup' && (
                  <label className="block text-sm font-semibold text-slate-700">
                    Nama lengkap
                    <input
                      name="full-name"
                      type="text"
                      value={fullName}
                      onChange={(event) => setFullName(event.target.value)}
                      autoComplete="name"
                      minLength={2}
                      required
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-base focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700"
                    />
                  </label>
                )}
                <label className="block text-sm font-semibold text-slate-700">
                  Email
                  <input
                    name="driver-email"
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    autoComplete="email"
                    required
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-base focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700"
                  />
                </label>
                <label className="block text-sm font-semibold text-slate-700">
                  Password
                  <input
                    name="driver-password"
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    autoComplete={authMode === 'signup' ? 'new-password' : 'current-password'}
                    minLength={authMode === 'signup' ? 8 : undefined}
                    required
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-base focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700"
                  />
                </label>
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={rememberMe}
                    onChange={(event) => setRememberPreference(event.target.checked)}
                    className="h-4 w-4 accent-emerald-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700"
                  />
                  Ingat saya di perangkat ini
                </label>
                <button
                  type="submit"
                  disabled={authLoading || !rememberPreferenceLoaded}
                  className="min-h-11 w-full rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {authLoading
                    ? 'Memverifikasi…'
                    : authMode === 'signup'
                      ? 'Buat akun'
                      : 'Masuk'}
                </button>
                {authMode === 'signin' && (
                  <button
                    type="button"
                    onClick={signInWithGoogle}
                    disabled={authLoading}
                    className="min-h-11 w-full rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 disabled:opacity-50"
                  >
                    Masuk dengan Google
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setAuthMode(authMode === 'signin' ? 'signup' : 'signin')}
                  disabled={authLoading}
                  className="min-h-10 w-full rounded-lg px-3 py-2 text-sm font-semibold text-emerald-800 hover:bg-emerald-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 disabled:opacity-50"
                >
                  {authMode === 'signin' ? 'Buat akun pengguna' : 'Sudah punya akun? Masuk'}
                </button>
              </form>
            ) : !isSupabaseConfigured || activeView === 'profile' || !isDriver ? (
              isSupabaseConfigured ? (
                <form onSubmit={saveProfile} className="space-y-4">
                  <div>
                    <h2 className="text-lg font-bold text-slate-900">Profil pribadi</h2>
                    <p className="mt-1 text-sm text-slate-600">
                      Perbarui data pribadi. Jenis akun dan penugasan armada hanya dapat diatur admin.
                    </p>
                  </div>
                  <label className="block text-sm font-semibold text-slate-700">
                    Nama lengkap
                    <input
                      name="profile-name"
                      type="text"
                      value={profileName}
                      onChange={(event) => setProfileName(event.target.value)}
                      autoComplete="name"
                      minLength={2}
                      required
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-base focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700"
                    />
                  </label>
                  <label className="block text-sm font-semibold text-slate-700">
                    Email akun
                    <input
                      type="email"
                      value={sessionEmail ?? ''}
                      readOnly
                      className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-base text-slate-600"
                    />
                  </label>
                  {isDriver ? (
                    <>
                      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                        <p className="text-sm font-semibold text-slate-800">Armada ditugaskan</p>
                        <p className="mt-1 text-sm text-slate-700">
                          {assignedBus
                            ? `${assignedBus.name} (${assignedBus.id})`
                            : 'Belum ada armada aktif'}
                        </p>
                        <p className="mt-1 text-xs text-slate-500">
                          Hubungi admin untuk mengubah penugasan.
                        </p>
                      </div>
                      <fieldset>
                        <legend className="text-sm font-semibold text-slate-700">
                          Status kepadatan penumpang
                        </legend>
                        <div className="mt-2 grid grid-cols-3 gap-2">
                          {([
                            { key: 'low', label: 'Lega' },
                            { key: 'medium', label: 'Sedang' },
                            { key: 'full', label: 'Penuh' },
                          ] as const).map((item) => (
                            <button
                              key={item.key}
                              type="button"
                              aria-pressed={occupancy === item.key}
                              onClick={() => setOccupancy(item.key)}
                              className={`min-h-11 rounded-lg border px-2 py-2 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 ${
                                occupancy === item.key
                                  ? 'border-emerald-700 bg-emerald-50 text-emerald-800'
                                  : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                              }`}
                            >
                              {occupancy === item.key && <Check className="mr-1 inline h-4 w-4" />}
                              {item.label}
                            </button>
                          ))}
                        </div>
                      </fieldset>
                    </>
                  ) : (
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                      <p className="text-sm font-semibold text-slate-800">Jenis akun</p>
                      <p className="mt-1 text-sm text-slate-700">Pengguna</p>
                      <p className="mt-1 text-xs text-slate-500">
                        Hubungi admin bila akun ini perlu diubah menjadi driver.
                      </p>
                    </div>
                  )}
                  <label className="block text-sm font-semibold text-slate-700">
                    Password baru
                    <input
                      name="profile-password"
                      type="password"
                      value={profilePassword}
                      onChange={(event) => setProfilePassword(event.target.value)}
                      autoComplete="new-password"
                      minLength={profilePassword ? 8 : undefined}
                      placeholder="Kosongkan jika tidak ingin mengganti"
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-base focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700"
                    />
                  </label>
                  <button
                    type="submit"
                    disabled={profileSaving || authLoading}
                    className="flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Save className="h-4 w-4" />
                    {profileSaving ? 'Menyimpan…' : 'Simpan profil'}
                  </button>
                </form>
              ) : (
                <div className="space-y-4">
                  <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                    Mode uji lokal memakai armada simulasi LINUS-01. Lokasi tidak dikirim ke peta publik.
                  </p>
                  <button
                    type="button"
                    onClick={startTracking}
                    disabled={isTracking}
                    className="flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 disabled:opacity-50"
                  >
                    <Play className="h-4 w-4" />
                    Mulai simulasi lokal
                  </button>
                </div>
              )
            ) : (
              <div className="space-y-4">
                <div>
                  <h2 className="text-lg font-bold text-slate-900">Pelacakan armada</h2>
                  <p className="mt-1 text-sm text-slate-600">
                    Bus mengikuti penugasan admin. Ubah kepadatan dari profil pribadi.
                  </p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <p className="text-sm font-semibold text-slate-800">Armada aktif</p>
                  <p className="mt-1 text-sm text-slate-700">
                    {assignedBus
                      ? `${assignedBus.name} (${assignedBus.id})`
                      : 'Belum ditugaskan'}
                  </p>
                  {assignedBus && (
                    <p className="mt-1 text-sm text-slate-600">
                      Kepadatan: {occupancy === 'low' ? 'Lega' : occupancy === 'full' ? 'Penuh' : 'Sedang'}
                    </p>
                  )}
                </div>
                {!assignedBus && (
                  <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                    Akun belum mendapat armada aktif. Minta admin menetapkan penugasan sebelum mulai GPS.
                  </p>
                )}
                <button
                  type="button"
                  onClick={isTracking ? stopTracking : startTracking}
                  disabled={!assignedBus || authLoading}
                  className={`flex min-h-12 w-full items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 disabled:cursor-not-allowed disabled:opacity-50 ${
                    isTracking
                      ? 'bg-rose-700 hover:bg-rose-800 focus-visible:outline-rose-700'
                      : 'bg-emerald-700 hover:bg-emerald-800'
                  }`}
                >
                  {isTracking ? <Square className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                  {isTracking ? 'Hentikan berbagi lokasi' : 'Mulai berbagi lokasi'}
                </button>
              </div>
            )}
          </div>

          {(!isSupabaseConfigured || sessionEmail) && (
            <div className="mt-5 rounded-lg bg-slate-50 p-3 text-sm text-slate-700" role="status" aria-live="polite">
              <p className="font-semibold text-slate-800">{statusMessage}</p>
              {lastCoords && (
                <p className="mt-1 flex items-center gap-1 text-xs text-slate-500">
                  <MapPin className="h-4 w-4 text-emerald-700" />
                  {lastCoords.lat.toFixed(5)}, {lastCoords.lng.toFixed(5)} ·{' '}
                  {lastCoords.speedKmh} km/j
                </p>
              )}
              {isTracking && (
                <p className="mt-1 flex items-center gap-1 text-xs text-slate-500">
                  <Smartphone className="h-4 w-4 text-emerald-700" />
                  {wakeLockActive ? 'Layar tetap aktif saat GPS berjalan' : 'GPS aktif'}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
