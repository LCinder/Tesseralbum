-- Tesseralbum · Postgres index, kept for phase 5
-- Run in the Supabase SQL Editor, or with `supabase db push`.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

-- Allowlist of editors. Today it holds one row: you.
create table if not exists public.owners (
  user_id  uuid primary key references auth.users on delete cascade,
  email    text not null,
  added_at timestamptz not null default now()
);

-- A point on the map. Shared across trips.
create table if not exists public.places (
  id           uuid primary key default gen_random_uuid(),
  city         text not null,
  country      text not null,
  country_code char(2) not null,
  lat          double precision not null,
  lng          double precision not null,
  drive_folder text,
  created_at   timestamptz not null default now(),
  unique (city, country)
);

-- The physical object. One NFC chip, one secret slug.
create table if not exists public.tags (
  id             uuid primary key default gen_random_uuid(),
  slug           text not null unique,
  souvenir       text not null,
  souvenir_photo text,
  place_id       uuid not null references public.places on delete restrict,
  active         boolean not null default true,
  last_scan_at   timestamptz,
  scan_count     integer not null default 0,
  created_at     timestamptz not null default now()
);

create index if not exists tags_place_idx on public.tags (place_id);

-- One stay. This is what gets shown as an album.
create table if not exists public.trips (
  id           uuid primary key default gen_random_uuid(),
  place_id     uuid not null references public.places on delete cascade,
  title        text not null,
  year         smallint not null,
  start_date   date,
  end_date     date,
  notes        text,
  drive_folder text,
  cover_id     uuid,
  created_at   timestamptz not null default now()
);

create index if not exists trips_place_idx on public.trips (place_id, year desc);

-- Every photo or video. The table the gallery and the map read from.
create table if not exists public.media (
  id            uuid primary key default gen_random_uuid(),
  trip_id       uuid not null references public.trips on delete cascade,
  tag_id        uuid references public.tags on delete set null,
  drive_file_id text not null,
  sha256        text not null unique,
  kind          text not null check (kind in ('photo','video')),
  mime          text not null,
  bytes         bigint not null,
  width         integer,
  height        integer,
  duration_s    integer,
  taken_at      timestamptz,
  lat           double precision,
  lng           double precision,
  geo_source    text not null default 'none'
                check (geo_source in ('exif','tag','manual','none')),
  thumb_path    text not null,
  caption       text,
  created_at    timestamptz not null default now()
);

create index if not exists media_trip_idx on public.media (trip_id, taken_at desc);
create index if not exists media_geo_idx  on public.media (lat, lng) where lat is not null;

-- A trip cover is one of its own photos. Added separately because `media`
-- did not exist yet when `trips` was created.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'trips_cover_fk'
  ) then
    alter table public.trips
      add constraint trips_cover_fk
      foreign key (cover_id) references public.media on delete set null;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Authorization
-- ---------------------------------------------------------------------------

-- `security definer` so the check does not depend on the policies of the
-- `owners` table itself and end up chasing its own tail.
create or replace function public.is_owner()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.owners o where o.user_id = auth.uid()
  );
$$;

revoke all on function public.is_owner() from public;
grant execute on function public.is_owner() to authenticated, anon;

alter table public.owners enable row level security;
alter table public.places enable row level security;
alter table public.tags   enable row level security;
alter table public.trips  enable row level security;
alter table public.media  enable row level security;

-- Deny-all by default: with no policy, nobody gets through. Only the editor
-- has direct access. Visitor reads go through the service client, which
-- bypasses RLS and enforces its own rules in `src/lib/data.ts`.
drop policy if exists owners_self_read on public.owners;
create policy owners_self_read on public.owners
  for select using (user_id = auth.uid());

drop policy if exists places_owner_all on public.places;
create policy places_owner_all on public.places
  for all using (public.is_owner()) with check (public.is_owner());

drop policy if exists tags_owner_all on public.tags;
create policy tags_owner_all on public.tags
  for all using (public.is_owner()) with check (public.is_owner());

drop policy if exists trips_owner_all on public.trips;
create policy trips_owner_all on public.trips
  for all using (public.is_owner()) with check (public.is_owner());

drop policy if exists media_owner_all on public.media;
create policy media_owner_all on public.media
  for all using (public.is_owner()) with check (public.is_owner());

-- ---------------------------------------------------------------------------
-- Counters
-- ---------------------------------------------------------------------------

-- Incrementing in SQL avoids the read-add-write race when two phones scan the
-- same souvenir at once.
create or replace function public.record_scan(tag uuid)
returns void
language sql
volatile
security definer
set search_path = public
as $$
  update public.tags
     set scan_count = scan_count + 1,
         last_scan_at = now()
   where id = tag;
$$;

revoke all on function public.record_scan(uuid) from public;
grant execute on function public.record_scan(uuid) to service_role;
