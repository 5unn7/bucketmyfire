/**
 * FireGlobe — the live wildfire tracker's DEFAULT view: a real-3D Three.js globe in the glass-
 * cockpit language. The earth is PROCEDURAL (baked Natural Earth outlines → runtime canvas fill +
 * crisp 3D vector coastlines/borders/provinces — no basemap imagery, no tiles), lit instrument-cool
 * with a cyan limb glow; the fire DATA on it is the warm register, drawn with the same brand tokens
 * and semantics as the flat map:
 *
 *   • reported   — CIFFC active fires: an AREA-ACCURATE surface disc (true hectares) + a constant-px
 *                  marker dot (dark casing → white pin ring → stage fill), tappable.
 *   • out        — extinguished fires this season, small dim dots, tappable.
 *   • perimeters — CWFIS M3 burn footprints as faint ember outlines (non-interactive).
 *   • hotspots   — satellite heat detections, GPU points coloured by intensity, tappable.
 *   • fwi / smoke— the two FORECAST rasters, fetched as single EPSG:4326 GetMap images and DRAPED
 *                  onto the sphere in the earth shader (smoke double-buffered + crossfaded so the
 *                  scrubber morphs instead of strobing — the same honesty/feel as the flat map).
 *
 * Implements the same `LiveMapView` contract as the Leaflet `FireMap` (kept behind `?flat=1` and as
 * the no-WebGL fallback), so the tracker page — layer sheet, scrubber, detail sheets, ledger — is
 * untouched. Mobile invariants hold: geometry rebuilds only on data setters (a user action), the
 * frame loop is O(1) uniform updates + one draw, there are NO shader recompiles after load (fixed
 * shader structure; 1×1 placeholder textures until a raster loads), and DPR is capped at 2.
 */
import * as THREE from 'three';
import { UI, GLOBE } from '../ui/theme';
import { LIVEFIRE } from '../config';
import { radiusMetersForHa } from './normalize';
import {
  FWI_WMS_URL, FWI_WMS_LAYER, FWI_WMS_SLD, GWIS_FWI_WMS_URL, GWIS_FWI_LAYER, GWIS_FWI_SLD,
  fwiForecastTime, GEOMET_WMS_URL, SMOKE_WMS_LAYER, SMOKE_WMS_SLD, isLiveFireEnabled,
} from './client';
import { paintBasemap, landEdges } from './globe/basemap';
import { GlobeTiles, llToV3 } from './globe/TileLayer';
import { STAGE_COLOR, SEV_COLOR } from './view';
import type { FireLayer, FireMapHandlers, LiveMapView } from './view';
import type { Hotspot, FireSeverity, ReportedFire, BurnPolygon } from './types';

export type { FireLayer, FireMapHandlers } from './view';

const DEG = Math.PI / 180;
const EARTH_R_M = 6_371_000; // mean earth radius (m) — the globe is unit-radius, so rad = m / this

// Layer altitudes (earth radii), bottom-up: base sphere 1.0 → raster TILES (1.0001 + z·1.2e-5,
// see TileLayer) → the forecast-drape shell → vector layers → marker dots. Altitudes are SMALL
// (≤ ~5 km) because at the deep zoom the tiles enable, a high-floating constant-px dot would
// parallax visibly off its true location; the dynamic near plane (setDist) keeps the z-buffer
// resolving these separations at every distance.
const ALT = { drape: 1.00045, lines: 1.0005, perim: 1.00055, disc: 1.00065, dots: 1.0008 } as const;

// Hotspot dot size per intensity band (px); colours come from the SHARED `view.ts` semantic maps so
// both views paint identical meanings.
const SEV_PX: Record<FireSeverity, number> = { low: 6, moderate: 7, high: 9, extreme: 12 };

// The CWFIS FWI drape window — one EPSG:4326 GetMap covering Canada (that data IS Canada-only).
const BOX = { lonMin: -141, latMin: 40, lonMax: -50, latMax: 84 } as const;
// The GWIS global FWI drape spans the WHOLE planet (its data IS global) — drawn UNDER the Canada drape,
// so the danger field colours everywhere and the finer CWFIS grid wins over Canada. r maps to vUv 1:1.
const GLOBE_BOX = { lonMin: -180, latMin: -90, lonMax: 180, latMax: 90 } as const;
// The SMOKE drape window is WIDER: the ECCC FireWork/RAQDPS-FW model is continental, and plumes
// routinely cross 40°N / drift over Alaska — a Canada-clipped drape cuts them with a razor edge.
const SMOKE_BOX = { lonMin: -170, latMin: 25, lonMax: -50, latMax: 84 } as const;
type DrapeBox = { lonMin: number; latMin: number; lonMax: number; latMax: number };
const boxSpan = (b: DrapeBox): { lon: number; lat: number } => ({ lon: b.lonMax - b.lonMin, lat: b.latMax - b.latMin });

/** Parse a theme token ('#hex' or 'rgba(…)') into a RAW THREE.Color + alpha — no colour-space
 *  conversion, so the GL output matches the DOM tokens byte-for-byte (ShaderMaterial applies no
 *  output transform either; see the colour notes in the earth shader). Cached per token string. */
const TOK_CACHE = new Map<string, { c: THREE.Color; a: number }>();
function tok(s: string): { c: THREE.Color; a: number } {
  const hit = TOK_CACHE.get(s);
  if (hit) return hit;
  const m = s.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/);
  const out = m
    ? { c: new THREE.Color().setRGB(+m[1] / 255, +m[2] / 255, +m[3] / 255), a: m[4] !== undefined ? +m[4] : 1 }
    : { c: new THREE.Color().setStyle(s, THREE.NoColorSpace), a: 1 };
  TOK_CACHE.set(s, out);
  return out;
}

/** A 1×1 fully-transparent placeholder so every raster sampler is always bound (fixed shader
 *  structure — toggling a layer changes a uniform float, never the program). */
function blankTex(): THREE.DataTexture {
  const t = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1);
  t.needsUpdate = true;
  return t;
}

/** Single-image WMS GetMap URL (v1.1.1 → bbox is lon-first) over a drape window. */
function wmsUrl(base: string, layer: string, box: DrapeBox, opts: { time?: string; sld?: string; width: number }): string {
  const span = boxSpan(box);
  const h = Math.round((opts.width * span.lat) / span.lon);
  const p = new URLSearchParams({
    service: 'WMS', version: '1.1.1', request: 'GetMap', layers: layer, styles: '',
    format: 'image/png', transparent: 'true', srs: 'EPSG:4326',
    bbox: `${box.lonMin},${box.latMin},${box.lonMax},${box.latMax}`,
    width: String(opts.width), height: String(h),
  });
  if (opts.time) p.set('time', opts.time);
  if (opts.sld) p.set('sld_body', opts.sld);
  return `${base}?${p.toString()}`;
}

// ── shaders ────────────────────────────────────────────────────────────────────────────────────

const EARTH_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vN;
varying vec3 vView;
void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vN = normalize(mat3(modelMatrix) * normal);
  vView = normalize(cameraPosition - wp.xyz);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

// Colour pipeline note: every texture + uniform here is RAW token bytes (NoColorSpace) and a raw
// ShaderMaterial applies no output transform, so what theme.ts says is what the screen shows.
const EARTH_FRAG = /* glsl */ `
uniform sampler2D uBase;
uniform vec3 uAtmo;
uniform vec3 uNight;
uniform vec3 uGrat;
uniform float uGratA;
varying vec2 vUv;
varying vec3 vN;
varying vec3 vView;
void main() {
  vec3 col = texture2D(uBase, vUv).rgb;
  float lon = vUv.x * 360.0 - 180.0;
  float lat = vUv.y * 180.0 - 90.0;

  // 15-degree graticule, fwidth-AA'd — the instrument grid under the data. Each line family fades
  // out where it stops being resolvable (meridians converge at the poles; without the fade the
  // blown-up fwidth paints the whole polar cap as "line").
  vec2 g = vec2(lon, lat) / 15.0;
  vec2 gf = abs(fract(g) - 0.5);
  vec2 fw = fwidth(g) * 1.4;
  vec2 onLine = (vec2(1.0) - smoothstep(vec2(0.0), fw, vec2(0.5) - gf))
    * (vec2(1.0) - smoothstep(vec2(0.25), vec2(0.55), fw));
  col = mix(col, uGrat, max(onLine.x, onLine.y) * uGratA);

  // Sphere shaping: camera-keyed falloff keeps the ball reading round, and a cool fresnel limb
  // sheen gives the instrument-glass edge. Never to pure black — the night floor keeps the form.
  float ndv = max(dot(normalize(vN), normalize(vView)), 0.0);
  col *= mix(0.58, 1.0, smoothstep(0.0, 0.6, ndv));
  col = mix(col, uNight, (1.0 - ndv) * 0.22);
  col += uAtmo * pow(1.0 - ndv, 2.8) * 0.20;
  gl_FragColor = vec4(col, 1.0);
}`;

// The forecast-drape SHELL: FWI + double-buffered smoke, on a transparent sphere ABOVE
// the raster tiles (the drapes are live DATA — they must read over real geography at close zoom,
// not be buried under it). Each drape samples inside its own lat/lon window; layers over-compose
// premultiplied and un-premultiply on output so standard alpha blending is exact.
const DRAPE_FRAG = /* glsl */ `
uniform sampler2D uFwi;
uniform sampler2D uFwiG; // GWIS global FWI wash (whole planet), drawn beneath the Canada drape
uniform sampler2D uSmokeA;
uniform sampler2D uSmokeB;
uniform float uSmokeMix;
uniform float uFwiOn;
uniform float uSmokeOn;
uniform float uFwiAlpha;
uniform float uSmokeAlpha;
uniform vec4 uBox; // FWI window: lonMin, latMin, lonSpan, latSpan
uniform vec4 uSBox; // the wider smoke window (the FireWork model is continental)
varying vec2 vUv;
varying vec3 vN;
varying vec3 vView;
void main() {
  float lon = vUv.x * 360.0 - 180.0;
  float lat = vUv.y * 180.0 - 90.0;
  vec3 acc = vec3(0.0);
  float accA = 0.0;
  // GWIS global FWI wash — the whole-planet danger field. GLOBE_BOX spans -180..180 / -90..90, so the
  // sample coord IS vUv. Composited first; the finer CWFIS Canada drape below overlays on top of it.
  vec4 fwig = texture2D(uFwiG, vUv);
  float fga = fwig.a * uFwiAlpha * uFwiOn;
  acc = acc * (1.0 - fga) + fwig.rgb * fga;
  accA = accA * (1.0 - fga) + fga;
  vec2 r = vec2((lon - uBox.x) / uBox.z, (lat - uBox.y) / uBox.w);
  if (r.x > 0.0 && r.x < 1.0 && r.y > 0.0 && r.y < 1.0) {
    vec4 fwi = texture2D(uFwi, r);
    float fa = fwi.a * uFwiAlpha * uFwiOn;
    acc = acc * (1.0 - fa) + fwi.rgb * fa;
    accA = accA * (1.0 - fa) + fa;
  }
  vec2 sr = vec2((lon - uSBox.x) / uSBox.z, (lat - uSBox.y) / uSBox.w);
  if (sr.x > 0.0 && sr.x < 1.0 && sr.y > 0.0 && sr.y < 1.0) {
    vec4 sm = mix(texture2D(uSmokeA, sr), texture2D(uSmokeB, sr), uSmokeMix);
    float sa = sm.a * uSmokeAlpha * uSmokeOn;
    acc = acc * (1.0 - sa) + sm.rgb * sa;
    accA = accA * (1.0 - sa) + sa;
  }
  if (accA < 0.004) discard;
  gl_FragColor = vec4(acc / accA, accA);
}`;

const ATMO_VERT = /* glsl */ `
varying vec3 vN;
void main() {
  vN = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

// BackSide halo: visible fragments are the shell's far surface in the ring just outside the earth's
// silhouette. There the geometric normal tips AWAY from the camera (dot < 0), most strongly right at
// the earth's edge — so (c − dot) peaks at the limb and falls to the halo's outer edge. Additive.
const ATMO_FRAG = /* glsl */ `
uniform vec3 uColor;
varying vec3 vN;
void main() {
  float f = pow(clamp(0.66 - dot(normalize(vN), vec3(0.0, 0.0, 1.0)), 0.0, 1.0), 4.0);
  gl_FragColor = vec4(uColor, 1.0) * f * 0.5;
}`;

// One point shader, three styles (uStyle): 0 = hotspot (colour core, dark edge), 1 = marker (dark
// casing → white pin ring → colour fill — the sun-readable mark), 2 = soft (dim extinguished dot),
// 3 = selection ring (hollow accent ring over the picked mark). Points fade out across the limb.
const POINT_VERT = /* glsl */ `
attribute float aSize;
attribute vec3 aColor;
uniform float uPx;
varying vec3 vColor;
varying float vFade;
void main() {
  vColor = aColor;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vec3 n = normalize(mat3(modelMatrix) * position);
  vFade = smoothstep(0.0, 0.14, dot(n, normalize(cameraPosition - wp.xyz)));
  gl_PointSize = aSize * uPx;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const POINT_FRAG = /* glsl */ `
uniform vec3 uInk;
uniform vec3 uPin;
uniform float uStyle;
varying vec3 vColor;
varying float vFade;
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float d = length(p);
  if (d > 1.0 || vFade < 0.02) discard;
  float aa = fwidth(d) * 1.5;
  vec3 col = vColor;
  float a = 1.0;
  // Glass-bead sheen: a soft specular highlight off the upper-left, so a mark reads as a domed
  // glass cabochon (the cockpit material) rather than a flat web-map dot. Masked to each style's
  // fill core below so it never bleeds onto the casing/ring.
  float sheen = 1.0 - smoothstep(0.0, 0.62, length(p - vec2(-0.26, -0.32)));
  if (uStyle < 0.5) { // hotspot — saturated core with a hard dark edge (sun-glare separation)
    col += sheen * 0.22 * (1.0 - smoothstep(0.5, 0.74, d)); // subtle gloss on the tiny bead
    col = mix(col, uInk, smoothstep(0.6 - aa, 0.74, d));
    a = (1.0 - smoothstep(0.9 - aa, 1.0, d)) * 0.95;
  } else if (uStyle < 1.5) { // marker — casing + pin ring + fill, the flat map's mark in GL
    col += sheen * 0.34 * (1.0 - smoothstep(0.46 - aa, 0.5, d)); // gloss on the colour fill core only
    col = mix(col, uPin, smoothstep(0.5 - aa, 0.5, d));
    col = mix(col, uInk, smoothstep(0.72 - aa, 0.72, d));
    a = mix(1.0, 0.62, smoothstep(0.72 - aa, 0.72, d));
    a *= 1.0 - smoothstep(1.0 - aa, 1.0, d);
  } else if (uStyle < 2.5) { // soft — extinguished: dim, subordinate
    col = mix(vColor, uInk, smoothstep(0.45, 0.72, d));
    a = (1.0 - smoothstep(0.78, 1.0, d)) * 0.62;
  } else { // selection ring — hollow, over the picked mark
    float ring = smoothstep(0.62 - aa, 0.62, d) * (1.0 - smoothstep(0.86, 0.86 + aa, d));
    col = vColor;
    a = ring;
  }
  gl_FragColor = vec4(col, a * vFade);
}`;

// ── geometry helpers ───────────────────────────────────────────────────────────────────────────

/** Merged LineSegments geometry from [lon,lat] polylines, draped at `alt` earth radii. */
function linesGeometry(lines: [number, number][][], alt: number): THREE.BufferGeometry {
  let n = 0;
  for (const l of lines) n += Math.max(0, l.length - 1) * 2;
  const pos = new Float32Array(n * 3);
  const v = new THREE.Vector3();
  let o = 0;
  for (const l of lines) {
    for (let i = 0; i < l.length - 1; i++) {
      llToV3(l[i][1], l[i][0], alt, v);
      pos[o++] = v.x; pos[o++] = v.y; pos[o++] = v.z;
      llToV3(l[i + 1][1], l[i + 1][0], alt, v);
      pos[o++] = v.x; pos[o++] = v.y; pos[o++] = v.z;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  return g;
}

interface PointSpec { lat: number; lon: number; color: THREE.Color; px: number }

/** (Re)build a Points geometry from marker specs (positions on the dot shell + per-point colour/size). */
function pointsGeometry(specs: PointSpec[]): THREE.BufferGeometry {
  const pos = new Float32Array(specs.length * 3);
  const col = new Float32Array(specs.length * 3);
  const size = new Float32Array(specs.length);
  const v = new THREE.Vector3();
  specs.forEach((s, i) => {
    llToV3(s.lat, s.lon, ALT.dots, v);
    pos.set([v.x, v.y, v.z], i * 3);
    col.set([s.color.r, s.color.g, s.color.b], i * 3);
    size[i] = s.px;
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  return g;
}

interface Pickable<T> { lat: number; lon: number; data: T }

// Frame-loop scratch (applyView runs per frame — no allocation allowed there).
const S_F = new THREE.Vector3();
const S_UP = new THREE.Vector3();
const S_RIGHT = new THREE.Vector3();
const S_MAT = new THREE.Matrix4();

// ── the view ───────────────────────────────────────────────────────────────────────────────────

export class FireGlobe implements LiveMapView {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private earth = new THREE.Group();
  private earthMat: THREE.ShaderMaterial;
  private drapeMat: THREE.ShaderMaterial; // the forecast shell (FWI/smoke/bans) above the tiles
  private pointMat: { hotspot: THREE.ShaderMaterial; marker: THREE.ShaderMaterial; soft: THREE.ShaderMaterial; sel: THREE.ShaderMaterial };
  // Zoom-in detail tiles + the vector geography that yields to them (double coastlines otherwise).
  private tiles: GlobeTiles;
  private tileFade = -1; // last applied fade (−1 forces the first apply)
  private lastTileSel = 0;
  private geoLineMats: { mat: THREE.LineBasicMaterial; base: number }[] = [];

  // Layer scene objects (each rebuilt by its data setter; visibility independent).
  private hotspotPts: THREE.Points;
  private reportedGrp = new THREE.Group(); // area discs + rim rings + marker dots
  private reportedDots: THREE.Points;
  private outPts: THREE.Points;
  private perimLines: THREE.LineSegments;
  private selPts: THREE.Points; // single-vertex selection ring
  private selLayer: FireLayer | null = null; // which layer the selection ring belongs to (cleared with it)
  // Reusable disc/ring materials — created ONCE so a data repaint never constructs a material
  // (a new material = a potential shader compile; the no-recompiles-after-load law).
  private discMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide });
  private ringMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false });

  // Pickables (screen-space nearest on tap; priority reported → out → hotspots).
  private pickHot: Pickable<Hotspot>[] = [];
  private pickRep: Pickable<ReportedFire>[] = [];
  private pickOut: Pickable<ReportedFire>[] = [];

  private visible: Record<FireLayer, boolean> = { reported: true, out: false, perimeters: true, hotspots: true, fwi: false, smoke: false };

  // View state — the lat/lon facing the camera + camera distance (earth radii), animated.
  private vLat = 56; private vLon = -96; private vDist: number;
  private tLat = 56; private tLon = -96; private tDist: number;
  private animating = false;
  private velLat = 0; private velLon = 0; // drag inertia (deg/s)
  private everTouched = false;
  private coarsePointer = false; // last pointerdown was touch/pen → fatter tap targets (mobile leniency)
  private framed = false; // a fitTo landed — the attract spin must not drift a framed view away
  private reduced = false;
  private dirty = true; // render-on-demand: a static scene skips the draw (battery — P1 review find)
  private raf = 0;
  private lastT = 0;
  private disposed = false;
  private ro: ResizeObserver | null = null;

  // Forecast rasters.
  private fwiTex: THREE.Texture;
  private fwiTexG: THREE.Texture; // GWIS global FWI drape (its own WMS request/load state)
  private fwiTime = fwiForecastTime();
  private fwiLoadedTime: string | null = null;
  private fwiInflight: string | null = null; // dedupe — toggle-on + the scrubber both request the same day
  private fwiToken = 0;
  private fwiLoadedTimeG: string | null = null;
  private fwiInflightG: string | null = null;
  private fwiTokenG = 0;
  private smokeTexA: THREE.Texture;
  private smokeTexB: THREE.Texture;
  private smokeFrontIsA = true;
  private smokeFrame: string | null = null; // the frame currently shown
  private smokePending: string | null = null; // latest requested frame (applied on show)
  private smokeInflight: string | null = null; // dedupe — never refetch the frame already loading
  private smokeToken = 0;
  private smokeMixTarget = 0;

  private handlers: FireMapHandlers;
  private container: HTMLElement;
  private onVis = (): void => {
    if (!document.hidden) {
      this.lastT = 0;
      this.dirty = true; // repaint on return — the tab may have dropped the backbuffer
    }
  };

  constructor(container: HTMLElement, handlers: FireMapHandlers) {
    this.container = container;
    this.handlers = handlers;
    this.reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const G = LIVEFIRE.globe;
    this.vDist = this.tDist = G.maxDist;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    // RAW colour end-to-end: every texture + uniform carries token BYTES (NoColorSpace) and the raw
    // ShaderMaterials apply no output transform — but three's BUILT-IN materials (the disc/ring/line
    // layers) append an sRGB encode against the default SRGBColorSpace output, which would render
    // the SAME stage token visibly lighter than the marker dot beside it. Linear output makes the
    // encode a passthrough so the whole scene is byte-for-byte the tokens (P1 review find).
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    const cv = this.renderer.domElement;
    cv.className = 'fglobe-canvas';
    cv.tabIndex = 0; // keyboard-operable (parity with Leaflet's keyboard:true — arrows rotate, +/- zoom)
    cv.setAttribute('role', 'application');
    cv.setAttribute('aria-label', 'Wildfire globe. Arrow keys rotate, plus and minus zoom.');
    // NOTE: the container is NOT touched yet — classList/append happen at the END of the ctor, after
    // every throwable step, so a construction failure leaves the container pristine for the Leaflet
    // fallback (menus.ts buildGlobe().catch(buildFlat)).

    this.camera = new THREE.PerspectiveCamera(G.fov, 1, 0.01, 12);
    this.camera.position.set(0, 0, this.vDist);

    // ── earth ──
    const atmo = tok(GLOBE.atmosphere);
    this.earthMat = new THREE.ShaderMaterial({
      vertexShader: EARTH_VERT,
      fragmentShader: EARTH_FRAG,
      uniforms: {
        uBase: { value: this.makeBaseTexture() },
        uAtmo: { value: atmo.c },
        uNight: { value: tok(GLOBE.night).c },
        uGrat: { value: tok(GLOBE.graticule).c },
        uGratA: { value: tok(GLOBE.graticule).a },
      },
    });
    const earthMesh = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 64), this.earthMat);
    this.earth.add(earthMesh);

    // ── zoom-in detail tiles (between the base sphere and the drape shell) ──
    this.tiles = new GlobeTiles({
      dpr: Math.min(window.devicePixelRatio || 1, 2),
      maxZ: G.tileMaxZ,
      lift: G.tileLift,
      onChange: () => { this.dirty = true; }, // a landed tile is a visible change (render-on-demand)
    });
    this.earth.add(this.tiles.group);

    // ── the forecast-drape shell (FWI / smoke / ban tint) — ABOVE the tiles, below the data marks ──
    this.drapeMat = new THREE.ShaderMaterial({
      vertexShader: EARTH_VERT,
      fragmentShader: DRAPE_FRAG,
      uniforms: {
        uBans: { value: null },
        uFwi: { value: (this.fwiTex = blankTex()) },
        uFwiG: { value: (this.fwiTexG = blankTex()) },
        uSmokeA: { value: (this.smokeTexA = blankTex()) },
        uSmokeB: { value: (this.smokeTexB = blankTex()) },
        uSmokeMix: { value: 0 },
        uFwiOn: { value: 0 },
        uSmokeOn: { value: 0 },
        uFwiAlpha: { value: G.fwiOpacity }, // the drape's OWN config token (a sphere drape reads softer than tiles)
        uSmokeAlpha: { value: LIVEFIRE.smokeOpacity },
        uBox: { value: new THREE.Vector4(BOX.lonMin, BOX.latMin, boxSpan(BOX).lon, boxSpan(BOX).lat) },
        uSBox: { value: new THREE.Vector4(SMOKE_BOX.lonMin, SMOKE_BOX.latMin, boxSpan(SMOKE_BOX).lon, boxSpan(SMOKE_BOX).lat) },
      },
      transparent: true,
      depthWrite: false,
      // depthTEST off too: the drape is a flat data OVERLAY that must always composite over the
      // basemap. A coarse drape sphere's flat facets sag ~0.0005 in radius at their centres — MORE
      // than its clearance above the tile shell — so with depth-testing the tiles punch hexagonal
      // holes through it (the facet centres fail the test). Front-face culling already limits it to
      // the near hemisphere, so "always draw" just paints it cleanly over the visible tiles.
      depthTest: false,
    });
    const drapeMesh = new THREE.Mesh(new THREE.SphereGeometry(ALT.drape, 96, 64), this.drapeMat);
    drapeMesh.renderOrder = 0.5; // after the tiles (0), before every data mark (≥1)
    this.earth.add(drapeMesh);

    // Crisp vector geography: coastlines + international borders + Canadian province lines. These
    // FADE OUT as the tiles fade in — the tiles carry the real coastlines at close zoom, and a
    // procedural outline over a raster one reads as a misregistered double edge.
    const edges = landEdges();
    const lineMat = (tokStr: string, geo = false): THREE.LineBasicMaterial => {
      const t = tok(tokStr);
      const m = new THREE.LineBasicMaterial({ color: t.c, transparent: true, opacity: t.a, depthWrite: false });
      if (geo) this.geoLineMats.push({ mat: m, base: t.a });
      return m;
    };
    this.earth.add(new THREE.LineSegments(linesGeometry(edges.coasts, ALT.lines), lineMat(GLOBE.coast, true)));
    this.earth.add(new THREE.LineSegments(linesGeometry(edges.borders, ALT.lines), lineMat(GLOBE.border, true)));
    this.earth.add(new THREE.LineSegments(linesGeometry(edges.provinces, ALT.lines), lineMat(GLOBE.province, true)));

    // ── atmosphere halo (outside the rotating group — it's view-aligned by nature) ──
    const atmoMat = new THREE.ShaderMaterial({
      vertexShader: ATMO_VERT,
      fragmentShader: ATMO_FRAG,
      uniforms: { uColor: { value: atmo.c } },
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
    });
    this.scene.add(new THREE.Mesh(new THREE.SphereGeometry(1.05, 64, 48), atmoMat));

    // ── data layers ──
    const ink = tok(UI.ink).c;
    const pin = tok(UI.text).c;
    const mkPointMat = (style: number): THREE.ShaderMaterial =>
      new THREE.ShaderMaterial({
        vertexShader: POINT_VERT,
        fragmentShader: POINT_FRAG,
        uniforms: { uPx: { value: Math.min(window.devicePixelRatio || 1, 2) }, uInk: { value: ink }, uPin: { value: pin }, uStyle: { value: style } },
        transparent: true,
        depthWrite: false,
      });
    this.pointMat = { hotspot: mkPointMat(0), marker: mkPointMat(1), soft: mkPointMat(2), sel: mkPointMat(3) };

    this.hotspotPts = new THREE.Points(pointsGeometry([]), this.pointMat.hotspot);
    this.reportedDots = new THREE.Points(pointsGeometry([]), this.pointMat.marker);
    this.outPts = new THREE.Points(pointsGeometry([]), this.pointMat.soft);
    this.perimLines = new THREE.LineSegments(new THREE.BufferGeometry(), lineMat(UI.ember));
    (this.perimLines.material as THREE.LineBasicMaterial).opacity = 0.5;
    this.selPts = new THREE.Points(pointsGeometry([]), this.pointMat.sel);
    this.selPts.visible = false;

    // Draw order mirrors the flat map's panes: footprints → out → discs → hotspots.
    this.perimLines.renderOrder = 1;
    this.reportedGrp.renderOrder = 2;
    this.outPts.renderOrder = 3;
    this.reportedDots.renderOrder = 4;
    this.hotspotPts.renderOrder = 5;
    this.selPts.renderOrder = 7;
    this.earth.add(this.perimLines, this.reportedGrp, this.outPts, this.reportedDots, this.hotspotPts, this.selPts);
    this.scene.add(this.earth);

    this.applyVisibility();
    this.bindInput();

    // Precompile EVERY shader program up front — including the tile material's (tiles spawn on the
    // first zoom-in; without this their first appearance pays a mid-interaction compile, breaking
    // the no-recompiles-after-load law in spirit). The probe mesh stays invisible in the scene.
    const tileProbe = new THREE.Mesh(new THREE.PlaneGeometry(0.0001, 0.0001), this.tiles.probeMaterial());
    tileProbe.visible = false;
    this.scene.add(tileProbe);
    this.renderer.compile(this.scene, this.camera);

    // ALL throwable construction is done — only now touch the container, so a ctor failure leaves
    // it pristine for the Leaflet fallback (and dispose() is the only undo path that's ever needed).
    container.classList.add('fglobe');
    container.appendChild(cv);
    document.addEventListener('visibilitychange', this.onVis);
    this.ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => this.invalidate()) : null;
    this.ro?.observe(container);
    this.invalidate();
    this.applyView();
    this.raf = requestAnimationFrame(this.tick);

    // QA hook (the __game/__fireQA pattern): the headless harness drives the scene directly. Gated —
    // `?qa` would boot the GAME on the front door, so the map QA flag is its own `?mapqa`.
    if (import.meta.env.DEV || new URLSearchParams(location.search).has('mapqa')) {
      (window as unknown as { __fireGlobe?: unknown }).__fireGlobe = this;
    }
  }

  /** The procedural earth fill texture (vector data → canvas), mipped + anisotropic. */
  private makeBaseTexture(): THREE.CanvasTexture {
    const t = new THREE.CanvasTexture(paintBasemap(2048, 1024));
    t.wrapS = THREE.RepeatWrapping; // the seam at ±180° samples across cleanly
    t.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    return t;
  }

  // ── data setters (the LiveMapView contract) ──

  setHotspots(hotspots: Hotspot[]): void {
    this.clearSelection();
    const ordered = [...hotspots].sort((a, b) => a.hfi - b.hfi); // hottest drawn last → on top
    this.pickHot = ordered.map((h) => ({ lat: h.lat, lon: h.lon, data: h }));
    this.swapPoints(this.hotspotPts, ordered.map((h) => ({
      lat: h.lat, lon: h.lon, color: tok(SEV_COLOR[h.severity]).c, px: SEV_PX[h.severity],
    })));
  }

  setReportedFires(fires: ReportedFire[]): void {
    this.clearSelection();
    const ordered = [...fires].sort((a, b) => b.sizeHa - a.sizeHa); // biggest first → small on top
    this.pickRep = ordered.map((f) => ({ lat: f.lat, lon: f.lon, data: f }));

    // Area-accurate footprint discs (true hectares → metres → radians on the unit sphere) + rim
    // rings, merged into ONE mesh + ONE line set. Honest scale: a small fire's disc is sub-pixel
    // zoomed out — the constant-px marker dot below carries visibility, exactly like the flat map.
    for (const c of this.reportedGrp.children) {
      (c as THREE.Mesh).geometry.dispose(); // materials are class-held + reused — only buffers die
    }
    this.reportedGrp.clear();
    const SEGS = 26;
    const sized = ordered.filter((f) => f.sizeHa > 0);
    if (sized.length) {
      const vCount = sized.length * (SEGS + 1);
      const pos = new Float32Array(vCount * 3);
      const col = new Float32Array(vCount * 4);
      const idx: number[] = [];
      const ringPos = new Float32Array(sized.length * SEGS * 2 * 3);
      const ringCol = new Float32Array(sized.length * SEGS * 2 * 4);
      const c0 = new THREE.Vector3();
      const e1 = new THREE.Vector3();
      const e2 = new THREE.Vector3();
      const p = new THREE.Vector3();
      let vo = 0;
      let ro = 0;
      sized.forEach((f) => {
        const ang = radiusMetersForHa(f.sizeHa) / EARTH_R_M;
        const { c } = tok(STAGE_COLOR[f.stage]);
        llToV3(f.lat, f.lon, 1, c0);
        e1.set(0, 1, 0).cross(c0).normalize();
        if (e1.lengthSq() < 1e-9) e1.set(1, 0, 0); // polar degenerate — any tangent will do
        e2.copy(c0).cross(e1).normalize();
        const base = vo;
        p.copy(c0).multiplyScalar(ALT.disc);
        pos.set([p.x, p.y, p.z], vo * 3);
        col.set([c.r, c.g, c.b, 0.16], vo * 4);
        vo++;
        const cosA = Math.cos(ang);
        const sinA = Math.sin(ang);
        // Pass 1 — the rim fan (centre + SEGS rim verts, triangle indices).
        for (let s = 0; s < SEGS; s++) {
          const t = (s / SEGS) * Math.PI * 2;
          p.copy(c0).multiplyScalar(cosA)
            .addScaledVector(e1, sinA * Math.cos(t))
            .addScaledVector(e2, sinA * Math.sin(t))
            .multiplyScalar(ALT.disc);
          pos.set([p.x, p.y, p.z], vo * 3);
          col.set([c.r, c.g, c.b, 0.16], vo * 4);
          idx.push(base, base + 1 + s, base + 1 + ((s + 1) % SEGS));
          vo++;
        }
        // Pass 2 — the rim STROKE segments (read back the now-written rim verts; a single pass would
        // read the next rim vertex one iteration before it exists).
        for (let s = 0; s < SEGS; s++) {
          const rim = base + 1 + s;
          const rimNext = base + 1 + ((s + 1) % SEGS);
          ringPos.set([pos[rim * 3], pos[rim * 3 + 1], pos[rim * 3 + 2]], ro * 3);
          ringCol.set([c.r, c.g, c.b, 0.8], ro * 4);
          ro++;
          ringPos.set([pos[rimNext * 3], pos[rimNext * 3 + 1], pos[rimNext * 3 + 2]], ro * 3);
          ringCol.set([c.r, c.g, c.b, 0.8], ro * 4);
          ro++;
        }
      });
      const discG = new THREE.BufferGeometry();
      discG.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      discG.setAttribute('color', new THREE.BufferAttribute(col, 4));
      discG.setIndex(idx);
      const ringG = new THREE.BufferGeometry();
      ringG.setAttribute('position', new THREE.BufferAttribute(ringPos, 3));
      ringG.setAttribute('color', new THREE.BufferAttribute(ringCol, 4));
      // The class-held materials are REUSED across repaints (a fresh material per paint risks a
      // shader compile mid-session — the no-recompiles law).
      this.reportedGrp.add(new THREE.Mesh(discG, this.discMat), new THREE.LineSegments(ringG, this.ringMat));
    }

    this.swapPoints(this.reportedDots, ordered.map((f) => ({
      lat: f.lat, lon: f.lon, color: tok(STAGE_COLOR[f.stage]).c, px: LIVEFIRE.globe.dotPx,
    })));
  }

  setOutFires(fires: ReportedFire[]): void {
    this.clearSelection();
    this.pickOut = fires.map((f) => ({ lat: f.lat, lon: f.lon, data: f }));
    this.swapPoints(this.outPts, fires.map((f) => ({ lat: f.lat, lon: f.lon, color: tok(UI.dim).c, px: LIVEFIRE.globe.outPx })));
  }

  setBurnPolygons(polys: BurnPolygon[]): void {
    this.perimLines.geometry.dispose();
    this.perimLines.geometry = linesGeometry(polys.map((p) => p.ring.map(([la, lo]) => [lo, la] as [number, number])), ALT.perim);
    this.dirty = true;
  }

  /** Swap a Points object's geometry for freshly-built marker data (dispose the old buffers). */
  private swapPoints(pts: THREE.Points, specs: PointSpec[]): void {
    pts.geometry.dispose();
    pts.geometry = pointsGeometry(specs);
    this.dirty = true;
  }

  // ── visibility + forecast rasters ──

  setLayer(layer: FireLayer, on: boolean): void {
    this.visible[layer] = on;
    this.applyVisibility();
  }

  isVisible(layer: FireLayer): boolean {
    return this.visible[layer];
  }

  private applyVisibility(): void {
    const v = this.visible;
    this.reportedGrp.visible = this.reportedDots.visible = v.reported;
    this.outPts.visible = v.out;
    this.hotspotPts.visible = v.hotspots;
    this.perimLines.visible = v.perimeters;
    // A selection whose layer just went hidden must take its ring with it (the flat map's highlight
    // lives ON the marker, so it gets this for free).
    if (this.selLayer && !v[this.selLayer]) this.clearSelection();
    // The two rasters are LIVE WMS feeds — the kill-switch gates them here exactly like the flat map.
    const live = isLiveFireEnabled();
    this.drapeMat.uniforms.uFwiOn.value = v.fwi && live ? 1 : 0;
    this.drapeMat.uniforms.uSmokeOn.value = v.smoke && live ? 1 : 0;
    if (v.fwi && live) {
      if (this.fwiLoadedTime !== this.fwiTime) this.loadFwi();
      if (this.fwiLoadedTimeG !== this.fwiTime) this.loadFwiGlobal();
    }
    if (v.smoke && live && this.smokePending && this.smokePending !== this.smokeFrame) this.showSmokeFrame(this.smokePending);
    if (!(v.smoke && live)) {
      // Hiding the smoke layer orphans any in-flight frame and settles the scrubber's buffering hint
      // (mirrors SmokeForecastLayer.setVisible(false); the pending frame re-issues on the next show).
      ++this.smokeToken;
      this.smokeInflight = null;
      this.handlers.onSmokeLoad?.(false);
    }
    this.dirty = true;
  }

  setFwiTime(iso: string): void {
    this.fwiTime = iso;
    if (this.visible.fwi && isLiveFireEnabled()) { this.loadFwi(); this.loadFwiGlobal(); }
  }

  private loadFwi(): void {
    const time = this.fwiTime;
    if (time === this.fwiLoadedTime || time === this.fwiInflight) return; // toggle-on + scrubber ask for the same day
    const token = ++this.fwiToken;
    this.fwiInflight = time;
    this.loadRaster(
      wmsUrl(FWI_WMS_URL, FWI_WMS_LAYER, BOX, { time, sld: FWI_WMS_SLD, width: LIVEFIRE.globe.rasterW }),
      (tex) => {
        if (token !== this.fwiToken || this.disposed) { tex.dispose(); return; }
        if (this.fwiTex && this.fwiTex !== tex) this.fwiTex.dispose();
        this.fwiTex = tex;
        this.drapeMat.uniforms.uFwi.value = tex;
        this.fwiLoadedTime = time;
        this.fwiInflight = null;
        this.dirty = true;
      },
      () => {
        // Failed day: clear the in-flight marker so a re-toggle / next scrub retries. The previous
        // day's drape stays up (same as the flat map's stale tiles) — never a hard blank.
        if (token === this.fwiToken) this.fwiInflight = null;
      },
    );
  }

  /** The GWIS GLOBAL FWI drape — same TIME + ramp as loadFwi(), but the worldwide ecmwf.fwi layer over
   *  the whole-planet box. A separate WMS request/texture so the two danger fields layer (global wash +
   *  Canada detail). A future/empty day returns a transparent tile → the wash just shows nothing. */
  private loadFwiGlobal(): void {
    const time = this.fwiTime;
    if (time === this.fwiLoadedTimeG || time === this.fwiInflightG) return;
    const token = ++this.fwiTokenG;
    this.fwiInflightG = time;
    this.loadRaster(
      wmsUrl(GWIS_FWI_WMS_URL, GWIS_FWI_LAYER, GLOBE_BOX, { time, sld: GWIS_FWI_SLD, width: LIVEFIRE.globe.rasterW }),
      (tex) => {
        if (token !== this.fwiTokenG || this.disposed) { tex.dispose(); return; }
        if (this.fwiTexG && this.fwiTexG !== tex) this.fwiTexG.dispose();
        this.fwiTexG = tex;
        this.drapeMat.uniforms.uFwiG.value = tex;
        this.fwiLoadedTimeG = time;
        this.fwiInflightG = null;
        this.dirty = true;
      },
      () => { if (token === this.fwiTokenG) this.fwiInflightG = null; },
    );
  }

  setSmokeTime(iso: string): void {
    this.smokePending = iso;
    if (!this.visible.smoke || !isLiveFireEnabled()) return; // remembered, applied on next show
    this.showSmokeFrame(iso);
  }

  /** Double-buffered smoke frame: load the next hour into the BACK texture, then crossfade the
   *  shader mix once it's ready — the plume morphs, never strobes (same scheme as the flat map). */
  private showSmokeFrame(iso: string): void {
    if (iso === this.smokeFrame || iso === this.smokeInflight) return;
    const token = ++this.smokeToken;
    this.smokeInflight = iso;
    this.handlers.onSmokeLoad?.(true);
    this.loadRaster(
      wmsUrl(GEOMET_WMS_URL, SMOKE_WMS_LAYER, SMOKE_BOX, { time: iso, sld: SMOKE_WMS_SLD, width: LIVEFIRE.globe.rasterW }),
      (tex) => {
        if (token !== this.smokeToken || this.disposed) { tex.dispose(); return; } // superseded by a faster scrub
        const u = this.drapeMat.uniforms;
        if (this.smokeFrontIsA) {
          if (this.smokeTexB) this.smokeTexB.dispose();
          this.smokeTexB = tex;
          u.uSmokeB.value = tex;
          this.smokeMixTarget = 1;
        } else {
          if (this.smokeTexA) this.smokeTexA.dispose();
          this.smokeTexA = tex;
          u.uSmokeA.value = tex;
          this.smokeMixTarget = 0;
        }
        this.smokeFrontIsA = !this.smokeFrontIsA;
        this.smokeFrame = iso;
        this.smokeInflight = null;
        this.handlers.onSmokeLoad?.(false);
        this.dirty = true;
      },
      () => {
        // Only the LIVE request may settle the buffering hint — a stale superseded frame's late
        // failure (or an FWI error; FWI passes no onError) must not clear a newer frame's pulse.
        if (token !== this.smokeToken || this.disposed) return;
        this.smokeInflight = null;
        this.handlers.onSmokeLoad?.(false); // previous frame stays draped (like the flat map's stale tiles)
      },
    );
  }

  private loadRaster(url: string, onLoad: (tex: THREE.Texture) => void, onError?: () => void): void {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = (): void => {
      const tex = new THREE.Texture(img);
      tex.minFilter = THREE.LinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.generateMipmaps = false;
      tex.wrapS = THREE.ClampToEdgeWrapping;
      tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.needsUpdate = true;
      onLoad(tex);
    };
    img.onerror = (): void => onError?.();
    img.src = url;
  }

  // ── framing + selection ──

  fitTo(points: [number, number][]): void {
    if (!points.length) return;
    const sum = new THREE.Vector3();
    const vs = points.map(([la, lo]) => llToV3(la, lo, 1, new THREE.Vector3()));
    for (const p of vs) sum.add(p);
    if (sum.lengthSq() < 1e-9) return; // antipodal degenerate — keep the current view
    sum.normalize();
    let maxAng = 0;
    for (const p of vs) maxAng = Math.max(maxAng, sum.angleTo(p));
    this.tLat = THREE.MathUtils.clamp(90 - Math.acos(THREE.MathUtils.clamp(sum.y, -1, 1)) / DEG, -82, 82);
    let lon = Math.atan2(sum.z, -sum.x) / DEG - 180;
    if (lon <= -180) lon += 360;
    this.tLon = lon;
    const G = LIVEFIRE.globe;
    const a = Math.min(maxAng * 1.18 + 0.05, Math.PI * 0.45);
    const half = (this.camera.fov / 2) * DEG;
    const eff = Math.min(half, Math.atan(Math.tan(half) * Math.max(0.4, this.camera.aspect)));
    this.tDist = THREE.MathUtils.clamp(Math.cos(a) + Math.sin(a) / Math.tan(eff), G.minDist, G.maxDist);
    this.animating = true;
    this.framed = true; // a framed view HOLDS — the attract spin must never drift it away
    this.dirty = true;
  }

  private clearSelection(): void {
    this.selPts.visible = false;
    this.selLayer = null;
    this.dirty = true;
  }

  private select(lat: number, lon: number, px: number, layer: FireLayer): void {
    this.swapPoints(this.selPts, [{ lat, lon, color: tok(UI.accent).c, px: px + 9 }]);
    this.selPts.visible = true;
    this.selLayer = layer;
  }

  // ── input: drag-to-rotate (inertia), wheel/pinch zoom, tap-to-pick ──

  private bindInput(): void {
    const cv = this.renderer.domElement;
    interface Ptr { id: number; x: number; y: number }
    let ptrs: Ptr[] = [];
    let downX = 0; let downY = 0; let downT = 0; let moved = false;
    let pinchBase = 0; let pinchDist = 0;
    let lastMoveT = 0;

    cv.addEventListener('pointerdown', (e) => {
      this.everTouched = true;
      this.coarsePointer = e.pointerType !== 'mouse'; // touch/pen → looser hit-testing in onTap
      this.animating = false; // a touch cancels any fit animation
      this.velLat = this.velLon = 0;
      ptrs.push({ id: e.pointerId, x: e.clientX, y: e.clientY });
      cv.setPointerCapture(e.pointerId);
      if (ptrs.length === 1) {
        downX = e.clientX; downY = e.clientY; downT = performance.now(); moved = false;
        cv.classList.add('grabbing');
      } else if (ptrs.length === 2) {
        pinchBase = Math.hypot(ptrs[0].x - ptrs[1].x, ptrs[0].y - ptrs[1].y);
        pinchDist = this.vDist;
      }
    });
    cv.addEventListener('pointermove', (e) => {
      const p = ptrs.find((q) => q.id === e.pointerId);
      if (!p) return;
      const dx = e.clientX - p.x;
      const dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
      if (ptrs.length === 1) {
        if (Math.abs(e.clientX - downX) + Math.abs(e.clientY - downY) > 6) moved = true;
        const dpp = this.degPerPx();
        this.vLon -= dx * dpp;
        this.vLat = THREE.MathUtils.clamp(this.vLat + dy * dpp, -85, 85);
        const now = performance.now();
        const dt = Math.max(8, now - lastMoveT) / 1000;
        lastMoveT = now;
        this.velLon = (-dx * dpp) / dt;
        this.velLat = (dy * dpp) / dt;
        this.applyView();
        this.dirty = true;
      } else if (ptrs.length === 2 && pinchBase > 0) {
        const spread = Math.hypot(ptrs[0].x - ptrs[1].x, ptrs[0].y - ptrs[1].y);
        if (spread > 0) this.setDist(1 + ((pinchDist - 1) * pinchBase) / spread); // altitude-scaled pinch
        moved = true;
      }
    });
    const up = (e: PointerEvent, cancelled: boolean): void => {
      const had = ptrs.some((q) => q.id === e.pointerId);
      ptrs = ptrs.filter((q) => q.id !== e.pointerId);
      if (!had) return;
      if (ptrs.length === 0) {
        cv.classList.remove('grabbing');
        // A pointercancel means the OS/browser took the gesture (edge swipe, palm rejection) — the
        // user did NOT tap; only a real pointerup may open a detail sheet.
        if (!cancelled && !moved && performance.now() - downT < 400) {
          this.velLat = this.velLon = 0;
          this.onTap(e.clientX, e.clientY);
        }
        // else: release with motion → the tick loop carries the inertia
      } else if (ptrs.length === 2) {
        // 3 → 2 fingers: RE-SEED the pinch (a transient palm/3rd touch must not dead-end the
        // two remaining fingers — neither branch of pointermove would fire with pinchBase 0).
        pinchBase = Math.hypot(ptrs[0].x - ptrs[1].x, ptrs[0].y - ptrs[1].y);
        pinchDist = this.vDist;
        this.velLat = this.velLon = 0;
      } else {
        pinchBase = 0;
        this.velLat = this.velLon = 0;
      }
    };
    cv.addEventListener('pointerup', (e) => up(e, false));
    cv.addEventListener('pointercancel', (e) => up(e, true));
    cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.everTouched = true;
      this.animating = false;
      this.zoomBy(Math.exp(e.deltaY * 0.0012));
    }, { passive: false });

    // Keyboard operability (parity with Leaflet's keyboard:true): arrows rotate, +/- zoom. The
    // canvas is focusable (tabIndex in the ctor); Escape is left alone — it closes the overlay.
    cv.addEventListener('keydown', (e) => {
      const dpp = this.degPerPx() * 18; // one step ≈ an 18px drag at the current zoom
      let handled = true;
      switch (e.key) {
        case 'ArrowLeft': this.vLon -= dpp; break;
        case 'ArrowRight': this.vLon += dpp; break;
        case 'ArrowUp': this.vLat = THREE.MathUtils.clamp(this.vLat + dpp, -85, 85); break;
        case 'ArrowDown': this.vLat = THREE.MathUtils.clamp(this.vLat - dpp, -85, 85); break;
        case '+': case '=': this.zoomBy(Math.exp(-0.18)); break;
        case '-': case '_': this.zoomBy(Math.exp(0.18)); break;
        default: handled = false;
      }
      if (handled) {
        e.preventDefault();
        this.everTouched = true;
        this.animating = false;
        this.applyView();
        this.dirty = true;
      }
    });
  }

  /** Degrees of surface arc per screen pixel at the current zoom (drives drag feel). */
  private degPerPx(): number {
    const h = this.renderer.domElement.clientHeight || 1;
    const worldPerPx = (2 * (this.vDist - 1) * Math.tan((this.camera.fov / 2) * DEG)) / h;
    return worldPerPx / DEG; // unit sphere: 1 world unit of surface ≈ 1 radian of arc
  }

  private setDist(d: number): void {
    const G = LIVEFIRE.globe;
    this.vDist = THREE.MathUtils.clamp(d, G.minDist, G.maxDist);
    this.camera.position.z = this.vDist;
    // Dynamic near plane: the zoom range spans ~3 earth radii down to ~15 km of altitude — one fixed
    // near plane can't hold z-precision for the small layer separations at both ends.
    this.camera.near = THREE.MathUtils.clamp((this.vDist - 1) * 0.08, 0.0008, 0.06);
    this.camera.updateProjectionMatrix();
    this.dirty = true;
  }

  /** Zoom by a multiplicative step on the ALTITUDE (dist−1), not the distance — uniform feel from
   *  whole-earth down to town scale (scaling dist itself overshoots violently near the surface). */
  private zoomBy(factor: number): void {
    this.setDist(1 + (this.vDist - 1) * factor);
  }

  /** Tap → screen-space nearest pickable (priority: reported → out → hotspots). The hit radius is
   *  finger-generous on touch — and HOTSPOTS get the largest of all, since they're the smallest marks
   *  and the hardest to hit with a fingertip (the user-requested mobile leniency). */
  private onTap(clientX: number, clientY: number): void {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const sx = clientX - rect.left;
    const sy = clientY - rect.top;
    const w = rect.width;
    const h = rect.height;
    const proj = new THREE.Vector3();
    const camDir = new THREE.Vector3();
    const base = this.coarsePointer ? 30 : 18; // touch fingertip vs precise mouse cursor
    const hotThresh = this.coarsePointer ? 42 : 24; // hotspots are the tiniest dots → the fattest target

    const nearest = <T,>(list: Pickable<T>[], thresh: number): { item: Pickable<T>; d: number } | null => {
      let best: { item: Pickable<T>; d: number } | null = null;
      for (const it of list) {
        llToV3(it.lat, it.lon, ALT.dots, proj).applyMatrix4(this.earth.matrixWorld);
        camDir.copy(this.camera.position).sub(proj);
        if (proj.dot(camDir) <= 0) continue; // behind the limb
        proj.project(this.camera);
        const px = (proj.x * 0.5 + 0.5) * w;
        const py = (-proj.y * 0.5 + 0.5) * h;
        const d = Math.hypot(px - sx, py - sy);
        if (d < thresh && (!best || d < best.d)) best = { item: it, d };
      }
      return best;
    };

    if (this.visible.reported) {
      const hit = nearest(this.pickRep, base);
      if (hit) {
        this.select(hit.item.lat, hit.item.lon, LIVEFIRE.globe.dotPx, 'reported');
        this.handlers.onSelectReported(hit.item.data);
        return;
      }
    }
    if (this.visible.out) {
      const hit = nearest(this.pickOut, base);
      if (hit) {
        this.select(hit.item.lat, hit.item.lon, LIVEFIRE.globe.outPx, 'out');
        this.handlers.onSelectReported(hit.item.data);
        return;
      }
    }
    if (this.visible.hotspots) {
      const hit = nearest(this.pickHot, hotThresh); // the fattest target — tiny dots, hard to fingertip
      if (hit) {
        this.select(hit.item.lat, hit.item.lon, SEV_PX[hit.item.data.severity], 'hotspots');
        this.handlers.onSelectHotspot(hit.item.data);
        return;
      }
    }
  }

  // ── frame loop (O(1): view math + uniform nudges + one draw) ──

  private tick = (now: number): void => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.tick);
    if (document.hidden) { this.lastT = 0; return; }
    const dt = this.lastT ? Math.min(0.05, (now - this.lastT) / 1000) : 0.016;
    this.lastT = now;
    const G = LIVEFIRE.globe;

    // Render-on-demand: a STATIC scene skips the whole frame (no view math, no GPU work) — the RAF
    // is then a ~free scheduler. Motion sources keep it live; `dirty` covers one-shot changes
    // (data repaints, layer toggles, raster loads, resize, selection).
    const spinning = !this.everTouched && !this.framed && !this.reduced; // attract drift only until a touch OR a framing
    const inertia = Math.abs(this.velLon) + Math.abs(this.velLat) > 0.01;
    const mixing = (this.drapeMat.uniforms.uSmokeMix.value as number) !== this.smokeMixTarget;
    if (!(spinning || inertia || this.animating || mixing || this.dirty)) return;
    this.dirty = false;

    if (spinning && !this.animating) this.vLon += G.idleSpinDegSec * dt;

    // Drag inertia — exponential decay.
    if (inertia) {
      this.vLon += this.velLon * dt;
      this.vLat = THREE.MathUtils.clamp(this.vLat + this.velLat * dt, -85, 85);
      const k = Math.exp(-dt * G.inertiaDamp);
      this.velLon *= k;
      this.velLat *= k;
    }

    // Fit animation — critically-damped approach to the framing target.
    if (this.animating) {
      const k = 1 - Math.exp(-dt * G.fitLerp);
      let dLon = this.tLon - this.vLon;
      dLon = ((dLon + 540) % 360) - 180; // shortest way round
      this.vLon += dLon * k;
      this.vLat += (this.tLat - this.vLat) * k;
      this.setDist(this.vDist + (this.tDist - this.vDist) * k);
      if (Math.abs(dLon) < 0.05 && Math.abs(this.tLat - this.vLat) < 0.05 && Math.abs(this.tDist - this.vDist) < 0.002) this.animating = false;
    }

    // Smoke crossfade (uniform lerp toward the committed frame's buffer).
    const u = this.drapeMat.uniforms;
    const mix = u.uSmokeMix.value as number;
    if (mix !== this.smokeMixTarget) {
      const step = dt * (1000 / Math.max(60, LIVEFIRE.smokeFadeMs));
      u.uSmokeMix.value = THREE.MathUtils.clamp(mix + Math.sign(this.smokeMixTarget - mix) * step, 0, 1);
    }

    // Zoom-in detail tiles: fade in across the [tileStartDist → tileFullDist] band, with the
    // procedural vector geography fading OUT in lockstep (the tiles carry the real coastlines).
    // The visible-tile selection refreshes a few times a second, and ONLY while frames are active —
    // a static view costs nothing; a landing tile re-arms the loop via onChange → dirty.
    const fade = THREE.MathUtils.clamp((G.tileStartDist - this.vDist) / (G.tileStartDist - G.tileFullDist), 0, 1);
    if (fade !== this.tileFade) {
      this.tileFade = fade;
      this.tiles.setOpacity(fade);
      for (const { mat, base } of this.geoLineMats) mat.opacity = base * (1 - fade);
      // The graticule yields too — and a hairline crack between tile patches then shows the dark
      // base fill instead of a bright grid line slicing through a town.
      this.earthMat.uniforms.uGratA.value = tok(GLOBE.graticule).a * (1 - fade);
    }
    if (fade > 0 && now - this.lastTileSel > 140) {
      this.lastTileSel = now;
      this.tiles.update(this.vLat, this.vLon, this.vDist, this.camera.fov, this.renderer.domElement.clientHeight || 1, this.camera.aspect);
    }

    this.applyView();
    this.renderer.render(this.scene, this.camera);
  };

  /** Pose the earth so (vLat, vLon) faces the camera with north up (no roll). Scratch temps —
   *  this runs every frame, so it allocates nothing. */
  private applyView(): void {
    if (this.vLon > 180) this.vLon -= 360;
    if (this.vLon < -180) this.vLon += 360;
    const f = llToV3(this.vLat, this.vLon, 1, S_F);
    llToV3(Math.min(89.9, this.vLat + 0.1), this.vLon, 1, S_UP);
    S_UP.sub(f).normalize();
    S_RIGHT.crossVectors(S_UP, f).normalize();
    S_MAT.makeBasis(S_RIGHT, S_UP, f).transpose();
    this.earth.quaternion.setFromRotationMatrix(S_MAT);
    this.earth.updateMatrixWorld();
  }

  invalidate(): void {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.dirty = true;
  }

  dispose(): void {
    this.disposed = true;
    // Ownership-guarded: a stale instance (built for an already-closed overlay while its chunk was
    // in flight) must not delete the LIVE instance's QA hook.
    const w = window as unknown as { __fireGlobe?: unknown };
    if (w.__fireGlobe === this) delete w.__fireGlobe;
    cancelAnimationFrame(this.raf);
    document.removeEventListener('visibilitychange', this.onVis);
    this.ro?.disconnect();
    this.tiles.dispose(); // first — the traverse below can't reach the tile textures (material.map)
    this.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const mat = mesh.material as THREE.Material | undefined;
      if (mat) mat.dispose();
    });
    for (const t of [this.earthMat.uniforms.uBase.value, this.fwiTex, this.fwiTexG, this.smokeTexA, this.smokeTexB]) {
      (t as THREE.Texture | null)?.dispose();
    }
    this.discMat.dispose(); // class-held — unattached when no sized fires, so the traverse can miss them
    this.ringMat.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.container.classList.remove('fglobe');
  }
}
