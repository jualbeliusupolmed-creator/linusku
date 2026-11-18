'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  ArrowDown,
  ArrowUp,
  Bus,
  Clock3,
  FileText,
  LogOut,
  MapPin,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Users,
} from 'lucide-react';
import type { Session } from '@supabase/supabase-js';
import {
  DEFAULT_ETA_SETTINGS,
  DEFAULT_FEATURE_FLAGS,
  DEFAULT_GEOFENCE_SETTINGS,
  DEFAULT_MAP_SETTINGS,
} from '@/data/usuRoutes';
import { getSupabaseClient, isSupabaseConfigured } from '@/lib/supabase';
import './admin.css';

type AdminTab = 'overview' | 'fleet' | 'drivers' | 'stops' | 'reports' | 'operations' | 'audit' | 'history';
type Occupancy = 'low' | 'medium' | 'full';

interface AdminBus {
  id: string;
  name: string;
  plate_number: string | null;
  capacity: number;
  is_active: boolean;
  driver_id: string | null;
}

interface AdminStop {
  id: string;
  name: string;
  area: string;
  lat: number;
  lng: number;
  sequence_order: number;
}

interface AdminPosition {
  bus_id: string;
  lat: number;
  lng: number;
  speed_kmh: number;
  occupancy: Occupancy;
  source_type: string;
  updated_at: string;
}

interface AdminReport {
  id: string;
  bus_id: string | null;
  stop_id: string | null;
  lat: number;
  lng: number;
  occupancy: Occupancy;
  created_at: string;
}

interface AdminUser {
  id: string;
  email: string;
  fullName: string;
  occupancy: Occupancy;
  createdAt: string;
  lastSignInAt: string | null;
  bannedUntil: string | null;
  assignedBusId: string | null;
  isAdmin: boolean;
  isDriver: boolean;
  provider: string;
}

interface AdminSettings {
  service: {
    serviceDays: number[];
    openingTime: string;
    closingTime: string;
    timeZone: string;
  };
  eta?: {
    minSpeedKmh: number;
    maxSpeedKmh: number;
    staleThresholdSeconds: number;
  };
  map?: {
    tileProvider: 'carto_voyager' | 'pmtiles_r2' | 'osm';
    fallbackToOsm: boolean;
  };
  features?: {
    crowdReportingEnabled: boolean;
    simulationMode: boolean;
    maintenanceMode: boolean;
  };
  geofence?: {
    campusBounds: {
      minLat: number;
      maxLat: number;
      minLng: number;
      maxLng: number;
    };
    maxDistanceFromRouteKm: number;
  };
  updatedAt?: string;
}

interface AdminData {
  buses: AdminBus[];
  stops: AdminStop[];
  positions: AdminPosition[];
  reports: AdminReport[];
  reportCount24h: number;
  settings: AdminSettings;
  settingsSource?: string;
  settingsUpdatedAt?: string;
  users: AdminUser[];
  drivers: AdminUser[];
  loadedAt: string;
}

interface AuditLog {
  id: number;
  admin_id: string;
  action: string;
  target_table: string;
  target_id: string | null;
  old_value: Record<string, unknown> | null;
  new_value: Record<string, unknown> | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
}

interface AuditLogResponse {
  logs: AuditLog[];
  totalCount: number;
  limit: number;
  offset: number;
}

interface PositionHistory {
  id: number;
  bus_id: string;
  lat: number;
  lng: number;
  speed_kmh: number;
  heading: number;
  occupancy: Occupancy;
  source_type: string;
  recorded_at: string;
}

interface PositionHistoryResponse {
  history: PositionHistory[];
  totalCount: number;
  limit: number;
  offset: number;
}

interface BusForm {
  id: string;
  name: string;
  plateNumber: string;
  capacity: string;
  isActive: boolean;
  driverId: string;
}

interface StopForm {
  id: string;
  name: string;
  area: string;
  lat: string;
  lng: string;
}

interface DriverForm {
  id: string;
  email: string;
  fullName: string;
  occupancy: Occupancy;
  password: string;
  active: boolean;
}

const TABS: Array<{ id: AdminTab; label: string; icon: typeof Activity }> = [
  { id: 'overview', label: 'Ikhtisar', icon: Activity },
  { id: 'fleet', label: 'Armada', icon: Bus },
  { id: 'drivers', label: 'Akun', icon: Users },
  { id: 'stops', label: 'Halte', icon: MapPin },
  { id: 'reports', label: 'Laporan crowd', icon: FileText },
  { id: 'operations', label: 'Jam dan rute', icon: Clock3 },
  { id: 'audit', label: 'Audit Log', icon: FileText },
  { id: 'history', label: 'Riwayat GPS', icon: Clock3 },
];

const DAYS = [
  { id: 1, label: 'Senin' },
  { id: 2, label: 'Selasa' },
  { id: 3, label: 'Rabu' },
  { id: 4, label: 'Kamis' },
  { id: 5, label: 'Jumat' },
  { id: 6, label: 'Sabtu' },
  { id: 7, label: 'Minggu' },
];

const EMPTY_BUS_FORM: BusForm = {
  id: '',
  name: '',
  plateNumber: '',
  capacity: '30',
  isActive: true,
  driverId: '',
};

const EMPTY_STOP_FORM: StopForm = {
  id: '',
  name: '',
  area: '',
  lat: '',
  lng: '',
};

function messageFromError(error: unknown): string {
  return error instanceof Error ? error.message : 'Permintaan belum berhasil. Coba lagi.';
}

function formatTime(value: string | null): string {
  if (!value) return 'Belum diperiksa';
  return new Intl.DateTimeFormat('id-ID', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Jakarta',
  }).format(new Date(value));
}

function formatDate(value: string | null): string {
  if (!value) return 'Belum pernah masuk';
  return new Intl.DateTimeFormat('id-ID', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Jakarta',
  }).format(new Date(value));
}

function formatOccupancy(value: Occupancy): string {
  return value === 'low' ? 'Lega' : value === 'medium' ? 'Sedang' : 'Penuh';
}

function ageLabel(value: string | undefined, now: number): string {
  if (!value) return 'Belum ada GPS';
  const ageSeconds = Math.max(0, Math.floor((now - new Date(value).getTime()) / 1000));
  if (ageSeconds < 45) return `Diperbarui ${ageSeconds} dtk lalu`;
  if (ageSeconds < 3600) return `Data lama, ${Math.floor(ageSeconds / 60)} mnt`;
  return `Data lama, ${formatTime(value)}`;
}

export default function AdminPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState('');
  const [data, setData] = useState<AdminData | null>(null);
  const [summaryLoaded, setSummaryLoaded] = useState(false);
  const [dataLoading, setDataLoading] = useState(false);
  const [dataError, setDataError] = useState('');
  const [positionError, setPositionError] = useState('');
  const [actionMessage, setActionMessage] = useState<{
    kind: 'success' | 'error';
    text: string;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<AdminTab>('overview');
  const [accountList, setAccountList] = useState<'users' | 'drivers'>('users');
  const [now, setNow] = useState(Date.now());
  const [lastPositionCheck, setLastPositionCheck] = useState<string | null>(null);
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [busEditorOpen, setBusEditorOpen] = useState(false);
  const [editingBusId, setEditingBusId] = useState<string | null>(null);
  const [busForm, setBusForm] = useState<BusForm>(EMPTY_BUS_FORM);
  const [driverEditorOpen, setDriverEditorOpen] = useState(false);
  const [editingDriver, setEditingDriver] = useState<DriverForm | null>(null);
  const [editingAccountType, setEditingAccountType] = useState<'user' | 'driver'>('driver');
  const [newDriver, setNewDriver] = useState({ email: '', fullName: '', password: '' });
  const [stopEditorOpen, setStopEditorOpen] = useState(false);
  const [editingStopId, setEditingStopId] = useState<string | null>(null);
  const [stopForm, setStopForm] = useState<StopForm>(EMPTY_STOP_FORM);
  const [serviceDays, setServiceDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [openingTime, setOpeningTime] = useState('07:00');
  const [closingTime, setClosingTime] = useState('17:00');
  const [etaSettings, setEtaSettings] = useState(DEFAULT_ETA_SETTINGS);
  const [mapSettings, setMapSettings] = useState(DEFAULT_MAP_SETTINGS);
  const [featureFlags, setFeatureFlags] = useState(DEFAULT_FEATURE_FLAGS);
  const [geofenceSettings, setGeofenceSettings] = useState(DEFAULT_GEOFENCE_SETTINGS);

  // Audit log state
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditError, setAuditError] = useState('');
  const [auditTotalCount, setAuditTotalCount] = useState(0);
  const [auditOffset, setAuditOffset] = useState(0);
  const [auditLimit] = useState(50);
  const [auditFilters, setAuditFilters] = useState({
    action: '',
    targetTable: '',
    targetId: '',
    adminId: '',
    since: '',
  });

  // History state
  const [positionHistory, setPositionHistory] = useState<PositionHistory[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [historyTotalCount, setHistoryTotalCount] = useState(0);
  const [historyOffset, setHistoryOffset] = useState(0);
  const [historyLimit] = useState(100);
  const [historyFilters, setHistoryFilters] = useState({
    busId: '',
    sourceType: '',
    since: '',
    until: '',
  });

  const requestAdmin = useCallback(
    async <T,>(url: string, init: RequestInit = {}): Promise<T> => {
      const supabase = getSupabaseClient();
      if (!supabase) throw new Error('Supabase belum dikonfigurasi.');
      const { data: sessionData, error: sessionError } =
        await supabase.auth.getSession();
      if (sessionError) throw new Error(`Sesi admin tidak dapat dibaca: ${sessionError.message}`);
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) throw new Error('Sesi admin sudah berakhir. Masuk kembali.');

      const headers = new Headers(init.headers);
      headers.set('Authorization', `Bearer ${accessToken}`);
      if (init.body) headers.set('Content-Type', 'application/json');
      const response = await fetch(url, { ...init, headers });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const errorMessage =
          payload && typeof payload === 'object' && 'error' in payload &&
          typeof payload.error === 'string'
            ? payload.error
            : `Permintaan gagal dengan status ${response.status}.`;
        throw new Error(errorMessage);
      }
      return payload as T;
    },
    []
  );

  const loadSummary = useCallback(async () => {
    if (!session) return;
    setDataLoading(true);
    setDataError('');
    try {
      const payload = await requestAdmin<AdminData>('/api/admin');
      setData(payload);
      setSummaryLoaded(true);
    } catch (error) {
      setDataError(messageFromError(error));
      setData(null);
      setSummaryLoaded(false);
    } finally {
      setDataLoading(false);
    }
  }, [requestAdmin, session]);

  useEffect(() => {
    const supabase = getSupabaseClient();
    if (!supabase) {
      setAuthError('Supabase belum dikonfigurasi untuk login admin.');
      setAuthLoading(false);
      return;
    }

    supabase.auth.getSession().then(({ data: sessionData, error }) => {
      if (error) setAuthError(`Sesi login tidak dapat dimuat: ${error.message}`);
      setSession(sessionData.session);
      setAuthLoading(false);
    });

    const { data: authListener } = supabase.auth.onAuthStateChange(
      (_event, nextSession) => {
        setSession(nextSession);
        setAuthError('');
      }
    );
    return () => authListener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    const queryTab = new URLSearchParams(window.location.search).get('tab');
    if (TABS.some((tab) => tab.id === queryTab)) {
      setActiveTab(queryTab as AdminTab);
    }
    const handlePopState = () => {
      const nextTab = new URLSearchParams(window.location.search).get('tab');
      if (TABS.some((tab) => tab.id === nextTab)) {
        setActiveTab(nextTab as AdminTab);
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  useEffect(() => {
    setData(null);
    setSummaryLoaded(false);
    if (session) void loadSummary();
  }, [loadSummary, session]);

  useEffect(() => {
    if (!data?.settings) return;
    if (data.settings.service) {
      setServiceDays(data.settings.service.serviceDays);
      setOpeningTime(data.settings.service.openingTime);
      setClosingTime(data.settings.service.closingTime);
    }
    setEtaSettings(data.settings.eta ?? DEFAULT_ETA_SETTINGS);
    setMapSettings(data.settings.map ?? DEFAULT_MAP_SETTINGS);
    setFeatureFlags(data.settings.features ?? DEFAULT_FEATURE_FLAGS);
    setGeofenceSettings(data.settings.geofence ?? DEFAULT_GEOFENCE_SETTINGS);
  }, [data?.loadedAt, data?.settings]);

  useEffect(() => {
    if (!summaryLoaded) return;
    let active = true;
    const refresh = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const payload = await requestAdmin<{
          buses: Array<AdminBus & { position: Omit<AdminPosition, 'bus_id'> | null }>;
          checkedAt: string;
        }>('/api/admin/positions');
        if (!active) return;
        const nextPositions = payload.buses.flatMap((bus) =>
          bus.position ? [{ ...bus.position, bus_id: bus.id }] : []
        );
        setData((current) =>
          current ? { ...current, positions: nextPositions } : current
        );
        setLastPositionCheck(payload.checkedAt);
        setPositionError('');
      } catch (error) {
        if (active) setPositionError(messageFromError(error));
      }
    };
    void refresh();
    const timer = window.setInterval(() => {
      setNow(Date.now());
      void refresh();
    }, 10000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [summaryLoaded, requestAdmin]);

  // Load audit logs
  const loadAuditLogs = useCallback(async (requestedOffset = auditOffset) => {
    if (!session) return;
    setAuditLoading(true);
    setAuditError('');
    try {
      const params = new URLSearchParams({
        limit: String(auditLimit),
        offset: String(requestedOffset),
      });
      if (auditFilters.action) params.set('action', auditFilters.action);
      if (auditFilters.targetTable) params.set('targetTable', auditFilters.targetTable);
      if (auditFilters.targetId) params.set('targetId', auditFilters.targetId);
      if (auditFilters.adminId) params.set('adminId', auditFilters.adminId);
      if (auditFilters.since) params.set('since', auditFilters.since);

      const payload = await requestAdmin<AuditLogResponse>(`/api/admin/audit?${params.toString()}`);
      setAuditLogs(payload.logs);
      setAuditTotalCount(payload.totalCount);
    } catch (error) {
      setAuditError(messageFromError(error));
    } finally {
      setAuditLoading(false);
    }
  }, [session, requestAdmin, auditLimit, auditOffset, auditFilters]);

  // Load position history
  const loadPositionHistory = useCallback(async (requestedOffset = historyOffset) => {
    if (!session) return;
    setHistoryLoading(true);
    setHistoryError('');
    try {
      const params = new URLSearchParams({
        limit: String(historyLimit),
        offset: String(requestedOffset),
      });
      if (historyFilters.busId) params.set('busId', historyFilters.busId);
      if (historyFilters.sourceType) params.set('sourceType', historyFilters.sourceType);
      if (historyFilters.since) params.set('since', historyFilters.since);
      if (historyFilters.until) params.set('until', historyFilters.until);

      const payload = await requestAdmin<PositionHistoryResponse>(`/api/admin/history?${params.toString()}`);
      setPositionHistory(payload.history);
      setHistoryTotalCount(payload.totalCount);
    } catch (error) {
      setHistoryError(messageFromError(error));
    } finally {
      setHistoryLoading(false);
    }
  }, [session, requestAdmin, historyLimit, historyOffset, historyFilters]);

  // Load audit logs when tab is active
  useEffect(() => {
    if (activeTab === 'audit') {
      void loadAuditLogs();
    }
  }, [activeTab, loadAuditLogs]);

  // Load history when tab is active
  useEffect(() => {
    if (activeTab === 'history') {
      void loadPositionHistory();
    }
  }, [activeTab, loadPositionHistory]);

  const positionsByBus = useMemo(
    () => new Map((data?.positions ?? []).map((position) => [position.bus_id, position])),
    [data?.positions]
  );

  const selectTab = (tab: AdminTab) => {
    if (activeTab === tab) return;
    setActiveTab(tab);
    const url = new URL(window.location.href);
    url.searchParams.set('tab', tab);
    window.history.pushState(null, '', url);
  };

  const mutate = async (
    url: string,
    method: 'POST' | 'PATCH' | 'PUT' | 'DELETE',
    body: unknown,
    successMessage: string
  ): Promise<boolean> => {
    setSaving(true);
    setActionMessage(null);
    try {
      await requestAdmin(url, {
        method,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      setActionMessage({ kind: 'success', text: successMessage });
      await loadSummary();
      return true;
    } catch (error) {
      setActionMessage({ kind: 'error', text: messageFromError(error) });
      return false;
    } finally {
      setSaving(false);
    }
  };

  const signInWithPassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const supabase = getSupabaseClient();
    if (!supabase) {
      setAuthError('Supabase belum dikonfigurasi untuk login admin.');
      return;
    }
    setAuthLoading(true);
    setAuthError('');
    const { error } = await supabase.auth.signInWithPassword({
      email: loginEmail.trim(),
      password: loginPassword,
    });
    setAuthLoading(false);
    if (error) setAuthError(`Login gagal: ${error.message}`);
  };

  const signInWithGoogle = async () => {
    const supabase = getSupabaseClient();
    if (!supabase) {
      setAuthError('Supabase belum dikonfigurasi untuk login admin.');
      return;
    }
    setAuthLoading(true);
    setAuthError('');
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: new URL(window.location.pathname, window.location.origin).toString(),
        queryParams: { prompt: 'select_account' },
      },
    });
    if (error) {
      setAuthError(`Login Google gagal: ${error.message}`);
      setAuthLoading(false);
    }
  };

  const signOut = async () => {
    const supabase = getSupabaseClient();
    const { error } = (await supabase?.auth.signOut()) ?? { error: null };
    if (error) setAuthError(`Keluar gagal: ${error.message}`);
  };

  const openNewBusForm = () => {
    setEditingBusId(null);
    setBusForm(EMPTY_BUS_FORM);
    setBusEditorOpen(true);
  };

  const openBusForm = (bus: AdminBus) => {
    setEditingBusId(bus.id);
    setBusForm({
      id: bus.id,
      name: bus.name,
      plateNumber: bus.plate_number ?? '',
      capacity: String(bus.capacity),
      isActive: bus.is_active,
      driverId: bus.driver_id ?? '',
    });
    setBusEditorOpen(true);
  };

  const submitBus = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const saved = await mutate(
      '/api/admin/buses',
      editingBusId ? 'PATCH' : 'POST',
      {
        ...busForm,
        id: busForm.id.trim().toUpperCase(),
        capacity: Number(busForm.capacity),
        driverId: busForm.driverId || null,
      },
      editingBusId ? 'Data armada diperbarui.' : 'Armada ditambahkan.'
    );
    if (saved) {
      setBusEditorOpen(false);
      setBusForm(EMPTY_BUS_FORM);
    }
  };

  const submitNewDriver = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const saved = await mutate(
      '/api/admin/users',
      'POST',
      newDriver,
      'Akun driver dibuat. Tetapkan bus dari bagian Armada.'
    );
    if (saved) {
      setNewDriver({ email: '', fullName: '', password: '' });
      setDriverEditorOpen(false);
    }
  };

  const changeAccountType = async (
    user: AdminUser,
    accountType: 'user' | 'driver'
  ) => {
    const saved = await mutate(
      '/api/admin/users/role',
      'PATCH',
      {
        id: user.id,
        accountType,
      },
      accountType === 'driver'
        ? 'Akun dipindahkan ke daftar driver. Tetapkan armada dari bagian Armada.'
        : 'Akun dipindahkan ke daftar pengguna.'
    );
    if (saved) setEditingDriver(null);
  };

  const submitDriverEdit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editingDriver) return;
    const saved = await mutate(
      '/api/admin/users',
      'PATCH',
      {
        id: editingDriver.id,
        email: editingDriver.email,
        fullName: editingDriver.fullName,
        occupancy: editingDriver.occupancy,
        password: editingDriver.password || undefined,
        active: editingDriver.active,
      },
      'Akun driver diperbarui.'
    );
    if (saved) {
      setEditingDriver(null);
    }
  };

  const openDriverEditor = (user: AdminUser) => {
    setEditingDriver({
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      occupancy: user.occupancy,
      password: '',
      active: !user.bannedUntil || new Date(user.bannedUntil).getTime() <= now,
    });
    setEditingAccountType('driver');
  };

  const submitStop = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const saved = await mutate(
      '/api/admin/stops',
      editingStopId ? 'PATCH' : 'POST',
      {
        ...stopForm,
        id: stopForm.id.trim().toLowerCase(),
        lat: Number(stopForm.lat),
        lng: Number(stopForm.lng),
      },
      editingStopId ? 'Data halte diperbarui.' : 'Halte ditambahkan.'
    );
    if (saved) {
      setStopEditorOpen(false);
      setEditingStopId(null);
      setStopForm(EMPTY_STOP_FORM);
    }
  };

  const reorderStop = async (index: number, direction: -1 | 1) => {
    if (!data) return;
    const stops = [...data.stops];
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= stops.length) return;
    [stops[index], stops[targetIndex]] = [stops[targetIndex], stops[index]];
    await mutate(
      '/api/admin/stops/reorder',
      'POST',
      { ids: stops.map((stop) => stop.id) },
      'Urutan halte dan rute diperbarui.'
    );
  };

  const deleteStop = async (stop: AdminStop) => {
    const typedId = window.prompt(`Ketik ${stop.id} untuk menghapus halte ini.`);
    if (typedId !== stop.id) return;
    await mutate(
      `/api/admin/stops?id=${encodeURIComponent(stop.id)}`,
      'DELETE',
      undefined,
      'Halte dihapus.'
    );
  };

  const deleteBus = async (bus: AdminBus) => {
    const typedId = window.prompt(`Ketik ${bus.id} untuk menghapus armada beserta posisi GPS-nya.`);
    if (typedId !== bus.id) return;
    await mutate(
      `/api/admin/buses?id=${encodeURIComponent(bus.id)}`,
      'DELETE',
      undefined,
      'Armada dihapus. Posisi GPS terkait juga dihapus.'
    );
  };

  const deleteReport = async (report: AdminReport) => {
    const typedId = window.prompt(`Ketik ID laporan ${report.id} untuk menghapusnya.`);
    if (typedId !== report.id) return;
    await mutate(
      `/api/admin/reports?id=${encodeURIComponent(report.id)}`,
      'DELETE',
      undefined,
      'Laporan dihapus.'
    );
  };

  const submitSettings = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (serviceDays.length === 0) {
      setActionMessage({
        kind: 'error',
        text: 'Pilih setidaknya satu hari layanan.',
      });
      return;
    }
    await mutate(
      '/api/admin/settings',
      'PUT',
      {
        service: { serviceDays, openingTime, closingTime, timeZone: 'Asia/Jakarta' },
        eta: etaSettings,
        map: mapSettings,
        features: featureFlags,
        geofence: geofenceSettings,
      },
      'Pengaturan operasional disimpan.'
    );
  };

  const toggleDay = (day: number) => {
    setServiceDays((current) =>
      current.includes(day)
        ? current.filter((value) => value !== day)
        : [...current, day].sort((a, b) => a - b)
    );
  };

  const startEditingStop = (stop: AdminStop) => {
    setEditingStopId(stop.id);
    setStopForm({
      id: stop.id,
      name: stop.name,
      area: stop.area,
      lat: String(stop.lat),
      lng: String(stop.lng),
    });
    setStopEditorOpen(true);
  };

  const stopCreation = () => {
    setEditingStopId(null);
    setStopForm(EMPTY_STOP_FORM);
    setStopEditorOpen(true);
  };

  const renderBusForm = () => (
    <form className="admin-form" onSubmit={submitBus}>
      <div className="admin-form-heading">
        <h2>{editingBusId ? `Ubah ${editingBusId}` : 'Tambah armada'}</h2>
        <button
          type="button"
          className="admin-button admin-button--quiet"
          onClick={() => setBusEditorOpen(false)}
        >
          Tutup
        </button>
      </div>
      <div className="admin-fields admin-fields--three">
        <label className="admin-field">
          ID armada
          <input
            name="bus-id"
            autoComplete="off"
            value={busForm.id}
            disabled={Boolean(editingBusId)}
            placeholder="LINUS-04"
            onChange={(event) => setBusForm({ ...busForm, id: event.target.value })}
            required
          />
        </label>
        <label className="admin-field">
          Nama armada
          <input
            name="bus-name"
            autoComplete="organization"
            value={busForm.name}
            onChange={(event) => setBusForm({ ...busForm, name: event.target.value })}
            required
          />
        </label>
        <label className="admin-field">
          Nomor kendaraan
          <input
            name="plate-number"
            autoComplete="off"
            value={busForm.plateNumber}
            onChange={(event) =>
              setBusForm({ ...busForm, plateNumber: event.target.value })
            }
          />
        </label>
        <label className="admin-field">
          Kapasitas kursi
          <input
            name="capacity"
            type="number"
            min="1"
            max="100"
            value={busForm.capacity}
            onChange={(event) =>
              setBusForm({ ...busForm, capacity: event.target.value })
            }
            required
          />
        </label>
        <label className="admin-field">
          Driver yang ditugaskan
          <select
            name="driver"
            value={busForm.driverId}
            onChange={(event) => setBusForm({ ...busForm, driverId: event.target.value })}
          >
            <option value="">Belum ditugaskan</option>
            {(data?.drivers ?? [])
              .map((user) => (
                <option key={user.id} value={user.id}>
                  {user.fullName || user.email}
                </option>
              ))}
          </select>
        </label>
        <label className="admin-check">
          <input
            type="checkbox"
            checked={busForm.isActive}
            onChange={(event) =>
              setBusForm({ ...busForm, isActive: event.target.checked })
            }
          />
          Armada aktif
        </label>
      </div>
      <button className="admin-button admin-button--primary" type="submit" disabled={saving}>
        {saving ? 'Menyimpan…' : editingBusId ? 'Simpan perubahan' : 'Tambah armada'}
      </button>
    </form>
  );

  const renderDriverForm = () => (
    <form className="admin-form" onSubmit={submitNewDriver}>
      <div className="admin-form-heading">
        <h2>Buat akun driver</h2>
        <button
          type="button"
          className="admin-button admin-button--quiet"
          onClick={() => setDriverEditorOpen(false)}
        >
          Tutup
        </button>
      </div>
      <div className="admin-fields admin-fields--three">
        <label className="admin-field">
          Nama lengkap
          <input
            name="full-name"
            autoComplete="name"
            value={newDriver.fullName}
            onChange={(event) =>
              setNewDriver({ ...newDriver, fullName: event.target.value })
            }
            required
          />
        </label>
        <label className="admin-field">
          Email driver
          <input
            name="driver-email"
            type="email"
            autoComplete="email"
            value={newDriver.email}
            onChange={(event) =>
              setNewDriver({ ...newDriver, email: event.target.value })
            }
            required
          />
        </label>
        <label className="admin-field">
          Password awal
          <input
            name="driver-password"
            type="password"
            autoComplete="new-password"
            minLength={8}
            value={newDriver.password}
            onChange={(event) =>
              setNewDriver({ ...newDriver, password: event.target.value })
            }
            required
          />
        </label>
      </div>
      <p className="admin-help">
        Password hanya disimpan oleh Supabase Auth dan tidak dapat dibaca kembali dari panel.
      </p>
      <button className="admin-button admin-button--primary" type="submit" disabled={saving}>
        {saving ? 'Membuat akun…' : 'Buat akun driver'}
      </button>
    </form>
  );

  const renderDriverEditForm = () =>
    editingDriver && (
      <form className="admin-form" onSubmit={submitDriverEdit}>
        <div className="admin-form-heading">
          <h2>Ubah akun driver</h2>
          <button
            type="button"
            className="admin-button admin-button--quiet"
            onClick={() => setEditingDriver(null)}
          >
            Tutup
          </button>
        </div>
        <div className="admin-fields admin-fields--three">
          <label className="admin-field">
            Nama lengkap
            <input
              name="edit-full-name"
              autoComplete="name"
              value={editingDriver.fullName}
              onChange={(event) =>
                setEditingDriver({ ...editingDriver, fullName: event.target.value })
              }
              required
            />
          </label>
          <label className="admin-field">
            Email
            <input
              name="edit-email"
              type="email"
              autoComplete="email"
              value={editingDriver.email}
              onChange={(event) =>
                setEditingDriver({ ...editingDriver, email: event.target.value })
              }
              required
            />
          </label>
          {editingAccountType === 'driver' && (
            <label className="admin-field">
              Status kepadatan driver
              <select
                value={editingDriver.occupancy}
                onChange={(event) => {
                  const value = event.target.value;
                  if (value === 'low' || value === 'medium' || value === 'full') {
                    setEditingDriver({ ...editingDriver, occupancy: value });
                  }
                }}
              >
                <option value="low">Lega</option>
                <option value="medium">Sedang</option>
                <option value="full">Penuh</option>
              </select>
            </label>
          )}
          <label className="admin-field">
            Password baru
            <input
              name="edit-password"
              type="password"
              autoComplete="new-password"
              minLength={8}
              value={editingDriver.password}
              onChange={(event) =>
                setEditingDriver({ ...editingDriver, password: event.target.value })
              }
            />
            <small className="admin-field-help">Kosongkan bila password tidak diganti.</small>
          </label>
        </div>
        <label className="admin-check">
          <input
            type="checkbox"
            checked={editingDriver.active}
            onChange={(event) =>
              setEditingDriver({ ...editingDriver, active: event.target.checked })
            }
          />
          Akun dapat masuk
        </label>
        <button className="admin-button admin-button--primary" type="submit" disabled={saving}>
          {saving ? 'Menyimpan…' : 'Simpan akun'}
        </button>
      </form>
    );

  const renderStopForm = () => (
    <form className="admin-form" onSubmit={submitStop}>
      <div className="admin-form-heading">
        <h2>{editingStopId ? `Ubah halte ${editingStopId}` : 'Tambah halte'}</h2>
        <button
          type="button"
          className="admin-button admin-button--quiet"
          onClick={() => setStopEditorOpen(false)}
        >
          Tutup
        </button>
      </div>
      <div className="admin-fields admin-fields--three">
        <label className="admin-field">
          ID halte
          <input
            name="stop-id"
            autoComplete="off"
            value={stopForm.id}
            disabled={Boolean(editingStopId)}
            placeholder="halte-nama"
            onChange={(event) => setStopForm({ ...stopForm, id: event.target.value })}
            required
          />
        </label>
        <label className="admin-field">
          Nama halte
          <input
            name="stop-name"
            value={stopForm.name}
            onChange={(event) => setStopForm({ ...stopForm, name: event.target.value })}
            required
          />
        </label>
        <label className="admin-field">
          Area atau jalan
          <input
            name="stop-area"
            value={stopForm.area}
            onChange={(event) => setStopForm({ ...stopForm, area: event.target.value })}
            required
          />
        </label>
        <label className="admin-field">
          Latitude
          <input
            name="stop-lat"
            type="number"
            step="any"
            inputMode="decimal"
            value={stopForm.lat}
            onChange={(event) => setStopForm({ ...stopForm, lat: event.target.value })}
            required
          />
        </label>
        <label className="admin-field">
          Longitude
          <input
            name="stop-lng"
            type="number"
            step="any"
            inputMode="decimal"
            value={stopForm.lng}
            onChange={(event) => setStopForm({ ...stopForm, lng: event.target.value })}
            required
          />
        </label>
      </div>
      <p className="admin-help">
        Koordinat harus berada di area Kampus USU. Urutan halte membentuk rute putar.
      </p>
      <button className="admin-button admin-button--primary" type="submit" disabled={saving}>
        {saving ? 'Menyimpan…' : editingStopId ? 'Simpan perubahan' : 'Tambah halte'}
      </button>
    </form>
  );

  if (authLoading) {
    return (
      <main className="admin-login-shell">
        <section className="admin-login" aria-busy="true">
          <p>Memeriksa sesi LINUSKU…</p>
        </section>
      </main>
    );
  }

  if (session && !data && dataLoading) {
    return (
      <main className="admin-shell">
        <div className="admin-main">
          <div className="admin-page-heading">
            <div>
              <h1>Panel operasional</h1>
              <p>Memuat data armada dan layanan LINUSKU…</p>
            </div>
          </div>
          <section className="admin-workspace" aria-busy="true">
            <div className="admin-section-heading">
              <div>
                <h2>Memuat status armada</h2>
                <p>Data akan muncul setelah layanan admin terverifikasi.</p>
              </div>
            </div>
            <div className="admin-skeleton-table" aria-hidden="true">
              {Array.from({ length: 5 }, (_, index) => (
                <div className="admin-skeleton-row" key={index}>
                  <span />
                  <span />
                  <span />
                  <span />
                </div>
              ))}
            </div>
          </section>
        </div>
      </main>
    );
  }

  if (!session || !data) {
    const isAuthenticated = Boolean(session);
    return (
      <main className="admin-login-shell">
        <section className="admin-login">
          <a className="admin-brand" href="/">
            <span>LINUSKU <small>Pengelolaan operasional</small></span>
          </a>
          <h1>
            {isAuthenticated
              ? dataLoading
                ? 'Memuat panel admin…'
                : dataError.includes('tidak memiliki akses admin')
                  ? 'Akun ini bukan admin'
                  : 'Panel admin belum tersedia'
              : 'Masuk ke panel admin'}
          </h1>
          <p
            className="admin-login-copy"
            role={isAuthenticated && dataError ? 'alert' : undefined}
          >
            {isAuthenticated
              ? (
                <>
                  {dataError || 'Akun ini belum memperoleh akses admin atau layanan admin belum siap.'}
                  {session?.user.email && (
                    <>
                      <br />
                      Akun yang aktif: <strong>{session.user.email}</strong>. Pilih akun admin yang benar.
                    </>
                  )}
                </>
              )
              : 'Gunakan akun pengelola yang sudah diizinkan. Secret key tidak pernah dikirim ke browser.'}
          </p>
          {!isAuthenticated && (
            <>
              <button
                type="button"
                className="admin-button admin-button--primary admin-login-google"
                onClick={signInWithGoogle}
                disabled={!isSupabaseConfigured || authLoading}
                aria-busy={authLoading}
              >
                <ShieldCheck size={17} aria-hidden="true" />
                {authLoading ? 'Membuka Google…' : 'Masuk dengan Google'}
              </button>
              <div className="admin-divider"><span>atau email</span></div>
              <form className="admin-login-form" onSubmit={signInWithPassword}>
                <label className="admin-field">
                  Email admin
                  <input
                    name="admin-email"
                    type="email"
                    autoComplete="email"
                    value={loginEmail}
                    onChange={(event) => setLoginEmail(event.target.value)}
                    required
                  />
                </label>
                <label className="admin-field">
                  Password
                  <input
                    name="admin-password"
                    type="password"
                    autoComplete="current-password"
                    value={loginPassword}
                    onChange={(event) => setLoginPassword(event.target.value)}
                    required
                  />
                </label>
                <button
                  type="submit"
                  className="admin-button admin-button--quiet"
                  disabled={!isSupabaseConfigured || authLoading}
                  aria-busy={authLoading}
                >
                  Masuk dengan email
                </button>
              </form>
            </>
          )}
          {authError && <p className="admin-message admin-message--error" role="alert">{authError}</p>}
          {isAuthenticated && (
            <div className="admin-login-actions">
              <button
                type="button"
                className="admin-button admin-button--primary"
                onClick={signInWithGoogle}
                disabled={!isSupabaseConfigured || authLoading}
                aria-busy={authLoading}
              >
                <ShieldCheck size={16} aria-hidden="true" />
                {authLoading ? 'Membuka Google…' : 'Pilih akun Google lain'}
              </button>
              <button
                type="button"
                className="admin-button admin-button--quiet"
                onClick={() => void loadSummary()}
                disabled={dataLoading}
              >
                {dataLoading ? 'Memuat…' : 'Coba lagi'}
              </button>
              <button type="button" className="admin-button admin-button--quiet" onClick={signOut}>
                <LogOut size={16} aria-hidden="true" />
                Keluar
              </button>
            </div>
          )}
        </section>
      </main>
    );
  }

  const activeBusIds = new Set(
    data.buses.filter((bus) => bus.is_active).map((bus) => bus.id)
  );
  const freshPositions = data.positions.filter(
    (position) =>
      activeBusIds.has(position.bus_id) &&
      now - new Date(position.updated_at).getTime() <= 45000
  );

  return (
    <main className="admin-shell">
      <header className="admin-topbar">
        <div className="admin-topbar-inner">
          <a className="admin-brand" href="/">
            <span>LINUSKU <small>Panel operasional</small></span>
          </a>
          <div className="admin-account">
            <span>{session.user.email}</span>
            <button
              type="button"
              className="admin-icon-button"
              onClick={signOut}
              aria-label="Keluar dari panel admin"
              title="Keluar"
            >
              <LogOut size={18} aria-hidden="true" />
            </button>
          </div>
        </div>
        <nav className="admin-tabs" aria-label="Bagian panel admin">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              aria-current={activeTab === id ? 'page' : undefined}
              className={activeTab === id ? 'is-selected' : ''}
              onClick={() => selectTab(id)}
            >
              <Icon size={16} aria-hidden="true" />
              {label}
            </button>
          ))}
        </nav>
      </header>

      <div className="admin-main">
        <div className="admin-page-heading">
          <div>
            <h1>
              {activeTab === 'overview'
                ? 'Operasi Linus'
                : TABS.find((tab) => tab.id === activeTab)?.label}
            </h1>
            <p>
              {activeTab === 'overview'
                ? 'Pantau keadaan armada, GPS, dan laporan Kampus USU.'
                : 'Kelola data LINUSKU yang tersimpan di Supabase.'}
            </p>
          </div>
          <button
            type="button"
            className="admin-button admin-button--quiet"
            onClick={() => void loadSummary()}
            disabled={dataLoading}
            aria-busy={dataLoading}
          >
            <RefreshCw size={16} aria-hidden="true" />
            {dataLoading ? 'Memuat…' : 'Segarkan data'}
          </button>
        </div>

        {(dataError || positionError || actionMessage) && (
          <div
            className={`admin-message ${dataError || positionError || actionMessage?.kind === 'error' ? 'admin-message--error' : ''}`}
            role={dataError || positionError || actionMessage?.kind === 'error' ? 'alert' : 'status'}
          >
            {dataError || positionError || actionMessage?.text}
          </div>
        )}

        {activeTab === 'overview' && (
          <section className="admin-workspace" aria-labelledby="fleet-status-title">
            <div className="admin-section-heading">
              <div>
                <h2 id="fleet-status-title">Status armada</h2>
                <p>
                  Pembaruan posisi otomatis setiap 10 detik. Terakhir diperiksa{' '}
                  {formatTime(lastPositionCheck)} WIB.
                </p>
              </div>
              <span className="admin-live-label">
                {freshPositions.length > 0 ? 'GPS terpantau' : 'Belum ada GPS aktif'}
              </span>
            </div>
            <dl className="admin-facts">
              <div><dt>Armada aktif</dt><dd>{data.buses.filter((bus) => bus.is_active).length}</dd></div>
              <div><dt>Posisi baru</dt><dd>{freshPositions.length}</dd></div>
              <div><dt>Pengguna</dt><dd>{data.users.length}</dd></div>
              <div><dt>Laporan 24 jam</dt><dd>{data.reportCount24h}</dd></div>
            </dl>
            <FleetTable
              buses={data.buses}
              users={data.drivers}
              positionsByBus={positionsByBus}
              now={now}
              saving={saving}
              compact
              onEdit={openBusForm}
              onDelete={deleteBus}
            />
            {busEditorOpen && renderBusForm()}
          </section>
        )}

        {activeTab === 'fleet' && (
          <section className="admin-workspace" aria-labelledby="fleet-title">
            <div className="admin-section-heading">
              <div>
                <h2 id="fleet-title">Daftar armada</h2>
                <p>Ubah identitas, kapasitas, status layanan, dan penugasan driver.</p>
              </div>
              <button
                type="button"
                className="admin-button admin-button--primary"
                onClick={openNewBusForm}
              >
                Tambah armada
              </button>
            </div>
            {busEditorOpen && renderBusForm()}
            {data.buses.length ? (
              <FleetTable
                buses={data.buses}
                users={data.drivers}
                positionsByBus={positionsByBus}
                now={now}
                saving={saving}
                onEdit={openBusForm}
                onDelete={deleteBus}
              />
            ) : (
              <EmptyState
                title="Belum ada armada"
                detail="Tambahkan armada agar dapat ditugaskan kepada driver."
                action="Tambah armada"
                onAction={openNewBusForm}
              />
            )}
          </section>
        )}

        {activeTab === 'drivers' && (
          <section className="admin-workspace" aria-labelledby="drivers-title">
            <div className="admin-section-heading">
              <div>
                <h2 id="drivers-title">
                  {accountList === 'users' ? 'Pengguna' : 'Driver'}
                </h2>
                <p>
                  {accountList === 'users'
                    ? 'Akun pengguna terpisah dari akun driver. Hanya admin yang dapat mengubah jenis akun.'
                    : 'Kelola profil driver dan penugasannya. Tetapkan armada dari bagian Armada.'}
                </p>
              </div>
              {accountList === 'drivers' && (
                <button
                  type="button"
                  className="admin-button admin-button--primary"
                  onClick={() => setDriverEditorOpen(true)}
                >
                  Tambah driver
                </button>
              )}
            </div>
            <div className="admin-account-switch" role="tablist" aria-label="Jenis akun">
              <button
                type="button"
                role="tab"
                aria-selected={accountList === 'users'}
                className={accountList === 'users' ? 'is-selected' : ''}
                onClick={() => {
                  setAccountList('users');
                  setDriverEditorOpen(false);
                  setEditingDriver(null);
                }}
              >
                Pengguna
                <span>{data.users.length}</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={accountList === 'drivers'}
                className={accountList === 'drivers' ? 'is-selected' : ''}
                onClick={() => {
                  setAccountList('drivers');
                  setEditingDriver(null);
                }}
              >
                Driver
                <span>{data.drivers.length}</span>
              </button>
            </div>
            {accountList === 'drivers' && driverEditorOpen && renderDriverForm()}
            {accountList === 'drivers' && renderDriverEditForm()}
            {(accountList === 'users' ? data.users : data.drivers).length ? (
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th scope="col">{accountList === 'users' ? 'Pengguna' : 'Driver'}</th>
                      <th scope="col">Masuk dengan</th>
                      {accountList === 'drivers' && (
                        <>
                          <th scope="col">Penugasan</th>
                          <th scope="col">Status penumpang</th>
                        </>
                      )}
                      <th scope="col">Terakhir masuk</th>
                      <th scope="col">Status</th>
                      <th scope="col"><span className="admin-visually-hidden">Tindakan</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {(accountList === 'users' ? data.users : data.drivers).map((user) => (
                      <tr key={user.id}>
                        <td data-label="Pengguna">
                          <strong>{user.fullName || user.email}</strong>
                          {user.fullName && <small>{user.email}</small>}
                        </td>
                        <td data-label="Masuk dengan">
                          {user.provider === 'google' ? 'Google' : 'Email'}
                        </td>
                        {accountList === 'drivers' && (
                          <>
                            <td data-label="Penugasan">{user.assignedBusId ?? 'Belum ditugaskan'}</td>
                            <td data-label="Status penumpang">{formatOccupancy(user.occupancy)}</td>
                          </>
                        )}
                        <td data-label="Terakhir masuk">{formatDate(user.lastSignInAt)}</td>
                        <td data-label="Status">
                          {!user.bannedUntil || new Date(user.bannedUntil).getTime() <= now
                            ? 'Aktif'
                            : 'Dinonaktifkan'}
                        </td>
                        <td data-label="Tindakan" className="admin-actions-cell">
                          {accountList === 'drivers' ? (
                            <>
                              <button
                                type="button"
                                className="admin-button admin-button--quiet"
                                onClick={() => openDriverEditor(user)}
                              >
                                Ubah profil
                              </button>
                              <button
                                type="button"
                                className="admin-button admin-button--quiet"
                                disabled={Boolean(user.assignedBusId) || saving}
                                title={user.assignedBusId ? 'Lepas penugasan armada terlebih dahulu.' : undefined}
                                onClick={() => void changeAccountType(user, 'user')}
                              >
                                Jadikan pengguna
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                type="button"
                                className="admin-button admin-button--quiet"
                                onClick={() => openDriverEditor(user)}
                              >
                                Ubah profil
                              </button>
                              <button
                                type="button"
                                className="admin-button admin-button--primary"
                                disabled={saving}
                                onClick={() => void changeAccountType(user, 'driver')}
                              >
                                Jadikan driver
                              </button>
                            </>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState
                title={accountList === 'users' ? 'Belum ada pengguna' : 'Belum ada driver'}
                detail={
                  accountList === 'users'
                    ? 'Akun pengguna terdaftar akan muncul di daftar ini.'
                    : 'Buat akun driver atau ubah akun pengguna menjadi driver.'
                }
                action={accountList === 'drivers' ? 'Buat akun driver' : undefined}
                onAction={accountList === 'drivers' ? () => setDriverEditorOpen(true) : undefined}
              />
            )}
          </section>
        )}

        {activeTab === 'stops' && (
          <section className="admin-workspace" aria-labelledby="stops-title">
            <div className="admin-section-heading">
              <div>
                <h2 id="stops-title">Halte dan urutan rute</h2>
                <p>Rute jalan akan dihitung ulang mengikuti koordinat dan urutan halte.</p>
              </div>
              <button
                type="button"
                className="admin-button admin-button--primary"
                onClick={stopCreation}
              >
                Tambah halte
              </button>
            </div>
            {stopEditorOpen && renderStopForm()}
            {data.stops.length ? (
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th scope="col">Urutan</th>
                      <th scope="col">Halte</th>
                      <th scope="col">Koordinat</th>
                      <th scope="col"><span className="admin-visually-hidden">Tindakan</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.stops.map((stop, index) => (
                      <tr key={stop.id}>
                        <td data-label="Urutan" className="admin-number">{stop.sequence_order}</td>
                        <td data-label="Halte">
                          <strong>{stop.name}</strong>
                          <small>{stop.area}</small>
                          <small>ID halte: {stop.id}</small>
                        </td>
                        <td data-label="Koordinat" className="admin-number">
                          {stop.lat.toFixed(5)}, {stop.lng.toFixed(5)}
                        </td>
                        <td data-label="Tindakan" className="admin-actions-cell">
                          <button
                            type="button"
                            className="admin-icon-button"
                            onClick={() => void reorderStop(index, -1)}
                            disabled={saving || index === 0}
                            aria-label={`Pindahkan ${stop.name} ke atas`}
                          >
                            <ArrowUp size={17} aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            className="admin-icon-button"
                            onClick={() => void reorderStop(index, 1)}
                            disabled={saving || index === data.stops.length - 1}
                            aria-label={`Pindahkan ${stop.name} ke bawah`}
                          >
                            <ArrowDown size={17} aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            className="admin-button admin-button--quiet"
                            onClick={() => startEditingStop(stop)}
                          >
                            Ubah
                          </button>
                          <button
                            type="button"
                            className="admin-button admin-button--danger"
                            onClick={() => void deleteStop(stop)}
                            disabled={saving}
                          >
                            Hapus
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState
                title="Belum ada halte"
                detail="Tambahkan sedikitnya dua halte agar rute dapat dihitung."
                action="Tambah halte"
                onAction={stopCreation}
              />
            )}
          </section>
        )}

        {activeTab === 'audit' && (
          <section className="admin-workspace" aria-labelledby="audit-title">
            <div className="admin-section-heading">
              <div>
                <h2 id="audit-title">Log Audit Admin</h2>
                <p>Riwayat perubahan yang dilakukan oleh admin.</p>
              </div>
              <button
                type="button"
                className="admin-button admin-button--quiet"
                onClick={() => void loadAuditLogs()}
                disabled={auditLoading}
              >
                <RefreshCw size={16} aria-hidden="true" />
                Segarkan
              </button>
            </div>
            {auditError && (
              <div className="admin-message admin-message--error" role="alert">{auditError}</div>
            )}
            <div className="admin-form admin-filter-form">
              <div className="admin-fields admin-fields--three">
                <label className="admin-field">
                  Aksi
                  <input
                    name="audit-action"
                    type="text"
                    value={auditFilters.action}
                    onChange={(e) => setAuditFilters({ ...auditFilters, action: e.target.value })}
                    placeholder="create_bus, update_stop, etc"
                  />
                </label>
                <label className="admin-field">
                  Tabel Target
                  <input
                    name="audit-table"
                    type="text"
                    value={auditFilters.targetTable}
                    onChange={(e) => setAuditFilters({ ...auditFilters, targetTable: e.target.value })}
                    placeholder="buses, stops, etc"
                  />
                </label>
                <label className="admin-field">
                  Target ID
                  <input
                    name="audit-target-id"
                    type="text"
                    value={auditFilters.targetId}
                    onChange={(e) => setAuditFilters({ ...auditFilters, targetId: e.target.value })}
                    placeholder="LINUS-01, halte-pintu-1"
                  />
                </label>
                <label className="admin-field">
                  Admin ID
                  <input
                    name="audit-admin-id"
                    type="text"
                    value={auditFilters.adminId}
                    onChange={(e) => setAuditFilters({ ...auditFilters, adminId: e.target.value })}
                    placeholder="UUID admin"
                  />
                </label>
                <label className="admin-field">
                  Dari Tanggal
                  <input
                    name="audit-since"
                    type="date"
                    value={auditFilters.since}
                    onChange={(e) => setAuditFilters({ ...auditFilters, since: e.target.value })}
                  />
                </label>
                <label className="admin-field">
                  <button
                    type="button"
                    className="admin-button admin-button--primary"
                    onClick={() => { setAuditOffset(0); void loadAuditLogs(0); }}
                    disabled={auditLoading}
                  >
                    Filter
                  </button>
                </label>
              </div>
            </div>
            {auditLoading ? (
              <div className="admin-skeleton-table" aria-busy="true">
                {Array.from({ length: 5 }, (_, index) => (
                  <div className="admin-skeleton-row" key={index}>
                    <span /><span /><span /><span /><span />
                  </div>
                ))}
              </div>
            ) : auditLogs.length ? (
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th scope="col">Waktu</th>
                      <th scope="col">Admin</th>
                      <th scope="col">Aksi</th>
                      <th scope="col">Tabel</th>
                      <th scope="col">Target ID</th>
                      <th scope="col">IP</th>
                    </tr>
                  </thead>
                  <tbody>
                    {auditLogs.map((log) => (
                      <tr key={log.id}>
                        <td data-label="Waktu">{formatDate(log.created_at)}</td>
                        <td data-label="Admin">{log.admin_id.slice(0, 8)}…</td>
                        <td data-label="Aksi"><code>{log.action}</code></td>
                        <td data-label="Tabel">{log.target_table}</td>
                        <td data-label="Target ID">{log.target_id ?? '-'}</td>
                        <td data-label="IP">{log.ip_address ?? '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState title="Belum ada log audit" detail="Log akan muncul setelah admin melakukan perubahan." />
            )}
            {auditTotalCount > auditLimit && (
              <div className="admin-pagination">
                <button
                  type="button"
                  className="admin-button admin-button--quiet"
                  onClick={() => {
                    const nextOffset = Math.max(0, auditOffset - auditLimit);
                    setAuditOffset(nextOffset);
                    void loadAuditLogs(nextOffset);
                  }}
                  disabled={auditOffset === 0 || auditLoading}
                >
                  Sebelumnya
                </button>
                <span>Halaman {Math.floor(auditOffset / auditLimit) + 1} dari {Math.ceil(auditTotalCount / auditLimit)}</span>
                <button
                  type="button"
                  className="admin-button admin-button--quiet"
                  onClick={() => {
                    const nextOffset = auditOffset + auditLimit;
                    setAuditOffset(nextOffset);
                    void loadAuditLogs(nextOffset);
                  }}
                  disabled={auditOffset + auditLimit >= auditTotalCount || auditLoading}
                >
                  Selanjutnya
                </button>
              </div>
            )}
          </section>
        )}

        {activeTab === 'history' && (
          <section className="admin-workspace" aria-labelledby="history-title">
            <div className="admin-section-heading">
              <div>
                <h2 id="history-title">Riwayat Posisi GPS</h2>
                <p>Data historis posisi armada (diambil dari trigger database).</p>
              </div>
              <button
                type="button"
                className="admin-button admin-button--quiet"
                onClick={() => void loadPositionHistory()}
                disabled={historyLoading}
              >
                <RefreshCw size={16} aria-hidden="true" />
                Segarkan
              </button>
            </div>
            {historyError && (
              <div className="admin-message admin-message--error" role="alert">{historyError}</div>
            )}
            <div className="admin-form admin-filter-form">
              <div className="admin-fields admin-fields--three">
                <label className="admin-field">
                  Armada
                  <select
                    name="history-bus"
                    value={historyFilters.busId}
                    onChange={(e) => setHistoryFilters({ ...historyFilters, busId: e.target.value })}
                  >
                    <option value="">Semua armada</option>
                    {data.buses.map((bus) => (
                      <option key={bus.id} value={bus.id}>{bus.id} — {bus.name}</option>
                    ))}
                  </select>
                </label>
                <label className="admin-field">
                  Sumber
                  <select
                    name="history-source"
                    value={historyFilters.sourceType}
                    onChange={(e) => setHistoryFilters({ ...historyFilters, sourceType: e.target.value })}
                  >
                    <option value="">Semua sumber</option>
                    <option value="driver">Driver</option>
                    <option value="device">Device</option>
                    <option value="simulator">Simulator</option>
                    <option value="crowd">Crowd</option>
                  </select>
                </label>
                <label className="admin-field">
                  Dari
                  <input
                    name="history-since"
                    type="datetime-local"
                    value={historyFilters.since}
                    onChange={(e) => setHistoryFilters({ ...historyFilters, since: e.target.value })}
                  />
                </label>
                <label className="admin-field">
                  Sampai
                  <input
                    name="history-until"
                    type="datetime-local"
                    value={historyFilters.until}
                    onChange={(e) => setHistoryFilters({ ...historyFilters, until: e.target.value })}
                  />
                </label>
                <label className="admin-field">
                  <button
                    type="button"
                    className="admin-button admin-button--primary"
                    onClick={() => { setHistoryOffset(0); void loadPositionHistory(0); }}
                    disabled={historyLoading}
                  >
                    Filter
                  </button>
                </label>
              </div>
            </div>
            {historyLoading ? (
              <div className="admin-skeleton-table" aria-busy="true">
                {Array.from({ length: 5 }, (_, index) => (
                  <div className="admin-skeleton-row" key={index}>
                    <span /><span /><span /><span /><span />
                  </div>
                ))}
              </div>
            ) : positionHistory.length ? (
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th scope="col">Waktu</th>
                      <th scope="col">Armada</th>
                      <th scope="col">Koordinat</th>
                      <th scope="col">Kecepatan</th>
                      <th scope="col">Kepadatan</th>
                      <th scope="col">Sumber</th>
                    </tr>
                  </thead>
                  <tbody>
                    {positionHistory.map((item) => (
                      <tr key={item.id}>
                        <td data-label="Waktu">{formatDate(item.recorded_at)}</td>
                        <td data-label="Armada">{item.bus_id}</td>
                        <td data-label="Koordinat" className="admin-number">
                          {item.lat.toFixed(5)}, {item.lng.toFixed(5)}
                        </td>
                        <td data-label="Kecepatan">{Math.round(item.speed_kmh)} km/j</td>
                        <td data-label="Kepadatan">{formatOccupancy(item.occupancy)}</td>
                        <td data-label="Sumber">{item.source_type}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState title="Belum ada riwayat posisi" detail="Data historis akan terisi saat armada mengirim GPS." />
            )}
            {historyTotalCount > historyLimit && (
              <div className="admin-pagination">
                <button
                  type="button"
                  className="admin-button admin-button--quiet"
                  onClick={() => {
                    const nextOffset = Math.max(0, historyOffset - historyLimit);
                    setHistoryOffset(nextOffset);
                    void loadPositionHistory(nextOffset);
                  }}
                  disabled={historyOffset === 0 || historyLoading}
                >
                  Sebelumnya
                </button>
                <span>Halaman {Math.floor(historyOffset / historyLimit) + 1} dari {Math.ceil(historyTotalCount / historyLimit)}</span>
                <button
                  type="button"
                  className="admin-button admin-button--quiet"
                  onClick={() => {
                    const nextOffset = historyOffset + historyLimit;
                    setHistoryOffset(nextOffset);
                    void loadPositionHistory(nextOffset);
                  }}
                  disabled={historyOffset + historyLimit >= historyTotalCount || historyLoading}
                >
                  Selanjutnya
                </button>
              </div>
            )}
          </section>
        )}

        {activeTab === 'reports' && (
          <section className="admin-workspace" aria-labelledby="reports-title">
            <div className="admin-section-heading">
              <div>
                <h2 id="reports-title">Laporan mahasiswa</h2>
                <p>Daftar laporan 24 jam terakhir. Hapus laporan yang tidak sesuai.</p>
              </div>
              <span className="admin-live-label">
                {data.reports.length} ditampilkan dari {data.reportCount24h}
              </span>
            </div>
            {data.reports.length ? (
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th scope="col">Waktu</th>
                      <th scope="col">Armada</th>
                      <th scope="col">Kepadatan</th>
                      <th scope="col">Lokasi</th>
                      <th scope="col"><span className="admin-visually-hidden">Tindakan</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.reports.map((report) => (
                      <tr key={report.id}>
                        <td data-label="Waktu">{formatDate(report.created_at)}</td>
                        <td data-label="Armada">
                          {report.bus_id ?? 'Tidak diketahui'}
                          {report.stop_id && <small>{report.stop_id}</small>}
                        </td>
                        <td data-label="Kepadatan">{formatOccupancy(report.occupancy)}</td>
                        <td data-label="Lokasi" className="admin-number">
                          {report.lat.toFixed(5)}, {report.lng.toFixed(5)}
                        </td>
                        <td data-label="Tindakan" className="admin-actions-cell">
                          <button
                            type="button"
                            className="admin-button admin-button--danger"
                            onClick={() => void deleteReport(report)}
                            disabled={saving}
                          >
                            Hapus laporan
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState
                title="Belum ada laporan baru"
                detail="Laporan kepadatan yang masuk dalam 24 jam akan muncul di sini."
              />
            )}
          </section>
        )}

        {activeTab === 'operations' && (
          <section className="admin-workspace" aria-labelledby="operations-title">
            <div className="admin-section-heading">
              <div>
                <h2 id="operations-title">Jam layanan dan rute</h2>
                <p>Jam menggunakan WIB. Rute mengikuti urutan halte pada bagian Halte.</p>
              </div>
              <Settings2 size={20} aria-hidden="true" />
            </div>
            <form className="admin-form admin-settings-form" onSubmit={submitSettings}>
              <fieldset className="admin-day-fieldset">
                <legend>Hari beroperasi</legend>
                <div className="admin-day-list">
                  {DAYS.map((day) => (
                    <label className="admin-day" key={day.id}>
                      <input
                        type="checkbox"
                        checked={serviceDays.includes(day.id)}
                        onChange={() => toggleDay(day.id)}
                      />
                      {day.label}
                    </label>
                  ))}
                </div>
              </fieldset>
              <div className="admin-fields admin-fields--two">
                <label className="admin-field">
                  Mulai layanan
                  <input
                    name="opening-time"
                    type="time"
                    value={openingTime}
                    onChange={(event) => setOpeningTime(event.target.value)}
                    required
                  />
                </label>
                <label className="admin-field">
                  Akhir layanan
                  <input
                    name="closing-time"
                    type="time"
                    value={closingTime}
                    onChange={(event) => setClosingTime(event.target.value)}
                    required
                  />
                </label>
              </div>
              <fieldset className="admin-settings-group">
                <legend>Estimasi dan posisi</legend>
                <div className="admin-fields admin-fields--three">
                  <label className="admin-field">
                    Kecepatan minimum (km/jam)
                    <input
                      name="min-speed"
                      type="number"
                      min="1"
                      max="120"
                      value={etaSettings.minSpeedKmh}
                      onChange={(event) =>
                        setEtaSettings((current) => ({
                          ...current,
                          minSpeedKmh: Number(event.target.value),
                        }))
                      }
                      required
                    />
                  </label>
                  <label className="admin-field">
                    Kecepatan maksimum (km/jam)
                    <input
                      name="max-speed"
                      type="number"
                      min="1"
                      max="120"
                      value={etaSettings.maxSpeedKmh}
                      onChange={(event) =>
                        setEtaSettings((current) => ({
                          ...current,
                          maxSpeedKmh: Number(event.target.value),
                        }))
                      }
                      required
                    />
                  </label>
                  <label className="admin-field">
                    Posisi dianggap kedaluwarsa (detik)
                    <input
                      name="stale-threshold"
                      type="number"
                      min="1"
                      max="3600"
                      value={etaSettings.staleThresholdSeconds}
                      onChange={(event) =>
                        setEtaSettings((current) => ({
                          ...current,
                          staleThresholdSeconds: Number(event.target.value),
                        }))
                      }
                      required
                    />
                  </label>
                </div>
              </fieldset>
              <fieldset className="admin-settings-group">
                <legend>Peta dan fitur</legend>
                <div className="admin-fields admin-fields--two">
                  <label className="admin-field">
                    Penyedia peta
                    <select
                      name="tile-provider"
                      value={mapSettings.tileProvider}
                      onChange={(event) => {
                        const tileProvider = event.currentTarget.value;
                        if (
                          tileProvider === 'carto_voyager' ||
                          tileProvider === 'osm' ||
                          tileProvider === 'pmtiles_r2'
                        ) {
                          setMapSettings((current) => ({
                            ...current,
                            tileProvider,
                          }));
                        }
                      }}
                    >
                      <option value="carto_voyager">CARTO Voyager</option>
                      <option value="osm">OpenStreetMap</option>
                      <option value="pmtiles_r2">Peta khusus (URL lingkungan)</option>
                    </select>
                  </label>
                  <label className="admin-day">
                    <input
                      type="checkbox"
                      checked={mapSettings.fallbackToOsm}
                      onChange={(event) =>
                        setMapSettings((current) => ({
                          ...current,
                          fallbackToOsm: event.target.checked,
                        }))
                      }
                    />
                    Gunakan OSM jika peta utama gagal
                  </label>
                  <label className="admin-day">
                    <input
                      type="checkbox"
                      checked={featureFlags.crowdReportingEnabled}
                      onChange={(event) =>
                        setFeatureFlags((current) => ({
                          ...current,
                          crowdReportingEnabled: event.target.checked,
                        }))
                      }
                    />
                    Aktifkan laporan mahasiswa
                  </label>
                  <label className="admin-day">
                    <input
                      type="checkbox"
                      checked={featureFlags.simulationMode}
                      onChange={(event) =>
                        setFeatureFlags((current) => ({
                          ...current,
                          simulationMode: event.target.checked,
                        }))
                      }
                    />
                    Paksa mode simulasi
                  </label>
                  <label className="admin-day">
                    <input
                      type="checkbox"
                      checked={featureFlags.maintenanceMode}
                      onChange={(event) =>
                        setFeatureFlags((current) => ({
                          ...current,
                          maintenanceMode: event.target.checked,
                        }))
                      }
                    />
                    Mode pemeliharaan
                  </label>
                </div>
              </fieldset>
              <fieldset className="admin-settings-group">
                <legend>Batas area kampus</legend>
                <div className="admin-fields admin-fields--three">
                  {([
                    ['minLat', 'Lintang minimum'],
                    ['maxLat', 'Lintang maksimum'],
                    ['minLng', 'Bujur minimum'],
                    ['maxLng', 'Bujur maksimum'],
                  ] as const).map(([key, label]) => (
                    <label className="admin-field" key={key}>
                      {label}
                      <input
                        name={key}
                        type="number"
                        step="0.000001"
                        value={geofenceSettings.campusBounds[key]}
                        onChange={(event) =>
                          setGeofenceSettings((current) => ({
                            ...current,
                            campusBounds: {
                              ...current.campusBounds,
                              [key]: Number(event.target.value),
                            },
                          }))
                        }
                        required
                      />
                    </label>
                  ))}
                  <label className="admin-field">
                    Jarak maksimum dari rute (km)
                    <input
                      name="max-distance"
                      type="number"
                      min="0.01"
                      max="10"
                      step="0.01"
                      value={geofenceSettings.maxDistanceFromRouteKm}
                      onChange={(event) =>
                        setGeofenceSettings((current) => ({
                          ...current,
                          maxDistanceFromRouteKm: Number(event.target.value),
                        }))
                      }
                      required
                    />
                  </label>
                </div>
              </fieldset>
              <p className="admin-help">
                Mengubah halte atau urutannya akan memperbarui rute yang dipakai peta dan ETA.
              </p>
              <button
                type="submit"
                className="admin-button admin-button--primary"
                disabled={saving}
              >
                {saving ? 'Menyimpan…' : 'Simpan pengaturan'}
              </button>
            </form>
            <div className="admin-route-note">
              <MapPin size={18} aria-hidden="true" />
              <p>
                Rute jalan mengikuti daftar halte yang aktif. Untuk mengubah jalurnya,
                perbarui koordinat atau urutan halte.
              </p>
            </div>
          </section>
        )}

        <footer className="admin-footer">
          <span>LINUSKU, pengelolaan operasi</span>
          <span>Masuk sebagai {session.user.email}</span>
        </footer>
      </div>
    </main>
  );
}

function FleetTable({
  buses,
  users,
  positionsByBus,
  now,
  saving,
  compact = false,
  onEdit,
  onDelete,
}: {
  buses: AdminBus[];
  users: AdminUser[];
  positionsByBus: Map<string, AdminPosition>;
  now: number;
  saving: boolean;
  compact?: boolean;
  onEdit: (bus: AdminBus) => void;
  onDelete: (bus: AdminBus) => void;
}) {
  return (
    <div className="admin-table-wrap">
      <table className="admin-table">
        <thead>
          <tr>
            <th scope="col">Armada</th>
            <th scope="col">Driver</th>
            <th scope="col">Posisi terakhir</th>
            <th scope="col">Kepadatan</th>
            <th scope="col">Status</th>
            <th scope="col"><span className="admin-visually-hidden">Tindakan</span></th>
          </tr>
        </thead>
        <tbody>
          {buses.map((bus) => {
            const position = positionsByBus.get(bus.id);
            const driver = users.find((user) => user.id === bus.driver_id);
            const isFresh =
              Boolean(position) &&
              now - new Date(position?.updated_at ?? '').getTime() <= 45000;
            return (
              <tr key={bus.id}>
                <td data-label="Armada">
                  <strong>{bus.id}</strong>
                  <small>{bus.name}</small>
                  {!compact && bus.plate_number && (
                    <small>Nomor kendaraan: {bus.plate_number}</small>
                  )}
                </td>
                <td data-label="Driver">
                  {driver
                    ? driver.fullName || driver.email
                    : bus.driver_id
                      ? 'Driver ditugaskan'
                      : 'Belum ditugaskan'}
                </td>
                <td data-label="Posisi terakhir" className="admin-number">
                  {position
                    ? `${position.lat.toFixed(5)}, ${position.lng.toFixed(5)}`
                    : 'Belum ada GPS'}
                  {position && (
                    <>
                      <small>{ageLabel(position.updated_at, now)}</small>
                      <small>Sumber posisi: {position.source_type}</small>
                      <small>Kecepatan: {Math.round(position.speed_kmh)} km/j</small>
                    </>
                  )}
                </td>
                <td data-label="Kepadatan">
                  {position ? formatOccupancy(position.occupancy) : 'Belum ada data'}
                </td>
                <td data-label="Status">
                  {!bus.is_active
                    ? 'Nonaktif'
                    : isFresh
                      ? 'GPS aktif'
                      : position
                        ? 'Data lama'
                        : 'Menunggu GPS'}
                </td>
                <td data-label="Tindakan" className="admin-actions-cell">
                  <button
                    type="button"
                    className="admin-button admin-button--quiet"
                    onClick={() => onEdit(bus)}
                  >
                    Ubah
                  </button>
                  <button
                    type="button"
                    className="admin-button admin-button--danger"
                    onClick={() => onDelete(bus)}
                    disabled={saving || bus.is_active}
                    title={bus.is_active ? 'Nonaktifkan armada sebelum menghapusnya' : undefined}
                    aria-label={`Hapus armada ${bus.id}`}
                  >
                    Hapus
                  </button>
                  {bus.is_active && <small>Nonaktifkan dahulu</small>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {!buses.length && (
        <EmptyState
          title="Belum ada armada"
          detail="Tambahkan bus sebelum mengatur penugasan driver."
        />
      )}
    </div>
  );
}

function EmptyState({
  title,
  detail,
  action,
  onAction,
}: {
  title: string;
  detail: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <div className="admin-empty">
      <Activity size={20} aria-hidden="true" />
      <div>
        <strong>{title}</strong>
        <p>{detail}</p>
      </div>
      {action && onAction && (
        <button type="button" className="admin-button admin-button--quiet" onClick={onAction}>
          {action}
        </button>
      )}
    </div>
  );
}
