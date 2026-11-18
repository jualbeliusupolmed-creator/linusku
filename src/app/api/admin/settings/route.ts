import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/adminAuth';

interface SettingsInput {
  serviceDays: number[];
  openingTime: string;
  closingTime: string;
}

function parseSettings(value: unknown): SettingsInput | null {
  if (!value || typeof value !== 'object') return null;
  const input = value as Record<string, unknown>;
  const serviceDays = input.serviceDays;
  const openingTime =
    typeof input.openingTime === 'string' ? input.openingTime : '';
  const closingTime =
    typeof input.closingTime === 'string' ? input.closingTime : '';
  const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

  if (
    !Array.isArray(serviceDays) ||
    serviceDays.length === 0 ||
    serviceDays.some(
      (day) => !Number.isInteger(day) || Number(day) < 1 || Number(day) > 7
    ) ||
    new Set(serviceDays).size !== serviceDays.length ||
    !timePattern.test(openingTime) ||
    !timePattern.test(closingTime) ||
    openingTime >= closingTime
  ) {
    return null;
  }
  return {
    serviceDays: serviceDays as number[],
    openingTime,
    closingTime,
  };
}

export async function PUT(request: NextRequest) {
  const authorization = await requireAdmin(request);
  if (!authorization.ok) return authorization.response;
  const body: unknown = await request.json().catch(() => null);
  const input = parseSettings(body);
  if (!input) {
    return NextResponse.json(
      { error: 'Pilih hari layanan dan rentang jam buka yang valid.' },
      { status: 400 }
    );
  }

  const { data, error } = await authorization.client
    .from('linusku_settings')
    .upsert(
      {
        key: 'service',
        service_days: input.serviceDays,
        opening_time: input.openingTime,
        closing_time: input.closingTime,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'key' }
    )
    .select('service_days, opening_time, closing_time, updated_at')
    .single();

  if (error) {
    return NextResponse.json(
      { error: `Jadwal belum dapat disimpan: ${error.message}` },
      { status: 503 }
    );
  }
  return NextResponse.json({ settings: data });
}
