/**
 * Saskatchewan — TRUE-SHAPE map (the rectangular-playfield foundation, 2026-06-05).
 *
 * This is the first map to opt into the true-shape playfield: instead of the province floating in the
 * middle of a square world with muted off-province margins on the radar, the WORLD'S EXTENT becomes the
 * province's projected bounding box (longest axis = the world budget), so Saskatchewan's boundary sits at
 * the map edge — "every map fits into the budget but is shaped like the actual province."
 *
 * It is built by RECEIVING the live Saskatchewan region (passed from regions.ts) and reusing all of its
 * authored data verbatim — anchors, named lakes, landmarks, highways, uplands, rivers, geo box + outline.
 * The ONLY change is `geo.fit = 'bounds'`, which flips World.computeWorldFrame from the square fit to the
 * rectangular bounding-box fit. So the SK world is byte-identical in content; only its framing differs.
 *
 * WHY a builder (not a spread const that imports SASKATCHEWAN): importing the base region's VALUE back from
 * regions.ts would create a runtime import cycle (regions.ts must import THIS file to register it), and the
 * spread would hit Saskatchewan in the temporal dead zone → crash. Taking the base as a PARAMETER means this
 * file imports only TYPES from regions.ts (erased at compile time → no runtime cycle), and regions.ts calls
 * the builder AFTER the base is fully defined. This is the seam every future true-shape map follows: a new
 * file exporting `makeXxx(base)` (or building from scratch), plus one registry line in regions.ts.
 */

import type { Region, GeoFrame } from '../regions';

/** The map id — mirrors the picker card in ui/profile.ts MAPS (keep the two in sync). */
export const SASKATCHEWAN_TRUE_ID = 'saskatchewan-true';

/**
 * Grow the true-shape Saskatchewan region from the live `base` Saskatchewan region. Reuses every data field
 * (names/anchors/lakes/rivers/…); overrides only id/label and flips the geo frame to `fit: 'bounds'` so the
 * world is fitted to the province's bounding box (true rectangular shape) rather than centred in a square.
 */
export function makeSaskatchewanTrue(base: Region): Region {
  return {
    ...base,
    id: SASKATCHEWAN_TRUE_ID,
    label: 'Saskatchewan (true shape)',
    // Same real geo box + outline as the square map; only the fit changes. (`base.geo` is always present on
    // Saskatchewan; the cast is safe because regions.ts only ever calls this with the SK region.)
    geo: { ...(base.geo as GeoFrame), fit: 'bounds' },
  };
}
