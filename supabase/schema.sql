-- Skema Database LINUSKU (Supabase PostgreSQL)
-- Jalankan SQL ini di Supabase SQL Editor

-- 1. Daftar Armada Bus Lintas USU (Linus)
create table if not exists public.buses (
  id text primary key, -- contoh: 'LINUS-01'
  name text not null,  -- contoh: 'Linus 01 (Koridor Utama)'
  plate_number text,
  capacity integer not null default 30,
  is_active boolean not null default true,
  driver_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

-- 2. Daftar Halte Resmi Bus Linus Kampus USU Padang Bulan
create table if not exists public.stops (
  id text primary key,
  name text not null,
  area text not null,
  lat double precision not null,
  lng double precision not null,
  sequence_order integer not null unique
);

-- 3. Posisi Real-Time Armada (1 baris per bus, di-upsert setiap 3-5 detik oleh driver)
create table if not exists public.bus_positions (
  bus_id text primary key references public.buses(id) on delete cascade,
  lat double precision not null check (lat between 3.550 and 3.575),
  lng double precision not null check (lng between 98.648 and 98.665),
  speed_kmh double precision not null default 18 check (speed_kmh between 0 and 80),
  heading double precision not null default 0 check (heading between -360 and 360),
  occupancy text not null default 'medium' check (occupancy in ('low', 'medium', 'full')),
  source_type text not null default 'driver' check (source_type = 'driver'),
  updated_at timestamptz not null default now()
);

-- Index untuk mempercepat filter armada aktif pada endpoint /api/positions
create index if not exists idx_bus_positions_updated_at
  on public.bus_positions (updated_at desc);
create index if not exists idx_buses_driver_id
  on public.buses (driver_id)
  where driver_id is not null;

-- 4. Laporan Crowdsourcing Mahasiswa (opsional untuk fallback / laporan kepadatan)
create table if not exists public.crowd_reports (
  id uuid primary key default gen_random_uuid(),
  bus_id text references public.buses(id) on delete set null,
  stop_id text references public.stops(id) on delete set null,
  lat double precision not null check (lat between 3.550 and 3.575),
  lng double precision not null check (lng between 98.648 and 98.665),
  occupancy text not null default 'medium' check (occupancy in ('low', 'medium', 'full')),
  created_at timestamptz not null default now()
);

-- Pengaturan operasional tunggal, dapat dibaca publik dan hanya diubah server admin.
create table if not exists public.linusku_settings (
  key text primary key check (key = 'service'),
  service_days integer[] not null default array[1, 2, 3, 4, 5],
  opening_time time not null default '07:00',
  closing_time time not null default '17:00',
  updated_at timestamptz not null default now(),
  check (opening_time < closing_time)
);

insert into public.linusku_settings (key)
values ('service')
on conflict (key) do nothing;

create index if not exists idx_crowd_reports_created_at
  on public.crowd_reports (created_at desc);
create index if not exists idx_crowd_reports_bus_id
  on public.crowd_reports (bus_id)
  where bus_id is not null;

-- Migrasi aman untuk database yang sudah dibuat dari versi sebelumnya
alter table public.buses
  add column if not exists driver_id uuid references auth.users(id) on delete set null;

alter table public.bus_positions
  drop constraint if exists bus_positions_source_type_check;
alter table public.bus_positions
  add constraint bus_positions_source_type_check check (source_type = 'driver');

-- Row Level Security (RLS)
alter table public.buses enable row level security;
alter table public.stops enable row level security;
alter table public.bus_positions enable row level security;
alter table public.crowd_reports enable row level security;
alter table public.linusku_settings enable row level security;

-- Kebijakan Baca Publik (diakses oleh endpoint /api/positions dengan cache 3 detik)
drop policy if exists "Public read buses" on public.buses;
drop policy if exists "Public read stops" on public.stops;
drop policy if exists "Public read bus_positions" on public.bus_positions;
drop policy if exists "Public read crowd_reports" on public.crowd_reports;
drop policy if exists "Public read linusku_settings" on public.linusku_settings;

create policy "Public read buses" on public.buses for select using (true);
create policy "Public read stops" on public.stops for select using (true);
create policy "Public read bus_positions" on public.bus_positions for select using (true);
create policy "Public read linusku_settings" on public.linusku_settings for select using (true);
-- Hindari akses langsung ke laporan mahasiswa. Semua laporan melewati /api/crowd,
-- yang memvalidasi lokasi serta menggunakan service role hanya di server.
revoke all on table public.buses, public.stops, public.bus_positions, public.crowd_reports
  from anon, authenticated;
grant select on table public.buses, public.stops, public.bus_positions to anon, authenticated;
grant insert, update on table public.bus_positions to authenticated;
revoke all on table public.linusku_settings from anon, authenticated;
grant select on table public.linusku_settings to anon, authenticated;
grant all on table public.linusku_settings to service_role;

-- Kebijakan Tulis Ketat (hanya akun driver yang ditugaskan ke bus aktif)
drop policy if exists "MVP upsert bus_positions" on public.bus_positions;
drop policy if exists "MVP insert crowd_reports" on public.crowd_reports;
drop policy if exists "Assigned driver upsert bus_positions" on public.bus_positions;
drop policy if exists "Assigned driver insert bus_positions" on public.bus_positions;
drop policy if exists "Assigned driver update bus_positions" on public.bus_positions;
drop policy if exists "Authenticated insert crowd_reports" on public.crowd_reports;
drop policy if exists "Public insert crowd_reports" on public.crowd_reports;

create policy "Assigned driver insert bus_positions" on public.bus_positions
  for insert
  to authenticated
  with check (
    exists (
      select 1 from public.buses
      where buses.id = bus_positions.bus_id
        and buses.driver_id = (select auth.uid())
        and buses.is_active
    )
  );

create policy "Assigned driver update bus_positions" on public.bus_positions
  for update
  to authenticated
  using (
    exists (
      select 1 from public.buses
      where buses.id = bus_positions.bus_id
        and buses.driver_id = (select auth.uid())
        and buses.is_active
    )
  )
  with check (
    exists (
      select 1 from public.buses
      where buses.id = bus_positions.bus_id
        and buses.driver_id = (select auth.uid())
        and buses.is_active
    )
  );

-- Validasi kedua di database untuk menolak posisi lama, waktu masa depan, dan
-- lompatan GPS yang tidak mungkin. Trigger tidak dapat dipanggil melalui API.
create or replace function public.validate_bus_position()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  elapsed_seconds double precision;
  distance_km double precision;
  implied_speed_kmh double precision;
begin
  if new.updated_at > now() + interval '1 minute' then
    raise exception 'Waktu posisi tidak boleh berada di masa depan';
  end if;

  if tg_op = 'UPDATE' then
    if new.updated_at <= old.updated_at then
      raise exception 'Waktu posisi harus lebih baru dari data sebelumnya';
    end if;

    elapsed_seconds := extract(epoch from new.updated_at - old.updated_at);
    distance_km := 6371 * 2 * asin(sqrt(
      power(sin(radians(new.lat - old.lat) / 2), 2) +
      cos(radians(old.lat)) * cos(radians(new.lat)) *
      power(sin(radians(new.lng - old.lng) / 2), 2)
    ));
    implied_speed_kmh := distance_km / (elapsed_seconds / 3600);

    if implied_speed_kmh > 80 then
      raise exception 'Perubahan posisi melebihi batas kecepatan';
    end if;
  end if;

  return new;
end;
$$;

revoke execute on function public.validate_bus_position() from public, anon, authenticated;

drop trigger if exists validate_bus_position_before_write on public.bus_positions;
create trigger validate_bus_position_before_write
before insert or update on public.bus_positions
for each row execute function public.validate_bus_position();

-- Seed data awal armada Linus
insert into public.buses (id, name, plate_number, capacity, is_active) values
  ('LINUS-01', 'Linus 01 — Rute Kampus', 'BK 7001 USU', 30, true),
  ('LINUS-02', 'Linus 02 — Rute Kampus', 'BK 7002 USU', 30, true),
  ('LINUS-03', 'Linus 03 — Rute Kampus', 'BK 7003 USU', 30, true)
on conflict (id) do nothing;

-- Seed 10 halte utama Kampus USU Padang Bulan
-- Pindahkan urutan lama sementara agar pertukaran nilai tidak melanggar UNIQUE
-- saat PostgreSQL memproses baris upsert satu per satu.
with linus_stop_ids(id) as (
  values
    ('halte-pintu-1'),
    ('halte-fk'),
    ('halte-biro'),
    ('halte-vokasi'),
    ('halte-fmipa'),
    ('halte-feb'),
    ('halte-perpus'),
    ('halte-fisip'),
    ('halte-teknik'),
    ('halte-hukum')
),
bounds as (
  select
    coalesce((select max(sequence_order) from public.stops), 0) as max_sequence,
    coalesce((
      select min(stop.sequence_order)
      from public.stops as stop
      join linus_stop_ids using (id)
    ), 0) as min_sequence
)
update public.stops as stop
set sequence_order =
  stop.sequence_order + bounds.max_sequence - bounds.min_sequence + 1
from bounds
where stop.id in (select id from linus_stop_ids);

insert into public.stops (id, name, area, lat, lng, sequence_order) values
  ('halte-pintu-1', 'Halte Pintu 1 / Gelanggang', 'Jl. Universitas (Pintu 1)', 3.5656, 98.6594, 1),
  ('halte-fk', 'Halte FK / RS USU', 'Jl. Dr. Mansyur', 3.5673, 98.6552, 2),
  ('halte-biro', 'Halte Biro Rektor / Pancasila', 'Jl. Dr. T. Mansyur', 3.5668, 98.6528, 3),
  ('halte-vokasi', 'Halte Fakultas Vokasi / Pintu 4', 'Jl. Tri Dharma', 3.5618, 98.6519, 4),
  ('halte-fmipa', 'Halte FMIPA & Fasilkom-TI', 'Jl. Bioteknologi', 3.5592, 98.6542, 5),
  ('halte-feb', 'Halte FEB USU', 'Jl. Prof. T.M. Hanafiah', 3.5598, 98.6562, 6),
  ('halte-perpus', 'Halte Perpustakaan USU', 'Jl. Perpustakaan', 3.5612, 98.6568, 7),
  ('halte-fisip', 'Halte FISIP & FIB', 'Jl. Sivitas Akademika', 3.5625, 98.6572, 8),
  ('halte-teknik', 'Halte Fakultas Teknik', 'Jl. Almamater', 3.5618, 98.6586, 9),
  ('halte-hukum', 'Halte Fakultas Hukum', 'Jl. Universitas', 3.5639, 98.6590, 10)
on conflict (id) do update set
  name = excluded.name,
  area = excluded.area,
  lat = excluded.lat,
  lng = excluded.lng,
  sequence_order = excluded.sequence_order;

-- Menata ulang urutan halte secara atomik tanpa benturan constraint UNIQUE.
create or replace function public.admin_reorder_stops(p_stop_ids text[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  stop_count bigint;
  matched_count bigint;
  minimum_order bigint;
  maximum_order bigint;
  shift_by bigint;
begin
  select count(*), coalesce(min(sequence_order), 0), coalesce(max(sequence_order), 0)
  into stop_count, minimum_order, maximum_order
  from public.stops;

  if cardinality(p_stop_ids) is distinct from stop_count then
    raise exception 'Daftar halte harus memuat semua halte tepat satu kali';
  end if;

  select count(distinct requested.id)
  into matched_count
  from unnest(p_stop_ids) as requested(id)
  join public.stops as stop on stop.id = requested.id;

  if matched_count is distinct from stop_count then
    raise exception 'Daftar halte harus memuat semua halte tepat satu kali';
  end if;

  if stop_count = 0 then
    return;
  end if;

  shift_by := maximum_order - minimum_order + 1;
  update public.stops
  set sequence_order = (sequence_order::bigint + shift_by)::integer;

  update public.stops as stop
  set sequence_order = requested.ordinality::integer
  from unnest(p_stop_ids) with ordinality as requested(id, ordinality)
  where stop.id = requested.id;
end;
$$;

revoke all on function public.admin_reorder_stops(text[]) from public, anon, authenticated;
grant execute on function public.admin_reorder_stops(text[]) to service_role;
