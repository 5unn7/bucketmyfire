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

/** A pilot's own position on a board: 1-based `rank` within `total` ranked pilots, plus their row.
 *  Lets the UI pin a "YOU · #14 · Top 5%" card even when the player is far below the visible top. */
export interface Standing<E> {
  rank: number;
  total: number;
  entry: E;
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
export function withTimeout(ms: number): { signal: AbortSignal; done: () => void } {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  return { signal: ctrl.signal, done: () => clearTimeout(t) };
}

/** REST base URL + auth headers, reused by the cloud-save module (same project + anon key). */
export function restBase(): string {
  return URL_BASE;
}
export function restHeaders(extra?: Record<string, string>): Record<string, string> {
  return headers(extra);
}

// --- Public API -------------------------------------------------------------

/**
 * Submit a winning run. Fire-and-forget: resolves to true on a 2xx, false on any failure
 * (unconfigured, network error, timeout, non-2xx). Never throws — the caller can ignore the
 * promise entirely.
 *
 * Goes through the `submit_score` SECURITY DEFINER RPC (not a direct `scores` table insert): direct
 * anon INSERT was revoked because the public anon key in the static bundle let anyone script an
 * unbounded flood of rows, and the 45s live-board cadence piled up a row per tick even for honest
 * play. The RPC UPSERTS one row per (mission, pilot, device) keeping the MAX, throttles per device,
 * and clamps the range server-side. Requires supabase/schema.sql to be applied to the project.
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
  const body = {
    p_pilot: pilot,
    p_mission_id: s.missionId.slice(0, 40),
    p_score: Math.max(0, Math.min(1_000_000, Math.round(s.score))),
    p_time_s: s.timeS !== undefined && isFinite(s.timeS) ? Math.max(0, Math.round(s.timeS * 10) / 10) : null,
    p_client_id: getClientId(),
  };
  const t = withTimeout(8000);
  try {
    const res = await fetch(`${URL_BASE}/rest/v1/rpc/submit_score`, {
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

/** A page of board rows plus the TOTAL number of ranked pilots (read from PostgREST's
 *  `Content-Range` header), so the UI can say "top 25 of 312" and compute percentiles. */
export interface Board<E> {
  rows: E[];
  total: number;
}

/** Top runs for one mission (each pilot's best), highest score first. Empty board on any failure. */
export async function fetchMissionTop(missionId: string, limit = 25): Promise<Board<MissionEntry>> {
  if (!isConfigured()) return { rows: [], total: 0 };
  const q = `mission_id=eq.${encodeURIComponent(missionId)}&order=score.desc,time_s.asc.nullslast&limit=${limit}`;
  const res = await getJsonWithCount<MissionEntry[]>(`/rest/v1/mission_best?${q}`);
  return { rows: res?.data ?? [], total: res?.total ?? res?.data?.length ?? 0 };
}

/** Overall career board (sum of best-per-mission per pilot), highest first. Empty board on failure. */
export async function fetchCareerTop(limit = 50): Promise<Board<CareerEntry>> {
  if (!isConfigured()) return { rows: [], total: 0 };
  const res = await getJsonWithCount<CareerEntry[]>(`/rest/v1/career_totals?order=total.desc&limit=${limit}`);
  return { rows: res?.data ?? [], total: res?.total ?? res?.data?.length ?? 0 };
}

/**
 * This device's standing on one mission board: its best row, the count of pilots ranked above it,
 * and the total field. `null` when the device has never posted to this mission, or on any network
 * failure — the caller then falls back to the local best. Ranking matches the board order: a pilot
 * is "above" you if their score is strictly higher (ties break by time in the view, close enough).
 */
export async function fetchMissionStanding(missionId: string): Promise<Standing<MissionEntry> | null> {
  if (!isConfigured()) return null;
  const id = getClientId();
  const mine = await getJson<MissionEntry[]>(
    `/rest/v1/mission_best?mission_id=eq.${encodeURIComponent(missionId)}&client_id=eq.${encodeURIComponent(id)}&limit=1`,
  );
  if (!mine || mine.length === 0) return null;
  const entry = mine[0];
  const above = await countRows(`/rest/v1/mission_best?mission_id=eq.${encodeURIComponent(missionId)}&score=gt.${entry.score}`);
  if (above == null) return null;
  const total = await countRows(`/rest/v1/mission_best?mission_id=eq.${encodeURIComponent(missionId)}`);
  return { rank: above + 1, total: total ?? above + 1, entry };
}

/** This pilot's standing on the career board (by callsign). `null` when unfound/offline/error. */
export async function fetchCareerStanding(pilot: string): Promise<Standing<CareerEntry> | null> {
  if (!isConfigured()) return null;
  const name = pilot.trim();
  if (name.length < 2) return null;
  const mine = await getJson<CareerEntry[]>(`/rest/v1/career_totals?pilot=eq.${encodeURIComponent(name)}&limit=1`);
  if (!mine || mine.length === 0) return null;
  const entry = mine[0];
  const above = await countRows(`/rest/v1/career_totals?total=gt.${entry.total}`);
  if (above == null) return null;
  const total = await countRows(`/rest/v1/career_totals`);
  return { rank: above + 1, total: total ?? above + 1, entry };
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

/** Like getJson, but also asks PostgREST for the exact total (`Prefer: count=exact`) and returns it
 *  from the `Content-Range` header — used to show "top N of TOTAL" without a second request. */
async function getJsonWithCount<T>(path: string): Promise<{ data: T; total: number | null } | null> {
  const t = withTimeout(8000);
  try {
    const res = await fetch(`${URL_BASE}${path}`, { headers: headers({ Prefer: 'count=exact' }), signal: t.signal });
    if (!res.ok) return null;
    const data = (await res.json()) as T;
    return { data, total: parseRangeTotal(res.headers.get('content-range')) };
  } catch {
    return null;
  } finally {
    t.done();
  }
}

/** Count rows matching a query WITHOUT paying for their bodies: ask for one row + the exact count,
 *  read the total from `Content-Range`. Returns null on any failure. */
async function countRows(path: string): Promise<number | null> {
  const sep = path.includes('?') ? '&' : '?';
  const t = withTimeout(8000);
  try {
    const res = await fetch(`${URL_BASE}${path}${sep}limit=1`, {
      headers: headers({ Prefer: 'count=exact' }),
      signal: t.signal,
    });
    if (!res.ok) return null;
    return parseRangeTotal(res.headers.get('content-range'));
  } catch {
    return null;
  } finally {
    t.done();
  }
}

/** PostgREST reports the total row count in the Content-Range header (e.g. "0-24/312", or a
 *  star-slash form when the offset is unknown). The total is the part after the slash. */
function parseRangeTotal(header: string | null): number | null {
  if (!header) return null;
  const slash = header.indexOf('/');
  if (slash < 0) return null;
  const n = parseInt(header.slice(slash + 1), 10);
  return Number.isFinite(n) ? n : null;
}
