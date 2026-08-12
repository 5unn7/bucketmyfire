/**
 * The live wildfire tracker's VIEW CONTRACT — the seam between the tracker page (openLiveFires in
 * ui/home/menus.ts: layer sheet, forecast scrubber, detail sheets, source ledger) and whatever
 * actually draws the map. `FireMap` (the flat Leaflet slippy map) is the one implementation — the
 * 3D `FireGlobe` was retired (nice look, but more complex + cluttered than productive). The contract
 * stays as a thin seam so the page never imports Leaflet directly (and a second view could return).
 *
 * No Leaflet, no DOM — importing this never pulls a map engine into the page bundle (the only value
 * imports are the theme tokens, which every page already carries). The tracker page only ever talks
 * to `LiveMapView`; everything else (data fetch, honesty model, layer state) lives outside the view.
 */
import { UI, MAP } from '../ui/theme';
import type { Hotspot, ReportedFire, BurnPolygon, FireSeverity, FireStage } from './types';

// ── Shared marker SEMANTICS ─────────────────────────────────────────────────────────────────────
// Every surface that draws a fire — the map marks, the Layers-sheet legend, the triage rail rows,
// the threat bar — reads these. One map per classification, here at the contract, never re-declared
// per view, or the legend starts lying about what a dot means.

/**
 * Stage of control → mark STYLE. Hue always means fire; stage is carried by fill + luminance +
 * whether it pulses (see `theme.ts → MAP` for the full rationale). The old traffic light
 * (warn/caution/**ok green**) is gone: green read as "all clear" on a wildfire map and pulled the
 * eye to the calmest ~half of the data.
 *
 *   fill    — the mark's interior (`null` = hollow: a contained fire is an outline, not a threat)
 *   ring    — the stroke around it, always present so every mark has a hard edge on any backdrop
 *   weight  — stroke width; heavier for the stages that are still running
 *   dim     — draw subordinate (lower opacity, no priority halo, sorts last in triage)
 */
export interface StageStyle {
  fill: string | null;
  ring: string;
  weight: number;
  dim: boolean;
}

export const STAGE_STYLE: Record<FireStage, StageStyle> = {
  OC: { fill: MAP.ocFill, ring: MAP.ocRing, weight: 1.8, dim: false },
  BH: { fill: MAP.bhFill, ring: MAP.bhRing, weight: 1.5, dim: false },
  UC: { fill: null, ring: MAP.ucRing, weight: 1.6, dim: false },
  OUT: { fill: MAP.outFill, ring: MAP.outRing, weight: 1, dim: true },
  UNK: { fill: MAP.bhFill, ring: MAP.bhRing, weight: 1.2, dim: true },
};

/** The single colour that best REPRESENTS a stage (a legend swatch, a rail row's dot, a chip).
 *  A hollow stage answers with its ring — the swatch still has to be visible. */
export const STAGE_COLOR: Record<FireStage, string> = {
  OC: MAP.ocFill,
  BH: MAP.bhFill,
  UC: MAP.ucRing,
  OUT: MAP.outFill,
  UNK: MAP.bhFill,
};

/** How much a stage counts toward "still burning" when ranking threats (see `triage.ts`). */
export const STAGE_URGENCY: Record<FireStage, number> = { OC: 1, BH: 0.55, UC: 0.22, OUT: 0, UNK: 0.35 };

/** Hotspot head-fire-intensity band → token (cool gold → amber-red hot). */
export const SEV_COLOR: Record<FireSeverity, string> = {
  low: UI.emberHi,
  moderate: UI.ember,
  high: UI.warn,
  extreme: UI.warn,
};

// Tap priority where marks stack (an active fire usually has hotspots on top of it): the
// AUTHORITATIVE layer wins — reported → out → hotspots. Both views implement this order.

/** The toggleable data layers (the Layers sheet + the per-layer setters below). */
export type FireLayer = 'reported' | 'out' | 'perimeters' | 'hotspots' | 'fwi' | 'smoke';

/**
 * Which basemap the console draws on. Three, because they answer three different questions:
 *   • satellite — the DEFAULT. Real imagery: lakes, rivers, the treeline, old burn scars. The only
 *     one that answers "where is this, and what's around it" for someone who doesn't read maps.
 *   • console   — the abstract dark map. Least visual noise, so the marks read hardest; the right
 *     choice when you're reading the fire pattern rather than the ground.
 *   • daylight  — the sun-readable light map. A dark map genuinely loses its marks outdoors in
 *     glare, so this fallback stays reachable (see DESIGN.md → map sun-readability).
 */
export type BasemapMode = 'satellite' | 'console' | 'daylight';
/** The cycle order the basemap button walks (each press → the next one). */
export const BASEMAP_ORDER: BasemapMode[] = ['satellite', 'console', 'daylight'];

export interface FireMapHandlers {
  onSelectHotspot: (h: Hotspot) => void;
  onSelectReported: (f: ReportedFire) => void;
  // Optional: fired true/false as a smoke forecast frame's tiles load/settle (drives the scrubber's
  // buffering hint). A consumer that doesn't animate smoke can omit it.
  onSmokeLoad?: (loading: boolean) => void;
  // Optional: fired when a tap lands on EMPTY map while a fire is selected — the view has already
  // cleared its own selection ring; the consumer should dismiss the open detail sheet.
  onDeselect?: () => void;
}

/** What a map view must do. Each `setX` repaints ONE layer from data; visibility is independent
 *  (`setLayer`); the two forecast rasters are driven by their TIME setters. */
export interface LiveMapView {
  setHotspots(hotspots: Hotspot[]): void;
  setReportedFires(fires: ReportedFire[]): void;
  setOutFires(fires: ReportedFire[]): void;
  setBurnPolygons(polys: BurnPolygon[]): void;
  setLayer(layer: FireLayer, on: boolean): void;
  setSmokeTime(iso: string): void;
  setFwiTime(iso: string): void;
  isVisible(layer: FireLayer): boolean;
  /** Frame the view to the given [lat, lon] points (the union of what the country filter shows). */
  fitTo(points: [number, number][]): void;
  /** Fly to one fire and select it — the triage rail's row → map hand-off. */
  focusFire(f: ReportedFire): void;
  /** Mark the highest-ranked threats so they carry the animated priority halo (rail ↔ map tie-in).
   *  Pass the fires in rank order; an empty array clears every halo. */
  setPriority(fires: ReportedFire[]): void;
  /** Swap the basemap (satellite imagery / abstract dark console / sun-readable daylight). */
  setBasemap(mode: BasemapMode): void;
  /** Re-measure the container (it's mounted hidden-then-shown). */
  invalidate(): void;
  dispose(): void;
  /** Optional: warm all FWI forecast-day images up front so pressing Play morphs without per-step stalls. */
  preloadFwi?(days: string[]): void;
}
