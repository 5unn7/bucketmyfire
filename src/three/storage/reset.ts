import { clearCampaign } from '../missions/progress';

/**
 * One-time campaign-progress reset (the clean-slate switch).
 *
 * Epoch 3 RESTRUCTURED the campaign — ten missions became six, with all-new mission ids. A returning
 * pilot's stored ids no longer match the catalog, so we wipe campaign progress (unlocks + best scores
 * + completion ledgers inside `bmf.campaign.v1`) exactly once and let everyone fly the new six in
 * order. Everything else is KEPT: the pilot profile (`bmf.profile.v1`), the cloud-save link
 * (`bmf.cloud.v1`), the anonymous client id (`bmf.client.v1`), and the help-seen flag are untouched.
 * (Epoch 2 was a narrower scores-only wipe after a scoring-scale change.)
 *
 * Gated by `DATA_EPOCH`: the next load runs the wipe, stamps the epoch, and never repeats (until the
 * next bump). To force another reset for every player later, bump `DATA_EPOCH`.
 *
 * LOCAL only. The cloud equivalent (`scores` table + the score fields inside `cloud_saves`) is reset
 * separately via `supabase/wipe.sql` — the shipped anon key can't touch those by design.
 *
 * Wrapped in try/catch: storage may be blocked (private mode), in which case nothing persisted.
 */

const EPOCH_KEY = 'bmf.epoch';
// Epoch 4: the campaign grew from six to EIGHT missions — a new "Backburn" (helitorch) mission at
// index 3 and an "After Burn" (mop-up) mission at index 6, shifting Doorstep/Three Towns/Everything
// at Once down. Because the linear unlock walks `index-1`, a returning pilot's stored ids would leave
// a beaten mission re-locked (its new predecessor is an uncleared new id) — so wipe campaign progress
// once and let everyone fly the eight in order.
const DATA_EPOCH = 4; // bump to force a one-time campaign-progress reset for every player

export function resetStaleStorage(): void {
  try {
    if (localStorage.getItem(EPOCH_KEY) === String(DATA_EPOCH)) return; // already on this epoch
    clearCampaign(); // restructured campaign: wipe stale unlocks + scores; keep profile / cloud link
    localStorage.setItem(EPOCH_KEY, String(DATA_EPOCH)); // stamp so the reset runs only once
  } catch {
    /* storage unavailable — nothing persisted, nothing to clear */
  }
}
