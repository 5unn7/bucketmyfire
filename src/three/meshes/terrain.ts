import * as THREE from 'three';
import { World } from '../World';
import { CLOUDS } from '../config';
import { FrameContext } from '../render/FrameContext';

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
}

/**
 * The live fire field (C5) the terrain samples to CHAR + GLOW: `tex` is the n×n RGBA DataTexture
 * (R=heat, G=scorch) from `FireFieldTexture`; `min`/`size` map world XZ → texture uv. When present,
 * the ground darkens to charcoal under the burn scar and glows orange (HDR → bloom) where it's
 * actively burning — so the fire reads as one CONTINUOUS advancing region, not isolated dots.
 */
export interface TerrainBurn {
  tex: THREE.Texture;
  min: number; // worldMin (-size/2)
  size: number; // world extent
}

// Default segments per side (fallback). Higher resolves the carved SHORELINES and
// stream channels more smoothly; the caller passes a quality-tier value.
const DEFAULT_SEGMENTS = 160;

export function createTerrain(
  world: World,
  segments: number = DEFAULT_SEGMENTS,
  frame?: FrameContext,
  burn?: TerrainBurn,
): Terrain {
  // PlaneGeometry is built in the XY plane; we rotate it −90° about X so it lies
  // flat in XZ with +Y up. After the rotation, getX/getZ read true world X/Z.
  const geometry = new THREE.PlaneGeometry(world.size, world.size, segments, segments);
  geometry.rotateX(-Math.PI / 2);

  const pos = geometry.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);

  // Displace every vertex by the shared world height, then color it by BIOME (A2):
  // meadow / forest / rock / shore from elevation × moisture × slope × water-distance, with
  // (a) a RICHER-COLOUR pass — broad macro tint drift + occasional gold autumn stands so the
  // forest floor isn't a uniform green — then (b) a baked BROAD-RELIEF hillshade (B5.1). The
  // live sun barely shades this gentle terrain, which left the 3D map reading flat next to
  // the crisp radar; baking the SAME directional hillshade the minimap uses (over a wide
  // baseline so it tracks landforms, not micro-noise) gives ridges/valleys readable depth.
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    pos.setY(i, world.groundHeightAt(x, z));

    const [r, g, b] = richerColor(world.biomes.sample(x, z).color, x, z);
    const shade = reliefShade(world, x, z);
    colors[i * 3] = r * shade;
    colors[i * 3 + 1] = g * shade;
    colors[i * 3 + 2] = b * shade;
  }

  pos.needsUpdate = true;
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  // Recompute normals after displacement so the sun lights the hills + basins.
  geometry.computeVertexNormals();

  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.96, // matte forest floor — minimal specular
    metalness: 0.0,
  });
  addTerrainDetail(material, frame, burn);

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'terrain';
  mesh.receiveShadow = true;

  return { mesh };
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
const MACRO_AMOUNT = 0.08; // how far the macro tint pushes (subtle — reads as terrain, not stripes)
const AUTUMN_SCALE = 0.0055; // autumn-stand patch frequency
const AUTUMN_THRESH = 0.66; // noise above this (in green biomes) turns to fall colour
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

/** Directional hillshade in [SHADE_LO, SHADE_HI] from the broad local height gradient. */
function reliefShade(world: World, x: number, z: number): number {
  const e = SHADE_BASELINE;
  const ex = (world.groundHeightAt(x + e, z) - world.groundHeightAt(x - e, z)) / (2 * e);
  const ez = (world.groundHeightAt(x, z + e) - world.groundHeightAt(x, z - e)) / (2 * e);
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
function addTerrainDetail(material: THREE.MeshStandardMaterial, frame?: FrameContext, burn?: TerrainBurn): void {
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
      shader.uniforms.uBurnMin = { value: burn.min };
      shader.uniforms.uBurnSize = { value: burn.size };
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
        ${burn ? 'uniform sampler2D uBurnTex; uniform float uBurnMin, uBurnSize;' : ''}
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
        }`,
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
            // Char: burned-out ground AND the hot leading edge darken to charred earth. The blend
            // stops short of pure black (lighter charcoal + 0.78 mix) so the hillshade relief still
            // reads through — a burned ridge stays distinct from a burned valley.
            float burnAmt = max(scorch, smoothstep(0.04, 0.45, heat));
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.085, 0.072, 0.058), burnAmt * 0.78);
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
    `bmf-terrain-detail-v5${frame ? '-cloud' : ''}${burn ? '-burn' : ''}`;
}
