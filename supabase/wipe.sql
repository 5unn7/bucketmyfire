-- bucketmyfire — ONE-OFF CLOUD SCORES RESET (scores only; keeps unlocks + profiles).
--
-- ⚠️  GLOBAL + irreversible. Run once after the scoring rescale: old rows are on the previous
--     (five-digit) scale and incompatible with the new 0–1400 scale, so the board must reset.
--
-- This mirrors the local "scores only" reset: it clears SCORES everywhere but preserves what each
-- player has unlocked and their pilot profile (callsign/heli).
--
-- The anon key the game ships with CANNOT do this (RLS denies DELETE on `scores`; `cloud_saves` is
-- locked to two RPCs) — by design. Run it as the project owner:
--   Supabase Dashboard → SQL Editor → New query → paste this file → Run.

-- 1) Leaderboard: clear every submitted run. The read-only views (`mission_best`, `career_totals`)
--    derive from this table, so they go empty automatically.
truncate table public.scores restart identity;

-- 2) Cloud saves: empty ONLY the score fields inside each save envelope — best scores + completion
--    ledgers — while keeping `progress.completed` (unlocks) and the `profile` (callsign/heli). The
--    blob shape is { v, progress: { completed, best, completions }, profile } (see cloudSave.ts), so
--    a restore after this re-imports unlocks/profile but no stale scores.
update public.cloud_saves
set save = jsonb_set(
             jsonb_set(save, '{progress,best}',        '{}'::jsonb, true),
             '{progress,completions}', '{}'::jsonb, true),
    updated_at = now()
where save ? 'progress';

-- Verify:
--   select count(*) from public.scores;                              -- → 0
--   select pilot, save->'progress'->'best' from public.cloud_saves;  -- → {} for every row
