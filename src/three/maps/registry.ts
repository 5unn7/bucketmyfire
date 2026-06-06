/**
 * Map registry — the single resolver the engine + UI key off. Flat list of MapModules (each tagged
 * with a `country`); resolvers keep the EXACT signatures the old world/regions.ts + world/terrainProfile.ts
 * exposed, so the cutover is byte-identical. No import.meta.env in this graph (Node verify-bundle safe);
 * BASE_URL prefixing of card art lives only in ui/profile.ts.
 */
import type { MapModule, MapCard, Region, TerrainProfile } from './types';
import type { MissionDef } from '../missions/types';
import { saskatchewan } from './saskatchewan';
import { britishColumbia } from './british-columbia';
import { alberta } from './alberta';
import { ontario } from './ontario';

// NOTE: the `saskatchewan-true` bounds-fit test bed was DELETED in Slice 2 — `saskatchewan` itself is now
// the true-shape, outline-masked rectangular world (its region declares geo.fit:'bounds'), so a separate
// rectangle map is redundant.

// Registry ORDER is load-bearing: saskatchewan first → MAPS[0] / firstAvailable resolve to it; matches
// the legacy world/regions.ts REGIONS insertion order so regionIds() is unchanged for the editor.
const MAPS: readonly MapModule[] = [saskatchewan, britishColumbia, alberta, ontario];
const BY_ID = new Map<string, MapModule>(MAPS.map((m) => [m.id, m]));

export const DEFAULT_REGION_ID = 'saskatchewan';
const fallback = (): MapModule => BY_ID.get(DEFAULT_REGION_ID)!; // SK always has region + terrain

export function getMap(id?: string): MapModule {
  return (id ? BY_ID.get(id) : undefined) ?? fallback();
}
/** Resolve a region by id, falling back to Saskatchewan for an unknown/missing id (legacy signature). */
export function getRegion(id?: string): Region {
  return getMap(id).region;
}
/** Resolve a terrain profile by id; maps with no profile fall back to Saskatchewan's (legacy behaviour). */
export function getTerrainProfile(id?: string): TerrainProfile {
  return getMap(id).terrain ?? fallback().terrain!;
}
/** All registered map ids, in registry order — used by the map editor's map picker. */
export function regionIds(): string[] {
  return [...BY_ID.keys()];
}
/** The picker cards (BASE_URL-relative imageUrl; ui/profile.ts prefixes). */
export function mapCards(): MapCard[] {
  return MAPS.map((m) => m.card);
}
/** Distinct countries present — the picker groups by country only when this has >1 entry. */
export function countriesPresent(): string[] {
  return [...new Set(MAPS.map((m) => m.country))];
}
export function missionsForMap(id: string): readonly MissionDef[] {
  return getMap(id).missions ?? [];
}
/** The whole campaign across all maps, in registry order (SK first → CAMPAIGN[0]). */
export function allMissions(): MissionDef[] {
  return MAPS.flatMap((m) => [...(m.missions ?? [])]);
}
export function missionById(id: string): MissionDef | undefined {
  return allMissions().find((m) => m.id === id);
}
