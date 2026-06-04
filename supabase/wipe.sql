-- bucketmyfire — ONE-OFF CLOUD DATA WIPE.
--
-- ⚠️  DESTRUCTIVE and GLOBAL. This empties the entire leaderboard and EVERY player's cloud save.
--     It cannot be undone. Run it once after the scoring rescale: old rows are on the previous
--     (0–40k) scale and are incompatible with the new 0–1400 scale, so the board must reset.
--
-- The anon key the game ships with CANNOT do this (RLS denies DELETE on `scores`, and `cloud_saves`
-- is fully locked to two RPCs) — by design. Run this as the project owner:
--
--   Supabase Dashboard → SQL Editor → New query → paste this file → Run.
--
-- `truncate ... restart identity` also resets the id sequences. The read-only views
-- (`mission_best`, `career_totals`) derive from `scores`, so they go empty automatically.

truncate table public.scores       restart identity;
truncate table public.cloud_saves  restart identity;

-- Verify (both should return 0):
--   select count(*) from public.scores;
--   select count(*) from public.cloud_saves;
