/**
 * Shared HUD data contracts. These are the POJOs that flow between Game (the only
 * Three-touching gameplay layer) and the DOM HUD + its sub-modules (radar, end
 * screen, engine-start). Kept in their own module so the sub-modules can import them
 * without depending on the HUD class itself (no import cycle); `HUD.ts` re-exports
 * all three so every existing `import … from './HUD'` keeps working unchanged.
 */

import type { TrackerItem, ScoreBreakdown } from '../missions/types';

export interface HudState {
  water: number;
  waterMax: number;
  scooping?: boolean; // bucket is actively filling — the water fill-bar glows so "keep dipping" reads
  bucketDetached?: boolean; // bucket jettisoned (no scoop/drop) — water pod reads "NO BUCKET" until re-rigged at a base
  health?: number; // 0..1 airframe health (always supplied; drives the HEALTH gauge)
  healthLow?: boolean; // gauge flashes red below the warn line
  firesLeft: number;
  hint: string | null;
  won: boolean;
  altFt: number; // barometric altitude (MSL, above sea-level datum) in FEET — the tape value
  raFt: number; // radar altitude (above the surface directly below) in FEET — low-flight / landing
  speed: number; // airspeed in KNOTS
  vertSpeed: number; // vertical speed in FT/MIN (+ climb, − descend)
  heliX: number;
  heliZ: number;
  yaw: number; // heading (rad) — drives heading tape + radar
  windKt: number; // wind speed in knots
  windDir: number; // world angle (rad) the wind blows TOWARD
  fires: { x: number; z: number }[];
  lakes: { x: number; z: number; r: number }[];
  worldSize: number; // bounding SQUARE extent (= the fire-field / burn-overlay grid span)
  worldSizeX: number; // true playfield rect (X) — the satellite-map blit uses this so a 'bounds' map isn't stretched
  worldSizeZ: number; // true playfield rect (Z)
  // C3 stakes: structures to defend, the threat gauge, lose state + final score.
  structures: { x: number; z: number; kind: 'cabin' | 'depot'; health: number; burning: boolean }[];
  bases?: { x: number; z: number }[]; // refuel bases (home + forward pads) — radar markers + low-fuel RTB cue
  threat: number; // 0..1 — most-endangered structure (drives the THREAT gauge)
  threatName?: string; // the most-threatened community's name — shown on the gauge at the critical moment
  lost: boolean; // every structure destroyed → mission failed
  score: number; // final score (shown on the end banner)
  // Campaign layer: the live objective checklist + optional fuel gauge. Empty / undefined
  // in the open sandbox, so the mission UI simply doesn't render.
  objectives?: readonly TrackerItem[];
  fuel?: number; // 0..1 tank fraction (undefined → no FuelSim → fuel gauge hidden)
  fuelLow?: boolean; // gauge flashes (below reserve)
  zones?: { x: number; z: number; active: boolean; done: boolean; home: boolean; lost?: boolean }[]; // crew landing zones (radar blips); `home` = the always-marked base, `lost` = the fire reached the family
  // Crew transport (delivery/evac missions): how many crew are aboard + the live board/disembark dwell.
  // Drives the strip's crew-count icon and the "CREW BOARDING / DISEMBARKING" progress bar. Undefined
  // on water missions, so neither element renders.
  crew?: {
    onboard: number; // crew currently in the cabin (0 or 1)
    delivered: number; // crews set down so far
    total: number; // crews to deliver this mission
    mode: 'boarding' | 'disembarking' | 'deploying' | null; // actively working a zone (drives the bar), else null
    progress: number; // 0..1 dwell on the worked zone
  };
  // Debrief summary for the end banner (what the run achieved) — built once at outcome.
  debrief?: {
    firesOut: number;
    firesTotal: number;
    structSaved: number;
    structTotal: number;
    crewDone: number;
    crewTotal: number;
    timeSec: number;
    breakdown?: ScoreBreakdown; // line-itemed score + grade (absent on a crash → plain score shown)
    // Why the run ended in failure → picks the blunt, cause-specific banner sub-line (so a crash
    // doesn't read "the fire won"). Set on a loss; ignored on a win. 'fire' is the catch-all.
    cause?: 'tree' | 'impact' | 'airframe' | 'bridge' | 'fuel' | 'casualty' | 'timeout' | 'structures' | 'fire';
  };
  // Aircraft whose campaign gate this WIN just crossed — drives the end-screen "NEW AIRCRAFT
  // UNLOCKED" callout (the progression payoff, otherwise invisible until the menu). Empty/undefined
  // when nothing new opened (a loss, a replay, or a mission that doesn't cross a threshold).
  unlocked?: { name: string; tagline: string }[];
}

/** Campaign end-banner callbacks (set by Game from main's mission router). */
export interface EndScreenHooks {
  hasNext: boolean; // is there a next mission to advance to?
  onNext(): void; // ▶ Next mission
  onMenu(): void; // ◂ Mission menu
  onRetry(): void; // ↻ Retry this mission
  noRetry?: boolean; // suppress the RETRY button entirely (Daily Burn — one play per day, no replay)
  onLeaderboard?(): void; // 🏆 open the global leaderboard on this mission
}

/** Static world place-name labels for the radar (A5) — set once, world-fixed. */
export interface MapLabels {
  communities: { name: string; x: number; z: number }[];
  lakes: { name: string; x: number; z: number }[];
  landmarks?: { name: string; x: number; z: number; kind: 'city' | 'town' }[]; // decorative reference places
  // (far-north settlements + southern cities) — drawn dimmer, on the expanded province map only
  outline?: { x: number; z: number }[]; // real province boundary (world XZ); expanded radar fits + clips to it
}
