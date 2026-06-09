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
 */
import * as L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { UI } from '../ui/theme';
import { LIVEFIRE } from '../config';
import { radiusMetersForHa } from './normalize';
import { FWI_WMS_URL, FWI_WMS_LAYER, GEOMET_WMS_URL, SMOKE_WMS_LAYER, SMOKE_WMS_STYLE, isLiveFireEnabled } from './client';
import type { Hotspot, FireSeverity, FireStage, ReportedFire, BurnPolygon, AlertItem, AlertLevel, BanArea, BanType } from './types';

/** The toggleable data layers. */
export type FireLayer = 'reported' | 'out' | 'perimeters' | 'hotspots' | 'fwi' | 'smoke' | 'alerts' | 'bans';

// Warm severity ramp for the raw HOTSPOTS, straight from the brand tokens (cool gold → amber-red hot).
const SEV_STYLE: Record<FireSeverity, { color: string; radius: number; fill: number }> = {
  low: { color: UI.emberHi, radius: 2.5, fill: 0.7 },
  moderate: { color: UI.ember, radius: 3, fill: 0.82 },
  high: { color: UI.warn, radius: 4, fill: 0.9 },
  extreme: { color: UI.warn, radius: 5.5, fill: 1 },
};

// Stage-of-control colour for the AUTHORITATIVE fires — danger→safe over existing tokens (no new hex):
// Out of control = warn (red), Being held = caution (amber), Under control = ok (green).
const STAGE_COLOR: Record<FireStage, string> = {
  OC: UI.warn,
  BH: UI.caution,
  UC: UI.ok,
  OUT: UI.caution,
  UNK: UI.caution,
};

// SaskAlert level → pin colour (critical=red, advisory=amber, info=neutral) over the same brand tokens.
const ALERT_COLOR: Record<AlertLevel, string> = { critical: UI.warn, advisory: UI.caution, info: UI.text, unknown: UI.caution };
// Fire-ban type → area tint (Ban=red, Restriction=amber, else neutral).
const BAN_COLOR: Record<BanType, string> = { Ban: UI.warn, Restriction: UI.caution, Advisory: UI.text, Other: UI.caution };

const CARTO_DARK = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';

export interface FireMapHandlers {
  onSelectHotspot: (h: Hotspot) => void;
  onSelectReported: (f: ReportedFire) => void;
  // Optional so a simpler consumer (e.g. a front-door map) need not wire the alert/ban layers.
  onSelectAlert?: (a: AlertItem) => void;
  onSelectBan?: (b: BanArea) => void;
}

export class FireMap {
  private map: L.Map;
  private hotspotLayer: L.LayerGroup;
  private reportedLayer: L.LayerGroup;
  private outLayer: L.LayerGroup;
  private perimLayer: L.LayerGroup;
  private bansLayer: L.LayerGroup;
  private alertsLayer: L.LayerGroup;
  private fwiLayer: L.TileLayer.WMS;
  private smokeLayer: L.TileLayer.WMS;
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

    // The Fire Weather Index raster (WMS tiles → tilePane, so it renders UNDER the canvas dots).
    this.fwiLayer = L.tileLayer.wms(FWI_WMS_URL, {
      layers: FWI_WMS_LAYER,
      format: 'image/png',
      transparent: true,
      opacity: LIVEFIRE.fwiOpacity, // low tint, not a paint — keep the map legible underneath (config.ts)
      crossOrigin: true,
    } as L.WMSOptions);

    // The surface-smoke FORECAST raster (ECCC GeoMet FireWork). A WMS tile underlay like FWI; its TIME
    // param is set per frame by setSmokeTime() so the layer animates. Tiles 404 gracefully past the run.
    this.smokeLayer = L.tileLayer.wms(GEOMET_WMS_URL, {
      layers: SMOKE_WMS_LAYER,
      styles: SMOKE_WMS_STYLE,
      format: 'image/png',
      transparent: true,
      version: '1.3.0',
      opacity: LIVEFIRE.smokeOpacity,
      crossOrigin: true,
    } as L.WMSOptions);

    // Vector layers, drawn back-to-front: footprints → ban areas → extinguished → active fires → hotspots
    // → alert pins (the highest-priority overlay sits on top). Each added per its toggle.
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
        radius: st.radius,
        color: st.color,
        weight: 1,
        opacity: 0.85,
        fillColor: st.color,
        fillOpacity: st.fill,
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
      const dot = L.circleMarker([f.lat, f.lon], {
        radius: 4.5,
        color: UI.text,
        weight: 1.5,
        opacity: 0.9,
        fillColor: color,
        fillOpacity: 0.95,
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
        radius: 2.5,
        color: UI.faint,
        weight: 1,
        opacity: 0.5,
        fillColor: UI.faint,
        fillOpacity: 0.4,
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
      const m = L.circleMarker([a.lat, a.lon], {
        radius: 7,
        color: UI.text,
        weight: 2,
        opacity: 0.95,
        fillColor: color,
        fillOpacity: 0.9,
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

  /** Point the animated smoke raster at one hourly forecast frame (ISO8601 UTC). Reloads only the visible
   *  tiles for that TIME; harmless when the layer is hidden (the param sticks for when it's shown). */
  setSmokeTime(iso: string): void {
    // `time` is a WMS dimension param (not in the typed WMSParams shape); Leaflet merges it into the
    // GetMap query at runtime. Cast through unknown to attach it without re-supplying the base params.
    this.smokeLayer.setParams({ time: iso } as unknown as L.WMSParams);
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
    sync(this.smokeLayer, this.visible.smoke && isLiveFireEnabled());
    sync(this.perimLayer, this.visible.perimeters);
    sync(this.bansLayer, this.visible.bans);
    sync(this.outLayer, this.visible.out);
    sync(this.reportedLayer, this.visible.reported);
    sync(this.hotspotLayer, this.visible.hotspots);
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

  /** Ring the tapped dot so the selection is obvious against its neighbours. Restores the PREVIOUS dot's
   *  exact pre-selection style (hotspots and reported dots have different base weights/colours). */
  private highlight(m: L.CircleMarker): void {
    if (this.selected && this.selectedBase) this.selected.setStyle(this.selectedBase);
    this.selectedBase = { weight: (m.options.weight as number) ?? 1, color: (m.options.color as string) ?? UI.text };
    this.selected = m;
    m.setStyle({ weight: 3, color: UI.text });
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
