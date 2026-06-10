import * as THREE from 'three';
import { World } from '../World';
import { CLOUDS, FOREST, TERRAIN_TEX } from '../config';
import { FrameContext } from '../render/FrameContext';
import { loadAlbedo } from './pbrTextures';

/**
 * Procedural forest-floor terrain for the 3D world.
 *
 * A large ground plane laid flat in the XZ plane (Y up), centered on the origin.
 * Every vertex is displaced by `world.groundHeightAt(x, z)` — the SAME function the
 * sims, placement, and lake meshes read — so the rendered surface and every height
 * query share one frame of reference. The carved lake basins (bowls below each flat
 * water plane) therefore become real geometry here for free.
 *
 * The mesh holds no height function of its own anymore; callers that need a surface
 * height ask the `World` directly.
 */

export interface Terrain {
  mesh: THREE.Mesh; // the ground, in the XZ plane, Y up
  /**
   * Budget-aware chunked colourer (load-perf): the heavy per-vertex BIOME colour + relief pass
   * (loop 2) is split off the synchronous boot path. The mesh ships at the first frame with a flat
   * neutral fallback colour (solid, correctly-shaped ground under the camera); `colorStep` then
   * streams the real biome colours in over the next few frames via Game's deferredBuild/pumpBuild —
   * exactly like the deferred lakes/forest. Returns true when every row-band is coloured. Same
   * `richerColor × reliefShadeGrid` maths, same order, no rng → determinism is untouched.
   */
  colorStep(budgetMs: number): boolean;
}

/**
 * The live fire field (C5) the terrain samples to CHAR + GLOW: `tex` is the nx×nz RGBA DataTexture
 * (R=heat, G=scorch) from `FireFieldTexture`; `min`/`size` map world XZ → texture uv PER AXIS (so a
 * rectangular map maps without skew). When present, the ground darkens to charcoal under the burn
 * scar and glows orange (HDR → bloom) where it's actively burning — so the fire reads as one
 * CONTINUOUS advancing region, not isolated dots.
 */
export interface TerrainBurn {
  tex: THREE.Texture;
  minX: number; // worldMin X (-sizeX/2)
  minZ: number; // worldMin Z (-sizeZ/2)
  sizeX: number; // world extent X
  sizeZ: number; // world extent Z
}

// Default segments per side (fallback). Higher resolves the carved SHORELINES and
// stream channels more smoothly; the caller passes a quality-tier value.
const DEFAULT_SEGMENTS = 160;

export function createTerrain(
  world: World,
  segments: number = DEFAULT_SEGMENTS,
  frame?: FrameContext,
  burn?: TerrainBurn,
  textured = false,
): Terrain {
  // PlaneGeometry is built in the XY plane; we rotate it −90° about X so it lies
  // flat in XZ with +Y up. After the rotation, getX/getZ read true world X/Z.
  // The plane spans the world's true extent — sizeX × sizeZ — so on a 'bounds'-fit (rectangular)
  // map the ground IS the province's shape, not a square. Square maps: sizeX === sizeZ (unchanged).
  const geometry = new THREE.PlaneGeometry(world.sizeX, world.sizeZ, segments, segments);
  geometry.rotateX(-Math.PI / 2);

  const pos = geometry.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);

  // PlaneGeometry gives a regular (segments+1)² grid, row-major (X across columns, Z down
  // rows). We sample the (expensive) world height ONCE per vertex into `heights`, displace
  // from it, then derive the baked hillshade from neighbouring GRID heights instead of four
  // more world-height calls per vertex. groundHeightAt loops every lake/river/bridge-valley,
  // so this drops the dominant terrain-build cost ~5× (5 calls/vertex → 1) with no visible
  // change — the relief is read from the same surface, just reusing samples we already have.
  const N = segments + 1; // vertices per side (same count both axes)
  const stepX = world.sizeX / segments; // world units between adjacent grid vertices, across columns (X)
  const stepZ = world.sizeZ / segments; // …and down rows (Z) — equal on square maps, differ on a rect map
  const heights = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const h = world.groundHeightAt(pos.getX(i), pos.getZ(i));
    heights[i] = h;
    pos.setY(i, h);
  }

  // Colour every vertex by BIOME (A2): meadow / forest / rock / shore from elevation ×
  // moisture × slope × water-distance, with (a) a RICHER-COLOUR pass — broad macro tint drift
  // + occasional gold autumn stands so the forest floor isn't a uniform green — then (b) a
  // baked BROAD-RELIEF hillshade (B5.1). The live sun barely shades this gentle terrain, which
  // left the 3D map reading flat next to the crisp radar; baking the SAME directional hillshade
  // the minimap uses (over a wide baseline so it tracks landforms, not micro-noise) gives
  // ridges/valleys readable depth. Read from `heights` so it's resolution-stable across tiers.
  //
  // LOAD-PERF: this is the heaviest per-vertex pass (biomes.sample ≈ 5 noise reads/vertex), so it's
  // streamed off the synchronous boot path. Seed the colour buffer with a flat NEUTRAL fallback now
  // (the mesh ships looking like plausible ground, not black, at the first frame), then `colorStep`
  // walks it in row-bands a few ms/frame under the cold-start spool. Deterministic — same maths/order.
  const [fr, fg, fb] = world.biomes.sample(0, 0).color; // a representative biome colour, sampled once
  for (let i = 0; i < pos.count; i++) {
    colors[i * 3] = fr * SHADE_BASE;
    colors[i * 3 + 1] = fg * SHADE_BASE;
    colors[i * 3 + 2] = fb * SHADE_BASE;
  }

  pos.needsUpdate = true;
  const colorAttr = new THREE.BufferAttribute(colors, 3);
  geometry.setAttribute('color', colorAttr);
  // Recompute normals after displacement so the sun lights the hills + basins. (Positions are final;
  // the streamed colour pass below only writes the `color` attribute, never geometry/normals.)
  geometry.computeVertexNormals();

  // Chunked colourer: write the real biome colour for `i` in [cursor, cursor+band) each call, flush
  // that slice's `needsUpdate`, advance, return true when the whole grid is coloured. Budget-checked
  // every BAND rows so one call honours its ms budget on a slow device without per-vertex timing.
  let cursor = 0;
  const BAND = N; // one grid ROW per band (N verts) — a natural slice + a cheap needsUpdate flush unit
  const colorStep = (budgetMs: number): boolean => {
    const t0 = performance.now();
    while (cursor < pos.count) {
      const end = Math.min(pos.count, cursor + BAND);
      for (let i = cursor; i < end; i++) {
        const vx = pos.getX(i);
        const vz = pos.getZ(i);
        const s = world.biomes.sample(vx, vz);
        let [r, g, b] = richerColor(s.color, vx, vz);
        // Canopy floor tint (the bare-hills fix): where trees actually STAND (biome density ×
        // the same clearing/editor thinning the forest scatter respects), pull the floor toward
        // the darkened canopy tint. Up close it reads as understory shadow grounding the stands;
        // past the tree cull the hills still read forested instead of bare green.
        if (FOREST.floorCanopy > 0 && s.treeDensity > 0) {
          const dens = s.treeDensity * world.clearingFactor(vx, vz) * world.authoredFoliageMul(vx, vz);
          if (dens > 0) {
            const w = Math.min(1, dens) * FOREST.floorCanopy;
            const k = FOREST.floorCanopyDarken;
            r += (s.treeTint[0] * k - r) * w;
            g += (s.treeTint[1] * k - g) * w;
            b += (s.treeTint[2] * k - b) * w;
          }
        }
        const shade = reliefShadeGrid(heights, i, N, stepX, stepZ);
        colors[i * 3] = r * shade;
        colors[i * 3 + 1] = g * shade;
        colors[i * 3 + 2] = b * shade;
      }
      cursor = end;
      colorAttr.needsUpdate = true; // re-upload the (now partially-real) colour buffer to the GPU
      if (performance.now() - t0 >= budgetMs) break; // out of budget — resume next frame
    }
    return cursor >= pos.count;
  };

  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.96, // matte forest floor — minimal specular
    metalness: 0.0,
  });
  addTerrainDetail(material, frame, burn, textured && TERRAIN_TEX.enabled);

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'terrain';
  mesh.receiveShadow = true;

  return { mesh, colorStep };
}

// --- Baked broad-relief hillshade (B5.1) -------------------------------------
// Light direction in world XZ — matches the minimap's hillshade (world/minimap.ts) so the
// 3D terrain and the radar read the SAME relief. Sampled over a wide baseline so the shade
// tracks hills/valleys, not the fine detail-bump grain (which the live sun already handles).
const SHADE_LX = 0.55;
const SHADE_LZ = 0.35;
const SHADE_BASELINE = 11; // world-unit half-step for the gradient (broad landform slope)
const SHADE_GAIN = 1.9; // gradient → brightness swing (relief contrast)
const SHADE_BASE = 0.84; // brightness on flat ground (slopes go up/down from here)
const SHADE_LO = 0.58; // darkest shaded slope (away from the light)
const SHADE_HI = 1.2; // brightest lit slope (toward the light)

// --- Richer terrain colour (macro variation + autumn stands) -----------------
const MACRO_SCALE = 0.0016; // broad tint-drift frequency (large patches across the map)
const MACRO_AMOUNT = 0.12; // how far the macro tint pushes (colour pass 0.08→0.12 — more warm/cool drift across
// the map so the floor isn't one flat green; still broad enough to read as terrain, not stripes)
const AUTUMN_SCALE = 0.0055; // autumn-stand patch frequency
const AUTUMN_THRESH = 0.6; // noise above this (in green biomes) turns to fall colour. 0.66→0.6 → more gold/amber
// stands dotting the forest, for colour variety against the green (the boreal fall look)
const AUTUMN_BAND = 0.12; // soft edge of the autumn patch
const AUTUMN_GOLD: [number, number, number] = [0.72, 0.46, 0.13]; // warm birch/tamarack gold

/**
 * Break the flat per-biome fill with (1) a low-frequency MACRO tint — drier/warmer on some
 * broad patches, lusher/cooler on others — and (2) occasional GOLD AUTUMN stands, gated to
 * green (forest/meadow) ground so rock, shore, and swamp keep their look. Deterministic.
 */
function richerColor(c: readonly [number, number, number], x: number, z: number): [number, number, number] {
  let [r, g, b] = c;
  // Macro drift in [-1, 1]: warm + dry on the high side, cool + lush on the low side.
  const macro = fbm2(x * MACRO_SCALE + 11.3, z * MACRO_SCALE - 4.7) * 2 - 1;
  r *= 1 + macro * MACRO_AMOUNT;
  g *= 1 + macro * MACRO_AMOUNT * 0.5;
  b *= 1 - macro * MACRO_AMOUNT * 0.7;
  // Autumn only where the ground reads green (forest/meadow), so we don't paint rock/sand.
  const green = g > r * 1.04 && g > b * 1.1;
  if (green) {
    const patch = fbm2(x * AUTUMN_SCALE - 8.1, z * AUTUMN_SCALE + 6.9);
    const w = smooth01((patch - AUTUMN_THRESH) / AUTUMN_BAND) * 0.7; // cap so it tints, not repaints
    r = r + (AUTUMN_GOLD[0] - r) * w;
    g = g + (AUTUMN_GOLD[1] - g) * w;
    b = b + (AUTUMN_GOLD[2] - b) * w;
  }
  return [r, g, b];
}

/** Cheap 2D value-noise fbm in [0,1] (JS, load-time) for the colour-variation fields. */
function fbm2(x: number, z: number): number {
  return vnoise(x, z) * 0.6 + vnoise(x * 2.3 + 5.1, z * 2.3 - 2.7) * 0.3 + vnoise(x * 4.7 + 9.2, z * 4.7 + 1.3) * 0.1;
}
function vnoise(x: number, z: number): number {
  const xi = Math.floor(x);
  const zi = Math.floor(z);
  const xf = x - xi;
  const zf = z - zi;
  const u = xf * xf * (3 - 2 * xf);
  const v = zf * zf * (3 - 2 * zf);
  const a = h21(xi, zi);
  const b = h21(xi + 1, zi);
  const c = h21(xi, zi + 1);
  const d = h21(xi + 1, zi + 1);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}
function h21(x: number, z: number): number {
  let p = (x * 123.34 + z * 345.45) % 1;
  if (p < 0) p += 1;
  p = (p * (p + 34.345)) % 1;
  return p < 0 ? p + 1 : p;
}
function smooth01(t: number): number {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * (3 - 2 * c);
}

/**
 * Directional hillshade in [SHADE_LO, SHADE_HI] from the broad local height gradient — read
 * from the precomputed height grid instead of re-sampling the world. `heights` is the row-major
 * (N×N) vertex grid; `i` is the vertex index; `step` is the world-unit spacing between adjacent
 * vertices. We pick a neighbour stride `k` so `k·step ≈ SHADE_BASELINE` (the broad-landform
 * baseline), keeping the relief resolution-stable: the same look at every quality tier. Borders
 * clamp to the nearest in-grid neighbour and divide by the true span used (no edge artefacts).
 */
function reliefShadeGrid(heights: Float32Array, i: number, N: number, stepX: number, stepZ: number): number {
  const ix = i % N;
  const iz = (i / N) | 0;
  // Per-axis neighbour stride so k·step ≈ the 11u baseline on each axis (cells differ on a rect map).
  const kx = Math.max(1, Math.round(SHADE_BASELINE / stepX));
  const kz = Math.max(1, Math.round(SHADE_BASELINE / stepZ));
  // X gradient (across columns) — clamp the column index, divide by the actual span sampled.
  const x0 = Math.max(0, ix - kx);
  const x1 = Math.min(N - 1, ix + kx);
  const ex = (heights[iz * N + x1] - heights[iz * N + x0]) / Math.max(1e-4, (x1 - x0) * stepX);
  // Z gradient (down rows).
  const z0 = Math.max(0, iz - kz);
  const z1 = Math.min(N - 1, iz + kz);
  const ez = (heights[z1 * N + ix] - heights[z0 * N + ix]) / Math.max(1e-4, (z1 - z0) * stepZ);
  const s = SHADE_BASE + (-ex * SHADE_LX - ez * SHADE_LZ) * SHADE_GAIN;
  return s < SHADE_LO ? SHADE_LO : s > SHADE_HI ? SHADE_HI : s;
}

/**
 * Procedural surface detail + triplanar rock (Track B5) patched over the biome vertex
 * colors. Two layers, no textures (hash value-noise, world-space, tiles seamlessly):
 *
 *  - **Triplanar detail bump** — the fine height noise is sampled on all three world
 *    planes and blended by the surface normal, so it projects correctly onto steep
 *    granite faces instead of smearing the top-down pattern down a cliff. The normal is
 *    perturbed from that height via screen derivatives (one extra value per fragment).
 *  - **Slope-driven rock** — where the ground steepens (low normal.y) the albedo tilts
 *    to granite grey with higher-contrast grain and the bump strengthens, so outcrops
 *    and cliffs read as rough rock while the flats stay soft grass/forest floor.
 *  - **Color mottle** on the flats breaks up the uniform per-biome fill.
 */
function addTerrainDetail(material: THREE.MeshStandardMaterial, frame?: FrameContext, burn?: TerrainBurn, textured = false): void {
  const DETAIL_SCALE = 0.14; // fine grain frequency (world units → ~7u wavelength)
  const PATCH_SCALE = 0.018; // broad color-patch frequency
  const MOTTLE = 0.24; // albedo lighten/darken range on the flats
  const FLAT_BUMP = 0.55; // micro-relief strength on gentle ground
  const ROCK_BUMP = 1.5; // stronger relief on rock faces
  const ROCK_LO = 0.34; // slope (1 − normal.y) where rock starts showing
  const ROCK_HI = 0.72; // slope where it's full rock
  const ROCK_COLOR = '0.43, 0.42, 0.40'; // granite grey

  material.onBeforeCompile = (shader) => {
    // Cloud shadows share the live time/wind references so a shadow drifts in lockstep with
    // the wind that bends the smoke and waves. Static coverage/darkness set once.
    if (frame) {
      shader.uniforms.uTime = frame.uTime;
      shader.uniforms.uWind = frame.uWind;
      shader.uniforms.uCloudScale = { value: CLOUDS.scale };
      shader.uniforms.uCloudSpeed = { value: CLOUDS.speed };
      shader.uniforms.uCloudLo = { value: CLOUDS.coverageLo };
      shader.uniforms.uCloudHi = { value: CLOUDS.coverageHi };
      shader.uniforms.uCloudDark = { value: CLOUDS.darken };
    }
    // C5 continuous burn: the live fire field (R=heat, G=scorch) the ground chars + glows from.
    // The texture is mutated in place each frame (FireFieldTexture.pack), so this is set once —
    // no recompile. uBurnMin/uBurnSize map world XZ → the field's 0..1 uv.
    if (burn) {
      shader.uniforms.uBurnTex = { value: burn.tex };
      shader.uniforms.uBurnMin = { value: new THREE.Vector2(burn.minX, burn.minZ) };
      shader.uniforms.uBurnSize = { value: new THREE.Vector2(burn.sizeX, burn.sizeZ) };
    }
    // Real ground/rock/scorch albedo (downloaded CC0). sRGB textures → the WebGL2 sampler returns
    // linear RGB, so the in-shader multiply into diffuseColor (linear here) is colour-correct. Set
    // once — no recompile; the maps are module-cached + shared across missions.
    if (textured) {
      shader.uniforms.uGroundTex = { value: loadAlbedo(TERRAIN_TEX.ground, 8) };
      shader.uniforms.uRockTex = { value: loadAlbedo(TERRAIN_TEX.rock, 8) };
      shader.uniforms.uScorchTex = { value: loadAlbedo(TERRAIN_TEX.scorch, 4) };
      shader.uniforms.uTexScale = { value: TERRAIN_TEX.scale };
      shader.uniforms.uGroundStr = { value: TERRAIN_TEX.groundStrength };
      shader.uniforms.uGroundMid = { value: TERRAIN_TEX.groundMidLuma };
      shader.uniforms.uRockStr = { value: TERRAIN_TEX.rockStrength };
      shader.uniforms.uRockBright = { value: TERRAIN_TEX.rockBright };
      shader.uniforms.uScorchStr = { value: TERRAIN_TEX.scorchStrength };
    }

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vTerrWorld;\nvarying vec3 vTerrN;')
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvTerrWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;',
      )
      // The terrain mesh sits at the origin (identity model), so the object normal IS
      // the world normal — used for triplanar weights + slope.
      .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nvTerrN = normalize(objectNormal);');

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
        varying vec3 vTerrWorld;
        varying vec3 vTerrN;
        ${frame ? 'uniform float uTime, uCloudScale, uCloudSpeed, uCloudLo, uCloudHi, uCloudDark; uniform vec2 uWind;' : ''}
        ${burn ? 'uniform sampler2D uBurnTex; uniform vec2 uBurnMin, uBurnSize;' : ''}
        ${textured ? 'uniform sampler2D uGroundTex, uRockTex, uScorchTex; uniform float uTexScale, uGroundStr, uGroundMid, uRockStr, uRockBright, uScorchStr;' : ''}
        float h21(vec2 p){ p = fract(p * vec2(123.34, 345.45)); p += dot(p, p + 34.345); return fract(p.x * p.y); }
        float vnoise(vec2 p){
          vec2 i = floor(p), f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          float a = h21(i), b = h21(i + vec2(1.0, 0.0)), c = h21(i + vec2(0.0, 1.0)), d = h21(i + vec2(1.0, 1.0));
          return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
        }
        float fbm2(vec2 p){ return vnoise(p) * 0.6 + vnoise(p * 2.3 + 5.1) * 0.3 + vnoise(p * 4.7 + 9.2) * 0.1; }
        // Triplanar fbm: blend the three world-plane projections by the |normal| so the
        // pattern never stretches on a vertical face.
        float fbmTri(vec3 wp, vec3 bw, float s){
          return fbm2(wp.xz * s) * bw.y + fbm2(wp.zy * s) * bw.x + fbm2(wp.xy * s) * bw.z;
        }
        ${textured ? /* glsl */ `
        // Triplanar ALBEDO: the three world-plane projections of a texture, blended by |normal|, so
        // the photo grain projects onto cliffs without the top-down pattern smearing down the face.
        vec3 triTex(sampler2D t, vec3 wp, vec3 bw, float s){
          return texture2D(t, wp.xz * s).rgb * bw.y + texture2D(t, wp.zy * s).rgb * bw.x + texture2D(t, wp.xy * s).rgb * bw.z;
        }` : ''}`,
      )
      .replace(
        '#include <lights_physical_fragment>',
        /* glsl */ `
        {
          vec3 wn = abs(vTerrN);
          vec3 bw = wn / max(wn.x + wn.y + wn.z, 1e-4);   // triplanar weights
          float dh = fbmTri(vTerrWorld, bw, ${DETAIL_SCALE.toFixed(3)});
          float slope = 1.0 - clamp(vTerrN.y, 0.0, 1.0);
          float steep = smoothstep(${ROCK_LO.toFixed(2)}, ${ROCK_HI.toFixed(2)}, slope);

          // Perturb the normal from the height field's screen-space derivatives; rock
          // faces get a stronger bump so they read rough.
          vec3 dpdx = dFdx(vTerrWorld);
          vec3 dpdy = dFdy(vTerrWorld);
          float dhx = dFdx(dh);
          float dhy = dFdy(dh);
          vec3 nrm = normalize(normal);
          vec3 r1 = cross(dpdy, nrm);
          vec3 r2 = cross(nrm, dpdx);
          float det = dot(dpdx, r1);
          vec3 grad = abs(det) > 1e-7 ? (r1 * dhx + r2 * dhy) / det : vec3(0.0);
          normal = normalize(nrm - grad * mix(${FLAT_BUMP.toFixed(2)}, ${ROCK_BUMP.toFixed(2)}, steep));

          // Flats: soft color mottle. Steep: tilt to granite grey with sharper grain.
          float broad = fbm2(vTerrWorld.xz * ${PATCH_SCALE.toFixed(3)});
          float mott = (dh * 0.5 + broad * 0.5) - 0.5;
          diffuseColor.rgb *= 1.0 + ${MOTTLE.toFixed(2)} * mott;
          vec3 rock = mix(diffuseColor.rgb, vec3(${ROCK_COLOR}), 0.55) * (1.0 + 0.4 * (dh - 0.5) * 2.0);
          diffuseColor.rgb = mix(diffuseColor.rgb, rock, steep);
          ${
            textured
              ? /* glsl */ `
          // Real ground grain — modulates LIGHTNESS only (keeps the biome hue), normalised by the
          // texture's mean luma so the multiply stays brightness-neutral on average. SINGLE planar tap
          // (the flats dominate the screen and are ~horizontal, so triplanar buys nothing here — 1 tap not 3).
          vec3 gT = texture2D(uGroundTex, vTerrWorld.xz * uTexScale).rgb;
          float gLuma = dot(gT, vec3(0.299, 0.587, 0.114));
          diffuseColor.rgb *= mix(1.0, gLuma / max(uGroundMid, 1e-3), uGroundStr);
          // Steep faces blend toward real granite albedo (its own colour), scaled to a lit brightness.
          // Triplanar HERE (cliffs are vertical, where a top-down tap would smear) — only on the steep minority.
          vec3 rT = triTex(uRockTex, vTerrWorld, bw, uTexScale * 0.7) * uRockBright;
          diffuseColor.rgb = mix(diffuseColor.rgb, rT, steep * uRockStr);`
              : ''
          }
        }
        ${
          frame
            ? /* glsl */ `
        {
          // Drifting cloud shadow: broad noise scrolling with the wind, softly darkening the ground.
          vec2 cp = (vTerrWorld.xz + uWind * uTime * uCloudSpeed) * uCloudScale;
          float cloud = fbm2(cp);
          float sh = smoothstep(uCloudLo, uCloudHi, cloud);
          diffuseColor.rgb *= mix(1.0, uCloudDark, sh);
        }`
            : ''
        }
        ${
          burn
            ? /* glsl */ `
        {
          // C5 CONTINUOUS BURN: sample the live fire field in world space. The whole burning AREA
          // chars + glows here (not only under the ≤14 flame billboards), so the fire reads as one
          // advancing region with a trailing burn scar instead of scattered dots.
          vec2 bUv = (vTerrWorld.xz - uBurnMin) / uBurnSize;
          if (bUv.x > 0.0 && bUv.x < 1.0 && bUv.y > 0.0 && bUv.y < 1.0) {
            vec4 bf = texture2D(uBurnTex, bUv);
            float heat = bf.r;     // actively burning 0..1
            float scorch = bf.g;   // burned-out scar 0/1
            // Char: burned-out ground AND the hot leading edge darken HARD to blackened earth — a
            // dangerous wildfire leaves the ground deeply charred. Kept a hair off pure black so a
            // little hillshade relief still reads (a burned ridge stays distinct from a burned valley).
            float burnAmt = max(scorch, smoothstep(0.04, 0.45, heat));
            vec3 charCol = vec3(0.028, 0.024, 0.020);
            ${textured ? 'charCol = mix(charCol, texture2D(uScorchTex, vTerrWorld.xz * uTexScale).rgb * 0.35, uScorchStr);' : ''}
            diffuseColor.rgb = mix(diffuseColor.rgb, charCol, burnAmt * 0.9);
            // Ember underglow on actively-burning ground (HDR > 1 → feeds bloom): a deep orange-red
            // that brightens with heat, so the live front reads as a glowing continuous band.
            totalEmissiveRadiance += vec3(2.6, 0.62, 0.10) * heat * heat * 1.35;
          }
        }`
            : ''
        }
        #include <lights_physical_fragment>`,
      );
  };
  material.customProgramCacheKey = () =>
    `bmf-terrain-detail-v5${frame ? '-cloud' : ''}${burn ? '-burn' : ''}${textured ? '-tex' : ''}`;
}
