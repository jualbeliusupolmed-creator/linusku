import { NextResponse } from 'next/server';
import { DEFAULT_OPERATING_SETTINGS } from '@/data/usuRoutes';
import { getSupabaseClient, isSupabaseConfigured } from '@/lib/supabase';

export async function GET() {
  const supabase = getSupabaseClient();
  if (!isSupabaseConfigured || !supabase) {
    return NextResponse.json({
      settings: DEFAULT_OPERATING_SETTINGS,
      source: 'default',
    });
  }

  const { data, error } = await supabase
    .from('linusku_settings')
    .select('service_days, opening_time, closing_time, updated_at')
    .eq('key', 'service')
    .maybeSingle();
  if (error) {
    return NextResponse.json(
      { error: `Jadwal operasional belum dapat dimuat: ${error.message}` },
      { status: 503 }
    );
  }
  if (!data) {
    return NextResponse.json(
      { error: 'Pengaturan operasional belum tersedia di Supabase.' },
      { status: 503 }
    );
  }

  return NextResponse.json(
    {
      settings: {
        serviceDays: data.service_days,
        openingTime: data.opening_time.slice(0, 5),
        closingTime: data.closing_time.slice(0, 5),
        timeZone: DEFAULT_OPERATING_SETTINGS.timeZone,
      },
      source: 'database',
      updatedAt: data.updated_at,
    },
    { headers: { 'Cache-Control': 'public, s-maxage=10, stale-while-revalidate=20' } }
  );
}
