-- ============================================================
-- LINUSKU Database Improvements Migration
-- Generated: 2026-11-18
-- Description: Comprehensive improvements for security, audit, flexibility, and analytics
-- ============================================================

-- Enable required extensions
create extension if not exists "pg_cron";
create extension if not exists "pgcrypto";
create extension if not exists "uuid-ossp";

-- ============================================================
-- 1. FIX: Longgarin source_type constraint (future-proof IoT/simulator)
-- ============================================================
-- Normalize legacy values before adding the stricter constraint.
update public.bus_positions
set source_type = 'driver'
where source_type not in ('driver', 'device', 'simulator', 'crowd');

alter table public.bus_positions
  drop constraint if exists bus_positions_source_type_check;

alter table public.bus_positions
  add constraint bus_positions_source_type_check
  check (source_type in ('driver', 'device', 'simulator', 'crowd'));

-- ============================================================
-- 2. FIX: Add explicit RLS INSERT policy for crowd_reports (service_role only)
-- ============================================================
-- Revoke any existing permissions first
revoke all on table public.crowd_reports from anon, authenticated, service_role;

-- Reports are accessed only by server-side APIs.
grant select, insert, delete on table public.crowd_reports to service_role;

-- Geofence limits are validated from settings by the database trigger and API.
alter table public.bus_positions
  drop constraint if exists bus_positions_lat_check;
alter table public.bus_positions
  drop constraint if exists bus_positions_lng_check;
alter table public.crowd_reports
  drop constraint if exists crowd_reports_lat_check;
alter table public.crowd_reports
  drop constraint if exists crowd_reports_lng_check;

-- Explicit policy for service_role insert
drop policy if exists "Service role insert crowd_reports" on public.crowd_reports;
create policy "Service role insert crowd_reports" on public.crowd_reports
  for insert to service_role with check (true);

-- ============================================================
-- 3. ADD: Partial index for active buses positions (performance)
-- ============================================================
-- Since PostgreSQL doesn't allow subquery in index WHERE clause,
-- we add a denormalized is_active column to bus_positions
-- maintained by trigger

alter table public.bus_positions
  add column if not exists bus_is_active boolean not null default true;

-- Update existing rows
update public.bus_positions bp
set bus_is_active = b.is_active
from public.buses b
where bp.bus_id = b.id;

-- Partial index for active buses only
create index if not exists idx_bus_positions_active_updated
  on public.bus_positions (updated_at desc)
  where bus_is_active;

-- Trigger to keep bus_is_active in sync
create or replace function public.sync_bus_position_active()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or tg_op = 'UPDATE' then
    new.bus_is_active := (
      select is_active from public.buses where id = new.bus_id
    );
  end if;
  return new;
end;
$$;

revoke execute on function public.sync_bus_position_active() from public, anon, authenticated;
grant execute on function public.sync_bus_position_active() to service_role;

drop trigger if exists sync_bus_position_active_trigger on public.bus_positions;
create trigger sync_bus_position_active_trigger
before insert or update on public.bus_positions
for each row execute function public.sync_bus_position_active();

create or replace function public.sync_bus_positions_for_bus()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.is_active is distinct from old.is_active then
    update public.bus_positions
    set bus_is_active = new.is_active
    where bus_id = new.id;
  end if;
  return new;
end;
$$;

revoke execute on function public.sync_bus_positions_for_bus() from public, anon, authenticated;
grant execute on function public.sync_bus_positions_for_bus() to service_role;

drop trigger if exists sync_bus_positions_for_bus_trigger on public.buses;
create trigger sync_bus_positions_for_bus_trigger
after update of is_active on public.buses
for each row execute function public.sync_bus_positions_for_bus();

-- ============================================================
-- 4. ADD: Admin Audit Log Table
-- ============================================================
create table if not exists public.admin_audit_log (
  id bigserial primary key,
  admin_id uuid not null references auth.users(id) on delete restrict,
  action text not null,
  target_table text not null,
  target_id text,
  old_value jsonb,
  new_value jsonb,
  ip_address inet,
  user_agent text,
  created_at timestamptz not null default now()
);

-- Indexes for common queries
create index if not exists idx_admin_audit_log_admin_id on public.admin_audit_log (admin_id);
create index if not exists idx_admin_audit_log_target on public.admin_audit_log (target_table, target_id);
create index if not exists idx_admin_audit_log_created_at on public.admin_audit_log (created_at desc);
create index if not exists idx_admin_audit_log_action on public.admin_audit_log (action);

-- RLS
alter table public.admin_audit_log enable row level security;

-- Only service_role can insert (server-side API)
revoke all on table public.admin_audit_log from anon, authenticated;
grant insert on table public.admin_audit_log to service_role;
grant select on table public.admin_audit_log to service_role;

drop policy if exists "Service role full access admin_audit_log" on public.admin_audit_log;
create policy "Service role full access admin_audit_log" on public.admin_audit_log
  for all to service_role using (true) with check (true);

-- Helper function to log admin actions (callable from server)
create or replace function public.log_admin_action(
  p_admin_id uuid,
  p_action text,
  p_target_table text,
  p_target_id text default null,
  p_old_value jsonb default null,
  p_new_value jsonb default null,
  p_ip_address inet default null,
  p_user_agent text default null
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.admin_audit_log (
    admin_id, action, target_table, target_id, old_value, new_value, ip_address, user_agent
  ) values (
    p_admin_id, p_action, p_target_table, p_target_id, p_old_value, p_new_value, p_ip_address, p_user_agent
  );
end;
$$;

revoke execute on function public.log_admin_action(uuid, text, text, text, jsonb, jsonb, inet, text) from public, anon, authenticated;
grant execute on function public.log_admin_action(uuid, text, text, text, jsonb, jsonb, inet, text) to service_role;

-- ============================================================
-- 5. ADD: Position History Table (for analytics/replay)
-- ============================================================
create table if not exists public.bus_position_history (
  id bigserial primary key,
  bus_id text not null references public.buses(id) on delete cascade,
  lat double precision not null check (lat between 3.550 and 3.575),
  lng double precision not null check (lng between 98.648 and 98.665),
  speed_kmh double precision not null check (speed_kmh between 0 and 80),
  heading double precision not null check (heading between -360 and 360),
  occupancy text not null check (occupancy in ('low', 'medium', 'full')),
  source_type text not null check (source_type in ('driver', 'device', 'simulator', 'crowd')),
  recorded_at timestamptz not null default now()
);

alter table public.bus_position_history
  drop constraint if exists bus_position_history_lat_check;
alter table public.bus_position_history
  drop constraint if exists bus_position_history_lng_check;

-- Partition by day for performance (using pg_partman would be better but this works)
-- For now, create indexes for time-range queries
create index if not exists idx_bus_position_history_bus_time on public.bus_position_history (bus_id, recorded_at desc);
create index if not exists idx_bus_position_history_recorded_at on public.bus_position_history (recorded_at desc);
create index if not exists idx_bus_position_history_source on public.bus_position_history (source_type);

-- RLS
alter table public.bus_position_history enable row level security;

-- Public read for analytics dashboard (via service_role API)
revoke all on table public.bus_position_history from anon, authenticated;
grant select on table public.bus_position_history to service_role;

drop policy if exists "Service role read bus_position_history" on public.bus_position_history;
create policy "Service role read bus_position_history" on public.bus_position_history
  for select to service_role using (true);

-- Trigger to auto-archive bus_positions changes to history
create or replace function public.archive_bus_position()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or tg_op = 'UPDATE' then
    insert into public.bus_position_history (
      bus_id, lat, lng, speed_kmh, heading, occupancy, source_type, recorded_at
    ) values (
      new.bus_id, new.lat, new.lng, new.speed_kmh, new.heading, new.occupancy, new.source_type, new.updated_at
    );
  end if;
  return new;
end;
$$;

revoke execute on function public.archive_bus_position() from public, anon, authenticated;
grant execute on function public.archive_bus_position() to service_role;

drop trigger if exists archive_bus_position_trigger on public.bus_positions;
create trigger archive_bus_position_trigger
after insert or update of lat, lng, speed_kmh, heading, occupancy, source_type, updated_at
on public.bus_positions
for each row execute function public.archive_bus_position();

-- ============================================================
-- 6. ADD: Driver Sessions Table (login/logout tracking)
-- ============================================================
create table if not exists public.driver_sessions (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references auth.users(id) on delete cascade,
  bus_id text references public.buses(id) on delete set null,
  session_token_hash text not null,
  device_info jsonb, -- {platform, userAgent, screenResolution, etc}
  ip_address inet,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  last_gps_at timestamptz,
  gps_count integer not null default 0,
  status text not null default 'active' check (status in ('active', 'ended', 'expired'))
);

create index if not exists idx_driver_sessions_driver on public.driver_sessions (driver_id, started_at desc);
create index if not exists idx_driver_sessions_bus on public.driver_sessions (bus_id, started_at desc);
create index if not exists idx_driver_sessions_status on public.driver_sessions (status);

-- RLS
alter table public.driver_sessions enable row level security;

revoke all on table public.driver_sessions from anon, authenticated;
grant insert, update, select on table public.driver_sessions to service_role;

drop policy if exists "Service role full access driver_sessions" on public.driver_sessions;
create policy "Service role full access driver_sessions" on public.driver_sessions
  for all to service_role using (true) with check (true);

-- Helper to start session
create or replace function public.start_driver_session(
  p_driver_id uuid,
  p_bus_id text,
  p_session_token text,
  p_device_info jsonb default null,
  p_ip_address inet default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session_id uuid;
begin
  -- End any existing active session for this driver
  update public.driver_sessions
  set status = 'ended', ended_at = now()
  where driver_id = p_driver_id and status = 'active';

  insert into public.driver_sessions (driver_id, bus_id, session_token_hash, device_info, ip_address, status)
  values (
    p_driver_id,
    p_bus_id,
    encode(digest(p_session_token, 'sha256'), 'hex'),
    p_device_info,
    p_ip_address,
    'active'
  )
  returning id into v_session_id;

  return v_session_id;
end;
$$;

revoke execute on function public.start_driver_session(uuid, text, text, jsonb, inet) from public, anon, authenticated;
grant execute on function public.start_driver_session(uuid, text, text, jsonb, inet) to service_role;

-- Helper to end session
create or replace function public.end_driver_session(p_driver_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.driver_sessions
  set status = 'ended', ended_at = now()
  where driver_id = p_driver_id and status = 'active';
end;
$$;

revoke execute on function public.end_driver_session(uuid) from public, anon, authenticated;
grant execute on function public.end_driver_session(uuid) to service_role;

-- Helper to record GPS ping
create or replace function public.record_driver_gps(p_driver_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.driver_sessions
  set last_gps_at = now(), gps_count = gps_count + 1
  where driver_id = p_driver_id and status = 'active';
end;
$$;

revoke execute on function public.record_driver_gps(uuid) from public, anon, authenticated;
grant execute on function public.record_driver_gps(uuid) to service_role;

-- ============================================================
-- 7. REFACTOR: linusku_settings to JSONB (flexible settings)
-- ============================================================
-- Create new table with JSONB
create table if not exists public.linusku_settings_v2 (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

-- Migrate existing data
insert into public.linusku_settings_v2 (key, value, updated_at)
select
  key,
  jsonb_build_object(
    'serviceDays', service_days,
    'openingTime', opening_time::text,
    'closingTime', closing_time::text,
    'timeZone', 'Asia/Jakarta'
  ),
  updated_at
from public.linusku_settings
where key = 'service'
on conflict (key) do nothing;

-- Add default configs
insert into public.linusku_settings_v2 (key, value) values
  ('eta', '{"minSpeedKmh": 12, "maxSpeedKmh": 80, "staleThresholdSeconds": 45}'::jsonb),
  ('map', '{"tileProvider": "carto_voyager", "fallbackToOsm": true}'::jsonb),
  ('features', '{"crowdReportingEnabled": true, "simulationMode": false, "maintenanceMode": false}'::jsonb),
  ('geofence', '{"campusBounds": {"minLat": 3.550, "maxLat": 3.575, "minLng": 98.648, "maxLng": 98.665}, "maxDistanceFromRouteKm": 0.3}'::jsonb)
on conflict (key) do nothing;

-- RLS
alter table public.linusku_settings_v2 enable row level security;

revoke all on table public.linusku_settings_v2 from anon, authenticated;
grant select on table public.linusku_settings_v2 to anon, authenticated;
grant all on table public.linusku_settings_v2 to service_role;

drop policy if exists "Public read linusku_settings_v2" on public.linusku_settings_v2;
create policy "Public read linusku_settings_v2" on public.linusku_settings_v2
  for select to anon, authenticated using (true);

drop policy if exists "Service role full access linusku_settings_v2" on public.linusku_settings_v2;
create policy "Service role full access linusku_settings_v2" on public.linusku_settings_v2
  for all to service_role using (true) with check (true);

-- Helper to get setting (with defaults)
create or replace function public.get_linusku_setting(p_key text, p_default jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_value jsonb;
begin
  select value into v_value from public.linusku_settings_v2 where key = p_key;
  if v_value is null then
    return p_default;
  end if;
  return v_value;
end;
$$;

revoke execute on function public.get_linusku_setting(text, jsonb) from public, anon, authenticated;
grant execute on function public.get_linusku_setting(text, jsonb) to anon, authenticated, service_role;

-- Helper to update setting
create or replace function public.set_linusku_setting(p_key text, p_value jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.linusku_settings_v2 (key, value, updated_at)
  values (p_key, p_value, now())
  on conflict (key) do update set
    value = excluded.value,
    updated_at = excluded.updated_at;
end;
$$;

revoke execute on function public.set_linusku_setting(text, jsonb) from public, anon, authenticated;
grant execute on function public.set_linusku_setting(text, jsonb) to service_role;

-- ============================================================
-- 8. ADD: Unique constraint on plate_number (where not null)
-- ============================================================
alter table public.buses
  drop constraint if exists unique_plate_number;

create unique index if not exists unique_plate_number
  on public.buses (plate_number)
  where plate_number is not null;

-- ============================================================
-- 9. ADD: pg_cron job for crowd_reports cleanup (24h TTL)
-- ============================================================
do $$
declare
  job_id bigint;
begin
  for job_id in
    select cron_job.jobid
    from cron.job as cron_job
    where cron_job.jobname in (
      'linusku-cleanup-crowd-reports',
      'linusku-cleanup-position-history',
      'linusku-cleanup-driver-sessions'
    )
  loop
    perform cron.unschedule(job_id);
  end loop;

  perform cron.schedule(
    'linusku-cleanup-crowd-reports',
    '0 3 * * *',
    'delete from public.crowd_reports where created_at < now() - interval ''24 hours'''
  );
  perform cron.schedule(
    'linusku-cleanup-position-history',
    '0 4 * * *',
    'delete from public.bus_position_history where recorded_at < now() - interval ''30 days'''
  );
  perform cron.schedule(
    'linusku-cleanup-driver-sessions',
    '0 5 * * *',
    'update public.driver_sessions set status = ''expired'', ended_at = now() where status = ''active'' and coalesce(last_gps_at, started_at) < now() - interval ''2 hours'''
  );
end;
$$;

-- ============================================================
-- 10. ADD: Geofence using PostGIS (optional - requires PostGIS extension)
-- ============================================================
-- Uncomment if PostGIS is enabled in Supabase
-- create extension if not exists postgis;
--
-- alter table public.stops
--   add column if not exists geom geometry(Point, 4326);
--
-- update public.stops set geom = ST_SetSRID(ST_MakePoint(lng, lat), 4326)
-- where geom is null;
--
-- create index if not exists idx_stops_geom on public.stops using gist (geom);
--
-- -- Campus polygon (approximate boundary)
-- create table if not exists public.campus_geofence (
--   id integer primary key default 1,
--   name text not null default 'USU Padang Bulan',
--   boundary geometry(Polygon, 4326) not null
-- );
--
-- insert into public.campus_geofence (id, name, boundary) values (
--   1, 'USU Padang Bulan',
--   ST_GeomFromText('POLYGON((
--     98.648 3.550,
--     98.665 3.550,
--     98.665 3.575,
--     98.648 3.575,
--     98.648 3.550
--   ))', 4326)
-- ) on conflict (id) do update set boundary = excluded.boundary;
--
-- -- Function to check if point is inside campus
-- create or replace function public.is_inside_campus_postgis(p_lat double precision, p_lng double precision)
-- returns boolean
-- language plpgsql
-- security definer
-- set search_path = ''
-- as $$
-- declare
--   v_point geometry;
--   v_boundary geometry;
-- begin
--   v_point := ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326);
--   select boundary into v_boundary from public.campus_geofence where id = 1;
--   return ST_Contains(v_boundary, v_point);
-- end;
-- $$;
--
-- revoke execute on function public.is_inside_campus_postgis(double precision, double precision) from public, anon, authenticated;
-- grant execute on function public.is_inside_campus_postgis(double precision, double precision) to service_role;

-- ============================================================
-- 11. UPDATE: validate_bus_position trigger to use settings for speed limits
-- ============================================================
drop trigger if exists validate_stops_sequence_trigger on public.stops;
drop function if exists public.validate_stops_sequence();

create or replace function public.validate_bus_position()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  elapsed_seconds double precision;
  distance_km double precision;
  implied_speed_kmh double precision;
  v_max_speed double precision;
  v_min_lat double precision;
  v_max_lat double precision;
  v_min_lng double precision;
  v_max_lng double precision;
begin
  -- Get max speed from settings (default 80)
  select coalesce(
    (value->>'maxSpeedKmh')::double precision,
    (value->>'max_speed_kmh')::double precision
  ) into v_max_speed
  from public.linusku_settings_v2 where key = 'eta';
  if v_max_speed is null then v_max_speed := 80; end if;

  select
    coalesce(
      (value->'campusBounds'->>'minLat')::double precision,
      (value->'campus_bounds'->>'min_lat')::double precision,
      3.550
    ),
    coalesce(
      (value->'campusBounds'->>'maxLat')::double precision,
      (value->'campus_bounds'->>'max_lat')::double precision,
      3.575
    ),
    coalesce(
      (value->'campusBounds'->>'minLng')::double precision,
      (value->'campus_bounds'->>'min_lng')::double precision,
      98.648
    ),
    coalesce(
      (value->'campusBounds'->>'maxLng')::double precision,
      (value->'campus_bounds'->>'max_lng')::double precision,
      98.665
    )
  into v_min_lat, v_max_lat, v_min_lng, v_max_lng
  from public.linusku_settings_v2
  where key = 'geofence';

  if v_min_lat is null then v_min_lat := 3.550; end if;
  if v_max_lat is null then v_max_lat := 3.575; end if;
  if v_min_lng is null then v_min_lng := 98.648; end if;
  if v_max_lng is null then v_max_lng := 98.665; end if;

  if new.lat < v_min_lat or new.lat > v_max_lat or
     new.lng < v_min_lng or new.lng > v_max_lng then
    raise exception 'Posisi bus berada di luar area kampus yang dikonfigurasi';
  end if;

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

    if implied_speed_kmh > v_max_speed then
      raise exception 'Perubahan posisi melebihi batas kecepatan (%)', v_max_speed;
    end if;
  end if;

  return new;
end;
$$;

revoke execute on function public.validate_bus_position() from public, anon, authenticated;
grant execute on function public.validate_bus_position() to service_role;

drop trigger if exists validate_bus_position_before_write on public.bus_positions;
create trigger validate_bus_position_before_write
before insert or update of lat, lng, speed_kmh, heading, occupancy, source_type, updated_at
on public.bus_positions
for each row execute function public.validate_bus_position();

-- ============================================================
-- COMPLETION MESSAGE
-- ============================================================
-- Verify migration:
-- select * from public.linusku_settings_v2;
-- select jobname, schedule from cron.job where jobname like 'linusku-%';
-- select * from public.admin_audit_log limit 1;