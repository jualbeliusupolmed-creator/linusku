-- Skema Database Produksi LINUSKU (Supabase PostgreSQL)
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
  source_type text not null default 'driver' check (source_type in ('driver', 'crowd', 'simulator')),
  updated_at timestamptz not null default now()
);

-- Index untuk mempercepat filter armada aktif pada endpoint /api/positions
create index if not exists idx_bus_positions_updated_at
  on public.bus_positions (updated_at desc);

-- 4. Laporan Crowdsourcing Mahasiswa (opsional untuk fallback / laporan kepadatan)
create table if not exists public.crowd_reports (
  id uuid primary key default gen_random_uuid(),
  bus_id text references public.buses(id) on delete set null,
  stop_id text references public.stops(id) on delete set null,
  lat double precision not null check (lat between 3.550 and 3.575),
  lng double precision not null check (lng between 98.648 and 98.665),
  occupancy text not null default 'medium' check (occupancy in ('low', 'medium', 'full')),
  reporter_fingerprint text,
  created_at timestamptz not null default now()
);

-- Migrasi aman untuk database yang sudah dibuat dari versi sebelumnya
alter table public.buses
  add column if not exists driver_id uuid references auth.users(id) on delete set null;

-- Row Level Security (RLS)
alter table public.buses enable row level security;
alter table public.stops enable row level security;
alter table public.bus_positions enable row level security;
alter table public.crowd_reports enable row level security;

-- Kebijakan Baca Publik (diakses oleh endpoint /api/positions dengan cache 3 detik)
drop policy if exists "Public read buses" on public.buses;
drop policy if exists "Public read stops" on public.stops;
drop policy if exists "Public read bus_positions" on public.bus_positions;
drop policy if exists "Public read crowd_reports" on public.crowd_reports;

create policy "Public read buses" on public.buses for select using (true);
create policy "Public read stops" on public.stops for select using (true);
create policy "Public read bus_positions" on public.bus_positions for select using (true);
create policy "Public read crowd_reports" on public.crowd_reports for select using (true);

-- Kebijakan Tulis Ketat (hanya akun driver yang ditugaskan ke bus aktif)
drop policy if exists "MVP upsert bus_positions" on public.bus_positions;
drop policy if exists "MVP insert crowd_reports" on public.crowd_reports;
drop policy if exists "Assigned driver upsert bus_positions" on public.bus_positions;
drop policy if exists "Authenticated insert crowd_reports" on public.crowd_reports;
drop policy if exists "Public insert crowd_reports" on public.crowd_reports;

create policy "Assigned driver upsert bus_positions" on public.bus_positions
  for all
  to authenticated
  using (
    exists (
      select 1 from public.buses
      where buses.id = bus_positions.bus_id
        and buses.driver_id = auth.uid()
        and buses.is_active
    )
  )
  with check (
    exists (
      select 1 from public.buses
      where buses.id = bus_positions.bus_id
        and buses.driver_id = auth.uid()
        and buses.is_active
    )
  );

create policy "Authenticated insert crowd_reports" on public.crowd_reports
  for insert
  to authenticated
  with check (auth.uid() is not null);

create policy "Public insert crowd_reports" on public.crowd_reports
  for insert
  to anon
  with check (
    lat between 3.550 and 3.575
    and lng between 98.648 and 98.665
  );

-- Seed data awal armada Linus
insert into public.buses (id, name, plate_number, capacity, is_active) values
  ('LINUS-01', 'Linus 01 — Rute Kampus', 'BK 7001 USU', 30, true),
  ('LINUS-02', 'Linus 02 — Rute Kampus', 'BK 7002 USU', 30, true),
  ('LINUS-03', 'Linus 03 — Rute Kampus', 'BK 7003 USU', 30, true)
on conflict (id) do nothing;

-- Seed 10 halte utama Kampus USU Padang Bulan
insert into public.stops (id, name, area, lat, lng, sequence_order) values
  ('halte-pintu-1', 'Halte Pintu 1 / Gelanggang', 'Jl. Universitas (Pintu 1)', 3.5656, 98.6594, 1),
  ('halte-hukum', 'Halte Fakultas Hukum', 'Jl. Universitas', 3.5639, 98.6578, 2),
  ('halte-fisip', 'Halte FISIP & FIB', 'Jl. Dr. A. Sofian', 3.5625, 98.6562, 3),
  ('halte-perpus', 'Halte Perpustakaan USU', 'Jl. Perpustakaan', 3.5612, 98.6548, 4),
  ('halte-biro', 'Halte Biro Rektor / Pancasila', 'Jl. Dr. T. Mansyur', 3.5649, 98.6531, 5),
  ('halte-feb', 'Halte FEB USU', 'Jl. Prof. T.M. Hanafiah', 3.5602, 98.6539, 6),
  ('halte-fmipa', 'Halte FMIPA & Fasilkom-TI', 'Jl. Bioteknologi', 3.5594, 98.6558, 7),
  ('halte-vokasi', 'Halte Fakultas Vokasi / Pintu 4', 'Jl. Tri Dharma', 3.5588, 98.6584, 8),
  ('halte-teknik', 'Halte Fakultas Teknik', 'Jl. Almamater', 3.5615, 98.6596, 9),
  ('halte-fk', 'Halte FK / RS USU', 'Jl. Dr. Mansyur', 3.5666, 98.6552, 10)
on conflict (id) do update set
  name = excluded.name,
  area = excluded.area,
  lat = excluded.lat,
  lng = excluded.lng,
  sequence_order = excluded.sequence_order;
