/**
 * FireMap — the interactive Leaflet map for the live wildfire tracker. A dark slippy map (CARTO dark
 * tiles, pinch-zoom/pan) that layers FOUR data sources, each independently toggleable:
 *
 *   • reported  — the AUTHORITATIVE CIFFC active fires: each drawn as an AREA-ACCURATE disc (radius
 *                 derived from its real hectares) shaded + ringed by stage of control, plus a centre
 *                 dot for visibility/hit-testing. Tapping fires `onSelectReported`.
 *   • perimeters — CWFIS M3 satellite-mapped burn footprints, faint scorch polygons (non-interactive).
 *   • hotspots  — raw CWFIS satellite heat detections, small dots coloured by head-fire intensity.
 *   • fwi       — the CWFIS Fire Weather Index raster, a WMS tile underlay (drawn beneath the dots).
 *
 * The ONLY Three-free map layer. Colours come from the `theme.ts` brand tokens (no hard-coded hex).
 * `preferCanvas` keeps a thousand-plus markers smooth on mobile. Tiles degrade gracefully — if CARTO
 * is unreachable the dark background + dots still read.
 *
 * THE tracker view: the tracker opens this flat map directly (the `LiveMapView` contract in `view.ts`).
 * The 3D `FireGlobe` it once shared the contract with was retired (more complex + cluttered than useful).
 */
import * as L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { UI } from '../ui/theme';
import { LIVEFIRE } from '../config';
import { radiusMetersForHa } from './normalize';
import { fwiFrameUrl, FWI_BOX, FWI_GLOBE_BOX, MERC_LAT_MAX, fwiForecastTime, GEOMET_WMS_URL, SMOKE_WMS_LAYER, SMOKE_WMS_SLD, isLiveFireEnabled } from './client';
import type { Hotspot, FireSeverity, ReportedFire, BurnPolygon } from './types';
import { STAGE_COLOR, SEV_COLOR } from './view';
import type { FireLayer, FireMapHandlers, LiveMapView } from './view';

export type { FireLayer, FireMapHandlers } from './view';

// Hotspot dot geometry per intensity band; the COLOURS come from the SHARED semantic maps in
// `view.ts` (STAGE_COLOR / SEV_COLOR) so both views paint identical meanings.
const SEV_STYLE: Record<FireSeverity, { radius: number; fill: number }> = {
  low: { radius: 2.5, fill: 0.7 },
  moderate: { radius: 3, fill: 0.82 },
  high: { radius: 4, fill: 0.9 },
  extreme: { radius: 5.5, fill: 1 },
};

const CARTO_DARK = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';

/**
 * A non-interactive dark backing disc drawn UNDER a marker so it separates from ANY background — the
 * sun-readability fix. On the dark basemap a bright dot already reads; outdoors in glare the whole screen
 * washes toward grey and a thin light-stroked dot vanishes into it. A near-black casing (UI.ink) one ring
 * wider than the dot gives a hard dark edge that survives the washout, so the marker stays a marker in the
 * sun. Cheap (one extra canvas circle) so it's reserved for the FEW important markers (reported + alerts),
 * not the thousand+ hotspots (those get a dark STROKE instead — same effect, no extra draw).
 */
function darkCasing(lat: number, lon: number, radius: number): L.CircleMarker {
  return L.circleMarker([lat, lon], {
    radius,
    stroke: false,
    fillColor: UI.ink,
    fillOpacity: 0.62,
    interactive: false,
  });
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
    sld: string,
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
      return L.tileLayer.wms(url, {
        layers: layer,
        styles: '', // empty — the custom SLD below supplies the (white→grey) styling
        sld_body: sld, // GeoMet honors SLD_BODY → server renders our smoke-true ramp (not the blue AQI default)
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
  // Which layers are currently shown (default: the authoritative fires — including the season's OUT
  // fires, the honest "what already burned" context — + their footprints + hotspots; the FWI raster is
  // opt-in so the map stays legible until the player asks for the danger field).
  private visible: Record<FireLayer, boolean> = { reported: true, out: true, perimeters: true, hotspots: true, fwi: false, smoke: false };

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
    L.tileLayer(CARTO_DARK, { subdomains: 'abcd', maxZoom: 19 }).addTo(this.map);

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
      SMOKE_WMS_SLD,
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
    this.applyVisibility();

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
        color: UI.ink, // a DARK casing stroke (was the fill colour → no separation): one marker, hard edge on any backdrop
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

  /** Plot the AUTHORITATIVE reported fires: an area-accurate footprint disc (true hectares) + a centre
   *  dot, both coloured by stage of control. Biggest fires drawn first so small ones land on top. */
  setReportedFires(fires: ReportedFire[]): void {
    this.reportedLayer.clearLayers();
    this.clearSelection();
    const ordered = [...fires].sort((a, b) => b.sizeHa - a.sizeHa);
    for (const f of ordered) {
      const color = STAGE_COLOR[f.stage];
      // The true footprint: a circle whose ground area equals the reported hectares (metres radius).
      if (f.sizeHa > 0) {
        L.circle([f.lat, f.lon], {
          radius: radiusMetersForHa(f.sizeHa),
          color,
          weight: 1.5,
          opacity: 0.8,
          fillColor: color,
          fillOpacity: 0.16,
          interactive: false, // taps go to the centre dot below (a huge disc shouldn't swallow the map)
        }).addTo(this.reportedLayer);
      }
      // The centre dot: always visible + the hit target (a 0.1 ha fire's disc is sub-pixel zoomed out).
      // A dark casing under it + a bold light pin-stroke over it = a marker that reads in direct sun.
      darkCasing(f.lat, f.lon, 7.5).addTo(this.reportedLayer);
      const dot = L.circleMarker([f.lat, f.lon], {
        radius: 5.5,
        color: UI.text,
        weight: 2,
        opacity: 1,
        fillColor: color,
        fillOpacity: 1,
      });
      dot.on('click', () => {
        this.highlight(dot);
        this.handlers.onSelectReported(f);
      });
      dot.addTo(this.reportedLayer);
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
        color: UI.ink, // dark casing stroke so an extinguished dot still has an edge in sun…
        weight: 1,
        opacity: 0.7,
        fillColor: UI.dim, // …while staying neutral + clearly subordinate to the active (coloured) fires
        fillOpacity: 0.55,
      });
      dot.on('click', () => {
        this.highlight(dot);
        this.handlers.onSelectReported(f);
      });
      dot.addTo(this.outLayer);
    }
  }

  /** Draw the satellite-mapped burn footprints as faint scorch polygons (non-interactive underlay). */
  setBurnPolygons(polys: BurnPolygon[]): void {
    this.perimLayer.clearLayers();
    for (const p of polys) {
      L.polygon(p.ring, {
        color: UI.ember,
        weight: 1,
        opacity: 0.5,
        fillColor: UI.ember,
        fillOpacity: 0.12,
        interactive: false,
      }).addTo(this.perimLayer);
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
  }

  // ── Framing + selection ──

  /** Frame the map to the given points (the union of whatever the country filter is showing). */
  fitTo(points: [number, number][]): void {
    if (!points.length) return;
    this.map.fitBounds(L.latLngBounds(points).pad(0.12), { maxZoom: 7 });
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
