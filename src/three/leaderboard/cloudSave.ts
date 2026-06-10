/**
 * Cloud progress save/restore — passwordless "pilot name + email" sync over Supabase RPC.
 *
 * Campaign progress (unlocks, best scores, the chosen heli/callsign) normally lives only in this
 * browser's localStorage, so clearing the cache or switching devices loses it. This module lets a
 * pilot pin that progress to an email so they can pull it back anywhere — with NO password and NO
 * Supabase Auth, exactly the lightweight model the project opted into.
 *
 * Privacy: the email is HASHED in the browser (SHA-256) and only the hash is ever sent; the server
 * never sees a plaintext email. The two Supabase functions (`save_cloud_progress` /
 * `load_cloud_progress`) are SECURITY DEFINER and the `cloud_saves` table is otherwise fully locked
 * (see supabase/schema.sql), so a save can only be read by someone who already knows the email + the
 * exact pilot name. The raw email IS kept in this device's localStorage (same trust as the rest of
 * the local save) purely to pre-fill the field and to auto-sync on win.
 *
 * Like the leaderboard client, everything here is best-effort and never throws into the game: when
 * Supabase isn't configured (`isConfigured()` false) the calls no-op and the UI degrades gracefully.
 */

import { isConfigured, restBase, restHeaders, withTimeout, getClientId } from './client';
import { exportProgress, importProgress, type Progress } from '../missions/progress';
import { HELIS, MAPS, findItem, firstAvailable, loadProfile, saveProfile, type Profile } from '../ui/profile';
import { cleanCallsign } from '../ui/callsign';

export { isConfigured };

// --- Local link (this device ⇄ a cloud account) -----------------------------
// Remembering the email+pilot lets us pre-fill the form and auto-push on every win. Stored on the
// user's own device only; the email is the lookup key, not a secret kept from its owner.

const LINK_KEY = 'bmf.cloud.v1';

export interface CloudLink {
  email: string;
  pilot: string;
}

export function getCloudLink(): CloudLink | null {
  try {
    const raw = localStorage.getItem(LINK_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as Partial<CloudLink>;
    if (typeof d.email === 'string' && typeof d.pilot === 'string' && d.email && d.pilot) {
      return { email: d.email, pilot: d.pilot };
    }
  } catch {
    /* ignore */
  }
  return null;
}

function setCloudLink(link: CloudLink): void {
  try {
    localStorage.setItem(LINK_KEY, JSON.stringify(link));
  } catch {
    /* storage blocked — auto-sync just won't persist across reloads */
  }
}

export function clearCloudLink(): void {
  try {
    localStorage.removeItem(LINK_KEY);
  } catch {
    /* ignore */
  }
}

export function isCloudLinked(): boolean {
  return getCloudLink() !== null;
}

// --- Email: validate + hash -------------------------------------------------

/** Light email check — enough to catch typos, not RFC-perfect (the address is only a lookup key). */
export function isValidEmail(email: string): boolean {
  const e = email.trim();
  return e.length >= 5 && e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}

/**
 * SHA-256 hex of the normalized email (lowercased, trimmed) with an app pepper, so the stored hash
 * isn't a bare email digest. Async (WebCrypto). Falls back to a non-crypto hash on the rare WebView
 * without `crypto.subtle` (still a stable, opaque key — uniqueness is all we need here).
 */
async function hashEmail(email: string): Promise<string> {
  const norm = 'bmf.cloud.v1|' + email.trim().toLowerCase();
  try {
    if (typeof crypto !== 'undefined' && crypto.subtle) {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(norm));
      return Array.from(new Uint8Array(buf))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    }
  } catch {
    /* fall through */
  }
  // Non-crypto fallback: FNV-ish double pass → a 16+ char hex key (satisfies the server length check).
  let h1 = 0x811c9dc5;
  let h2 = 0xc9dc5118;
  for (let i = 0; i < norm.length; i++) {
    h1 = Math.imul(h1 ^ norm.charCodeAt(i), 0x01000193) >>> 0;
    h2 = Math.imul(h2 + norm.charCodeAt(i), 0x85 ^ (i + 1)) >>> 0;
  }
  return 'fnv-' + h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}

// --- Save blob --------------------------------------------------------------

interface CloudBlob {
  v: 1;
  progress: Progress;
  profile: Profile | null;
}

function buildBlob(pilot: string): CloudBlob {
  const cur = loadProfile();
  const profile: Profile = {
    name: pilot,
    mapId: cur?.mapId ?? firstAvailable(MAPS).id,
    heliId: cur?.heliId ?? firstAvailable(HELIS).id,
  };
  return { v: 1, progress: exportProgress(), profile };
}

export type CloudResult = { ok: true; detail?: string } | { ok: false; reason: string };

// --- Public API -------------------------------------------------------------

/**
 * Push the current local progress to the cloud under (pilot, email). Also persists the pilot name
 * to the local profile so the in-game identity stays consistent, and remembers the link for
 * auto-sync. Validates format only — NOT leaderboard-style name uniqueness (the email keys the
 * account, so the same pilot re-saving from another device must be allowed).
 */
export async function saveToCloud(pilot: string, email: string): Promise<CloudResult> {
  if (!isConfigured()) return { ok: false, reason: 'Cloud saves are offline right now.' };
  const name = cleanCallsign(pilot);
  if (name.length < 2) return { ok: false, reason: 'Enter a callsign (2+ characters).' };
  if (!isValidEmail(email)) return { ok: false, reason: 'Enter a valid email address.' };

  // Keep the local identity in step with what we're saving under.
  const cur = loadProfile();
  saveProfile({
    name,
    mapId: findItem(MAPS, cur?.mapId)?.available ? (cur as Profile).mapId : firstAvailable(MAPS).id,
    heliId: findItem(HELIS, cur?.heliId)?.available ? (cur as Profile).heliId : firstAvailable(HELIS).id,
  });

  const ok = await postSave(name, email);
  if (!ok) return { ok: false, reason: 'Could not reach the cloud — try again.' };
  setCloudLink({ email: email.trim(), pilot: name });
  return { ok: true, detail: 'Progress saved to the cloud.' };
}

/**
 * Restore a cloud save by (pilot, email) and MERGE it into local progress (union of unlocks, max
 * best score — never destructive). Adopts the saved profile (callsign/heli/map) and remembers the
 * link. The caller should reload the menu afterward so unlocks/best scores re-render.
 */
export async function loadFromCloud(pilot: string, email: string): Promise<CloudResult> {
  if (!isConfigured()) return { ok: false, reason: 'Cloud saves are offline right now.' };
  const name = cleanCallsign(pilot);
  if (name.length < 2) return { ok: false, reason: 'Enter the callsign you saved under.' };
  if (!isValidEmail(email)) return { ok: false, reason: 'Enter the email you saved under.' };

  const hash = await hashEmail(email);
  const t = withTimeout(8000);
  let rows: { save: CloudBlob }[] | null = null;
  try {
    const res = await fetch(`${restBase()}/rest/v1/rpc/load_cloud_progress`, {
      method: 'POST',
      headers: restHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ p_email_hash: hash, p_pilot: name }),
      signal: t.signal,
    });
    if (res.ok) rows = (await res.json()) as { save: CloudBlob }[];
  } catch {
    rows = null;
  } finally {
    t.done();
  }

  if (rows === null) return { ok: false, reason: 'Could not reach the cloud — try again.' };
  if (rows.length === 0) return { ok: false, reason: 'No save found for that callsign + email.' };

  const blob = rows[0].save;
  if (blob?.progress) importProgress(blob.progress);
  applyProfile(blob?.profile, name);
  setCloudLink({ email: email.trim(), pilot: name });
  return { ok: true, detail: 'Progress restored.' };
}

/**
 * Fire-and-forget auto-sync after a win: if this device is linked to a cloud account, push the
 * fresh progress. Never throws — safe to `void` from the game loop. No-op when unlinked/offline.
 */
export async function cloudAutoSave(): Promise<void> {
  const link = getCloudLink();
  if (!link || !isConfigured()) return;
  try {
    await postSave(link.pilot, link.email);
  } catch {
    /* best-effort */
  }
}

// --- internals --------------------------------------------------------------

/** Hash the email and POST the current blob to the upsert RPC. Returns ok. `p_client_id` lets the RPC
 *  throttle NEW-save creation per device (a re-save of your own row is never throttled). */
async function postSave(pilot: string, email: string): Promise<boolean> {
  const hash = await hashEmail(email);
  const t = withTimeout(8000);
  try {
    const res = await fetch(`${restBase()}/rest/v1/rpc/save_cloud_progress`, {
      method: 'POST',
      headers: restHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ p_email_hash: hash, p_pilot: pilot, p_save: buildBlob(pilot), p_client_id: getClientId() }),
      signal: t.signal,
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    t.done();
  }
}

/** Adopt a restored profile (defensively — it came off the network), falling back to `fallbackName`. */
function applyProfile(p: Profile | null | undefined, fallbackName: string): void {
  const name = typeof p?.name === 'string' && p.name.trim() ? cleanCallsign(p.name) : fallbackName;
  const map = findItem(MAPS, p?.mapId);
  const heli = findItem(HELIS, p?.heliId);
  saveProfile({
    name: name || fallbackName,
    mapId: map?.available ? map.id : firstAvailable(MAPS).id,
    heliId: heli?.available ? heli.id : firstAvailable(HELIS).id,
  });
}
