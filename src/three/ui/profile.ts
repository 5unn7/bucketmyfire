/**
 * Player profile + selectable-content catalog (v1 onboarding).
 *
 * The onboarding screen lets a pilot pick a callsign (name), a MAP, and a
 * HELICOPTER, then persists that choice in the browser (localStorage) so a
 * returning player skips straight to a "Welcome back" quick-start.
 *
 * Scope: ONE map is playable today (the live boreal world); the other maps are
 * `available: false` placeholders ("Coming soon"). All THREE helicopters are
 * playable, but the campaign GATES them — they are not all unlocked at the start:
 * the Bell 205A-1 is open from mission one, the Bell 212 unlocks once you've cleared
 * `unlockAfter` missions, and the UH-60 unlocks for the last three. `isHeliUnlocked()`
 * resolves that gate against `missions/progress`; the pickers (Onboarding +
 * the hangar) render a locked card with the requirement until it's met.
 */

import { getProgress, getPurchasedHelis, recordHeliPurchase } from '../missions/progress';
import { careerScore } from '../missions/rank';
import { mapCards } from '../maps/registry';
import { cleanCallsign, randomCallsign } from './callsign';

export interface Profile {
  /** Pilot callsign — display only (shown on the end banner). */
  name: string;
  /** Selected map id (see MAPS). v1: always the one playable map. */
  mapId: string;
  /** Selected helicopter id (see HELIS). v1: always the one playable heli. */
  heliId: string;
}

/** A pickable card in the onboarding roster (map or helicopter). */
export interface CatalogItem {
  id: string;
  name: string;
  tagline: string; // one-line subtitle under the name
  blurb: string; // a sentence of flavor shown on the card
  available: boolean; // false → rendered dimmed with a "SOON" badge, not selectable
  accent: string; // CSS color for the card's procedural art (zero binary assets)
  glyph: string; // a single emoji/glyph standing in for cover art
  /** Optional real cover art (served from public/, BASE_URL-prefixed). When set, the 3D card shows
   *  this floating over the accent halo instead of the procedural fallback — the data-only seam for
   *  dropping in heli / map renders (e.g. the isometric Saskatchewan map). */
  imageUrl?: string;
  /** Optional spec bars (helis) — value is 0..1, drives a little meter on the card. */
  specs?: { label: string; value: number }[];
  /** Optional headline facts (maps) — pre-formatted province scale shown as stat rows on the card. */
  stats?: { area: string; lakes: string };
  /** Campaign gate (helis): missions that must be CLEARED before this airframe is
   *  flyable. 0/undefined → open from the start. See isHeliUnlocked(). */
  unlockAfter?: number;
  /** Career-points PRICE (helis): the alternative unlock path — buy the airframe with points instead
   *  of waiting for the campaign gate. 0/undefined → not purchasable (only the mission gate opens it).
   *  Spent against the wallet (availablePoints = career points − points already spent). See buyHeli(). */
  cost?: number;
}

// --- Maps -------------------------------------------------------------------
// DERIVED from the maps/ registry (the single source of map identity — src/three/maps/). The map
// DATA stays bundler-agnostic (root-relative imageUrl path); the UI roots it here. ROOT-absolute,
// NOT import.meta.env.BASE_URL: with vite `base:'./'` BASE_URL is page-relative, which 404s on the
// sub-path pages that consume this catalog (/campaign/, /open-skies/). The site deploys at the
// domain root (hub.ts already hard-codes /images/...). Add a map = a folder under src/three/maps/.
export const MAPS: CatalogItem[] = mapCards().map((c) => ({
  ...c,
  imageUrl: c.imageUrl ? '/' + c.imageUrl : undefined,
}));

// --- Helicopters ------------------------------------------------------------
// Each entry maps to a glTF model in meshes/heliModels.ts (HELI_MODELS) by id AND to a
// gameplay class in config.ts (HELI_CLASSES) by the SAME id — so selecting one now changes
// the airframe AND how it flies/carries/survives. The spec bars below illustrate that class:
// 205 = slow/forgiving/small, 212 = medium, UH-60 = fast/big/twitchy/tough.
//
// They unlock TWO ways (either suffices): by campaign progress (`unlockAfter` = missions to clear) OR
// by SPENDING career points (`cost`). A new pilot starts on the trainer and earns the heavier ships —
// the 205 is open, the 212 unlocks after the first two missions (in time for the first real wall), and
// the Black Hawk for the last three (the set-piece + finale) — but a points-rich pilot stuck on a gate
// can buy the next airframe early. (Additive — clearing a tier never takes an earlier airframe away,
// and a points purchase is permanent.) The mission gate stays the "free" path; `cost` is the shortcut.
//
// `imageUrl` is a cinematic key-art render of each airframe in its livery over a boreal wildfire
// (public/images/heli/, ROOT-absolute — BASE_URL is './' in prod, i.e. page-relative, and 404s on
// the sub-path pickers /campaign/ + /open-skies/ that render these cards) —
// the pickers show it full-bleed behind the scrim, with the procedural "hangar bay" art as fallback.
const HELI_ART = '/images/heli/';
export const HELIS: CatalogItem[] = [
  {
    id: 'bell-205a1',
    name: 'Bell 205A-1',
    tagline: 'The trainer',
    blurb: 'Single-engine Huey in firefighting livery. The forgiving one: stable and easy to place — but the slowest, with the smallest bucket (half the Black Hawk). Learn the slung-bucket feel here.',
    available: true,
    accent: '#c4232c',
    glyph: '🚁',
    imageUrl: HELI_ART + 'Bell205A1.webp',
    specs: [
      { label: 'Speed', value: 0.55 },
      { label: 'Agility', value: 0.85 },
      { label: 'Bucket', value: 0.5 },
      { label: 'Airframe', value: 0.6 },
    ],
  },
  {
    id: 'bell-212',
    name: 'Bell 212',
    tagline: 'Twin-engine medium',
    blurb: 'The Twin-Pac sister of the Huey — more power, a bigger belly, and a tougher airframe. A balanced step up from the 205: faster and carries more, still steady in the gusts off the lakes.',
    available: true,
    unlockAfter: 2, // earned at Mission 3 — the first real wall (Hold the Line)
    cost: 5000, // …or buy it early with career points (the spend-to-unlock path)
    accent: '#d8a12a',
    glyph: '🚁',
    imageUrl: HELI_ART + 'Bell212.webp',
    specs: [
      { label: 'Speed', value: 0.7 },
      { label: 'Agility', value: 0.62 },
      { label: 'Bucket', value: 0.75 },
      { label: 'Airframe', value: 0.75 },
    ],
  },
  {
    id: 'uh-60',
    name: 'UH-60 Black Hawk',
    tagline: 'Supreme — a handful',
    blurb: 'A big four-blade utility ship: the fastest, biggest tank (double the 205), and toughest airframe. But heavy and twitchy down low — all that momentum overshoots, so it takes a confident hand. Supreme range and payload for an experienced pilot.',
    available: true,
    unlockAfter: 5, // unlocks from Mission 6 (Three Towns, the set-piece) through After Burn + the finale
    cost: 15000, // …or buy it early with career points (a steep but reachable shortcut to the top ship)
    accent: '#5b6b50',
    glyph: '🚁',
    imageUrl: HELI_ART + 'UH60.webp',
    specs: [
      { label: 'Speed', value: 0.95 },
      { label: 'Agility', value: 0.4 },
      { label: 'Bucket', value: 1.0 },
      { label: 'Airframe', value: 0.95 },
    ],
  },
];

/** First available item in a catalog — the sensible default selection. */
export function firstAvailable(catalog: CatalogItem[]): CatalogItem {
  return catalog.find((c) => c.available) ?? catalog[0];
}

export function findItem(catalog: CatalogItem[], id: string | undefined): CatalogItem | undefined {
  return catalog.find((c) => c.id === id);
}

/**
 * How many campaign missions the pilot has CLEARED — the value heli unlocks gate on.
 * Reads the same localStorage progress the mission menu uses (0 for a fresh pilot).
 */
export function missionsCleared(): number {
  return getProgress().completed.length;
}

/**
 * TEST UNLOCK (dev / QA only): in a dev build (`npm run dev`) or behind `?qa` / `?unlockall` on the
 * URL, EVERY airframe is flyable so the whole fleet can be exercised without grinding points. This
 * NEVER fires on a normal prod load, so it can't hand real players free aircraft or feed the global
 * board — the same gate the ConfigPanel / `__game` debug handle ride. Window access is try/guarded so
 * a non-browser import (a Node gate that pulls this module in) just sees `false`.
 */
function testUnlockAll(): boolean {
  try {
    if (import.meta.env.DEV) return true;
    const q = new URLSearchParams(window.location.search);
    return q.has('qa') || q.has('unlockall');
  } catch {
    return false;
  }
}

/**
 * Is a helicopter flyable right now? It must exist (`available`) AND be unlocked by ANY path:
 * the TEST gate (dev / `?qa` / `?unlockall`), the campaign gate (cleared ≥ `unlockAfter`, default
 * 0 → open from the start), OR a career-points purchase. Pass a pre-read `cleared` count and
 * `purchased` list when gating a whole picker grid so it doesn't re-hit storage per card.
 */
export function isHeliUnlocked(
  heli: CatalogItem,
  cleared: number = missionsCleared(),
  purchased: string[] = getPurchasedHelis(),
): boolean {
  return heli.available && (testUnlockAll() || cleared >= (heli.unlockAfter ?? 0) || purchased.includes(heli.id));
}

// --- Career-points economy (spend-to-unlock) --------------------------------
// The wallet is derived, never stored: career points (Σ best-per-mission, the same lifetime total the
// rank ladder reads) MINUS the points already spent on aircraft. Storing only the purchase LIST (in
// missions/progress) and deriving "spent" from the cost table keeps the wallet self-consistent — a
// cloud merge that unions purchases can never desync a separately-stored balance. Career points
// themselves are untouched by spending (rank reflects lifetime achievement, not your current balance).

/** A heli's career-points price (0 = not purchasable — only its mission gate opens it). */
export function heliCost(heli: CatalogItem): number {
  return heli.cost ?? 0;
}

/** Points already spent on aircraft = Σ cost of every purchased heli still in the catalog. */
export function spentPoints(purchased: string[] = getPurchasedHelis()): number {
  return HELIS.reduce((sum, h) => (purchased.includes(h.id) ? sum + heliCost(h) : sum), 0);
}

/** The spendable wallet: lifetime career points minus everything already spent on aircraft. */
export function availablePoints(): number {
  return Math.max(0, careerScore() - spentPoints());
}

/** Was this airframe unlocked by SPENDING points (vs the campaign gate)? Drives the "bought" copy. */
export function isHeliPurchased(heli: CatalogItem, purchased: string[] = getPurchasedHelis()): boolean {
  return purchased.includes(heli.id);
}

/** Result of attempting a points purchase — `ok` plus a reason code for the UI to message. */
export type BuyResult = { ok: boolean; reason?: 'unavailable' | 'owned' | 'free' | 'priceless' | 'funds' };

/**
 * Buy a helicopter with career points. Validates the whole gate here (the single chokepoint both the
 * Hangar and any future surface route through): the ship must be sellable, not already owned, priced,
 * and affordable against the live wallet. On success it records the purchase (idempotent) so the heli
 * is permanently flyable. Never throws — a blocked buy returns `ok:false` with a reason.
 */
export function buyHeli(heli: CatalogItem): BuyResult {
  if (!heli.available) return { ok: false, reason: 'unavailable' };
  const cleared = missionsCleared();
  const purchased = getPurchasedHelis();
  if (purchased.includes(heli.id)) return { ok: false, reason: 'owned' };
  if (cleared >= (heli.unlockAfter ?? 0)) return { ok: false, reason: 'free' }; // already earned the free way
  const cost = heliCost(heli);
  if (cost <= 0) return { ok: false, reason: 'priceless' };
  if (availablePoints() < cost) return { ok: false, reason: 'funds' };
  recordHeliPurchase(heli.id);
  return { ok: true };
}

/**
 * Helicopters whose campaign gate is crossed by going from `before` to `after` cleared missions —
 * i.e. `unlockAfter` lands in `(before, after]`. Drives the on-win "NEW AIRCRAFT UNLOCKED" callout:
 * Game samples the cleared count either side of recording a win and asks which airframes just opened.
 */
export function newlyUnlockedHelis(before: number, after: number): CatalogItem[] {
  return HELIS.filter((h) => {
    const at = h.unlockAfter ?? 0;
    return h.available && at > before && at <= after;
  });
}

const STORAGE_KEY = 'bmf.profile.v1';

/**
 * Load a saved profile, or null if none / unusable. A stored map/heli that no
 * longer exists or is no longer available is dropped back to the default, so a
 * future content change can never strand a returning player on a dead pick.
 */
export function loadProfile(): Profile | null {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    return null; // storage blocked (private mode / disabled) — treat as first run
  }
  if (!raw) return null;
  try {
    const data = JSON.parse(raw) as Partial<Profile>;
    // Sanitize on the way OUT, not just on save: cleanCallsign runs in the editor, but a hand-tampered
    // localStorage value or a restored cloud-save could carry raw markup that would reach an innerHTML
    // sink (HomeScreen/TitleScreen render the name). loadProfile is the single chokepoint every screen
    // reads through, so cleaning here closes that hole for all of them (also NFC-normalizes + clamps to 24).
    const name = typeof data.name === 'string' ? cleanCallsign(data.name) : '';
    if (!name) return null;
    const map = findItem(MAPS, data.mapId);
    const heli = findItem(HELIS, data.heliId);
    return {
      name,
      mapId: map?.available ? map.id : firstAvailable(MAPS).id,
      // Clamp a still-locked heli (e.g. progress was cleared/restored under the saved pick)
      // back to the always-open trainer, so the boot path can never fly an un-earned airframe.
      heliId: heli && isHeliUnlocked(heli) ? heli.id : firstAvailable(HELIS).id,
    };
  } catch {
    return null; // corrupt JSON — start fresh
  }
}

/** True once a pilot has a usable saved profile with a real callsign (loadProfile rejects an
 *  empty name). The boot path uses this to gate play behind the first-run identity screen. */
export function hasNamedProfile(): boolean {
  return loadProfile() !== null;
}

export function saveProfile(profile: Profile): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
  } catch {
    // Storage unavailable — the session still works, the choice just won't persist.
  }
}

/**
 * The pilot's callsign for lead/board association — guaranteed non-empty. Returns the saved callsign,
 * or, for a player who reaches a capture surface WITHOUT ever naming themselves (rare: the notify-me /
 * front-door flows can fire before the in-game identity screen), generates a random callsign AND
 * PERSISTS it as a fresh profile. Persisting is the "sync": the same handle ties their email to a row
 * in the leadlist now, and follows them into the game + onto the board when they later fly — so a
 * lead captured pre-naming and a future pilot are the same person, not two.
 */
export function ensureCallsign(): string {
  const existing = loadProfile();
  if (existing) return existing.name;
  const name = randomCallsign();
  saveProfile({ name, mapId: firstAvailable(MAPS).id, heliId: firstAvailable(HELIS).id });
  return name;
}

export function clearProfile(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

// --- Cold-start ritual seen-flag (#9) ---------------------------------------
// The hold-to-spool engine start is a great fantasy beat the FIRST time and a speed bump by the sixth
// mission. We persist a one-bit "you've done it once" flag so the boot path skips the ritual on later
// missions (booting with the engine already running, the same path QA/?autostart uses).
const COLD_START_KEY = 'bmf.coldstart.v1';

/** Has the pilot completed the hold-to-start ritual at least once? (Later missions skip it.) */
export function coldStartSeen(): boolean {
  try {
    return localStorage.getItem(COLD_START_KEY) === '1';
  } catch {
    return false; // storage blocked → just show the ritual each time (harmless)
  }
}

/** Record that the cold-start ritual has been completed once. */
export function markColdStartSeen(): void {
  try {
    localStorage.setItem(COLD_START_KEY, '1');
  } catch {
    /* storage unavailable — the ritual simply shows again next time */
  }
}
