create table if not exists public.linusku_admin_users (
  email text primary key,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.linusku_admin_users enable row level security;
revoke all on table public.linusku_admin_users from anon, authenticated;
grant select, insert, update, delete on table public.linusku_admin_users to service_role;

insert into public.linusku_admin_users (email, active)
values
  ('kampuskitaapp@gmail.com', true),
  ('jualbeliusupolmed@gmail.com', true)
on conflict (email) do nothing;

create table if not exists public.driver_access_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  full_name text not null,
  phone text,
  notes text,
  requested_bus_id text references public.buses(id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_driver_access_requests_status
  on public.driver_access_requests (status, created_at desc);

alter table public.driver_access_requests enable row level security;
revoke all on table public.driver_access_requests from anon, authenticated;
grant select, insert, update, delete on table public.driver_access_requests to service_role;

drop policy if exists "Service role full access driver_access_requests" on public.driver_access_requests;
create policy "Service role full access driver_access_requests"
  on public.driver_access_requests
  for all to service_role
  using (true)
  with check (true);

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  endpoint text not null unique,
  subscription jsonb not null,
  stop_id text references public.stops(id) on delete cascade,
  threshold_minutes integer not null default 5 check (threshold_minutes between 1 and 60),
  locale text not null default 'id-ID',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_push_subscriptions_stop
  on public.push_subscriptions (stop_id)
  where stop_id is not null;

alter table public.push_subscriptions enable row level security;
revoke all on table public.push_subscriptions from anon, authenticated;
grant select, insert, update, delete on table public.push_subscriptions to service_role;

drop policy if exists "Service role full access push_subscriptions" on public.push_subscriptions;
create policy "Service role full access push_subscriptions"
  on public.push_subscriptions
  for all to service_role
  using (true)
  with check (true);

do $$
declare
  duplicate_bus record;
begin
  for duplicate_bus in
    select driver_id
    from public.buses
    where driver_id is not null
    group by driver_id
    having count(*) > 1
  loop
    raise notice 'LINUSKU: driver % memiliki lebih dari satu armada; penugasan tambahan dilepas', duplicate_bus.driver_id;
  end loop;
end;
$$;

with ranked as (
  select
    id,
    row_number() over (
      partition by driver_id
      order by created_at asc, id asc
    ) as assignment_rank
  from public.buses
  where driver_id is not null
)
update public.buses
set driver_id = null
where id in (
  select id
  from ranked
  where assignment_rank > 1
);

create unique index if not exists unique_buses_driver_id
  on public.buses (driver_id)
  where driver_id is not null;

insert into public.linusku_settings_v2 (key, value, updated_at)
values (
  'schedule',
  '{"firstDepartureTime":"07:00","lastDepartureTime":"17:00","headwayMinutes":15,"timeZone":"Asia/Jakarta"}'::jsonb,
  now()
)
on conflict (key) do nothing;

update public.linusku_settings_v2
set
  value = value || jsonb_build_object(
    'averageDwellSeconds', coalesce((value->>'averageDwellSeconds')::int, 30),
    'trafficMultiplier', coalesce((value->>'trafficMultiplier')::numeric, 1.15),
    'confidenceThresholdSeconds', coalesce((value->>'confidenceThresholdSeconds')::int, 120)
  ),
  updated_at = now()
where key = 'eta';

update public.linusku_settings_v2
set
  value = value || jsonb_build_object(
    'pushNotificationsEnabled', coalesce((value->>'pushNotificationsEnabled')::boolean, true),
    'driverAccessRequestsEnabled', coalesce((value->>'driverAccessRequestsEnabled')::boolean, true)
  ),
  updated_at = now()
where key = 'features';

create or replace function public.set_linusku_settings(p_values jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  category text;
  result jsonb := '{}'::jsonb;
begin
  if p_values is null or jsonb_typeof(p_values) <> 'object' then
    raise exception 'Pengaturan harus berupa objek JSON.';
  end if;

  for category in select jsonb_object_keys(p_values)
  loop
    insert into public.linusku_settings_v2 (key, value, updated_at)
    values (category, p_values -> category, now())
    on conflict (key) do update
      set value = excluded.value,
          updated_at = excluded.updated_at;

    result := result || jsonb_build_object(
      category,
      jsonb_build_object(
        'value', p_values -> category,
        'updated_at', now()
      )
    );
  end loop;

  return result;
end;
$$;

revoke all on function public.set_linusku_settings(jsonb) from public, anon, authenticated;
grant execute on function public.set_linusku_settings(jsonb) to service_role;
