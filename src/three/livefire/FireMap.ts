/**
 * FireMap — the interactive Leaflet map behind the live wildfire CONSOLE. A dark instrument basemap
 * (CARTO dark tiles, tinted toward the cockpit's blue-black) that the country's fire is drawn onto as
 * the only light on screen, layering data sources that are each independently toggleable:
 *
 *   • reported  — the AUTHORITATIVE CIFFC active fires: an AREA-ACCURATE disc (radius from its real
 *                 hectares) plus a centre mark whose RADIUS SCALES WITH SIZE and whose treatment
 *                 carries stage of control (see `view.ts → STAGE_STYLE`). Tapping fires `onSelectReported`.
 *   • perimeters — CWFIS M3 satellite-mapped burn footprints, cold scorch polygons (non-interactive).
 *   • hotspots  — raw CWFIS satellite heat detections, small dots coloured by head-fire intensity.
 *   • fwi / smoke — the CWFIS/GWIS danger raster + the ECCC surface-smoke forecast, drawn beneath.
 *
 * Three design rules this file exists to hold:
 *
 *   1. HUE MEANS FIRE. Stage of control is fill + luminance + pulse, never a separate hue. The map
 *      used to paint stage as a traffic light and the ~half of fires that are "under control" turned
 *      the country green — the calmest possible read of a wildfire map. See `theme.ts → MAP`.
 *   2. SIZE MEANS SIZE. A 50,000 ha fire and a 0.1 ha spot must not be the same dot. The centre mark
 *      scales logarithmically with hectares, on top of the true-area disc (which is sub-pixel at
 *      country zoom, so it can't do this job alone).
 *   3. THE MAP TELLS YOU WHERE TO LOOK. The handful of fires `triage.ts` ranks highest carry an
 *      animated priority halo, tying each triage-rail row to its mark.
 *
 * Daylight: the dark console is the default, but the previously-documented sun-readability problem is
 * real (outdoors in glare a dark map loses its marks), so `setDaylight(true)` swaps back to the light
 * CARTO tiles and re-tunes the label ink. Both looks share one mark palette.
 *
 * The ONLY Three-free map layer. Colours come from `theme.ts` brand tokens (no hard-coded hex).
 * `preferCanvas` keeps a thousand-plus markers smooth on mobile. Tiles degrade gracefully — if CARTO
 * is unreachable the cased marks still read on the `MAP.landInk` backdrop.
 *
 * THE tracker view: the tracker opens this flat map directly (the `LiveMapView` contract in `view.ts`).
 * The 3D `FireGlobe` it once shared the contract with was retired (more complex + cluttered than useful).
 */
import * as L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { UI, MAP } from '../ui/theme';
import { LIVEFIRE } from '../config';
import { radiusMetersForHa } from './normalize';
import { fwiFrameUrl, FWI_BOX, FWI_GLOBE_BOX, MERC_LAT_MAX, fwiForecastTime, GEOMET_WMS_URL, SMOKE_WMS_LAYER, SMOKE_WMS_STYLE, SMOKE_CSS_FILTER, isLiveFireEnabled } from './client';
import { PLACES } from './places';
import type { Place } from './places';
import type { Hotspot, FireSeverity, ReportedFire, BurnPolygon } from './types';
import { STAGE_STYLE, SEV_COLOR } from './view';
import type { BasemapMode, FireLayer, FireMapHandlers, LiveMapView } from './view';

export type { FireLayer, FireMapHandlers } from './view';

// Hotspot dot geometry per intensity band; the COLOURS come from the SHARED semantic maps in
// `view.ts` (STAGE_STYLE / SEV_COLOR) so every surface paints identical meanings.
const SEV_STYLE: Record<FireSeverity, { radius: number; fill: number }> = {
  low: { radius: 2.5, fill: 0.7 },
  moderate: { radius: 3, fill: 0.82 },
  high: { radius: 4, fill: 0.9 },
  extreme: { radius: 5.5, fill: 1 },
};

// NO-LABEL basemaps, deliberately. The `_all` tiles bake CARTO's own place names into the imagery,
// which meant two label systems fighting on one map: the tiles' names printed straight through the
// curated ones and no amount of decluttering could touch them (the captures showed "Yello|Yellowknife"
// and "Edmo|Edmonton" doubled on top of each other). With `_nolabels` the console owns every label it
// draws, so `declutter()` is authoritative and the map stays legible at any zoom. Esri's imagery
// carries no labels either, for the same reason.
const CARTO_DARK = 'https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png';
const CARTO_LIGHT = 'https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png';
// Esri World Imagery — keyless, CORS-open, global, and the DEFAULT basemap. An abstract map tells you
// a fire is at 55.1N 105.3W; imagery tells you it's in the trees on the north shore of a lake, next
// to last year's burn scar. That's the difference between plotting a fire and understanding it.
// Attribution is required and lives on the Credits page (Settings → Credits & data), where the CARTO
// and OSM credits already are — the map itself carries no on-map attribution control.
// NB the {z}/{y}/{x} axis order: ArcGIS REST tiles are row-then-column, NOT the XYZ {z}/{x}/{y}.
const ESRI_IMAGERY = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';

/** Tile URL + tint + max native zoom per basemap mode. One table so a mode can't half-apply. */
const BASEMAPS: Record<BasemapMode, { url: string; tint: string; maxZoom: number; subdomains?: string }> = {
  satellite: { url: ESRI_IMAGERY, tint: MAP.tileTintSat, maxZoom: 19 },
  console: { url: CARTO_DARK, tint: MAP.tileTint, maxZoom: 19, subdomains: 'abcd' },
  daylight: { url: CARTO_LIGHT, tint: MAP.tileTintDay, maxZoom: 19, subdomains: 'abcd' },
};

/**
 * A reported fire's centre-mark radius, in screen px, from its reported hectares.
 *
 * Design rule 2 in one function. Logarithmic because hectares span six orders of magnitude
 * (0.01 → 500,000): linear scaling makes every fire but the season's monster a dot, and sqrt still
 * flattens the middle of the range where most of the interesting fires live. The floor keeps the
 * smallest fire a comfortable tap target; the ceiling stops a megafire eating its neighbours.
 * An unknown size (`sizeHa < 0`, which the feed does report) sits just above the floor — visible and
 * tappable, never dropped, because "size not reported" must not read as "no fire".
 *
 * The ceiling is deliberately modest (11 px, not the 15 this first shipped with). With 300-plus fires
 * out of control at once the top of the range is not rare, and a generous ceiling merged the whole
 * boreal northwest into one orange mass — losing exactly the magnitude read the scaling exists to
 * give. Differentiation across the range beats absolute size at the top of it.
 */
function markRadiusFor(sizeHa: number): number {
  if (!(sizeHa > 0)) return 2.6;
  // ~2.4 px at 1 ha · 4 px at 100 ha · 5 px at 1,000 ha · 6.5 px at 10,000 ha · 8 px at the top. The
  // shallow slope is what buys the differentiation: a steeper one pins most of the feed (which lives
  // in the hundreds to low thousands of hectares) against the ceiling, and then nothing stands out.
  //
  // Sized DOWN twice now, and the reason is the density of a real bad season: with ~600 fires on a
  // national view, marks that look right in isolation merge into a solid mass that hides the ground
  // and each other. The map has to stay a map — you should be able to see the lake a fire is sitting
  // on. Zooming in is what earns you a bigger mark, not the mark being big to begin with.
  return Math.max(2.4, Math.min(8, 1.9 + 1.4 * Math.log10(1 + sizeHa)));
}

/**
 * A non-interactive dark backing disc drawn UNDER a mark so it separates from ANY background.
 * On the daylight basemap this is the sun-readability fix (in glare the white land and a bright dot
 * both wash toward the same pale grey, so a near-black casing one ring wider gives the hard edge that
 * survives it); on the dark console it does the same job against the FWI wash and the smoke raster,
 * which are exactly the backdrops a bare ember dot would disappear into. Cheap (one extra canvas
 * circle), so it stays reserved for the FEW important marks (reported fires), never the thousand-plus
 * hotspots — those get a dark STROKE instead, same effect, no extra draw.
 */
function darkCasing(lat: number, lon: number, radius: number): L.CircleMarker {
  return L.circleMarker([lat, lon], {
    radius,
    stroke: false,
    fillColor: MAP.casing,
    fillOpacity: 0.85,
    interactive: false,
  });
}

/** Trim outliers off a point set: the [lo, hi] percentile span of one axis. Used by `fitTo` — see there. */
function span(values: number[], lo: number, hi: number): [number, number] {
  const s = [...values].sort((a, b) => a - b);
  const at = (q: number): number => s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))]!;
  return [at(lo), at(hi)];
}

/**
 * A flicker-free animated WMS forecast layer — the smoke trail's smoothness.
 *
 * The naive approach (one WMS layer whose TIME param is reset per frame) STROBES: Leaflet drops the old
 * tiles the instant the param changes and shows nothing until the new ones load, so each hourly step
 * blanks the column. This double-buffers it: two WMS layers on two dedicated panes (so opacity is one CSS
 * transition over the whole frame, not per-tile). `showFrame()` loads the next hour into the BACK buffer
 * and only crossfades — back pane fades up, front pane fades down — once those tiles have loaded. Result:
 * the plume MORPHS hour-to-hour instead of flashing, and the playback loop's wrap (+48 h → now) dissolves
 * like any other step. A request token means fast scrubbing always lands on the latest frame.
 */
class SmokeForecastLayer {
  private a: L.TileLayer.WMS;
  private b: L.TileLayer.WMS;
  private frontIsA = false; // which buffer is currently lit; flips on every committed crossfade
  private frame: string | null = null; // the TIME currently shown (front buffer), null when hidden/blank
  private pending: string | null = null; // latest requested TIME (re-applied on show; wins a fast scrub)
  private shown = false;
  private token = 0; // bumped per request — a stale buffer 'load' that fires late checks this and bails
  private onState?: (loading: boolean) => void;

  constructor(
    private map: L.Map,
    url: string,
    layer: string,
    style: string, // a GeoMet NAMED style — sld_body is dead for this layer, see SMOKE_WMS_STYLE
    opacity: number, // the layer's own (constant) opacity; the crossfade rides the pane opacity 0↔1
    fadeMs: number,
  ) {
    const mk = (paneName: string): L.TileLayer.WMS => {
      this.map.createPane(paneName);
      const pane = this.map.getPane(paneName)!;
      pane.style.zIndex = '250'; // above the basemap + FWI (tilePane 200), below the canvas dots (overlayPane 400)
      pane.style.opacity = '0'; // start dark; the crossfade drives this 0↔1
      pane.style.transition = `opacity ${fadeMs}ms ease`;
      pane.style.pointerEvents = 'none'; // never swallow a tap meant for a fire dot underneath
      // Desaturate the server's RedGrey ramp into brand smoke-grey. On the PANE so it's one composite for
      // the whole frame (and so the crossfade's pane opacity multiplies cleanly on top of it).
      pane.style.filter = SMOKE_CSS_FILTER;
      return L.tileLayer.wms(url, {
        layers: layer,
        styles: style, // named GeoMet style; `sld_body` returns a blank raster (see SMOKE_WMS_STYLE)
        format: 'image/png',
        transparent: true,
        version: '1.3.0',
        // 512px tiles (vs the 256 default) → ~4× FEWER GetMap requests per frame. GeoMet resets connections
        // (ERR_CONNECTION_RESET) under a burst of small-tile requests, which left rectangular GAPS in the
        // smoke — the "glitch". Fewer, larger tiles fit the browser's per-host concurrency in one wave, so
        // they load whole, and there are fewer seams to begin with.
        tileSize: 512,
        opacity, // the layer's own opacity; the pane opacity (0↔1) is the crossfade multiplier on top
        crossOrigin: true,
        pane: paneName,
      } as L.WMSOptions);
    };
    this.a = mk('smokeA');
    this.b = mk('smokeB');
  }

  /** Wire a loading callback (true while a frame's tiles are in flight) so the UI can show a buffering hint. */
  setOnState(cb: (loading: boolean) => void): void {
    this.onState = cb;
  }

  private buffer(front: boolean): L.TileLayer.WMS {
    return (front ? this.frontIsA : !this.frontIsA) ? this.a : this.b;
  }
  private pane(front: boolean): HTMLElement {
    return this.map.getPane((front ? this.frontIsA : !this.frontIsA) ? 'smokeA' : 'smokeB')!;
  }

  /** Show/hide the whole forecast layer. Both buffers join/leave the map together; the pending frame is
   *  (re)applied on show so the layer is never blank when revealed. */
  setVisible(on: boolean): void {
    if (on === this.shown) {
      if (on && this.pending) this.showFrame(this.pending); // idempotent re-show keeps the current frame
      return;
    }
    this.shown = on;
    if (on) {
      this.a.addTo(this.map);
      this.b.addTo(this.map);
      if (this.pending) this.showFrame(this.pending);
    } else {
      this.map.removeLayer(this.a);
      this.map.removeLayer(this.b);
      this.pane(true).style.opacity = '0';
      this.pane(false).style.opacity = '0';
      this.frame = null;
      this.onState?.(false);
    }
  }

  /** Point the layer at one hourly forecast frame (ISO8601 UTC); crossfades to it once its tiles load. When
   *  hidden it's just remembered (applied on the next show). */
  showFrame(iso: string): void {
    this.pending = iso;
    if (!this.shown || iso === this.frame) return;
    const back = this.buffer(false);
    const backPane = this.pane(false);
    const myToken = ++this.token;
    this.onState?.(true);
    back.once('load', () => {
      if (myToken !== this.token || !this.shown) return; // a newer frame superseded this one — abandon it
      backPane.style.opacity = '1'; // crossfade the new frame up…
      this.pane(true).style.opacity = '0'; // …and the old front out (transition on each pane)
      this.frontIsA = !this.frontIsA; // the back buffer is now the front
      this.frame = iso;
      this.onState?.(false);
    });
    back.setParams({ time: iso } as unknown as L.WMSParams); // triggers the reload → eventual 'load'
  }
}

/**
 * The Fire-Weather-Index forecast, MORPHED (not strobed) — the FWI counterpart of SmokeForecastLayer.
 *
 * The naive single-tiled-WMS-with-TIME approach blanks the danger field every day-step (Leaflet drops the
 * old tiles the instant the param changes). This double-buffers it with single-image overlays: two panes
 * (`fwiA`/`fwiB`), each holding a GLOBAL GWIS overlay (drawn under) + a CANADA CWFIS overlay (on top).
 * `showFrame()` points the BACK pane's two images at the next day, waits for BOTH to settle, then crossfades
 * the panes (back up, front down). FWI rises/falls IN PLACE (it doesn't translate like a smoke plume), so a
 * temporal cross-dissolve is the honest morph — no warping. A request token makes a fast scrub always land on
 * the latest day; each day is ONE preloadable GetMap PNG per source (client `fwiFrameUrl`).
 */
class FwiForecastLayer {
  private aG: L.ImageOverlay; private aC: L.ImageOverlay; // buffer A: global wash (under) + Canada grid (over)
  private bG: L.ImageOverlay; private bC: L.ImageOverlay; // buffer B
  private frontIsA = false; // which pane is currently lit; flips on each committed crossfade
  private frame: string | null = null; // the day currently shown (front pane), null when hidden/blank
  private pending: string; // latest requested day (re-applied on show; wins a fast scrub)
  private shown = false;
  private token = 0; // bumped per request — a stale buffer load that fires late checks this and bails
  private onState?: (loading: boolean) => void;

  constructor(private map: L.Map, opacity: number, fadeMs: number, private width: number) {
    this.pending = fwiForecastTime(); // a sensible default day so toggling FWI on is never blank
    const TRANSPARENT = 'data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw=='; // 1×1
    // Clamp the overlay box latitude to the mercator limit so it matches the 3857 GetMap's actual extent
    // (the global box's ±90 can't be drawn in mercator — its image stops at ±MERC_LAT_MAX, so must the box).
    const cLat = (lat: number): number => Math.max(-MERC_LAT_MAX, Math.min(MERC_LAT_MAX, lat));
    const caBounds = L.latLngBounds([cLat(FWI_BOX.latMin), FWI_BOX.lonMin], [cLat(FWI_BOX.latMax), FWI_BOX.lonMax]);
    const gBounds = L.latLngBounds([cLat(FWI_GLOBE_BOX.latMin), FWI_GLOBE_BOX.lonMin], [cLat(FWI_GLOBE_BOX.latMax), FWI_GLOBE_BOX.lonMax]);
    const mkPane = (name: string): void => {
      this.map.createPane(name);
      const pane = this.map.getPane(name)!;
      pane.style.zIndex = '210'; // under smoke (250) + the canvas dots (overlayPane 400), over the basemap (200)
      pane.style.opacity = '0'; // start dark; the crossfade drives this 0↔1
      // LINEAR (constant-rate), not ease: an ease curve slows at both ends, so chained day-steps read as
      // discrete "settle → morph → settle" pulses; a linear dissolve filling ~the whole dwell chains into one
      // continuous, video-like flow when Play runs (fwiFadeMs ≈ fwiFrameMs leaves no static hold between days).
      pane.style.transition = `opacity ${fadeMs}ms linear`;
      pane.style.pointerEvents = 'none'; // never swallow a tap meant for a fire dot above
    };
    mkPane('fwiA'); mkPane('fwiB');
    // Each overlay starts on a 1×1 transparent placeholder (no broken-image flash); showFrame swaps the real
    // URL in. Add GLOBAL first so the finer CANADA grid sits ON TOP within each pane (the old 210<220 z-order).
    const mk = (pane: string, bounds: L.LatLngBounds): L.ImageOverlay =>
      L.imageOverlay(TRANSPARENT, bounds, { opacity, pane, interactive: false } as L.ImageOverlayOptions);
    this.aG = mk('fwiA', gBounds); this.aC = mk('fwiA', caBounds);
    this.bG = mk('fwiB', gBounds); this.bC = mk('fwiB', caBounds);
  }

  /** Wire a loading callback (true while a day's images are in flight) so the scrubber can show a buffering hint. */
  setOnState(cb: (loading: boolean) => void): void {
    this.onState = cb;
  }

  private pair(front: boolean): [L.ImageOverlay, L.ImageOverlay] {
    return (front ? this.frontIsA : !this.frontIsA) ? [this.aG, this.aC] : [this.bG, this.bC];
  }
  private pane(front: boolean): HTMLElement {
    return this.map.getPane((front ? this.frontIsA : !this.frontIsA) ? 'fwiA' : 'fwiB')!;
  }

  /** Show/hide the whole forecast layer. Both buffers join/leave together; the pending day is (re)applied on
   *  show so it's never blank when revealed. */
  setVisible(on: boolean): void {
    if (on === this.shown) {
      if (on) this.showFrame(this.pending); // idempotent re-show keeps the current day
      return;
    }
    this.shown = on;
    const all = [this.aG, this.aC, this.bG, this.bC];
    if (on) {
      for (const o of all) o.addTo(this.map);
      this.showFrame(this.pending);
    } else {
      for (const o of all) this.map.removeLayer(o);
      this.pane(true).style.opacity = '0';
      this.pane(false).style.opacity = '0';
      this.frame = null;
      this.onState?.(false);
    }
  }

  /** Point the layer at one forecast DAY (yyyy-mm-dd UTC); crossfades to it once BOTH source images settle.
   *  When hidden it's just remembered (applied on the next show). */
  showFrame(day: string): void {
    this.pending = day;
    if (!this.shown || day === this.frame) return;
    const [bg, bc] = this.pair(false);
    const backPane = this.pane(false);
    const myToken = ++this.token;
    this.onState?.(true);
    let settled = 0;
    const done = (): void => {
      if (myToken !== this.token || !this.shown) return; // a newer day superseded this one — abandon it
      if (++settled < 2) return; // wait for BOTH overlays (Canada grid + global wash)
      backPane.style.opacity = '1'; // crossfade the new day up…
      this.pane(true).style.opacity = '0'; // …and the old day out (transition rides each pane)
      this.frontIsA = !this.frontIsA; // the back pane is now the front
      this.frame = day;
      this.onState?.(false);
    };
    // Count both LOAD and ERROR as "settled": a GWIS gap/outage (a future/empty day, a dropped request) must
    // still let the Canada grid morph — the errored overlay just keeps/clears its image. Never throws (honest
    // degrade, no loop-death). `off()` first clears any stale handlers from a superseded scrub step.
    bg.off('load').off('error'); bc.off('load').off('error');
    bg.once('load', done); bg.once('error', done);
    bc.once('load', done); bc.once('error', done);
    bg.setUrl(fwiFrameUrl('gwis', day, this.width));
    bc.setUrl(fwiFrameUrl('cwfis', day, this.width));
  }

  /** Warm every day's images (both sources) into the HTTP cache so pressing Play never stalls. */
  preload(days: string[]): void {
    for (const day of days) {
      new Image().src = fwiFrameUrl('gwis', day, this.width);
      new Image().src = fwiFrameUrl('cwfis', day, this.width);
    }
  }
}

export class FireMap implements LiveMapView {
  private map: L.Map;
  private hotspotLayer: L.LayerGroup;
  private reportedLayer: L.LayerGroup;
  private outLayer: L.LayerGroup;
  private perimLayer: L.LayerGroup;
  private haloLayer: L.LayerGroup; // the animated priority halos on the top-ranked threats
  private tiles: L.TileLayer; // the live basemap (swapped wholesale by setBasemap)
  private basemap: BasemapMode = 'satellite';
  private placeMarks: { place: Place; marker: L.Marker }[] = []; // curated labels, decluttered per view
  private declutterQueued = false;
  private markByFire = new Map<string, L.CircleMarker>(); // fireId → its centre mark, for focusFire()
  private fwi: FwiForecastLayer; // double-buffered FWI day-morph (Canada CWFIS + global GWIS), crossfaded
  private smoke: SmokeForecastLayer;
  private selected: L.CircleMarker | null = null;
  private selectedBase: { weight: number; color: string } | null = null; // the selected dot's pre-ring style
  // Canvas-renderer guard: unlike the SVG renderer, a click on a canvas marker ALSO bubbles to the map's
  // own `click` — so a marker tap would fire the bare-map deselect right after opening the detail, snapping
  // it shut. A marker click sets this (synchronously, before the map click in the same DOM event); the map
  // handler consumes it. Self-clears next tick so a genuine empty-map tap still deselects.
  private justHitMarker = false;
  private handlers: FireMapHandlers;
  // Which layers are currently shown (default: the active authoritative fires + their footprints + hotspots).
  // OUT fires (the season's extinguished blazes) are OPT-IN/default-off — there are hundreds of them, and
  // painting them all buried the live fires in dots; they're the honest "what already burned" context, one
  // toggle away. FWI is opt-in too, so the map stays legible until the user asks for the danger field. This
  // mirrors the menu's `layerOn` defaults (they must agree, or the map shows a layer the toggle reads as off).
  private visible: Record<FireLayer, boolean> = { reported: true, out: false, perimeters: true, hotspots: true, fwi: false, smoke: false };

  constructor(container: HTMLElement, handlers: FireMapHandlers) {
    this.handlers = handlers;
    this.map = L.map(container, {
      preferCanvas: true, // canvas renderer → a thousand+ dots stay smooth
      zoomControl: true,
      attributionControl: false, // no on-map credits/Leaflet logo — attribution lives on the Credits page
      minZoom: 2,
      maxZoom: 13,
      worldCopyJump: true,
    });
    this.map.setView([58, -100], 4); // rough Canada centre; fitTo() refits to the live data
    // The instrument backdrop. `MAP.landInk` fills the container so the console never flashes white
    // while tiles stream (and stays dark if CARTO is unreachable entirely); the tint filter on the
    // tile pane pulls CARTO's neutral grey toward the cockpit's blue-black so the ember marks are the
    // only warm light on the map. Filtering the PANE (not each tile) is one composite for the frame.
    container.style.background = MAP.landInk;
    const base = BASEMAPS[this.basemap];
    this.tiles = L.tileLayer(base.url, { subdomains: base.subdomains ?? 'abc', maxZoom: base.maxZoom }).addTo(this.map);
    this.map.getPane('tilePane')!.style.filter = base.tint;

    // The Fire Weather Index forecast — a double-buffered DAY-MORPH (Canada CWFIS grid over the global GWIS
    // wash), each day a single GetMap image that crossfades into the next instead of strobing per WMS-TIME
    // step. Renders beneath the smoke + the canvas dots (its panes sit at z 210). setFwiTime() drives the day;
    // honestly labeled a forecast in the UI. (Was two tiled WMS layers whose TIME param blanked on each step.)
    this.fwi = new FwiForecastLayer(this.map, LIVEFIRE.fwiOpacity, LIVEFIRE.fwiFadeMs, LIVEFIRE.fwiProxyWidth);
    if (handlers.onSmokeLoad) this.fwi.setOnState(handlers.onSmokeLoad); // shares the scrubber's buffering hint

    // The surface-smoke FORECAST raster (ECCC GeoMet FireWork) — double-buffered so the hourly animation
    // crossfades instead of strobing. setSmokeTime() drives the frame; tiles 404 gracefully past the run.
    this.smoke = new SmokeForecastLayer(
      this.map,
      GEOMET_WMS_URL,
      SMOKE_WMS_LAYER,
      SMOKE_WMS_STYLE,
      LIVEFIRE.smokeOpacity,
      LIVEFIRE.smokeFadeMs,
    );
    if (handlers.onSmokeLoad) this.smoke.setOnState(handlers.onSmokeLoad);

    // Vector layers, drawn back-to-front: footprints → extinguished → hotspots → active fires
    // (authoritative above raw detections — see applyVisibility). Each added per its toggle.
    this.perimLayer = L.layerGroup();
    this.outLayer = L.layerGroup();
    this.reportedLayer = L.layerGroup();
    this.hotspotLayer = L.layerGroup();
    // Priority halos ride their own DOM pane ABOVE the canvas marks: a canvas circle can't animate
    // without redrawing it every frame (a non-starter for a mobile map), but a dozen CSS-animated
    // divIcons cost nothing. Deliberately a HANDFUL of elements — the whole point is that only the
    // fires the console is pointing at move. Non-interactive so taps fall through to the mark beneath.
    // Built BEFORE applyVisibility(), which syncs this layer along with the reported marks.
    this.map.createPane('lfHalo');
    const haloPane = this.map.getPane('lfHalo')!;
    haloPane.style.zIndex = '610'; // over the canvas marks (overlayPane 400), under the labels (620)
    haloPane.style.pointerEvents = 'none';
    this.haloLayer = L.layerGroup();
    this.applyVisibility();
    this.buildPlaces();

    // Tap EMPTY map → dismiss any active selection. With the CANVAS renderer a marker click also bubbles
    // here (it doesn't with SVG), so honour the marker-hit guard: if a dot was just tapped, swallow this
    // companion map click (it would instantly re-close the detail we just opened) and let it through only
    // on a genuine bare-basemap tap.
    this.map.on('click', () => {
      if (this.justHitMarker) { this.justHitMarker = false; return; }
      if (!this.selected) return;
      if (this.selectedBase) this.selected.setStyle(this.selectedBase);
      this.selected = null;
      this.selectedBase = null;
      this.handlers.onDeselect?.();
    });
  }

  // ── Layer data setters (each clears + repaints its own group; visibility is independent) ──

  /** Plot the raw satellite hotspots (hottest last so intense dots sit on top). */
  setHotspots(hotspots: Hotspot[]): void {
    this.hotspotLayer.clearLayers();
    this.clearSelection();
    const ordered = [...hotspots].sort((a, b) => a.hfi - b.hfi);
    for (const h of ordered) {
      const st = SEV_STYLE[h.severity];
      const m = L.circleMarker([h.lat, h.lon], {
        radius: st.radius + 0.5, // a touch larger so the smallest cool dots survive sun-glare washout
        color: MAP.casing, // a DARK casing stroke (was the fill colour → no separation): one marker, hard edge on any backdrop
        weight: 1.4,
        opacity: 1,
        fillColor: SEV_COLOR[h.severity],
        fillOpacity: Math.min(1, st.fill + 0.12), // fuller saturation so the hue holds when luminance washes out
      });
      m.on('click', () => {
        this.highlight(m);
        this.handlers.onSelectHotspot(h);
      });
      m.addTo(this.hotspotLayer);
    }
  }

  /**
   * Plot the AUTHORITATIVE reported fires: an area-accurate footprint disc (true hectares) plus a
   * centre mark that SCALES WITH SIZE and carries stage of control as fill + luminance.
   *
   * Draw order is the hierarchy. Biggest first so a megafire's mark can't bury the small fires
   * landing on top of it; and within that, contained fires paint before the running ones, so where
   * marks overlap the thing still out of control is what you see and what a tap hits.
   */
  setReportedFires(fires: ReportedFire[]): void {
    this.reportedLayer.clearLayers();
    this.clearSelection();
    this.markByFire.clear();
    // Sort: least urgent first (they end up underneath), then biggest first within a stage.
    const ordered = [...fires].sort(
      (a, b) => Number(STAGE_STYLE[a.stage].dim) - Number(STAGE_STYLE[b.stage].dim) || b.sizeHa - a.sizeHa,
    );
    for (const f of ordered) {
      const st = STAGE_STYLE[f.stage];
      // The true footprint: a circle whose ground area equals the reported hectares (metres radius).
      // Only for genuinely large fires. A small fire's true disc is sub-pixel at national zoom, so it
      // contributed nothing but a ring of noise around its own mark — hundreds of them were a big part
      // of what turned the map into a solid mass. Above ~1,000 ha the disc starts carrying real
      // information as you zoom in: how far the thing actually reaches across the ground.
      if (f.sizeHa >= 1000) {
        L.circle([f.lat, f.lon], {
          radius: radiusMetersForHa(f.sizeHa),
          color: MAP.areaStroke,
          weight: 1,
          opacity: st.dim ? 0.22 : 0.6,
          fillColor: MAP.areaFill,
          fillOpacity: st.dim ? 0.25 : 1,
          interactive: false, // taps go to the centre mark below (a huge disc shouldn't swallow the map)
        }).addTo(this.reportedLayer);
      }
      // The centre mark: always visible + the hit target (a 0.1 ha fire's true disc is sub-pixel at
      // country zoom). Radius carries MAGNITUDE; fill + ring carry STAGE; the casing keeps it readable
      // over the FWI wash, the smoke raster and the basemap alike.
      const r = markRadiusFor(f.sizeHa);
      darkCasing(f.lat, f.lon, r + 1.7).addTo(this.reportedLayer);
      const dot = L.circleMarker([f.lat, f.lon], {
        radius: r,
        color: st.ring,
        weight: st.weight,
        opacity: st.dim ? 0.65 : 1,
        fillColor: st.fill ?? '#000',
        // A hollow stage (under control) draws ring-only: contained is an outline, not a filled threat.
        fillOpacity: st.fill ? (st.dim ? 0.5 : 0.92) : 0,
      });
      dot.on('click', () => {
        this.highlight(dot);
        this.handlers.onSelectReported(f);
      });
      dot.addTo(this.reportedLayer);
      if (f.fireId) this.markByFire.set(f.fireId, dot);
    }
  }

  /** Plot the EXTINGUISHED ("out") fires reported this season as small, dim neutral dots — historical
   *  context, drawn beneath the active fires, opt-in. Tapping one opens its full record like any fire. */
  setOutFires(fires: ReportedFire[]): void {
    this.outLayer.clearLayers();
    this.clearSelection();
    for (const f of fires) {
      const dot = L.circleMarker([f.lat, f.lon], {
        radius: 3,
        // COLD ash, not ember: an extinguished fire must never share the burning hue. The ring gives
        // it an edge on either basemap; both come from the shared MAP ramp, so "out" reads the same
        // everywhere (the map mark, the legend swatch, the detail chip).
        color: MAP.outRing,
        weight: 1,
        opacity: 0.55,
        fillColor: MAP.outFill,
        fillOpacity: 0.55,
      });
      dot.on('click', () => {
        this.highlight(dot);
        this.handlers.onSelectReported(f);
      });
      dot.addTo(this.outLayer);
    }
  }

  /** Draw the satellite-mapped burn footprints as scorch polygons (non-interactive underlay). Burnt
   *  ground is DESATURATED, not ember: it already burned, so it must sit visibly behind live flame
   *  rather than competing with it for the same warm hue. */
  setBurnPolygons(polys: BurnPolygon[]): void {
    this.perimLayer.clearLayers();
    for (const p of polys) {
      L.polygon(p.ring, {
        color: MAP.scarStroke,
        weight: 1,
        opacity: 0.7,
        fillColor: MAP.scarFill,
        fillOpacity: 1,
        interactive: false,
      }).addTo(this.perimLayer);
    }
  }

  // ── The console's "look here" layer ──

  /**
   * Ring the top-ranked threats with an animated halo. This is the map half of the triage rail: the
   * same fires, in the same order, so a row and a mark are obviously the same thing.
   *
   * DOM markers on a dedicated pane, not canvas — a dozen CSS-animated elements are free, whereas
   * animating canvas circles means redrawing the marker layer every frame. `.lf-halo` owns the
   * animation (and drops it under `prefers-reduced-motion`, where the ring stays static but present:
   * the ranking is information, so it must survive with motion off).
   */
  setPriority(fires: ReportedFire[]): void {
    this.haloLayer.clearLayers();
    fires.forEach((f, i) => {
      const size = Math.round(markRadiusFor(f.sizeHa) * 2 + 26);
      L.marker([f.lat, f.lon], {
        pane: 'lfHalo',
        interactive: false,
        keyboard: false,
        icon: L.divIcon({
          className: 'lf-halo',
          // The rank number rides the halo so the map can be read against the rail without counting.
          html: `<i style="width:${size}px;height:${size}px;animation-delay:${(i * 0.16).toFixed(2)}s"></i><b>${i + 1}</b>`,
          iconSize: [0, 0],
        }),
      }).addTo(this.haloLayer);
    });
  }

  /** Fly to one fire and select it — the triage rail's row → map hand-off. Zooms in far enough to see
   *  the fire's true footprint against the ground, and rings its mark if that mark is currently drawn
   *  (it won't be if the user has toggled the reported layer off — the flight still happens). */
  focusFire(f: ReportedFire): void {
    this.map.flyTo([f.lat, f.lon], Math.max(this.map.getZoom(), 7), { duration: 0.85 });
    const mark = f.fireId ? this.markByFire.get(f.fireId) : undefined;
    if (mark) this.highlight(mark);
  }

  /** Swap the basemap (satellite imagery / abstract dark console / sun-readable daylight). The MARKS
   *  never change — one ember palette reads on all three — but the place labels invert (light ink +
   *  dark halo over imagery and the dark console, dark ink + white halo in daylight) or they'd vanish
   *  into the ground they're drawn on. */
  setBasemap(mode: BasemapMode): void {
    if (mode === this.basemap) return;
    this.basemap = mode;
    const base = BASEMAPS[mode];
    this.map.removeLayer(this.tiles);
    this.tiles = L.tileLayer(base.url, { subdomains: base.subdomains ?? 'abc', maxZoom: base.maxZoom }).addTo(this.map);
    this.tiles.bringToBack();
    this.map.getPane('tilePane')!.style.filter = base.tint;
    for (const { marker } of this.placeMarks) {
      const span = marker.getElement()?.firstElementChild as HTMLElement | null;
      if (span) {
        span.style.color = mode === 'daylight' ? MAP.labelInkDay : MAP.labelInk;
        span.style.textShadow = this.labelHalo();
      }
    }
  }


  // ── Visibility ──

  /** Show/hide a data layer. */
  setLayer(layer: FireLayer, on: boolean): void {
    this.visible[layer] = on;
    this.applyVisibility();
  }

  /** Point the animated smoke raster at one hourly forecast frame (ISO8601 UTC). Crossfades to it once the
   *  frame's tiles load (no blank flash); remembered + applied later when the layer is hidden. */
  setSmokeTime(iso: string): void {
    this.smoke.showFrame(iso);
  }

  /** Point the Fire-Weather-Index forecast at one DAY (yyyy-mm-dd) — crossfades to it once the day's images
   *  load (no blank strobe). The day-scrubber steps the continuous model grid; each day is its own run. */
  setFwiTime(iso: string): void {
    this.fwi.showFrame(iso);
  }

  /** Warm every FWI forecast-day image up front so pressing Play morphs without per-step stalls. */
  preloadFwi(days: string[]): void {
    this.fwi.preload(days);
  }

  /** The label halo for the current basemap: a dark glow on the console, a white one in daylight. Four
   *  stacked shadows, because one soft shadow doesn't survive a label crossing a bright hotspot cluster. */
  private labelHalo(): string {
    const c = this.basemap === 'daylight' ? MAP.labelHaloDay : MAP.labelHalo;
    return `0 0 2px ${c},0 0 3px ${c},0 0 4px ${c},0 1px 5px ${c}`;
  }

  /** Curated place labels — denser geographic orientation than the basemap's decluttered names (which only
   *  surface a couple until you zoom way in). Built ONCE and kept on the map; which ones actually show is
   *  decided per view by `declutter()`. Non-interactive and drawn on a pane ABOVE the data, so a name always
   *  reads over the FWI wash + fire marks while taps pass straight through to the fires beneath. */
  private buildPlaces(): void {
    this.map.createPane('lfPlaces');
    const pane = this.map.getPane('lfPlaces')!;
    pane.style.zIndex = '620'; // above the canvas marks (overlayPane 400) so names stay legible; below popups (700)
    pane.style.pointerEvents = 'none'; // never block a map drag or a fire tap underneath
    const group = L.layerGroup();
    for (const place of PLACES) {
      const style =
        `position:absolute;left:0;top:0;transform:translate(-50%,-50%);white-space:nowrap;` +
        `font-family:var(--mono),monospace;font-weight:${place.tier === 0 ? 700 : 600};font-size:${place.tier === 0 ? 11 : 10}px;` +
        `letter-spacing:.02em;color:${MAP.labelInk};text-shadow:${this.labelHalo()};`;
      const marker = L.marker([place.lat, place.lon], {
        pane: 'lfPlaces',
        interactive: false,
        keyboard: false,
        // Custom className (NOT the default 'leaflet-div-icon') drops Leaflet's white box; iconSize 0 anchors
        // the 0×0 root on the latlng and the span centres on it via translate(-50%,-50%).
        icon: L.divIcon({ className: 'lf-place', html: `<span style="${style}">${place.name}</span>`, iconSize: [0, 0] }),
      });
      group.addLayer(marker);
      this.placeMarks.push({ place, marker });
    }
    group.addTo(this.map);
    this.queueDeclutter();
    // Both events, not just zoom: a PAN changes which labels collide just as much as a zoom does.
    this.map.on('zoomend', () => this.queueDeclutter());
    this.map.on('moveend', () => this.queueDeclutter());
  }

  /** Coalesce declutter passes into the next frame — a pinch-zoom fires these events in bursts. */
  private queueDeclutter(): void {
    if (this.declutterQueued) return;
    this.declutterQueued = true;
    requestAnimationFrame(() => {
      this.declutterQueued = false;
      this.declutter();
    });
  }

  /**
   * Decide which place labels are drawn for the CURRENT view — the fix for the name pile-up.
   *
   * Tier alone (0 always · 1 from z≥5 · 2 from z≥6) was never enough: at country zoom the whole
   * populated south is a few hundred pixels wide, so Toronto / Ottawa / Montréal / Québec City
   * overprinted into an unreadable smear, and on a phone the entire southern corridor collapsed into
   * one blur. Zoom bands can't fix that, because the collisions happen WITHIN a tier.
   *
   * So: project every candidate to screen space and place them greedily, most important first
   * (tier, then west-to-east for a stable, non-flickering order), rejecting any label whose box
   * overlaps one already placed. Importance wins ties, so the big names survive and the small ones
   * yield — which is exactly what a cartographer does by hand. ~90 labels, an O(n²) box test on a
   * short list, once per settled view: cheap enough to be invisible.
   */
  private declutter(): void {
    const z = this.map.getZoom();
    const minZoomFor = (tier: number): number => (tier === 0 ? 0 : tier === 1 ? 5 : 6);
    const size = this.map.getSize();
    const placed: { l: number; r: number; t: number; b: number }[] = [];
    // Most important first. Within a tier, sort by longitude so the order is stable across pans —
    // ordering by anything view-dependent makes labels flicker in and out as you drag.
    const ordered = [...this.placeMarks].sort(
      (a, b) => a.place.tier - b.place.tier || a.place.lon - b.place.lon,
    );
    for (const { place, marker } of ordered) {
      const el = marker.getElement();
      if (!el) continue;
      let show = z >= minZoomFor(place.tier);
      if (show) {
        const pt = this.map.latLngToContainerPoint([place.lat, place.lon]);
        // Approximate the rendered box from the mono glyph width — measuring each element would force
        // ~90 layout reflows per pan. Mono means character count is an honest proxy for width.
        const fs = place.tier === 0 ? 11 : 10;
        const halfW = (place.name.length * fs * 0.62) / 2 + 4;
        const halfH = fs * 0.72;
        const box = { l: pt.x - halfW, r: pt.x + halfW, t: pt.y - halfH, b: pt.y + halfH };
        // Skip anything that isn't FULLY on screen. Rejecting only wholly-off-screen labels left the
        // ones straddling an edge rendering as fragments ("St. John's" → "St"), which reads as a bug;
        // and reserving space for labels nobody can read would suppress on-screen names for no reason.
        if (box.l < 0 || box.r > size.x || box.t < 0 || box.b > size.y) show = false;
        else if (placed.some((p) => box.l < p.r && box.r > p.l && box.t < p.b && box.b > p.t)) show = false;
        else placed.push(box);
      }
      el.style.display = show ? '' : 'none';
    }
  }

  isVisible(layer: FireLayer): boolean {
    return this.visible[layer];
  }

  /** Add/remove each layer group from the map per the current visibility flags (idempotent). */
  private applyVisibility(): void {
    const sync = (lyr: L.Layer, on: boolean): void => {
      const has = this.map.hasLayer(lyr);
      if (on && !has) lyr.addTo(this.map);
      else if (!on && has) this.map.removeLayer(lyr);
    };
    // The FWI forecast is a live CWFIS/GWIS feed, so the kill-switch must stop it too. Its own double-buffered
    // manager (image-overlay panes), not a single Leaflet layer — drive it directly, like smoke.
    this.fwi.setVisible(this.visible.fwi && isLiveFireEnabled());
    // Smoke is its own double-buffered manager (two panes), not a single Leaflet layer — drive it directly.
    this.smoke.setVisible(this.visible.smoke && isLiveFireEnabled());
    sync(this.perimLayer, this.visible.perimeters);
    sync(this.outLayer, this.visible.out);
    // Hotspots UNDER the reported dots: where the two stack (an active fire usually has hotspots on
    // it), the topmost-wins canvas tap must open the AUTHORITATIVE fire — the shared tap-priority
    // rule in view.ts, and what the globe's picker does.
    sync(this.hotspotLayer, this.visible.hotspots);
    sync(this.reportedLayer, this.visible.reported);
    // Halos annotate the reported marks, so they travel with that layer — a ranked ring hovering over
    // a fire you've hidden would point at nothing.
    sync(this.haloLayer, this.visible.reported);
  }

  // ── Framing + selection ──

  /**
   * Frame the map on the FIRE, not on the country.
   *
   * Fitting the raw bounds of every fire was framing the phone on the western hemisphere — a couple of
   * Arctic and Newfoundland outliers stretch the box from ~49°N to ~68°N and ~-140° to ~-52°, which on a
   * 390 px-wide screen resolves to roughly zoom 2: Canada a smudge in the top third, South America on
   * screen, the actual fires unreadable. The outliers were dictating the frame for everyone.
   *
   * So trim to the 4th–96th percentile of latitude and longitude — the band the fires actually sit in —
   * and let the handful outside it fall off the initial view (they're still plotted, still one pan away).
   * Padding is in PIXELS rather than a fraction of the bounds, so a wide box can't also inflate its own
   * margin. `minZoom: 3` is a floor against a near-empty set zooming out to the whole globe.
   */
  fitTo(points: [number, number][]): void {
    if (!points.length) return;
    if (points.length < 4) {
      this.map.fitBounds(L.latLngBounds(points), { maxZoom: 7, padding: [40, 40] });
      return;
    }
    // Trim harder on a narrow viewport. A phone showing the same national box resolves to a zoom where
    // the whole burning band is a smear along one edge and most of the screen is Arctic ocean; biting
    // further into the tails frames the band the fires actually occupy. A laptop has the width to show
    // the country honestly, so it keeps the wider span.
    const narrow = this.map.getSize().x < 620;
    const lo = narrow ? 0.1 : 0.04;
    const hi = narrow ? 0.9 : 0.96;
    const [latMin, latMax] = span(points.map((p) => p[0]), lo, hi);
    const [lonMin, lonMax] = span(points.map((p) => p[1]), lo, hi);
    const b = L.latLngBounds([latMin, lonMin], [latMax, lonMax]);
    // Clamped by hand rather than via fitBounds: Leaflet's FitBoundsOptions has a maxZoom but no floor,
    // and a near-empty set (one province, two fires) would otherwise fall out to the whole globe.
    const fit = this.map.getBoundsZoom(b, false, L.point(26, 26));
    this.map.setView(b.getCenter(), Math.max(3, Math.min(7, fit)));
  }

  /** Forget any current selection (its marker is about to be removed by a layer repaint). */
  private clearSelection(): void {
    this.selected = null;
    this.selectedBase = null;
  }

  /** Ring the tapped dot so the selection is obvious against its neighbours. The ring is the cyan
   *  ACCENT — selection is the one "interactive/live" state, and the globe view rings the same way
   *  (the two views must read identically). Restores the PREVIOUS dot's exact pre-selection style
   *  (hotspots and reported dots have different base weights/colours). */
  private highlight(m: L.CircleMarker): void {
    // Every marker click funnels through here, so this is the one place to arm the canvas-renderer guard
    // (see the map 'click' handler). Self-clear next tick: if the companion map click never comes, a later
    // bare-map tap must still be able to deselect.
    this.justHitMarker = true;
    setTimeout(() => { this.justHitMarker = false; }, 0);
    if (this.selected && this.selectedBase) this.selected.setStyle(this.selectedBase);
    this.selectedBase = { weight: (m.options.weight as number) ?? 1, color: (m.options.color as string) ?? UI.text };
    this.selected = m;
    m.setStyle({ weight: 3, color: UI.accent });
    m.bringToFront();
  }

  /** Leaflet needs this once the container has its real size (it's mounted hidden-then-shown). */
  invalidate(): void {
    this.map.invalidateSize();
  }

  dispose(): void {
    this.map.remove();
  }
}
