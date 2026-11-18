import { NextRequest, NextResponse } from 'next/server';
import { isInsideCampus } from '@/data/usuRoutes';
import { requireAdmin } from '@/lib/adminAuth';

interface StopInput {
  id: string;
  name: string;
  area: string;
  lat: number;
  lng: number;
}

function parseStopInput(value: unknown): StopInput | null {
  if (!value || typeof value !== 'object') return null;
  const input = value as Record<string, unknown>;
  const id = typeof input.id === 'string' ? input.id.trim().toLowerCase() : '';
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  const area = typeof input.area === 'string' ? input.area.trim() : '';
  const lat = Number(input.lat);
  const lng = Number(input.lng);

  if (
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id) ||
    name.length < 2 ||
    name.length > 100 ||
    area.length < 2 ||
    area.length > 120 ||
    !isInsideCampus(lat, lng)
  ) {
    return null;
  }
  return { id, name, area, lat, lng };
}

export async function POST(request: NextRequest) {
  const authorization = await requireAdmin(request);
  if (!authorization.ok) return authorization.response;
  const body: unknown = await request.json().catch(() => null);
  const input = parseStopInput(body);
  if (!input) {
    return NextResponse.json(
      { error: 'Periksa ID, nama, area, dan koordinat halte di dalam Kampus USU.' },
      { status: 400 }
    );
  }

  const { data: lastStop, error: orderError } = await authorization.client
    .from('stops')
    .select('sequence_order')
    .order('sequence_order', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (orderError) {
    return NextResponse.json(
      { error: `Urutan halte belum dapat dibaca: ${orderError.message}` },
      { status: 503 }
    );
  }

  const { data, error } = await authorization.client
    .from('stops')
    .insert({ ...input, sequence_order: (lastStop?.sequence_order ?? 0) + 1 })
    .select('id, name, area, lat, lng, sequence_order')
    .single();
  if (error) {
    return NextResponse.json(
      { error: `Halte belum dapat ditambahkan: ${error.message}` },
      { status: 409 }
    );
  }
  return NextResponse.json({ stop: data }, { status: 201 });
}

export async function PATCH(request: NextRequest) {
  const authorization = await requireAdmin(request);
  if (!authorization.ok) return authorization.response;
  const body: unknown = await request.json().catch(() => null);
  const input = parseStopInput(body);
  if (!input) {
    return NextResponse.json(
      { error: 'Periksa ID, nama, area, dan koordinat halte di dalam Kampus USU.' },
      { status: 400 }
    );
  }

  const { data, error } = await authorization.client
    .from('stops')
    .update({
      name: input.name,
      area: input.area,
      lat: input.lat,
      lng: input.lng,
    })
    .eq('id', input.id)
    .select('id, name, area, lat, lng, sequence_order')
    .maybeSingle();
  if (error || !data) {
    return NextResponse.json(
      { error: `Halte belum dapat diperbarui: ${error?.message ?? 'halte tidak ditemukan'}` },
      { status: error ? 503 : 404 }
    );
  }
  return NextResponse.json({ stop: data });
}

export async function DELETE(request: NextRequest) {
  const authorization = await requireAdmin(request);
  if (!authorization.ok) return authorization.response;
  const stopId = new URL(request.url).searchParams.get('id')?.trim() ?? '';
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(stopId)) {
    return NextResponse.json({ error: 'ID halte tidak valid.' }, { status: 400 });
  }

  const { count, error: countError } = await authorization.client
    .from('stops')
    .select('id', { count: 'exact', head: true });
  if (countError) {
    return NextResponse.json(
      { error: `Jumlah halte belum dapat diperiksa: ${countError.message}` },
      { status: 503 }
    );
  }
  if ((count ?? 0) <= 2) {
    return NextResponse.json(
      { error: 'Rute harus memiliki sedikitnya dua halte.' },
      { status: 400 }
    );
  }

  const { error } = await authorization.client.from('stops').delete().eq('id', stopId);
  if (error) {
    return NextResponse.json(
      { error: `Halte belum dapat dihapus: ${error.message}` },
      { status: 503 }
    );
  }

  return NextResponse.json({ ok: true });
}
