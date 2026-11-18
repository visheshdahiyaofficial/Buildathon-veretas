-- CrisisPulse schema. Run once in the Supabase SQL editor.
create extension if not exists postgis;
create extension if not exists vector;

-- People allowed to use the dashboard.
create table if not exists dashboard_admins (
  user_id uuid primary key references auth.users (id) on delete cascade
);

create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from dashboard_admins where user_id = auth.uid());
$$;

create table if not exists clusters (
  id uuid primary key default gen_random_uuid(),
  lat double precision not null,
  lng double precision not null,
  radius_m double precision not null default 0,
  report_count int not null default 0,
  disaster_type text not null default 'other',
  severity int not null default 1 check (severity between 1 and 5),
  people_count int not null default 0,
  trapped_count int not null default 0,
  trapped_confirmed int not null default 0,
  trapped_reported_max int not null default 0,
  children_count int not null default 0,
  injured_count int not null default 0,
  needs text[] not null default '{}',
  hazards text[] not null default '{}',
  title text not null default '',
  summary text not null default '',
  member_hash text not null default '',
  status text not null default 'new' check (status in ('new', 'dispatched', 'resolved')),
  first_report_at timestamptz not null default now(),
  last_report_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  client_id text not null,
  created_at timestamptz not null default now(),
  reported_at timestamptz not null default now(),
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  location geography(point, 4326) generated always as (st_setsrid(st_makepoint(lng, lat), 4326)::geography) stored,
  accuracy_m double precision,
  disaster_type text not null default 'other',
  about text not null default 'self' check (about in ('self', 'others')),
  text text not null default '' check (char_length(text) <= 4000),
  people_count int check (people_count >= 0),
  trapped_count int not null default 0 check (trapped_count >= 0),
  has_children boolean not null default false,
  injured_count int not null default 0 check (injured_count >= 0),
  needs text[] not null default '{}',
  photo_paths text[] not null default '{}' check (cardinality(photo_paths) <= 3),
  -- Filled in by the AI worker:
  extracted jsonb,
  embedding vector(768),
  cluster_id uuid references clusters (id) on delete set null,
  processed_at timestamptz,
  unique (user_id, client_id) -- offline retries never create duplicates
);

create index if not exists reports_location_idx on reports using gist (location);
create index if not exists reports_unprocessed_idx on reports (created_at) where processed_at is null;
create index if not exists reports_cluster_idx on reports (cluster_id);

-- Row-level security: phones can add reports and read only their own;
-- admins read everything; the worker uses the service-role key (bypasses RLS).
alter table reports enable row level security;
alter table clusters enable row level security;
alter table dashboard_admins enable row level security;

create policy "reporters insert own" on reports for insert to authenticated
  with check (user_id = auth.uid() and extracted is null and cluster_id is null and processed_at is null);
create policy "reporters read own" on reports for select to authenticated
  using (user_id = auth.uid() or is_admin());

create policy "admins read clusters" on clusters for select to authenticated using (is_admin());
create policy "admins update cluster status" on clusters for update to authenticated
  using (is_admin()) with check (is_admin());

create policy "admins see admins" on dashboard_admins for select to authenticated using (is_admin());

-- Private photo bucket. Files go in <user_id>/<client_id>/<n>.jpg
insert into storage.buckets (id, name, public) values ('report-photos', 'report-photos', false)
on conflict (id) do nothing;

create policy "reporters upload own photos" on storage.objects for insert to authenticated
  with check (bucket_id = 'report-photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "admins read photos" on storage.objects for select to authenticated
  using (bucket_id = 'report-photos' and (is_admin() or (storage.foldername(name))[1] = auth.uid()::text));

-- Live updates for the dashboard and the worker.
alter publication supabase_realtime add table reports;
alter publication supabase_realtime add table clusters;
