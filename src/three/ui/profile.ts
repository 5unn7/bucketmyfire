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
 * the Bell 205A-1 is open from sortie one, the Bell 212 unlocks once you've cleared
 * `unlockAfter` sorties, and the UH-60 unlocks for the last two. `isHeliUnlocked()`
 * resolves that gate against `missions/progress`; the pickers (Onboarding +
 * MissionSelect) render a locked card with the requirement until it's met.
 */

import { getProgress } from '../missions/progress';

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
  /** Optional spec bars (helis) — value is 0..1, drives a little meter on the card. */
  specs?: { label: string; value: number }[];
  /** Campaign gate (helis): sorties that must be CLEARED before this airframe is
   *  flyable. 0/undefined → open from the start. See isHeliUnlocked(). */
  unlockAfter?: number;
}

// --- Maps -------------------------------------------------------------------
// The first entry is the live world; the rest are placeholders for FUTURE MAPS.
export const MAPS: CatalogItem[] = [
  {
    id: 'boreal-shield',
    name: 'Northern Shield',
    tagline: 'Boreal · Saskatchewan',
    blurb: 'Glacier-scoured granite, meandering eskers, and a chain of cold kettle lakes. The starting country.',
    available: true,
    accent: '#3f7d4a',
    glyph: '🌲',
  },
  {
    id: 'ember-flats',
    name: 'Ember Flats',
    tagline: 'Muskeg · high fire load',
    blurb: 'Flat peatland bogs that catch fast and run with the wind. Few lakes — pick your water carefully.',
    available: false,
    accent: '#b5642a',
    glyph: '🔥',
  },
  {
    id: 'glacier-coast',
    name: 'Glacier Coast',
    tagline: 'Fjords · open water',
    blurb: 'Steep coastal valleys and deep cold inlets. Water everywhere, but the wind funnels through the passes.',
    available: false,
    accent: '#3d7fa6',
    glyph: '🏔️',
  },
];

// --- Helicopters ------------------------------------------------------------
// Each entry maps to a glTF model in meshes/heliModels.ts (HELI_MODELS) by id AND to a
// gameplay class in config.ts (HELI_CLASSES) by the SAME id — so selecting one now changes
// the airframe AND how it flies/carries/survives. The spec bars below illustrate that class:
// 205 = slow/forgiving/small, 212 = medium, UH-60 = fast/big/twitchy/tough.
//
// They are GATED by campaign progress (`unlockAfter` = sorties to clear), so a new pilot
// starts on the trainer and earns the heavier ships: the 205 is open, the 212 unlocks after
// the first two sorties (in time for the first real wall), and the Black Hawk for the last two
// (the set-piece + finale). (Additive — clearing a tier never takes an earlier airframe away.)
export const HELIS: CatalogItem[] = [
  {
    id: 'bell-205a1',
    name: 'Bell 205A-1',
    tagline: 'The trainer',
    blurb: 'Single-engine Huey in water-bomber livery. The forgiving one: stable and easy to place — but the slowest, with the smallest bucket (half the Black Hawk). Learn the slung-bucket feel here.',
    available: true,
    accent: '#c8362a',
    glyph: '🚁',
    specs: [
      { label: 'Speed', value: 0.55 },
      { label: 'Agility', value: 0.85 },
      { label: 'Bucket', value: 0.5 },
      { label: 'Hull', value: 0.6 },
    ],
  },
  {
    id: 'bell-212',
    name: 'Bell 212',
    tagline: 'Twin-engine medium',
    blurb: 'The Twin-Pac sister of the Huey — more power, a bigger belly, and a tougher hull. A balanced step up from the 205: faster and carries more, still steady in the gusts off the lakes.',
    available: true,
    unlockAfter: 2, // earned at Mission 3 — the first real wall (Hold the Line)
    accent: '#d8a12a',
    glyph: '🚁',
    specs: [
      { label: 'Speed', value: 0.7 },
      { label: 'Agility', value: 0.62 },
      { label: 'Bucket', value: 0.75 },
      { label: 'Hull', value: 0.75 },
    ],
  },
  {
    id: 'uh-60',
    name: 'UH-60 Black Hawk',
    tagline: 'Supreme — a handful',
    blurb: 'A big four-blade utility ship: the fastest, biggest tank (double the 205), and toughest hull. But heavy and twitchy down low — all that momentum overshoots, so it takes a confident hand. Supreme range and payload for an experienced pilot.',
    available: true,
    unlockAfter: 4, // unlocks for Missions 5 & 6 — the set-piece + the finale
    accent: '#5b6b50',
    glyph: '🚁',
    specs: [
      { label: 'Speed', value: 0.95 },
      { label: 'Agility', value: 0.4 },
      { label: 'Bucket', value: 1.0 },
      { label: 'Hull', value: 0.95 },
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
 * How many campaign sorties the pilot has CLEARED — the value heli unlocks gate on.
 * Reads the same localStorage progress the mission menu uses (0 for a fresh pilot).
 */
export function missionsCleared(): number {
  return getProgress().completed.length;
}

/**
 * Is a helicopter flyable right now? It must exist (`available`) AND the campaign must have
 * cleared at least `unlockAfter` sorties (default 0 → open from the start). Pass a pre-read
 * `cleared` count when gating a whole picker grid so it doesn't re-hit storage per card.
 */
export function isHeliUnlocked(heli: CatalogItem, cleared: number = missionsCleared()): boolean {
  return heli.available && cleared >= (heli.unlockAfter ?? 0);
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
    const name = typeof data.name === 'string' ? data.name.trim() : '';
    if (!name) return null;
    const map = findItem(MAPS, data.mapId);
    const heli = findItem(HELIS, data.heliId);
    return {
      name: name.slice(0, 24),
      mapId: map?.available ? map.id : firstAvailable(MAPS).id,
      // Clamp a still-locked heli (e.g. progress was cleared/restored under the saved pick)
      // back to the always-open trainer, so the boot path can never fly an un-earned airframe.
      heliId: heli && isHeliUnlocked(heli) ? heli.id : firstAvailable(HELIS).id,
    };
  } catch {
    return null; // corrupt JSON — start fresh
  }
}

export function saveProfile(profile: Profile): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
  } catch {
    // Storage unavailable — the session still works, the choice just won't persist.
  }
}

export function clearProfile(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
