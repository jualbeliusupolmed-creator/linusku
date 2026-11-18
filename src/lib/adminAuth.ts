import { NextRequest, NextResponse } from 'next/server';
import type { User } from '@supabase/supabase-js';
import {
  getSupabaseAdminClient,
  isSupabaseAdminConfigured,
} from '@/lib/supabaseServer';
import { getAdminAllowlist, isAdminEmailAllowed } from './adminAllowlist';

export { getAdminAllowlist, isAdminEmailAllowed } from './adminAllowlist';

export type AdminClient = NonNullable<ReturnType<typeof getSupabaseAdminClient>>;

export type AdminAuthorization =
  | {
      ok: true;
      client: AdminClient;
      user: User;
    }
  | {
      ok: false;
      response: NextResponse<{ error: string }>;
    };

export async function requireAdmin(
  request: NextRequest
): Promise<AdminAuthorization> {
  const client = getSupabaseAdminClient();
  if (!isSupabaseAdminConfigured || !client) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Layanan admin belum dikonfigurasi di server.' },
        { status: 503 }
      ),
    };
  }

  const allowlist = getAdminAllowlist();
  if (allowlist.length === 0) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Daftar email admin belum dikonfigurasi di server.' },
        { status: 503 }
      ),
    };
  }

  const authorization = request.headers.get('authorization');
  const accessToken = authorization?.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length).trim()
    : '';
  if (!accessToken) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Sesi admin diperlukan.' },
        { status: 401 }
      ),
    };
  }

  const { data, error } = await client.auth.getUser(accessToken);
  if (error || !data.user) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Sesi tidak valid. Silakan masuk kembali.' },
        { status: 401 }
      ),
    };
  }

  if (!data.user.email_confirmed_at) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Email akun admin harus sudah diverifikasi.' },
        { status: 403 }
      ),
    };
  }

  if (!isAdminEmailAllowed(data.user.email, allowlist)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Akun ini tidak memiliki akses admin LINUSKU.' },
        { status: 403 }
      ),
    };
  }

  return { ok: true, client, user: data.user };
}
