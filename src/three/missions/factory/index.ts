/**
 * Mission FACTORY (Slice 3) — a deterministic PRODUCER of the existing `MissionDef`. Given a kind + seed it
 * picks an archetype (or one is forced), dials it by a seed-derived intensity, and wraps the archetype's
 * scenario output with the id / map / homeBase / sky to make a complete, ready-to-play `MissionDef`. Nothing
 * downstream changes — Game/runtime/scoring/HUD consume a generated def exactly like an authored one.
 *
 * Determinism: a single mulberry32 stream off `seed` drives the archetype pick, the intensity, the per-day
 * params, and the sky — same OPTS → same def (a pure POJO, no wall-clock / global-RNG in the emitted data).
 * The archetype-pick + intensity draws are consumed UNCONDITIONALLY (then overridden by opts) so forcing an
 * `archetypeId`/`intensity` doesn't shift the downstream stream — the def a forced pick yields matches the
 * auto-picked one. The optional `MapContext` (build-time pre-bake / host-side co-op) lets town-defense
 * archetypes target a real defensible town; without it (the runtime daily) archetypes stay World-free.
 */
import type { MissionDef, TimeOfDay } from '../types';
import { ARCHETYPES, archetypeById } from './archetypes';
import type { MapContext } from './MapContext';

/** mulberry32 — the factory's parameter PRNG (same family as daily.ts; seeded → deterministic). */
function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TIMES: readonly TimeOfDay[] = ['dawn', 'day', 'noon', 'overcast', 'golden', 'dusk'];

export type MissionKind = 'daily' | 'coop' | 'campaign';

export interface GenerateOpts {
  kind: MissionKind;
  seed: number; // the WORLD seed (also stamped onto the def)
  archetypeId?: string; // force a specific archetype; omit → seed-rotated
  intensity?: number; // 0..1 override; omit → seed-derived
  map?: string; // region id (default 'saskatchewan')
  homeBase?: string; // base anchor id (default 'la-ronge')
}

/**
 * Generate a complete `MissionDef`. Pure + deterministic from `opts.seed`. Pass a `MapContext` (built from
 * a World at BUILD time, never on a phone boot) to let town-defense archetypes pick a real defensible town.
 */
export function generateMission(opts: GenerateOpts, ctx?: MapContext): MissionDef {
  const r = makeRng(opts.seed ^ 0xa5a5a5a5);
  // Draw the pick + intensity UNCONDITIONALLY so forcing an archetype/intensity can't shift the stream that
  // feeds build() + the sky — a forced extinguish daily yields the same def as an auto-picked one.
  const pick = Math.floor(r() * ARCHETYPES.length);
  const rolledIntensity = r();
  const arche = opts.archetypeId ? (archetypeById(opts.archetypeId) ?? ARCHETYPES[pick]) : ARCHETYPES[pick];
  const intensity = opts.intensity ?? rolledIntensity;
  const out = arche.build(r, intensity, ctx);
  const timeOfDay = TIMES[Math.floor(r() * TIMES.length)];
  // A 'daily'-kind def carries a `daily-`-prefixed id so it FAILS SAFE under isDailyId (keeps generated
  // wins out of campaign unlocks) even if a caller forgets to stamp the id.
  const idPrefix = opts.kind === 'daily' ? 'daily-gen' : `gen-${opts.kind}`;
  return {
    id: `${idPrefix}-${opts.seed >>> 0}`,
    index: 0,
    name: out.flavor.kind,
    brief: out.flavor.brief,
    tagline: out.flavor.tagline,
    difficulty: out.difficulty,
    seed: opts.seed,
    map: opts.map ?? 'saskatchewan',
    homeBase: opts.homeBase ?? 'la-ronge',
    timeOfDay,
    wind: out.wind,
    fire: out.fire,
    bucket: out.bucket,
    payload: out.payload,
    fuel: out.fuel,
    fires: out.fires,
    structures: out.structures,
    objectives: out.objectives,
    fails: out.fails,
  };
}
