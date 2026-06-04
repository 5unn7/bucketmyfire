/**
 * One-time local-storage reset (the clean-slate switch).
 *
 * The game owns a handful of `bmf.*` localStorage keys — campaign progress + best scores
 * (`bmf.campaign.v1`), pilot profile (`bmf.profile.v1`), the cloud-save link (`bmf.cloud.v1`),
 * the anonymous client id (`bmf.client.v1`), and the help-seen flag (`bmf.help.seen.v1`).
 *
 * When every player must start fresh — e.g. the scoring scale changed and old saved scores are
 * meaningless — bump `DATA_EPOCH`. The next load then wipes ALL `bmf.*` keys exactly once and stamps
 * the new epoch, so it never repeats (until the next bump). Idempotent and self-disarming.
 *
 * This clears LOCAL data only. The cloud tables (`scores`, `cloud_saves`) are wiped separately via
 * `supabase/wipe.sql` — the anon key can't delete them, so that runs in the Supabase SQL editor.
 *
 * Wrapped in try/catch: storage may be blocked (private mode), in which case nothing persisted and
 * there's nothing to clear.
 */

const EPOCH_KEY = 'bmf.epoch';
const DATA_EPOCH = 2; // bump to force a one-time wipe of all local data for every player

export function resetStaleStorage(): void {
  try {
    if (localStorage.getItem(EPOCH_KEY) === String(DATA_EPOCH)) return; // already on this epoch
    const doomed: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('bmf.')) doomed.push(k); // every game key (incl. the old epoch, if any)
    }
    for (const k of doomed) localStorage.removeItem(k);
    localStorage.setItem(EPOCH_KEY, String(DATA_EPOCH)); // stamp so the wipe runs only once
  } catch {
    /* storage unavailable — nothing persisted, nothing to clear */
  }
}
