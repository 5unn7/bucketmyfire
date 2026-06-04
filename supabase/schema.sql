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

-- ---------------------------------------------------------------------------
-- Row-level security: anon can read everything and insert bounded rows; nothing else.
-- ---------------------------------------------------------------------------
alter table public.scores enable row level security;

drop policy if exists "scores: anyone can read"   on public.scores;
drop policy if exists "scores: anyone can insert" on public.scores;

create policy "scores: anyone can read"
  on public.scores for select
  using (true);

create policy "scores: anyone can insert"
  on public.scores for insert
  with check (
    char_length(pilot) between 1 and 24
    and char_length(mission_id) between 1 and 40
    and score >= 0 and score <= 1000000
  );

-- No UPDATE / DELETE policies → those are denied for the anon role by default.

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
grant select, insert on public.scores to anon;
grant select on public.mission_best to anon;
grant select on public.career_totals to anon;

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

-- One save per (email, pilot) — a shared family email can still hold several distinct pilots.
create unique index if not exists cloud_saves_key
  on public.cloud_saves (email_hash, lower(pilot));

alter table public.cloud_saves enable row level security;
-- No policies + revoke = anon/authenticated have NO direct table access. The RPCs are the only door.
revoke all on public.cloud_saves from anon, authenticated;

-- Upsert a save. SECURITY DEFINER writes past RLS; empty search_path + schema-qualified refs are
-- the standard hardening for definer functions.
create or replace function public.save_cloud_progress(p_email_hash text, p_pilot text, p_save jsonb)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ts timestamptz;
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

  insert into public.cloud_saves (email_hash, pilot, save, updated_at)
  values (p_email_hash, p_pilot, p_save, now())
  on conflict (email_hash, lower(pilot))
  do update set save = excluded.save, pilot = excluded.pilot, updated_at = now()
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
revoke all on function public.save_cloud_progress(text, text, jsonb) from public;
revoke all on function public.load_cloud_progress(text, text)        from public;
grant execute on function public.save_cloud_progress(text, text, jsonb) to anon;
grant execute on function public.load_cloud_progress(text, text)        to anon;

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
