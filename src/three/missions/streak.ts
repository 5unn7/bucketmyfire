/**
 * Daily Burn streak — the comeback loop (audit VISION-3). A LOCAL, no-Supabase counter of consecutive
 * UTC days the player has cleared the Daily Burn. It gives a one-session player a compounding reason to
 * come back tomorrow: miss a day and the streak resets to zero, so the pull is "don't break the chain."
 *
 * Deliberately client-only and tiny: it shares the Daily Burn's UTC-day clock (so it rolls over at the
 * same instant world-wide as the daily map, see `dayNumberUTC`) and persists one small record in
 * localStorage. Everything degrades gracefully if storage is blocked (private mode) — the streak just
 * won't persist between sessions. The store is IDEMPOTENT per day, so recording a replay of the same
 * day's burn never double-counts.
 */
import { dayNumberUTC } from './daily';

const KEY = 'bmf.daily.streak.v1';

interface StreakStore {
  count: number; // current consecutive-day streak
  lastDay: number; // UTC day number of the most recent clear (-1 = never)
  best: number; // longest streak ever reached (a "personal best" flex)
}

function load(): StreakStore {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw) as Partial<StreakStore>;
      return {
        count: typeof s.count === 'number' ? s.count : 0,
        lastDay: typeof s.lastDay === 'number' ? s.lastDay : -1,
        best: typeof s.best === 'number' ? s.best : 0,
      };
    }
  } catch {
    /* storage unavailable — fall through to defaults */
  }
  return { count: 0, lastDay: -1, best: 0 };
}

function save(s: StreakStore): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* ignore — the streak just won't persist this session */
  }
}

/**
 * Record TODAY's Daily Burn clear and return the live streak after it. Consecutive if the previous
 * clear was exactly yesterday; otherwise the streak restarts at 1 (a gap broke it). IDEMPOTENT per UTC
 * day — calling it again the same day (e.g. a replay, or a per-frame outcome latch) returns the current
 * count without bumping it, so it's safe to call from a hot path.
 */
export function recordDailyClear(now: Date = new Date()): number {
  const today = dayNumberUTC(now);
  const s = load();
  if (s.lastDay === today) return s.count; // already counted today — no double-bump
  const count = s.lastDay === today - 1 ? s.count + 1 : 1; // yesterday → extend; else restart
  const best = Math.max(s.best, count);
  save({ count, lastDay: today, best });
  return count;
}

/**
 * The LIVE streak for display (read-only — never writes). The stored count if the last clear was today
 * or yesterday (the chain is still alive), else 0 — a missed day has already broken it, so the menu
 * shows 0 and the next clear starts a fresh streak at 1.
 */
export function dailyStreak(now: Date = new Date()): number {
  const s = load();
  if (s.lastDay < 0) return 0;
  const gap = dayNumberUTC(now) - s.lastDay;
  return gap === 0 || gap === 1 ? s.count : 0;
}

/** Longest streak ever reached (for a "best: N days" flex). */
export function bestDailyStreak(): number {
  return load().best;
}
