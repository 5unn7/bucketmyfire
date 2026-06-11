/**
 * The live wildfire tracker's VIEW CONTRACT — the seam between the tracker page (openLiveFires in
 * ui/home/menus.ts: layer sheet, forecast scrubber, detail sheets, source ledger) and whatever
 * actually draws the map. Two interchangeable views implement it:
 *
 *   • FireGlobe — the DEFAULT: a procedural Three.js globe (the brand view; lazy ~three chunk)
 *   • FireMap   — the flat Leaflet slippy map (the original; kept behind `?flat=1` + as the
 *                 fallback when WebGL is unavailable)
 *
 * No Three, no Leaflet, no DOM — importing this never pulls a map engine into the page bundle
 * (the only value imports are the theme tokens, which every page already carries). The tracker
 * page only ever talks to `LiveMapView`; everything else (data fetch, honesty model, layer state)
 * is identical whichever view is mounted.
 */
import { UI } from '../ui/theme';
import type { Hotspot, ReportedFire, BurnPolygon, FireSeverity, FireStage } from './types';

// ── Shared marker colour SEMANTICS ──────────────────────────────────────────────────────────────
// Both views must paint the same MEANING with the same token, or the Layers-sheet legend lies on
// one of them. One map per classification, here at the contract — never re-declared per view.

/** Stage of control → token (danger→safe): Out of control = warn, Being held = caution, Under
 *  control = ok; Out/unknown stay caution-neutral. */
export const STAGE_COLOR: Record<FireStage, string> = {
  OC: UI.warn,
  BH: UI.caution,
  UC: UI.ok,
  OUT: UI.caution,
  UNK: UI.caution,
};

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
  /** Re-measure the container (it's mounted hidden-then-shown). */
  invalidate(): void;
  dispose(): void;
}
