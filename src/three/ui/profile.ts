/**
 * Player profile + selectable-content catalog (v1 onboarding).
 *
 * The onboarding screen lets a pilot pick a callsign (name), a MAP, and a
 * HELICOPTER, then persists that choice in the browser (localStorage) so a
 * returning player skips straight to a "Welcome back" quick-start.
 *
 * v1 scope: only ONE map and ONE helicopter are actually playable (the live
 * boreal world + the Bell 205A-1 hero model). The catalog still lists the
 * planned future picks as `available: false` ("Coming soon") so the picker
 * reads as a real roster — and so wiring the real maps/helis in later is just
 * flipping a flag and pointing the generator at a preset (the planned seams:
 * a map = TERRAIN profile + seed + lake set behind World; a heli = a livery +
 * flight tuning behind createHelicopter()). Nothing downstream branches on the
 * id yet, so adding content never breaks an existing save.
 */

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
    blurb: 'The twin-pac sister of the Huey — more power, a bigger belly, and a tougher hull. A balanced step up from the 205: faster and carries more, still steady in the gusts off the lakes.',
    available: true,
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
      heliId: heli?.available ? heli.id : firstAvailable(HELIS).id,
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
