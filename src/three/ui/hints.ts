/**
 * Coach-once hints — "teach a move the first time, then trust the pilot." A tiny localStorage-backed
 * counter per hint KIND so an instructional cue (descend-to-fill, re-rig, …) shows a couple of times
 * for a new player and then never nags a returning one. Live STATE feedback (the water-bar glow, the
 * danger gauges) is separate and always on; this only gates the teaching TEXT — the fix for the
 * "bucket filled, go dump" perpetual-nag. Storage blocked → counts read 0 (it just keeps coaching),
 * which is harmless.
 */

const KEY = 'bmf.coach.v1';
const MAX_DEFAULT = 2; // show a teaching hint this many times, then suppress it for good

function load(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}') as Record<string, number>;
  } catch {
    return {};
  }
}

function save(m: Record<string, number>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(m));
  } catch {
    /* storage blocked — coaching just won't persist across sessions; harmless */
  }
}

/** True once this hint KIND has been shown/acted on enough times to stop coaching it. */
export function coached(kind: string, max = MAX_DEFAULT): boolean {
  return (load()[kind] ?? 0) >= max;
}

/** Record that the player has now performed this action once (bumps its learned-count). */
export function coachBump(kind: string): void {
  const m = load();
  m[kind] = (m[kind] ?? 0) + 1;
  save(m);
}
