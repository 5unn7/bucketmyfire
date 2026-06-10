/**
 * GlobeTiles — the globe's ZOOM-IN detail layer: standard slippy-map raster tiles (CARTO dark, the
 * exact basemap the flat `?flat=1` Leaflet view uses — credited on the Credits page) draped onto
 * spherical patches. The procedural instrument earth stays the FAR view; past `tileStartDist` the
 * tiles fade in so close zoom shows real geography — towns, lakes, roads, names.
 *
 * How it works:
 *   • LOD: the zoom level z is picked from the view's ground metres-per-pixel vs Web Mercator's
 *     156543·cos(lat)/2^z; the visible spherical cap maps to a lat/lon bbox → tile x/y ranges
 *     (count-guarded: too many tiles → step z down).
 *   • Each tile is a sphere patch whose vertex rows are spaced linearly in MERCATOR Y (so the
 *     raster maps linearly in V) with the gudermannian giving the latitude per row — projection-
 *     true draping, no smearing toward the poles.
 *   • Tiles sit at radius 1.0001 + z·1.2e-5: every level above the base sphere's chord sag, each
 *     level above its parent, all below the forecast-drape shell and the data marks.
 *   • While a tile loads, its z−1 PARENT is kept in the needed set so there is never a hole; an
 *     LRU keeps the cache bounded (~35 MB of GPU textures worst case).
 *   • All tile materials are MeshBasicMaterial({map}) — ONE shader program, precompiled by the
 *     globe at construction, so the first zoom-in never stutters on a compile.
 *
 * Textures load with NoColorSpace (raw bytes) to match the globe's linear-output renderer — the
 * tiles render byte-for-byte as CARTO authored them, like every other colour in the scene.
 */
import * as THREE from 'three';

const DEG = Math.PI / 180;
const SUBS = ['a', 'b', 'c', 'd'];
// Same tile set as FireMap.ts's CARTO_DARK Leaflet template, as a function (no {s}/{z} tokens).
const tileUrl = (z: number, x: number, y: number): string =>
  `https://${SUBS[(x + y) % 4]}.basemaps.cartocdn.com/dark_all/${z}/${x}/${y}.png`;

const MAX_SELECTED = 48; // per-selection tile budget — exceeded → step the zoom level down
const CACHE_MAX = 160; // LRU bound on retained tiles (~160 × 256² RGBA ≈ 42 MB GPU worst case)
const MIN_Z = 3;

/** lat/lon (deg) → unit-sphere position matching THREE.SphereGeometry's equirect UV layout.
 *  (THE one mapping — FireGlobe imports this; keep any change in lockstep with its shaders.) */
export function llToV3(lat: number, lon: number, r: number, out = new THREE.Vector3()): THREE.Vector3 {
  const phi = (90 - lat) * DEG;
  const theta = (lon + 180) * DEG;
  return out.set(-r * Math.sin(phi) * Math.cos(theta), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(theta));
}

/** Latitude (deg) → slippy tile Y at level z (Web Mercator, clamped to the projection's ±85.05°). */
function lat2tileY(lat: number, z: number): number {
  const phi = THREE.MathUtils.clamp(lat, -85, 85) * DEG;
  const merc = Math.log(Math.tan(Math.PI / 4 + phi / 2));
  return Math.floor(((1 - merc / Math.PI) / 2) * 2 ** z);
}

interface TileEntry {
  z: number;
  x: number;
  y: number;
  mesh: THREE.Mesh | null; // null while the raster is in flight (or after a failed fetch)
  lastUsed: number; // selection generation — drives the LRU
  state: 'loading' | 'ready' | 'failed';
}

/** Build one tile's sphere patch: lon linear, rows linear in Mercator Y (gudermannian latitudes). */
function buildPatch(z: number, x: number, y: number, radius: number): THREE.BufferGeometry {
  const n = z < 5 ? 16 : z < 8 ? 8 : 6; // big low-z tiles need curvature; small high-z ones don't
  const lon0 = (x / 2 ** z) * 360 - 180;
  const lonSpan = 360 / 2 ** z;
  const m0 = Math.PI * (1 - (2 * y) / 2 ** z); // north edge, Mercator Y
  const m1 = Math.PI * (1 - (2 * (y + 1)) / 2 ** z); // south edge
  const pos = new Float32Array((n + 1) * (n + 1) * 3);
  const uv = new Float32Array((n + 1) * (n + 1) * 2);
  const idx: number[] = [];
  const v = new THREE.Vector3();
  for (let r = 0; r <= n; r++) {
    const merc = m0 + ((m1 - m0) * r) / n;
    const lat = Math.atan(Math.sinh(merc)) / DEG;
    for (let c = 0; c <= n; c++) {
      const i = r * (n + 1) + c;
      llToV3(lat, lon0 + (lonSpan * c) / n, radius, v);
      pos.set([v.x, v.y, v.z], i * 3);
      uv.set([c / n, 1 - r / n], i * 2); // raster top row = north; flipY puts v=1 at the top
      if (r < n && c < n) idx.push(i, i + n + 1, i + 1, i + 1, i + n + 1, i + n + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

export class GlobeTiles {
  readonly group = new THREE.Group();
  private tiles = new Map<string, TileEntry>();
  private gen = 0;
  private opacity = 0;
  private zBoost: number; // sharper selection on hi-DPR screens (z+1 beats fetching @2x rasters)
  private disposed = false;
  private maxZ: number;
  private onChange: () => void;
  private lift: { value: number }; // ONE shared uniform ref — every tile material reads it

  constructor(opts: { dpr: number; maxZ: number; lift: number; onChange: () => void }) {
    this.zBoost = opts.dpr >= 1.5 ? 1 : 0;
    this.maxZ = opts.maxZ;
    this.lift = { value: opts.lift };
    this.onChange = opts.onChange;
    this.group.visible = false;
    this.group.renderOrder = 0; // under the drape shell + every data mark (their renderOrder ≥ 1)
  }

  /** One tile material. Raw CARTO dark reads murky on the instrument globe, so the shared patch
   *  lifts brightness (config: LIVEFIRE.globe.tileLift, one live uniform) and pulls the greys a
   *  touch COOL so the tiles sit in the globe's ink-navy world instead of flat black. Every tile
   *  shares ONE program (customProgramCacheKey) — precompiled via probeMaterial at globe ctor. */
  private makeMaterial(map: THREE.Texture): THREE.MeshBasicMaterial {
    const m = new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: true, opacity: this.opacity });
    m.onBeforeCompile = (shader): void => {
      shader.uniforms.uLift = this.lift;
      shader.fragmentShader = shader.fragmentShader
        .replace('void main() {', 'uniform float uLift;\nvoid main() {')
        .replace(
          '#include <map_fragment>',
          `#include <map_fragment>
  diffuseColor.rgb = min(vec3(1.0), diffuseColor.rgb * uLift);
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.93, 1.0, 1.1), 0.3);`,
        );
    };
    m.customProgramCacheKey = (): string => 'bmf-globe-tile';
    return m;
  }

  /** A structurally-identical material on a 1×1 texture — the globe adds it to the scene (hidden)
   *  and renderer.compile()s, so the first real tile never pays a mid-interaction shader compile. */
  probeMaterial(): THREE.MeshBasicMaterial {
    const t = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1);
    t.needsUpdate = true;
    return this.makeMaterial(t);
  }

  /** Layer fade (0 → hidden). Applied to every tile material — uniform-only, no recompiles. */
  setOpacity(o: number): void {
    this.opacity = o;
    this.group.visible = o > 0.004;
    for (const e of this.tiles.values()) {
      if (e.mesh) (e.mesh.material as THREE.MeshBasicMaterial).opacity = o;
    }
  }

  /** Recompute the needed tile set for the current view; fetch what's missing, LRU-evict the rest.
   *  Cheap (set math over ≤ ~50 keys) — safe to call a few times a second while interacting. */
  update(viewLat: number, viewLon: number, dist: number, fovYDeg: number, hPx: number, aspect: number): void {
    if (this.disposed || this.opacity <= 0) return;
    this.gen++;

    // Ground sampling at the view centre → the Mercator zoom level that roughly matches it.
    const capV = (dist - 1) * Math.tan((fovYDeg / 2) * DEG); // half-height of the view, radians of arc
    const mPerPx = ((capV * 2) / hPx) * 6_371_000;
    const cosLat = Math.max(0.1, Math.cos(viewLat * DEG));
    let z = Math.round(Math.log2((156543 * cosLat) / Math.max(0.5, mPerPx))) + this.zBoost;
    z = THREE.MathUtils.clamp(z, MIN_Z, this.maxZ);

    // Visible cap (radians of surface arc): screen half-DIAGONAL + a proportional margin, clamped by
    // the horizon. The margin MUST be proportional — a fixed degree floor would dwarf the ~0.1°-wide
    // view at street zoom and inflate the bbox so the budget guard stepped the LOD way down (soft tiles).
    const horizon = Math.acos(1 / Math.max(1.0001, dist));
    const cap = Math.min(horizon, Math.hypot(capV, capV * aspect) * 1.25);
    const capDeg = cap / DEG;

    // Cap → lat/lon bbox → tile ranges, stepping z down until the tile budget holds.
    let x0 = 0;
    let x1 = 0;
    let y0 = 0;
    let y1 = 0;
    for (;;) {
      const lonHalf = Math.min(180, capDeg / cosLat);
      y0 = lat2tileY(viewLat + capDeg, z);
      y1 = lat2tileY(viewLat - capDeg, z);
      x0 = Math.floor(((viewLon - lonHalf + 180) / 360) * 2 ** z);
      x1 = Math.floor(((viewLon + lonHalf + 180) / 360) * 2 ** z);
      if ((x1 - x0 + 1) * (y1 - y0 + 1) <= MAX_SELECTED || z <= MIN_Z) break;
      z--;
    }

    const needed = new Set<string>();
    const require = (tz: number, tx: number, ty: number): void => {
      const span = 2 ** tz;
      const wx = ((tx % span) + span) % span; // antimeridian wrap
      if (ty < 0 || ty >= span) return;
      const key = `${tz}/${wx}/${ty}`;
      if (needed.has(key)) return;
      needed.add(key);
      let e = this.tiles.get(key);
      if (!e) {
        e = { z: tz, x: wx, y: ty, mesh: null, lastUsed: this.gen, state: 'loading' };
        this.tiles.set(key, e);
        this.fetch(e, key);
      }
      e.lastUsed = this.gen;
      // While this tile is in flight (or failed), its parent covers the hole.
      if (e.state !== 'ready' && tz > MIN_Z) require(tz - 1, tx >> 1, ty >> 1);
    };
    for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) require(z, tx, ty);

    // Visibility per entry + LRU eviction of long-unused tiles beyond the cache bound.
    if (this.tiles.size > CACHE_MAX) {
      const evictable = [...this.tiles.entries()]
        .filter(([k]) => !needed.has(k))
        .sort((a, b) => a[1].lastUsed - b[1].lastUsed);
      for (const [k, e] of evictable.slice(0, this.tiles.size - CACHE_MAX)) {
        this.drop(e);
        this.tiles.delete(k);
      }
    }
    for (const [k, e] of this.tiles) {
      if (e.mesh) e.mesh.visible = needed.has(k);
    }
  }

  private fetch(e: TileEntry, key: string): void {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = (): void => {
      if (this.disposed || !this.tiles.has(key)) return;
      const tex = new THREE.Texture(img);
      tex.minFilter = THREE.LinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.generateMipmaps = false;
      tex.needsUpdate = true;
      const mesh = new THREE.Mesh(buildPatch(e.z, e.x, e.y, 1.0001 + e.z * 1.2e-5), this.makeMaterial(tex));
      mesh.renderOrder = 0;
      e.mesh = mesh;
      e.state = 'ready';
      this.group.add(mesh);
      this.onChange(); // render-on-demand: a landed tile is a visible change
    };
    img.onerror = (): void => {
      if (this.disposed) return;
      e.state = 'failed'; // the parent keeps covering; a later selection may retry after eviction
    };
    img.src = tileUrl(e.z, e.x, e.y);
  }

  private drop(e: TileEntry): void {
    if (!e.mesh) return;
    this.group.remove(e.mesh);
    e.mesh.geometry.dispose();
    const mat = e.mesh.material as THREE.MeshBasicMaterial;
    mat.map?.dispose();
    mat.dispose();
    e.mesh = null;
  }

  dispose(): void {
    this.disposed = true;
    for (const e of this.tiles.values()) this.drop(e);
    this.tiles.clear();
  }
}
