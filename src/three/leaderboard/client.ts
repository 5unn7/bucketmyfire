/**
 * Global leaderboard client — a tiny, dependency-free wrapper over Supabase's auto-generated
 * PostgREST API (plain `fetch`, no @supabase/supabase-js). The anon key is the public,
 * row-level-security-gated key, so it's safe to ship in this static client bundle.
 *
 * Everything here is best-effort and NEVER throws into the game: a failed submit or fetch
 * resolves to a quiet failure (false / null / []). When the env vars are absent the whole
 * module reports `isConfigured() === false` and the UI shows an "offline" board — the game is
 * otherwise unchanged (the local best-score store in missions/progress.ts stays authoritative
 * for campaign unlocks; this is purely additive bragging-rights on top).
 *
 * Schema lives in `supabase/schema.sql`; config in `.env` (see `.env.example`).
 */

import { cleanCallsign, isReservedCallsign } from '../ui/callsign';

const URL_BASE = (import.meta.env.VITE_SUPABASE_URL ?? '').replace(/\/$/, '');
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY ?? '';

/** True when both Supabase env vars are present — gates all network calls and the UI state. */
export function isConfigured(): boolean {
  return URL_BASE.length > 0 && ANON_KEY.length > 0;
}

// --- Types ------------------------------------------------------------------

/** One row of a per-mission board (a pilot's best run on that mission). */
export interface MissionEntry {
  pilot: string;
  score: number;
  time_s: number | null;
  client_id: string | null;
  created_at: string;
}

/** One row of the overall board (a pilot's summed best-per-mission score). */
export interface CareerEntry {
  pilot: string;
  total: number;
  missions: number;
  last_seen: string;
}

/** The payload submitted on a win. */
export interface ScoreSubmission {
  pilot: string;
  missionId: string;
  score: number;
  timeS?: number;
}

// --- Anonymous device id ----------------------------------------------------
// A stable, anonymous per-browser id so the board can highlight "you" without any login.
// Purely a display aid — it's also sent with each row so a future "your best" lookup is cheap.

const CLIENT_KEY = 'bmf.client.v1';

export function getClientId(): string {
  try {
    let id = localStorage.getItem(CLIENT_KEY);
    if (!id) {
      id = newId();
      localStorage.setItem(CLIENT_KEY, id);
    }
    return id;
  } catch {
    // Storage blocked (private mode) — a fresh ephemeral id is fine; we just can't persist it.
    return newId();
  }
}

function newId(): string {
  try {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  } catch {
    /* fall through to the manual id */
  }
  // Non-crypto fallback (older WebViews). Uniqueness is best-effort; collisions are harmless here.
  return 'c-' + Math.abs(hashStr(`${navigator.userAgent}|${performance.now()}`)).toString(36) + '-' + Date.now().toString(36);
}

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h;
}

// --- REST helpers -----------------------------------------------------------

function headers(extra?: Record<string, string>): Record<string, string> {
  return {
    apikey: ANON_KEY,
    Authorization: `Bearer ${ANON_KEY}`,
    ...extra,
  };
}

/** Abort a request that hangs (flaky mobile network) so the UI never waits forever. */
function withTimeout(ms: number): { signal: AbortSignal; done: () => void } {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  return { signal: ctrl.signal, done: () => clearTimeout(t) };
}

// --- Public API -------------------------------------------------------------

/**
 * Submit a winning run. Fire-and-forget: resolves to true on a 2xx, false on any failure
 * (unconfigured, network error, timeout, non-2xx). Never throws — the caller can ignore the
 * promise entirely.
 */
export async function submitScore(s: ScoreSubmission): Promise<boolean> {
  if (!isConfigured()) return false;
  // Final hygiene on the auto-submit path. If the pilot never set a name (still the reserved
  // default 'Pilot') we post under a per-device handle so the board doesn't collapse to one
  // 'Pilot' row and the career grouping stays distinct per player.
  let pilot = cleanCallsign(s.pilot);
  if (pilot.length < 2 || isReservedCallsign(pilot)) {
    const tag = getClientId().replace(/[^a-zA-Z0-9]/g, '').slice(0, 5) || '0000';
    pilot = `Pilot-${tag}`;
  }
  pilot = pilot.slice(0, 24);
  const body = [
    {
      pilot,
      mission_id: s.missionId.slice(0, 40),
      score: Math.max(0, Math.min(1_000_000, Math.round(s.score))),
      time_s: s.timeS !== undefined && isFinite(s.timeS) ? Math.max(0, Math.round(s.timeS * 10) / 10) : null,
      client_id: getClientId(),
    },
  ];
  const t = withTimeout(8000);
  try {
    const res = await fetch(`${URL_BASE}/rest/v1/scores`, {
      method: 'POST',
      headers: headers({ 'Content-Type': 'application/json', Prefer: 'return=minimal' }),
      body: JSON.stringify(body),
      signal: t.signal,
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    t.done();
  }
}

/** Top runs for one mission (each pilot's best), highest score first. [] on any failure. */
export async function fetchMissionTop(missionId: string, limit = 25): Promise<MissionEntry[]> {
  if (!isConfigured()) return [];
  const q = `mission_id=eq.${encodeURIComponent(missionId)}&order=score.desc,time_s.asc.nullslast&limit=${limit}`;
  return (await getJson<MissionEntry[]>(`/rest/v1/mission_best?${q}`)) ?? [];
}

/** Overall career board (sum of best-per-mission per pilot), highest first. [] on any failure. */
export async function fetchCareerTop(limit = 50): Promise<CareerEntry[]> {
  if (!isConfigured()) return [];
  const q = `order=total.desc&limit=${limit}`;
  return (await getJson<CareerEntry[]>(`/rest/v1/career_totals?${q}`)) ?? [];
}

/**
 * Is this callsign already claimed by ANOTHER device on the board? Case-insensitive. Used by the
 * callsign editor to block duplicate names. Fail-open: returns false when the board is offline or
 * the request errors (we never block a player because the network is flaky — the submit-time clean
 * is the backstop). `excludeClientId` defaults to this device, so renaming to your own name is fine.
 */
export async function isNameTaken(name: string, excludeClientId?: string): Promise<boolean> {
  if (!isConfigured()) return false;
  const clean = name.trim();
  if (clean.length < 2) return false;
  const exclude = excludeClientId ?? getClientId();
  // ilike is case-insensitive (% / _ act as wildcards → it may over-match, which only widens the
  // candidate set); the exact, case-insensitive compare below is what actually decides "taken".
  const rows = await getJson<{ pilot: string; client_id: string | null }[]>(
    `/rest/v1/scores?select=pilot,client_id&pilot=ilike.${encodeURIComponent(clean)}&limit=50`,
  );
  if (!rows) return false; // network error → fail open
  const lc = clean.toLowerCase();
  return rows.some((r) => (r.pilot ?? '').trim().toLowerCase() === lc && r.client_id !== exclude);
}

async function getJson<T>(path: string): Promise<T | null> {
  const t = withTimeout(8000);
  try {
    const res = await fetch(`${URL_BASE}${path}`, { headers: headers(), signal: t.signal });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  } finally {
    t.done();
  }
}
