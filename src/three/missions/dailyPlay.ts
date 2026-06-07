/**
 * Daily Burn completion lock — the "retry until you clear it, then you're done for the day" rule. A tiny
 * LOCAL record of which UTC day the player has CLEARED their Daily Burn, so the home card locks to a
 * "cleared — resets in Xh" state and the `?daily` route refuses a re-boot once today's burn is beaten.
 *
 * Unlimited retries are allowed UNTIL the clear: the lock is set on the WIN (see Game.latchOutcome), not
 * at boot, so a loss or an early quit costs nothing and the player can keep flying today's map until they
 * put it out. The win then closes the door until the next UTC midnight (when the daily map itself rolls
 * over, see `dayNumberUTC`).
 *
 * Deliberately separate from the streak store (`streak.ts`): the streak counts the consecutive-day CHAIN,
 * this just gates re-entry once the day is cleared. Degrades gracefully if storage is blocked — the lock
 * just won't persist that session.
 */
import { dayNumberUTC } from './daily';

const KEY = 'bmf.daily.cleared.v1';

function loadDay(): number {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw != null) {
      const n = parseInt(raw, 10);
      if (Number.isFinite(n)) return n;
    }
  } catch {
    /* storage unavailable — treat as "never cleared" */
  }
  return -1;
}

/** Lock today's Daily Burn as cleared (idempotent per UTC day). Call once on the WIN, not at boot. */
export function markDailyCompleted(now: Date = new Date()): void {
  try {
    localStorage.setItem(KEY, String(dayNumberUTC(now)));
  } catch {
    /* ignore — the lock just won't persist this session */
  }
}

/** True once the player has CLEARED today's Daily Burn — the card locks and `?daily` refuses a re-boot. */
export function hasCompletedDaily(now: Date = new Date()): boolean {
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
