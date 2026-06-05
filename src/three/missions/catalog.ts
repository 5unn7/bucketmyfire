/**
 * Campaign assembler. The campaign DATA now lives per-map under `src/three/maps/<region>/missions.ts`
 * (Saskatchewan's 8-mission campaign is `maps/saskatchewan/missions.ts`); this thin module composes
 * the full campaign from the map registry so the long-standing consumers — `main.ts`,
 * `scripts/verify-campaign.ts`, and the menus — keep importing `CAMPAIGN` / `missionById` from here
 * unchanged. To add or edit a mission, edit the map's `missions.ts`, not this file.
 */
import type { MissionDef } from './types';
import { allMissions } from '../maps/registry';

/** The whole campaign across all maps, in registry order (Saskatchewan first → CAMPAIGN[0]). */
export const CAMPAIGN: MissionDef[] = allMissions();

export function missionById(id: string): MissionDef | undefined {
  return CAMPAIGN.find((m) => m.id === id);
}
