import { createClient, SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabasePublishableKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(supabaseUrl && supabasePublishableKey);

export function getSupabaseConfigurationError(): string | null {
  if (supabaseUrl && supabasePublishableKey) return null;
  if (!supabaseUrl && !supabasePublishableKey) {
    return 'NEXT_PUBLIC_SUPABASE_URL dan kunci publik belum dikonfigurasi.';
  }
  if (!supabaseUrl) return 'NEXT_PUBLIC_SUPABASE_URL belum dikonfigurasi.';
  return 'Kunci publik Supabase belum dikonfigurasi.';
}

interface ClientOptions {
  rememberSession?: boolean;
  storageKey?: string;
}

const clients = new Map<string, SupabaseClient>();

export function getSupabaseClient(
  options: ClientOptions = {}
): SupabaseClient | null {
  if (!isSupabaseConfigured || !supabaseUrl || !supabasePublishableKey) {
    return null;
  }

  const { rememberSession, storageKey } = options;
  const clientKey =
    rememberSession === undefined
      ? 'default'
      : `${storageKey ?? 'custom'}:${rememberSession ? 'local' : 'session'}`;
  const existingClient = clients.get(clientKey);
  if (existingClient) {
    return existingClient;
  }

  const authOptions =
    rememberSession === undefined
      ? undefined
      : {
          persistSession: true,
          storageKey,
          storage:
            typeof window === 'undefined'
              ? undefined
              : rememberSession
                ? window.localStorage
                : window.sessionStorage,
        };
  const client = createClient(
    supabaseUrl,
    supabasePublishableKey,
    authOptions ? { auth: authOptions } : undefined
  );
  clients.set(clientKey, client);
  return client;
}
