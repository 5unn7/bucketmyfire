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
 * No longer the default view: the tracker opens the 3D `FireGlobe` (same `LiveMapView` contract in
 * `view.ts`); this flat map stays reachable via `?flat=1` and as the no-WebGL fallback.
 */
import * as L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { UI } from '../ui/theme';
import { LIVEFIRE } from '../config';
import { radiusMetersForHa } from './normalize';
import { FWI_WMS_URL, FWI_WMS_LAYER, FWI_WMS_SLD, fwiForecastTime, GEOMET_WMS_URL, SMOKE_WMS_LAYER, SMOKE_WMS_SLD, isLiveFireEnabled } from './client';
import type { Hotspot, FireSeverity, ReportedFire, BurnPolygon, AlertItem, BanArea } from './types';
import { STAGE_COLOR, SEV_COLOR, ALERT_COLOR, BAN_COLOR } from './view';
import type { FireLayer, FireMapHandlers, LiveMapView } from './view';

export type { FireLayer, FireMapHandlers } from './view';

// Hotspot dot geometry per intensity band; the COLOURS come from the SHARED semantic maps in
// `view.ts` (STAGE_COLOR / SEV_COLOR / ALERT_COLOR / BAN_COLOR) so both views paint identical meanings.
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

export class FireMap implements LiveMapView {
  private map: L.Map;
  private hotspotLayer: L.LayerGroup;
  private reportedLayer: L.LayerGroup;
  private outLayer: L.LayerGroup;
  private perimLayer: L.LayerGroup;
  private bansLayer: L.LayerGroup;
  private alertsLayer: L.LayerGroup;
  private fwiLayer: L.TileLayer.WMS;
  private smoke: SmokeForecastLayer;
  private selected: L.CircleMarker | null = null;
  private selectedBase: { weight: number; color: string } | null = null; // the selected dot's pre-ring style
  private handlers: FireMapHandlers;
  // Which layers are currently shown (default: the authoritative fires + their footprints + hotspots;
  // the FWI raster is opt-in so the map stays legible until the player asks for the danger field).
  private visible: Record<FireLayer, boolean> = { reported: true, out: false, perimeters: true, hotspots: true, fwi: false, smoke: false, alerts: false, bans: false };

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

    // The Fire Weather Index raster (WMS tiles → tilePane, so it renders UNDER the canvas dots). TIME = a
    // near-term FORECAST day so the layer is the CONTINUOUS model grid (full coverage), not the patchy
    // station-interpolated analysis. (See fwiForecastTime; honestly labeled a forecast in the UI.)
    this.fwiLayer = L.tileLayer.wms(FWI_WMS_URL, {
      layers: FWI_WMS_LAYER,
      styles: '', // empty — the brand SLD below supplies the warm danger ramp (not the default classed blue→red)
      sld_body: FWI_WMS_SLD, // same continuous ramp the globe uses → 24-bit output (no 4-bit dither), on-brand colours
      format: 'image/png',
      transparent: true,
      opacity: LIVEFIRE.fwiOpacity, // low tint, not a paint — keep the map legible underneath (config.ts)
      time: fwiForecastTime(),
      crossOrigin: true,
    } as L.WMSOptions);

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

    // Vector layers, drawn back-to-front: footprints → ban areas → extinguished → hotspots → active
    // fires → alert pins (authoritative above raw detections — see applyVisibility — and the
    // highest-priority overlay on top). Each added per its toggle.
    this.perimLayer = L.layerGroup();
    this.bansLayer = L.layerGroup();
    this.outLayer = L.layerGroup();
    this.reportedLayer = L.layerGroup();
    this.hotspotLayer = L.layerGroup();
    this.alertsLayer = L.layerGroup();
    this.applyVisibility();
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

  /** Plot active wildfire/evacuation ALERTS as bold ringed pins coloured by level (critical→advisory→info).
   *  Tapping one opens the issuer's notice (which links out to the official page). Drawn on top of fires. */
  setAlerts(alerts: AlertItem[]): void {
    this.alertsLayer.clearLayers();
    this.clearSelection();
    for (const a of alerts) {
      const color = ALERT_COLOR[a.level];
      darkCasing(a.lat, a.lon, 10).addTo(this.alertsLayer); // dark halo so the bold pin reads against sun-glare
      const m = L.circleMarker([a.lat, a.lon], {
        radius: 8,
        color: UI.text,
        weight: 2.5,
        opacity: 1,
        fillColor: color,
        fillOpacity: 1,
      });
      m.on('click', () => {
        this.highlight(m);
        this.handlers.onSelectAlert?.(a);
      });
      m.addTo(this.alertsLayer);
    }
  }

  /** Draw provincial fire-ban / restriction AREAS as dashed tinted polygons coloured by type. Tappable for
   *  the ban detail. An empty `bans` array simply clears the layer (the "no ban" state shows as nothing). */
  setBans(bans: BanArea[]): void {
    this.bansLayer.clearLayers();
    for (const b of bans) {
      const color = BAN_COLOR[b.type];
      const poly = L.polygon(b.ring, {
        color,
        weight: 1.5,
        opacity: 0.85,
        fillColor: color,
        fillOpacity: 0.14,
        dashArray: '6 4',
      });
      poly.on('click', () => this.handlers.onSelectBan?.(b));
      poly.addTo(this.bansLayer);
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

  /** Point the Fire-Weather-Index raster at one forecast DAY (yyyy-mm-dd) — updates the WMS TIME param so
   *  the day-scrubber can step the continuous forecast grid forward (each day is its own model run). */
  setFwiTime(iso: string): void {
    this.fwiLayer.setParams({ time: iso } as unknown as L.WMSParams);
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
    // The FWI raster is a live CWFIS feed, so the kill-switch must stop it too (the JSON feeds gate in
    // the client; this layer is constructed directly, so gate it here — never hit CWFIS when disabled).
    sync(this.fwiLayer, this.visible.fwi && isLiveFireEnabled());
    // Smoke is its own double-buffered manager (two panes), not a single Leaflet layer — drive it directly.
    this.smoke.setVisible(this.visible.smoke && isLiveFireEnabled());
    sync(this.perimLayer, this.visible.perimeters);
    sync(this.bansLayer, this.visible.bans);
    sync(this.outLayer, this.visible.out);
    // Hotspots UNDER the reported dots: where the two stack (an active fire usually has hotspots on
    // it), the topmost-wins canvas tap must open the AUTHORITATIVE fire — the shared tap-priority
    // rule in view.ts, and what the globe's picker does.
    sync(this.hotspotLayer, this.visible.hotspots);
    sync(this.reportedLayer, this.visible.reported);
    sync(this.alertsLayer, this.visible.alerts);
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
