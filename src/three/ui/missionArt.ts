/**
 * Per-mission POSTER art — the data-only seam for the Screen 4 mission carousel. Empty today; the
 * user supplies mission images later (drop a file in public/missions/ and add one line here).
 *
 * Kept in the UI layer (not missions/) on purpose: `MissionDef` stays pure SCENARIO data (CLAUDE.md),
 * and the missions/ tree is partly esbuild-bundled for `verify:campaign`, which must not see
 * `import.meta.env`. This map is keyed by mission id — exactly like ui/icons.ts is keyed by card id.
 * `ScreenMission` falls back to a procedural cover when a poster is absent, so the carousel is
 * complete with or without art.
 */

/** Mission id → poster path RELATIVE to public/ (BASE_URL is applied by `missionPoster`). */
export const MISSION_POSTERS: Record<string, string> = {
  // 'first-light': 'missions/first-light.jpg',
  // 'crews-to-the-road': 'missions/crews-to-the-road.jpg',
  // …add the rest as art lands.
};

/** Resolve a mission's poster to a loadable URL (BASE_URL-prefixed), or undefined → procedural cover. */
export function missionPoster(id: string): string | undefined {
  const rel = MISSION_POSTERS[id];
  return rel ? import.meta.env.BASE_URL + rel : undefined;
}
