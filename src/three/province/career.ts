/**
 * Province career store ('bmf.career.v1') — the open-world progression the campaign no longer carries.
 * It records the META of your open-world flying: a SEASON LOG of recent shifts (for the debrief + a
 * future season screen), your best single shift, the regions you've flown, and an `onboarded` flag
 * (false until your first shift → the DispatchDirector runs the guided onboarding arc only on a
 * brand-new pilot's first flight; Phase 2b consumes it).
 *
 * It does NOT re-implement the economy: reputation still banks through `progress.recordScore` →
 * `careerScore()`, and the wallet + rank ladder are UNCHANGED. This store holds only the log + flags.
 * localStorage-backed, try/catch-guarded (private-mode safe, mirroring missions/progress.ts). The
 * record SHAPING (`buildShiftRecord`) is a PURE function so the Node gate can assert it without storage.
 */
import { dayNumberUTC } from '../missions/daily';

const KEY = 'bmf.career.v1';
const LOG_MAX = 20; // keep the most recent N shifts (the season log); older ones drop off

/** One logged shift — what the debrief + season screen read back. */
export interface ShiftRecord {
  region: string; // region id flown (e.g. "saskatchewan")
  day: number; // UTC day number (dayNumberUTC) the shift was flown
  reputation: number; // reputation banked that shift
  townsStanding: number; // towns still standing at end of shift
  townsTotal: number;
  answered: number; // dispatch calls held
  missed: number; // dispatch calls lost
  stoodDown: boolean; // true if the province overran you (vs. you left it standing)
}

/** The live end-of-shift snapshot Game hands the store (region + the ProvinceMode tally). */
export interface ShiftSummary {
  region: string;
  reputation: number;
  townsStanding: number;
  townsTotal: number;
  answered: number;
  missed: number;
  stoodDown: boolean;
}

export interface Career {
  onboarded: boolean; // has flown at least one shift → onboarding arc no longer runs
  bestShift: number; // best single-shift reputation
  regionsFlown: string[]; // region ids flown (distinct)
  log: ShiftRecord[]; // most-recent-first, capped at LOG_MAX
}

const EMPTY: Career = { onboarded: false, bestShift: 0, regionsFlown: [], log: [] };

/** Shape a summary into a stored record (PURE — `day` is passed in, no Date.now → gate-assertable). */
export function buildShiftRecord(s: ShiftSummary, day: number): ShiftRecord {
  return {
    region: s.region,
    day,
    reputation: Math.max(0, Math.round(s.reputation)),
    townsStanding: Math.max(0, Math.round(s.townsStanding)),
    townsTotal: Math.max(0, Math.round(s.townsTotal)),
    answered: Math.max(0, Math.round(s.answered)),
    missed: Math.max(0, Math.round(s.missed)),
    stoodDown: !!s.stoodDown,
  };
}

function load(): Career {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const c = JSON.parse(raw) as Partial<Career>;
      return {
        onboarded: !!c.onboarded,
        bestShift: typeof c.bestShift === 'number' ? c.bestShift : 0,
        regionsFlown: Array.isArray(c.regionsFlown) ? c.regionsFlown.filter((x) => typeof x === 'string') : [],
        log: Array.isArray(c.log) ? (c.log.filter((r) => r && typeof r === 'object') as ShiftRecord[]).slice(0, LOG_MAX) : [],
      };
    }
  } catch {
    /* storage unavailable — fall through to defaults */
  }
  return { ...EMPTY };
}

function save(c: Career): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(c));
  } catch {
    /* ignore — career meta just won't persist */
  }
}

export function getCareer(): Career {
  return load();
}

export function isOnboarded(): boolean {
  return load().onboarded;
}

export function bestShift(): number {
  return load().bestShift;
}

/** Mark the region as flown + flip `onboarded` once a shift is genuinely underway (Game calls this on
 *  the first board push, ~boardEverySec in). Idempotent; no log entry — that lands at shift end. */
export function markFlown(region: string, now: Date = new Date()): void {
  void now; // reserved (a future "flown on day N" stamp); region + onboarded are date-free
  const c = load();
  let dirty = false;
  if (!c.onboarded) {
    c.onboarded = true;
    dirty = true;
  }
  if (region && !c.regionsFlown.includes(region)) {
    c.regionsFlown.push(region);
    dirty = true;
  }
  if (dirty) save(c);
}

/** Record a completed shift: prepend a capped season-log entry, bump bestShift, ensure flown/onboarded. */
export function recordShift(s: ShiftSummary, now: Date = new Date()): Career {
  const c = load();
  const rec = buildShiftRecord(s, dayNumberUTC(now));
  c.log.unshift(rec);
  if (c.log.length > LOG_MAX) c.log.length = LOG_MAX;
  c.bestShift = Math.max(c.bestShift, rec.reputation);
  c.onboarded = true;
  if (rec.region && !c.regionsFlown.includes(rec.region)) c.regionsFlown.push(rec.region);
  save(c);
  return c;
}

/** Wipe the career meta (settings reset / epoch migration). */
export function resetCareer(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
