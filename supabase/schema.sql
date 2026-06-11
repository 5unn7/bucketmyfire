-- bucketmyfire — global leaderboard schema (Supabase / Postgres).
--
-- Paste this whole file into the Supabase SQL editor (Dashboard → SQL Editor → New query)
-- and run it once. It is idempotent — safe to re-run after edits.
--
-- Design:
--   * `scores` holds one row per submitted winning run. Anyone (the anon key) may INSERT a
--     run and SELECT the board, but never UPDATE or DELETE — enforced by row-level security.
--   * Input is bounded by CHECK constraints so a tampered client can't store absurd values
--     (this is light anti-griefing, not real anti-cheat — a determined client can still post a
--     plausible-but-fake score; acceptable for a casual arcade board).
--   * Two read-only views power the UI:
--       - `mission_best`   — each pilot's BEST run per mission (so one player can't flood a board)
--       - `career_totals`  — per pilot, the sum of their best-per-mission scores (the overall board)

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------
create table if not exists public.scores (
  id          bigint generated always as identity primary key,
  pilot       text        not null,
  mission_id  text        not null,
  score       integer     not null,
  time_s      real,                                   -- mission elapsed seconds at the win (nullable)
  client_id   text,                                   -- anonymous per-device id (for "your rank" highlight)
  created_at  timestamptz not null default now(),

  constraint scores_pilot_len      check (char_length(pilot) between 1 and 24),
  constraint scores_mission_len    check (char_length(mission_id) between 1 and 40),
  constraint scores_score_range    check (score >= 0 and score <= 1000000),
  constraint scores_time_range     check (time_s is null or (time_s >= 0 and time_s <= 86400)),
  constraint scores_client_len     check (client_id is null or char_length(client_id) <= 64)
);

-- Fast "top N for a mission" reads.
create index if not exists scores_mission_score_idx on public.scores (mission_id, score desc);
-- Supports submit_score()'s upsert lookup (this device's run of a mission) + its per-device throttle count.
create index if not exists scores_upsert_idx        on public.scores (mission_id, pilot, client_id);
create index if not exists scores_client_recent_idx on public.scores (client_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Row-level security: anon can READ everything; writes route through the submit_score RPC below.
-- ---------------------------------------------------------------------------
-- Direct anon INSERT was REMOVED (the legacy "anyone can insert" policy is dropped, not recreated):
-- with the public anon key in the static bundle, an open insert grant lets anyone script an unbounded
-- flood of rows (free-tier exhaustion / fake-board spam), and the live board pushes a running score
-- every ~45s — so even an HONEST endless session piled up a row per tick. The SECURITY DEFINER
-- submit_score() function (below) is now the only write door: it UPSERTS one row per (mission, pilot,
-- device) keeping the player's MAX, throttles per device, and clamps the range.
alter table public.scores enable row level security;

drop policy if exists "scores: anyone can read"   on public.scores;
drop policy if exists "scores: anyone can insert" on public.scores; -- migrate a live project off the open insert

create policy "scores: anyone can read"
  on public.scores for select
  using (true);

-- No INSERT / UPDATE / DELETE policies → all writes are denied for the anon role; the RPC is the door.

-- ---------------------------------------------------------------------------
-- Views — each pilot's best run per mission, and career totals.
-- security_invoker so the views respect the caller's RLS (Postgres 15+; Supabase is current).
-- ---------------------------------------------------------------------------
create or replace view public.mission_best
  with (security_invoker = true) as
  select distinct on (mission_id, pilot)
    mission_id,
    pilot,
    score,
    time_s,
    client_id,
    created_at
  from public.scores
  order by mission_id, pilot, score desc, time_s asc nulls last, created_at asc;

create or replace view public.career_totals
  with (security_invoker = true) as
  select
    pilot,
    sum(score)::bigint as total,
    count(*)           as missions,
    max(created_at)    as last_seen
  from public.mission_best
  group by pilot
  order by total desc;

-- ---------------------------------------------------------------------------
-- Grants — make the table + views reachable through the auto REST API for the
-- public (anon) role. RLS still applies to the table; the views inherit it.
-- ---------------------------------------------------------------------------
grant usage on schema public to anon;
grant select on public.scores to anon;          -- READ only; writes go through submit_score() below
-- Explicitly revoke the legacy direct INSERT grant so re-applying fully migrates an already-live
-- project off direct anon inserts (the dropped policy already denies them under RLS; this is belt + braces).
revoke insert on public.scores from anon;
grant select on public.mission_best to anon;
grant select on public.career_totals to anon;

-- ---------------------------------------------------------------------------
-- Score submission — the ONLY write path into public.scores (direct anon INSERT was revoked above).
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER (writes past RLS as the table owner), mirroring submit_lead. Three jobs:
--   • UPSERT-keep-MAX per (mission_id, pilot, client_id): the live board pushes the running score
--     every ~45s, so this updates ONE row in place instead of appending hundreds over a long session,
--     and a lower late submit never overwrites a better earlier one (mission_best already takes the max).
--   • THROTTLE new rows per device (30/hour) so a scripted client can't mint unbounded fake-pilot rows.
--   • CLAMP the score to [0, 1e6] + time to [0, 86400] server-side.
-- NOTE: this is light anti-griefing, NOT anti-cheat. The game is 100% client-side, so a determined
-- client can still post a plausible-but-fake score under its own callsign — only server-authoritative
-- play could prevent that, which this project deliberately does not do. Standard definer hardening:
-- empty search_path + schema-qualified refs.
create or replace function public.submit_score(
  p_pilot text, p_mission_id text, p_score integer, p_time_s real, p_client_id text
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pilot   text    := left(coalesce(p_pilot, ''), 24);
  v_mission text    := left(coalesce(p_mission_id, ''), 40);
  v_score   integer := greatest(0, least(1000000, coalesce(p_score, 0)));
  v_time    real    := case when p_time_s is null then null else greatest(0, least(86400, p_time_s)) end;
  v_client  text    := left(coalesce(p_client_id, ''), 64);
  v_recent  int;
begin
  if char_length(v_pilot) < 1 or char_length(v_mission) < 1 then
    return false;
  end if;

  -- Upsert-keep-MAX for THIS device's run of this mission: update in place (no new row), so the 45s
  -- board cadence can't grow the table and a lower late submit never replaces a better earlier one.
  update public.scores
     set score      = greatest(score, v_score),
         time_s     = coalesce(v_time, time_s),
         created_at = now()
   where mission_id = v_mission and pilot = v_pilot and coalesce(client_id, '') = v_client;
  if found then
    return true;
  end if;

  -- A genuinely NEW (mission, pilot, device) row: throttle per device. An honest player creates a
  -- handful; a scripted flood varying pilot/mission is capped. Accept-but-drop over the cap (no insert)
  -- so a flooder can't probe the limit and an honest player never sees an error.
  if v_client <> '' then
    select count(*) into v_recent
      from public.scores
     where client_id = v_client
       and created_at > now() - interval '1 hour';
    if v_recent >= 30 then
      return true;
    end if;
  end if;

  insert into public.scores (pilot, mission_id, score, time_s, client_id)
  values (v_pilot, v_mission, v_score, v_time, nullif(v_client, ''));
  return true;
end;
$$;

-- Only anon may call the narrow RPC; the table itself stays read-only to anon.
revoke all on function public.submit_score(text, text, integer, real, text) from public;
grant execute on function public.submit_score(text, text, integer, real, text) to anon;

-- ===========================================================================
-- Cloud saves — passwordless "name + email" progress sync (optional, no auth).
-- ===========================================================================
-- Lets a pilot restore their campaign progress (unlocks, best scores, chosen
-- heli/callsign) on a new device or after clearing their browser, by entering
-- their pilot name + email. There are NO passwords and NO Supabase Auth.
--
-- Privacy: the email is hashed CLIENT-SIDE (SHA-256) before it ever leaves the
-- browser, so this table only ever stores an opaque hash — it can never leak a
-- plaintext email. The table is fully locked (RLS on, ZERO policies, all privs
-- revoked); the ONLY way in is the two SECURITY DEFINER RPCs below, each of which
-- requires the caller to already know the email (to produce the hash) + the exact
-- pilot name. Rows therefore can't be enumerated or scraped through the REST API.
--
-- Threat model (accept for a casual arcade game): anyone who knows BOTH your email
-- and your callsign could load/overwrite that save. The stakes are game progress
-- only; this is the "lightweight, no verification" model the project opted into.

create table if not exists public.cloud_saves (
  id          bigint generated always as identity primary key,
  email_hash  text        not null,                  -- client-side SHA-256 hex (never the raw email)
  pilot       text        not null,
  save        jsonb       not null,                  -- versioned progress+profile envelope
  updated_at  timestamptz not null default now(),

  constraint cloud_saves_hash_len  check (char_length(email_hash) between 16 and 128),
  constraint cloud_saves_pilot_len check (char_length(pilot) between 1 and 24),
  constraint cloud_saves_save_size check (pg_column_size(save) <= 32768)   -- ~32KB cap (anti-abuse)
);

-- Anonymous per-device id (NOT PII — same opaque id leads/scores use), kept only to throttle NEW-save
-- creation per device in save_cloud_progress(). Added idempotently so re-applying migrates a live table.
alter table public.cloud_saves add column if not exists client_id text;

-- One save per (email, pilot) — a shared family email can still hold several distinct pilots.
create unique index if not exists cloud_saves_key
  on public.cloud_saves (email_hash, lower(pilot));
-- Supports the per-device new-save throttle lookup in save_cloud_progress().
create index if not exists cloud_saves_client_recent_idx on public.cloud_saves (client_id, updated_at desc);

alter table public.cloud_saves enable row level security;
-- No policies + revoke = anon/authenticated have NO direct table access. The RPCs are the only door.
revoke all on public.cloud_saves from anon, authenticated;

-- Upsert a save. SECURITY DEFINER writes past RLS; empty search_path + schema-qualified refs are
-- the standard hardening for definer functions. `p_client_id` (anonymous per-device id) THROTTLES
-- NEW-save creation per device so the public anon key can't be scripted to mint unbounded distinct
-- saves (each ≤32KB) by varying the email_hash — your OWN re-save (an update of an existing row) is
-- never throttled. It has a DEFAULT so an un-updated client (the old 3-arg call) still resolves.
-- The signature changed (added p_client_id), so the prior 3-arg overload is dropped first.
drop function if exists public.save_cloud_progress(text, text, jsonb);
create or replace function public.save_cloud_progress(
  p_email_hash text, p_pilot text, p_save jsonb, p_client_id text default ''
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ts     timestamptz;
  v_client text := left(coalesce(p_client_id, ''), 64);
  v_recent int;
begin
  if p_email_hash is null or char_length(p_email_hash) not between 16 and 128 then
    raise exception 'invalid email_hash';
  end if;
  if p_pilot is null or char_length(p_pilot) not between 1 and 24 then
    raise exception 'invalid pilot';
  end if;
  if p_save is null or pg_column_size(p_save) > 32768 then
    raise exception 'invalid save';
  end if;

  -- Update an existing save in place (your own re-save / auto-sync) — always allowed, never throttled.
  update public.cloud_saves
     set save = p_save, pilot = p_pilot, client_id = coalesce(nullif(v_client, ''), client_id), updated_at = now()
   where email_hash = p_email_hash and lower(pilot) = lower(p_pilot)
   returning updated_at into v_ts;
  if found then
    return v_ts;
  end if;

  -- A genuinely NEW (email_hash, pilot) save: throttle per device (10/hour) so a scripted client can't
  -- flood distinct rows to exhaust the free-tier row budget. Far above any real use (a person saves one
  -- or two pilots). Over the cap → raise, so the client surfaces "try again" rather than silently losing it.
  if v_client <> '' then
    select count(*) into v_recent
      from public.cloud_saves
     where client_id = v_client
       and updated_at > now() - interval '1 hour';
    if v_recent >= 10 then
      raise exception 'rate limited';
    end if;
  end if;

  insert into public.cloud_saves (email_hash, pilot, save, client_id, updated_at)
  values (p_email_hash, p_pilot, p_save, nullif(v_client, ''), now())
  returning updated_at into v_ts;

  return v_ts;
end;
$$;

-- Fetch a save by email-hash + pilot (case-insensitive). Returns 0 or 1 row.
create or replace function public.load_cloud_progress(p_email_hash text, p_pilot text)
returns table (save jsonb, pilot text, updated_at timestamptz)
language sql
security definer
set search_path = ''
as $$
  select s.save, s.pilot, s.updated_at
  from public.cloud_saves s
  where s.email_hash = p_email_hash
    and lower(s.pilot) = lower(p_pilot)
  limit 1;
$$;

-- Only anon may call the two narrow RPCs; nothing else is exposed.
revoke all on function public.save_cloud_progress(text, text, jsonb, text) from public;
revoke all on function public.load_cloud_progress(text, text)              from public;
grant execute on function public.save_cloud_progress(text, text, jsonb, text) to anon;
grant execute on function public.load_cloud_progress(text, text)              to anon;

-- ===========================================================================
-- Crash / error telemetry — locked table, written ONLY by the `report-error`
-- Edge Function (supabase/functions/report-error). See src/three/telemetry/errorBeacon.ts.
-- ===========================================================================
-- The game POSTs uncaught errors + unhandled rejections (PII-free: error name/message, a trimmed
-- stack, the path, WebGL availability, viewport, user-agent) to the Edge Function, which inserts
-- here using the service role. The table is fully locked to anon/authenticated — like cloud_saves,
-- the only door is the function — so error rows can't be enumerated or written through the REST API.

create table if not exists public.client_errors (
  id          bigint generated always as identity primary key,
  kind        text        not null,                  -- 'error' | 'unhandledrejection'
  name        text        not null,                  -- error constructor name
  message     text        not null,
  stack       text,                                  -- first few frames, trimmed
  path        text,                                  -- location.pathname (never the query string)
  ua          text,                                  -- navigator.userAgent
  meta        jsonb,                                 -- { webgl2, dpr, vw, vh }
  created_at  timestamptz not null default now(),

  constraint client_errors_kind_len    check (char_length(kind) <= 40),
  constraint client_errors_name_len    check (char_length(name) <= 120),
  constraint client_errors_message_len check (char_length(message) <= 500),
  constraint client_errors_stack_len   check (stack is null or char_length(stack) <= 2000),
  constraint client_errors_path_len    check (path  is null or char_length(path)  <= 200),
  constraint client_errors_ua_len      check (ua    is null or char_length(ua)    <= 400)
);

create index if not exists client_errors_created_idx on public.client_errors (created_at desc);

alter table public.client_errors enable row level security;
-- No policies + revoke = anon/authenticated have NO direct access. The Edge Function (service role)
-- is the only writer; the project owner reads it from the dashboard.
revoke all on public.client_errors from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Hardening (security advisor 0028/0029): the rls_auto_enable() event-trigger function (it
-- auto-enables RLS on newly created public tables) was reachable by the anon/authenticated roles
-- via PostgREST RPC. An event-trigger function is invoked by the trigger mechanism, never by a
-- direct EXECUTE, so revoke the API roles' grant to drop it from the public API (no behavior change).
-- Guarded so this file still runs cleanly on a project where that function was never created.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'rls_auto_enable'
  ) then
    execute 'revoke execute on function public.rls_auto_enable() from anon, authenticated, public';
  end if;
end $$;

-- ===========================================================================
-- Leads — marketing/notify signups (Squadron Store waitlist, co-op interest, etc.)
-- ===========================================================================
-- UNLIKE cloud_saves (which hashes the email so we can never contact the player), this table
-- intentionally stores a PLAINTEXT, emailable address — its whole purpose is to let us reach a
-- player when a teased feature ships. This is an explicit, consented signup — the player typed
-- their email into a "Notify me" field — so storing it plaintext is appropriate.
--
-- The table is FULLY LOCKED (RLS on, ZERO policies, all privs revoked) exactly like `cloud_saves`
-- and `client_errors`: the ONLY door is the SECURITY DEFINER `submit_lead` RPC below. Direct anon
-- INSERT was removed deliberately — with the public anon key in the static bundle, an open insert
-- grant lets anyone script an unbounded flood of rows (free-tier row-budget exhaustion / junk
-- data). Routing through the RPC lets the server VALIDATE, DEDUPE, and THROTTLE before any write.

create table if not exists public.leads (
  id          bigint generated always as identity primary key,
  email       text        not null,
  source      text,                                   -- where the signup came from: 'shop' | 'coop' | ...
  pilot       text,                                   -- the player's callsign at signup (optional)
  client_id   text,                                   -- anonymous per-device id (dedupe aid)
  created_at  timestamptz not null default now(),

  constraint leads_email_len    check (char_length(email) between 5 and 254),
  constraint leads_email_fmt    check (email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  constraint leads_source_len   check (source    is null or char_length(source)    <= 24),
  constraint leads_pilot_len    check (pilot     is null or char_length(pilot)     <= 24),
  constraint leads_client_len   check (client_id is null or char_length(client_id) <= 64)
);

create index if not exists leads_created_idx on public.leads (created_at desc);
-- Supports the throttle lookups in submit_lead (recent rows by device, and the email dedupe).
create index if not exists leads_client_recent_idx on public.leads (client_id, created_at desc);
create index if not exists leads_email_lower_idx    on public.leads (lower(email));

alter table public.leads enable row level security;
-- Drop the legacy open-insert policy (this table shipped with anon direct-insert before it was
-- locked behind the RPC) so re-applying this file fully migrates an already-live project.
drop policy if exists "leads: anyone can insert" on public.leads;
-- No policies + revoke = anon/authenticated have NO direct table access. The RPC is the only door.
revoke all on public.leads from anon, authenticated;

-- Capture a marketing/notify lead. SECURITY DEFINER writes past RLS; the function VALIDATES the
-- email, DEDUPES (a known email just refreshes its row), and THROTTLES per device + per email so a
-- scripted client can't flood the table. Returns true when the signup is accepted (whether it
-- inserted, refreshed, or was silently throttled — the caller only needs "we got it"); false only
-- on a malformed email. Standard definer hardening: empty search_path + schema-qualified refs.
create or replace function public.submit_lead(
  p_email text, p_source text, p_pilot text, p_client_id text
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email  text := lower(trim(p_email));
  v_recent int;
  v_exists boolean;
begin
  -- Validate format/length (mirrors the table CHECKs so a bad input is rejected, not raised).
  if v_email is null
     or char_length(v_email) not between 5 and 254
     or v_email !~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    return false;
  end if;

  -- Dedupe: a returning email just touches its newest row's timestamp — no pile of duplicates.
  update public.leads
     set created_at = now(),
         source     = coalesce(left(p_source, 24), source),
         pilot      = coalesce(nullif(left(p_pilot, 24), ''), pilot)
   where lower(email) = v_email
     and id = (select max(id) from public.leads where lower(email) = v_email);
  if found then
    return true;
  end if;

  -- Throttle a NEW email: cap fresh signups per device to 5/hour (NULL client_id → global-ish
  -- guard on the email itself, already deduped above). Over the cap → accept-but-drop (no insert),
  -- so an attacker can't tell they're throttled and a real user never sees an error.
  if p_client_id is not null then
    select count(*) into v_recent
      from public.leads
     where client_id = left(p_client_id, 64)
       and created_at > now() - interval '1 hour';
    if v_recent >= 5 then
      return true;
    end if;
  end if;

  insert into public.leads (email, source, pilot, client_id)
  values (
    v_email,
    left(p_source, 24),
    nullif(left(p_pilot, 24), ''),
    left(p_client_id, 64)
  );
  return true;
end;
$$;

-- Only anon may call the narrow RPC; the table itself stays sealed.
revoke all on function public.submit_lead(text, text, text, text) from public;
grant execute on function public.submit_lead(text, text, text, text) to anon;

-- ===========================================================================
-- Live wildfire ingestion store — the "honest window" BACKEND (Phases 1–3).
-- ===========================================================================
-- Until now the live-fire map fetched 5 government feeds straight from every visitor's browser
-- (src/three/livefire/client.ts) — a zero-backend MVP that can only ever show "right now" and
-- breaks site-wide the day a source changes schema. This store inverts that: the `ingest-fires`
-- Edge Function (supabase/functions/ingest-fires) pulls the AUTHORITATIVE CIFFC reported-fire roll +
-- national summary SERVER-SIDE on a pg_cron schedule and writes here with the service role. The game
-- client then reads THIS (fast, one schema we control), and — the real unlock — we keep an
-- append-only HISTORY per fire, so the UI can show a fire's size + stage OVER TIME (impossible from
-- the client). The ephemeral layers (raw hotspots, FWI/smoke rasters) stay client-direct: they are
-- "now"-only and snapshotting them buys nothing.
--
-- Access mirrors `scores`: anon may SELECT all three (public data); only the service role writes.
-- RLS on, one read policy each, NO write policies (the Edge Function bypasses RLS as service role).

-- ── Current fire state — one row per fire, upserted each ingest ─────────────────────────────────
create table if not exists public.fires (
  fire_id       text        primary key,             -- field_system_fire_id (else agency fire id)
  lat           double precision not null,
  lon           double precision not null,
  agency        text,                                 -- province/territory code (lowercase, e.g. 'sk')
  country       text,                                 -- 'CA' | 'US' | 'MX' | 'OT' (server-side filter aid)
  stage         text        not null,                 -- 'OC' | 'BH' | 'UC' | 'OUT' | 'UNK'
  size_ha       double precision,                     -- field_fire_size (null/<0 = unknown)
  props         jsonb,                                -- the full CIFFC record verbatim (drives the panel)
  reported_at   timestamptz,                          -- field_situation_report_date (the SOURCE's time)
  first_seen    timestamptz not null default now(),   -- when WE first saw this fire
  last_updated  timestamptz not null default now(),   -- when WE last touched this row

  constraint fires_lat_range  check (lat between -90 and 90),
  constraint fires_lon_range  check (lon between -180 and 180),
  constraint fires_stage_vals check (stage in ('OC','BH','UC','OUT','UNK'))
);
-- Fast "active fires, biggest first" reads (the default map layer + headline) and country filter.
create index if not exists fires_stage_size_idx on public.fires (stage, size_ha desc);
create index if not exists fires_country_idx     on public.fires (country);

-- ── Append-only per-fire HISTORY — the thing the client architecture can't do ───────────────────
-- One row per OBSERVED CHANGE (the ingest only appends when stage or size moved, or the fire is new),
-- so a static fire doesn't pile up a row every cron tick.
create table if not exists public.fire_snapshots (
  id          bigint generated always as identity primary key,
  fire_id     text        not null references public.fires(fire_id) on delete cascade,
  stage       text        not null,
  size_ha     double precision,
  reported_at timestamptz,                            -- the source sitrep date for this observation
  observed_at timestamptz not null default now(),     -- when our ingest recorded it

  constraint fire_snapshots_stage_vals check (stage in ('OC','BH','UC','OUT','UNK'))
);
-- The sparkline query: this fire's points, in time order.
create index if not exists fire_snapshots_fire_idx on public.fire_snapshots (fire_id, observed_at);

-- ── Append-only national-summary snapshots (CIFFC dashboard) — the season trend ─────────────────
create table if not exists public.national_summary (
  id             bigint generated always as identity primary key,
  fires_today    integer,
  active_fires   integer,
  ytd_total      integer,
  area_burned_ha double precision,
  prep_level     integer,
  published_at   timestamptz,                         -- CIFFC sitrep date (the SOURCE's time)
  observed_at    timestamptz not null default now()
);
create index if not exists national_summary_observed_idx on public.national_summary (observed_at desc);

-- ── RLS: anon reads, service role writes ────────────────────────────────────────────────────────
alter table public.fires            enable row level security;
alter table public.fire_snapshots   enable row level security;
alter table public.national_summary enable row level security;

drop policy if exists "fires: anyone can read"            on public.fires;
drop policy if exists "fire_snapshots: anyone can read"   on public.fire_snapshots;
drop policy if exists "national_summary: anyone can read" on public.national_summary;

create policy "fires: anyone can read"            on public.fires            for select using (true);
create policy "fire_snapshots: anyone can read"   on public.fire_snapshots   for select using (true);
create policy "national_summary: anyone can read" on public.national_summary for select using (true);
-- No INSERT/UPDATE/DELETE policies → anon cannot write; the Edge Function (service role) bypasses RLS.

grant select on public.fires            to anon;
grant select on public.fire_snapshots   to anon;
grant select on public.national_summary to anon;

-- ---------------------------------------------------------------------------
-- Scheduling — pg_cron pings the public `ingest-fires` Edge Function every 10 minutes.
-- ---------------------------------------------------------------------------
-- The function is deployed with verify_jwt = FALSE (like report-error) but gates writes behind a
-- shared secret it reads from its own env (INGEST_SECRET) and FAILS CLOSED when that secret is unset,
-- so a random public POST can't drive it. pg_net sends that secret as a header. Run this block ONCE,
-- AFTER deploying the function and setting its INGEST_SECRET (the function rejects every call until you
-- do). Replace <PROJECT_REF> and <INGEST_SECRET> with your values (the cron job stores
-- the secret in pg_cron's job table, readable only by the postgres role — acceptable for this use).
--
--   create extension if not exists pg_cron;
--   create extension if not exists pg_net;
--
--   select cron.schedule(
--     'ingest-fires-10min',
--     '*/10 * * * *',
--     $cron$
--       select net.http_post(
--         url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/ingest-fires',
--         headers := jsonb_build_object('Content-Type','application/json','x-ingest-secret','<INGEST_SECRET>'),
--         body    := '{}'::jsonb,
--         timeout_milliseconds := 30000
--       );
--     $cron$
--   );
--
-- To inspect / unschedule:  select * from cron.job;   select cron.unschedule('ingest-fires-10min');

-- ===========================================================================
-- Provincial-agency wildfire feeds (the richer layer on top of national CIFFC).
-- ===========================================================================
-- CIFFC (public.fires, ingest-fires) is the national baseline. Each PROVINCE runs its own wildfire
-- service with MORE detail than the national roll — cause, response type, geographic description, and a
-- direct per-fire official incident URL. Those feeds all have DIFFERENT schemas, so we use ONE flexible
-- table: normalize the shared SPINE into columns (for the map + queries) and keep EVERY source field
-- verbatim in `props` jsonb. Keyed by (source, source_fire_id). Written by the ingest-provincial Edge
-- Function (one adapter per source; BC Wildfire is the first — keyless ArcGIS Online PublicView).
create table if not exists public.provincial_fires (
  source          text        not null,              -- adapter id, e.g. 'bc-wildfire'
  source_fire_id  text        not null,              -- the source's own fire identifier
  agency          text,                              -- CIFFC-style province code ('BC','AB',…)
  name            text,
  lat             double precision not null,
  lon             double precision not null,
  size_ha         double precision,
  status          text,                              -- the source's OWN status string (kept raw)
  stage           text,                              -- best-effort CIFFC-style stage if derivable
  discovered_at   timestamptz,
  updated_at_src  timestamptz,
  props           jsonb,                             -- the FULL source record verbatim
  first_seen      timestamptz not null default now(),
  last_updated    timestamptz not null default now(),
  primary key (source, source_fire_id),
  constraint provincial_fires_lat_range check (lat between -90 and 90),
  constraint provincial_fires_lon_range check (lon between -180 and 180)
);
create index if not exists provincial_fires_source_idx on public.provincial_fires (source);
create index if not exists provincial_fires_agency_idx on public.provincial_fires (agency);

alter table public.provincial_fires enable row level security;
drop policy if exists "provincial_fires: anyone can read" on public.provincial_fires;
create policy "provincial_fires: anyone can read" on public.provincial_fires for select using (true);
grant select on public.provincial_fires to anon;

-- Per-fire size/stage HISTORY for provincial fires — the provincial mirror of public.fire_snapshots.
-- ingest-provincial APPENDS a row only when a province's fire moved (stage or size changed, or it's new),
-- so a steady fire doesn't pile up a row per cron tick. Keyed by (source, source_fire_id) like its parent.
-- This is what lets a BC/AB/ON detail card draw a tracked-history chart: fire_snapshots only ever held the
-- CIFFC-id'd national rows, so a provincial-id'd card (shown via the prefer-provincial path) could never
-- find its history there. on delete cascade keeps it tidy when a parent provincial fire ages out.
create table if not exists public.provincial_fire_snapshots (
  id              bigint generated always as identity primary key,
  source          text        not null,
  source_fire_id  text        not null,
  stage           text        not null,
  size_ha         double precision,
  reported_at     timestamptz,                            -- the source's own update/discovery time
  observed_at     timestamptz not null default now(),     -- when our ingest recorded it
  constraint provincial_fire_snapshots_stage_vals check (stage in ('OC','BH','UC','OUT','UNK')),
  foreign key (source, source_fire_id) references public.provincial_fires (source, source_fire_id) on delete cascade
);
-- The sparkline query: this fire's points, in time order.
create index if not exists provincial_fire_snapshots_fire_idx
  on public.provincial_fire_snapshots (source, source_fire_id, observed_at);

alter table public.provincial_fire_snapshots enable row level security;
drop policy if exists "provincial_fire_snapshots: anyone can read" on public.provincial_fire_snapshots;
create policy "provincial_fire_snapshots: anyone can read" on public.provincial_fire_snapshots for select using (true);
grant select on public.provincial_fire_snapshots to anon;

-- Schedule (run after deploying ingest-provincial; staggered :05/:15/… vs ingest-fires' :00/:10/…):
--   select cron.schedule('ingest-provincial-10min', '5,15,25,35,45,55 * * * *', $cron$
--     select net.http_post(
--       url := 'https://<PROJECT_REF>.supabase.co/functions/v1/ingest-provincial',
--       headers := jsonb_build_object('Content-Type','application/json'),
--       body := '{}'::jsonb, timeout_milliseconds := 60000);
--   $cron$);
