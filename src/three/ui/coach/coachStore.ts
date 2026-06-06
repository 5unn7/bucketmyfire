/**
 * Interactive-tutorial "done" flag — the storage twin of `ui/hints.ts`'s coach counters, but a single
 * boolean: has this pilot finished (or skipped) the guided first flight? Kept INDEPENDENT of the static
 * help's `bmf.help.seen.v1` so replaying one surface never re-pops the other. Storage-blocked reads as
 * "not done" (the coach just runs again next session — harmless, same idiom as hints.ts / HelpModal).
 */

const KEY = 'bmf.tutorial.done.v1';

/** True once the guided first flight has been completed or skipped. (false if storage is blocked.) */
export function tutorialDone(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

/** Remember the guided first flight is finished, so the coach never auto-runs again. */
export function markTutorialDone(): void {
  try {
    localStorage.setItem(KEY, '1');
  } catch {
    // storage blocked — it'll just coach again next session, harmless
  }
}

/** Clear the flag so the coach re-runs (the "Replay guided first flight" path in the help modal). */
export function resetTutorial(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // storage blocked — nothing persisted to clear
  }
}
