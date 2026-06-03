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
