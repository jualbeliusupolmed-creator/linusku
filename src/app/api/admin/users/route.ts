import { NextRequest, NextResponse } from 'next/server';
import { isAdminEmailAllowed, requireAdmin } from '@/lib/adminAuth';

function isEmail(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.trim().length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
  );
}

export async function POST(request: NextRequest) {
  const authorization = await requireAdmin(request);
  if (!authorization.ok) return authorization.response;
  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Data akun tidak valid.' }, { status: 400 });
  }

  const input = body as Record<string, unknown>;
  const email = isEmail(input.email) ? input.email.trim().toLowerCase() : '';
  const fullName =
    typeof input.fullName === 'string' ? input.fullName.trim() : '';
  const password = typeof input.password === 'string' ? input.password : '';

  if (!email || fullName.length < 2 || fullName.length > 100 || password.length < 8) {
    return NextResponse.json(
      { error: 'Isi nama, email valid, dan password minimal 8 karakter.' },
      { status: 400 }
    );
  }
  if (isAdminEmailAllowed(email)) {
    return NextResponse.json(
      { error: 'Email admin dikelola melalui allowlist server, bukan sebagai akun driver.' },
      { status: 400 }
    );
  }

  const { data, error } = await authorization.client.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });
  if (error || !data.user) {
    return NextResponse.json(
      { error: `Akun driver belum dapat dibuat: ${error?.message ?? 'kesalahan server'}` },
      { status: 409 }
    );
  }

  return NextResponse.json(
    {
      user: {
        id: data.user.id,
        email: data.user.email,
        fullName,
      },
    },
    { status: 201 }
  );
}

export async function PATCH(request: NextRequest) {
  const authorization = await requireAdmin(request);
  if (!authorization.ok) return authorization.response;
  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Data akun tidak valid.' }, { status: 400 });
  }

  const input = body as Record<string, unknown>;
  const id = typeof input.id === 'string' ? input.id.trim() : '';
  const email = isEmail(input.email) ? input.email.trim().toLowerCase() : '';
  const fullName =
    typeof input.fullName === 'string' ? input.fullName.trim() : '';
  const occupancy = input.occupancy;
  const password =
    typeof input.password === 'string' ? input.password : undefined;

  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      id
    ) ||
    !email ||
    fullName.length < 2 ||
    fullName.length > 100 ||
    (occupancy !== undefined &&
      occupancy !== 'low' &&
      occupancy !== 'medium' &&
      occupancy !== 'full') ||
    (password !== undefined && password.length > 0 && password.length < 8) ||
    typeof input.active !== 'boolean'
  ) {
    return NextResponse.json(
      { error: 'Periksa nama, email, password baru, dan status akun.' },
      { status: 400 }
    );
  }

  const { data: currentData, error: currentError } =
    await authorization.client.auth.admin.getUserById(id);
  const currentUser = currentData.user;
  if (currentError || !currentUser) {
    return NextResponse.json(
      { error: `Akun tidak ditemukan: ${currentError?.message ?? ''}` },
      { status: 404 }
    );
  }
  if (
    isAdminEmailAllowed(currentUser.email) ||
    isAdminEmailAllowed(email)
  ) {
    return NextResponse.json(
      { error: 'Akun admin tidak dapat diubah dari pengelolaan driver.' },
      { status: 403 }
    );
  }

  const attributes: {
    email: string;
    user_metadata: Record<string, unknown>;
    password?: string;
    ban_duration?: string;
  } = {
    email,
    user_metadata: {
      ...currentUser.user_metadata,
      full_name: fullName,
      ...(occupancy === undefined ? {} : { linusku_occupancy: occupancy }),
    },
    ban_duration: input.active ? 'none' : '876000h',
  };
  if (password) attributes.password = password;

  const { data, error } = await authorization.client.auth.admin.updateUserById(
    id,
    attributes
  );
  if (error || !data.user) {
    return NextResponse.json(
      { error: `Akun belum dapat diperbarui: ${error?.message ?? 'kesalahan server'}` },
      { status: 503 }
    );
  }

  return NextResponse.json({
    user: {
      id: data.user.id,
      email: data.user.email,
      fullName,
      active: !data.user.banned_until,
    },
  });
}
