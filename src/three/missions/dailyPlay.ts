/**
 * Daily Burn one-play-per-day lock — the "you get one shot at today's burn" rule (a Wordle-style limit
 * on the retention surface). A tiny LOCAL record of which UTC day the player has consumed their Daily
 * Burn run, so the home card locks to a "played — resets in Xh" state and the `?daily` route refuses a
 * second boot until the next UTC midnight (when the daily map itself rolls over, see `dayNumberUTC`).
 *
 * Deliberately separate from the streak store (`streak.ts`): the streak counts CLEARS, this counts the
 * single ATTEMPT. Marked at boot (you spent your shot the moment you flew it), so quitting early can't
 * dodge the limit. Degrades gracefully if storage is blocked — the lock just won't persist that session.
 */
import { dayNumberUTC } from './daily';

const KEY = 'bmf.daily.played.v1';

function loadDay(): number {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw != null) {
      const n = parseInt(raw, 10);
      if (Number.isFinite(n)) return n;
    }
  } catch {
    /* storage unavailable — treat as "never played" */
  }
  return -1;
}

/** Spend today's Daily Burn attempt (idempotent per UTC day). Call once when the daily boots. */
export function markDailyPlayed(now: Date = new Date()): void {
  try {
    localStorage.setItem(KEY, String(dayNumberUTC(now)));
  } catch {
    /* ignore — the lock just won't persist this session */
  }
}

/** True once the player has flown TODAY's Daily Burn — the card locks and `?daily` refuses a re-boot. */
export function hasPlayedDaily(now: Date = new Date()): boolean {
  return loadDay() === dayNumberUTC(now);
}

/** Milliseconds until the next UTC midnight, when the Daily Burn (and this lock) resets world-wide. */
export function msUntilDailyReset(now: Date = new Date()): number {
  return (dayNumberUTC(now) + 1) * 86_400_000 - now.getTime();
}

/** Compact "Xh Ym" countdown to the daily reset, for the locked card's context line. */
export function dailyResetCountdown(now: Date = new Date()): string {
  const ms = Math.max(0, msUntilDailyReset(now));
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
