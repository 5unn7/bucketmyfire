import * as THREE from 'three';

/**
 * Procedural forest fire for the 3D world.
 *
 * A small stack of camera-facing **flame billboards** drawn with an additive,
 * procedurally-animated flame shader (scrolling domain-warped FBM noise shaped into
 * licking tongues, with a white-hot core fading through orange to deep red at the
 * tips) — plus a warm point light. ZERO binary assets: the flame is entirely GLSL.
 * Additive HDR output feeds the bloom pass so the fire GLOWS rather than reading as
 * flat geometry. The whole thing is driven by a single intensity value in [0..1] so
 * the game can shrink and dim it as the player douses it (mirroring `Fire.intensity`).
 *
 * Conventions: Y is up; each billboard's BASE sits at local y = 0 and rises along +Y.
 * The billboards are Y-LOCKED (they rotate to face the camera horizontally but stay
 * upright in the world), so the fire reads as a volumetric column from any chase angle
 * without ever tilting off the ground. The caller sets `group.position` to a point on
 * the terrain and the fire sits flush. `setIntensity(t)`/`setSize(s)` are called when
 * the fire's health changes; `flicker(elapsed)` every frame advances the animation.
 */

export interface FireMesh {
  group: THREE.Group; // flame billboards; modeled with the base at local y=0
  light: THREE.PointLight; // warm glow whose intensity tracks the fire
  setIntensity(t: number): void; // 0..1 — flame brightness/height + alpha; ~0 => invisible
  setSize(s: number): void; // 0..1 — the fire's FOOTPRINT (NWCG size class): small spot vs big blaze
  setFan(f: number): void; // 0..1 — rotor-downwash agitation (C4): whips the flame harder, cosmetic
  flicker(elapsedSeconds: number): void; // call each frame to advance the flame animation
}

// One flame sheet: its mesh/material plus the deterministic per-sheet parameters that
// give the column variety (different scales, offsets, and noise phases so the sheets
// don't shimmer in unison) and let us rebuild its size each frame from intensity/size.
interface Sheet {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  baseW: number; // full-size width of this sheet (world units)
  baseH: number; // full-size height factor (× FULL_HEIGHT)
  ox: number; // unit XZ offset (−1..1), scaled by footprint in apply()
  oz: number;
  seed: number;
}

// Tallest sheet at full size/intensity, in units. Billboards taper to a point, so this
// can run far taller than the old cones without looking like a needle — a big blaze should
// TOWER over the ~6–8u canopy (a wall of flame, the WRATH of a wildfire), while a small
// spot stays a low flame.
const FULL_HEIGHT = 15.0;

// Light sits a touch above the base so it pools warm light on the ground.
const LIGHT_Y = 1.5;
const LIGHT_MAX_INTENSITY = 6;
const LIGHT_MAX_DISTANCE = 40;

// Deterministic sheet layout: a SPREAD of flame sheets that fan across the fire's
// footprint (so a grown blaze reads as a wide WALL of fire, not one column) framing a
// narrow white-hot core. w = base width (units), h = height factor, (ox,oz) = a UNIT
// offset in [-1..1] that `apply()` scales by the fire's footprint (small spot → tight
// cluster, big blaze → a broad front whose edges meet the neighbouring fires), seed =
// noise/sway phase. Additive overlap reads as a dense sheet of flame.
const SHEETS: ReadonlyArray<{
  w: number;
  h: number;
  ox: number;
  oz: number;
  seed: number;
}> = [
  { w: 4.6, h: 0.5, ox: -1.0, oz: 0.3, seed: 0.1 }, // far-left wall
  { w: 4.2, h: 0.58, ox: -0.6, oz: -0.35, seed: 0.27 },
  { w: 4.0, h: 0.7, ox: -0.18, oz: 0.45, seed: 0.44 },
  { w: 3.8, h: 0.82, ox: 0.18, oz: -0.2, seed: 0.61 },
  { w: 4.0, h: 0.66, ox: 0.55, oz: 0.35, seed: 0.78 },
  { w: 4.5, h: 0.52, ox: 1.0, oz: -0.3, seed: 0.92 }, // far-right wall
  { w: 2.6, h: 1.0, ox: 0.0, oz: 0.0, seed: 0.5 }, // white-hot core, tallest, centered
  { w: 2.1, h: 0.9, ox: -0.3, oz: 0.12, seed: 0.36 }, // inner lick
];

// HDR blackbody flame ramp (values >1 so the bloom pass haloes only the white-hot seat).
// A real fire is a TEMPERATURE gradient: a blinding white-yellow core at the seat, cooling
// up through saturated orange to a deep blood-red, with the crown starving out to embers.
// The DARK comes from the smoke that takes over above — the flame itself just thins out.
const COLOR_CORE = new THREE.Color(2.6, 2.05, 1.25); // white-hot seat (the only part that blooms)
const COLOR_HOT = new THREE.Color(2.0, 0.95, 0.22); // hot yellow-orange
const COLOR_MID = new THREE.Color(1.35, 0.38, 0.05); // saturated deep orange (the flame body)
const COLOR_COOL = new THREE.Color(0.55, 0.08, 0.02); // dark blood-red at the cooling tips

const VERT = /* glsl */ `
  uniform float uTime;
  uniform float uWidth;   // effective base width (world units)
  uniform float uHeight;  // effective height (world units)
  uniform float uSeed;
  uniform float uFan;     // 0..1 rotor-downwash agitation (C4)
  varying vec2 vUv;
  varying float vSeed;
  void main() {
    vUv = uv;             // uv.y: 0 at base → 1 at the tip
    vSeed = uSeed;
    // Y-locked billboard: build the quad in view space from screen-right and
    // world-up-projected-into-view, so the flame always faces the camera but
    // stays standing upright on the ground.
    vec4 center = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    vec3 up = (viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz;
    vec3 right = vec3(1.0, 0.0, 0.0);
    // Width tapers toward the tip; a slow sway leans the upper flame. Under the rotor
    // downwash (uFan) the upper flame WHIPS harder and adds a fast chatter — the fire
    // visibly reacts as the heli hovers in to line up a drop.
    float w = uWidth * mix(1.0, 0.18, uv.y);
    float sway = sin(uTime * 2.1 + uSeed * 6.28) * 0.5 * uv.y * uWidth * 0.25;
    sway *= 1.0 + uFan * 1.6;
    sway += sin(uTime * 8.5 + uSeed * 9.0) * uFan * uv.y * uWidth * 0.18;
    vec3 p = center.xyz + right * (position.x * w + sway) + up * (uv.y * uHeight);
    gl_Position = projectionMatrix * vec4(p, 1.0);
  }`;

const FRAG = /* glsl */ `
  precision highp float;
  uniform float uTime;
  uniform float uIntensity;   // 0..1 brightness + alpha
  uniform vec3 uCore;
  uniform vec3 uHot;
  uniform vec3 uMid;
  uniform vec3 uCool;
  varying vec2 vUv;
  varying float vSeed;

  float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.02; a *= 0.5; }
    return v;
  }

  void main() {
    vec2 uv = vUv;
    // Flames RISE: scroll the noise field downward in uv.y (so detail travels up). Two
    // turbulence layers — a slow churn the FAST detail rides on — give a violent, boiling
    // wall instead of a lazy lick. The fast layer accelerates up the flame.
    float t = uTime * 2.3 + vSeed * 23.0;
    vec2 q = vec2(uv.x * 2.4, uv.y * 3.0 - t);
    float warp = fbm(q * 0.55 + vec2(0.0, t * 0.45));
    float n = fbm(q + warp * 1.3);                       // domain-warped turbulence (the body)
    float fine = fbm(q * 2.6 + vec2(vSeed * 4.0, t * 1.6)); // fast fine churn (the flicker)

    // Base shape: a dense, bright SEAT that thins FAST going up. The strong vertical falloff
    // is what stops the additive sheets from piling into a flat orange cloud — only the
    // lower body is solid; the crown is sparse, broken tongues.
    float edge = pow(clamp(1.0 - abs(uv.x * 2.0), 0.0, 1.0), 1.25);
    float vert = smoothstep(1.05, 0.0, uv.y);            // 1 at the seat → ~0 at the top
    float body = edge * vert;
    // Carve licking tongues: noise + an upward erosion that bites HARDER toward the crown,
    // so the top breaks into separated flames with gaps (no solid blob).
    float flame = body * (0.45 + 0.8 * n + 0.35 * fine) - uv.y * uv.y * 1.6 * (1.0 - n);
    float a = smoothstep(0.2, 0.5, flame) * uIntensity;
    if (a <= 0.01) discard;

    // Heat = a TEMPERATURE field: hottest at the dense seat, cooling up the flame. Biased
    // hard to the base so the white-hot core sits low and the body reads deep orange/red.
    float heat = clamp(flame * 1.25 * (1.0 - uv.y * 0.65) + (1.0 - uv.y) * 0.22, 0.0, 1.0);
    // Blackbody ramp: dark blood-red → deep orange → hot yellow → white-hot core.
    vec3 col = mix(uCool, uMid, smoothstep(0.04, 0.34, heat));
    col = mix(col, uHot, smoothstep(0.34, 0.66, heat));
    col = mix(col, uCore, smoothstep(0.72, 0.96, heat));
    // Starve the crown: fade the flame out toward the top so the BLACK SMOKE behind takes
    // over (the danger reads from the smoke, not an orange haze). Reduced emissive on the
    // cooler body so additive overlap doesn't wash to a flat glow — bloom only grabs the seat.
    a *= smoothstep(1.0, 0.2, uv.y);
    gl_FragColor = vec4(col * (0.74 + 0.6 * heat) * uIntensity, a);
  }`;

export function createFire(): FireMesh {
  const group = new THREE.Group();
  group.name = 'fire';

  const sheets: Sheet[] = [];

  // A unit plane with its base at y=0 (translate +0.5) — the shader rebuilds the quad
  // in view space, so the only thing read from the geometry is position.x and uv.y.
  const geom = new THREE.PlaneGeometry(1, 1, 1, 1);
  geom.translate(0, 0.5, 0);

  SHEETS.forEach((spec) => {
    const material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uWidth: { value: spec.w },
        uHeight: { value: FULL_HEIGHT * spec.h },
        uIntensity: { value: 1 },
        uSeed: { value: spec.seed },
        uFan: { value: 0 },
        uCore: { value: COLOR_CORE },
        uHot: { value: COLOR_HOT },
        uMid: { value: COLOR_MID },
        uCool: { value: COLOR_COOL },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false, // overlapping flames blend; they don't occlude the depth buffer
      blending: THREE.AdditiveBlending, // overlap glows + feeds the bloom pass
    });

    const mesh = new THREE.Mesh(geom, material);
    mesh.position.set(0, 0, 0); // apply() places it; offsets scale with the footprint
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.frustumCulled = false; // the shader moves the verts; the source AABB is meaningless
    group.add(mesh);

    sheets.push({ mesh, material, baseW: spec.w, baseH: spec.h, ox: spec.ox, oz: spec.oz, seed: spec.seed });
  });

  // Warm orange point light, lifted off the base. (Game hides this — the fixed pool of
  // HeroFireLights does the ground lighting — but it's kept for API compatibility.)
  const light = new THREE.PointLight(0xff7a18, LIGHT_MAX_INTENSITY, LIGHT_MAX_DISTANCE, 2);
  light.position.set(0, LIGHT_Y, 0);
  light.castShadow = false;
  group.add(light);

  let intensity = 1;
  let size = 0.5;

  // Push the effective width/height/brightness for the current size+intensity onto every
  // sheet. Height grows mostly with size (footprint class) but a dying fire also shrinks
  // and dims; width fattens a touch with intensity so a roaring fire reads broad.
  function apply(): void {
    // Footprint: a small spot is a tight cluster (±~4u); a full blaze fans its flame
    // sheets across a broad front (±~18u) so neighbouring fires' walls meet into one
    // continuous fire line as they spread.
    const footprint = 3.5 + 16 * size;
    const sw = 0.6 + 0.95 * size; // per-sheet width grows with size
    const sh = 0.62 + 1.85 * size; // height climbs hard with size — a grown blaze towers
    const hI = 0.45 + 0.55 * intensity;
    const wI = 0.8 + 0.2 * intensity;
    for (const s of sheets) {
      s.mesh.position.set(s.ox * footprint, 0, s.oz * footprint);
      s.material.uniforms.uHeight.value = FULL_HEIGHT * s.baseH * sh * hI;
      s.material.uniforms.uWidth.value = s.baseW * sw * wI;
      s.material.uniforms.uIntensity.value = intensity;
    }
  }

  function setIntensity(t: number): void {
    intensity = THREE.MathUtils.clamp(t, 0, 1);
    apply();
    light.intensity = LIGHT_MAX_INTENSITY * intensity;
    light.distance = LIGHT_MAX_DISTANCE * (0.3 + 0.7 * intensity);
  }

  function setSize(s: number): void {
    size = THREE.MathUtils.clamp(s, 0, 1);
    apply();
  }

  // C4: how hard the rotor downwash is whipping this flame (0 = calm). Cosmetic only —
  // it never touches the fire's intensity/size sim state, just the flame's sway.
  function setFan(f: number): void {
    const v = THREE.MathUtils.clamp(f, 0, 1);
    for (const s of sheets) s.material.uniforms.uFan.value = v;
  }

  // Advance the flame animation. The procedural shader does the licking on its own from
  // uTime; here we just feed each sheet its own slightly-offset clock (so they're out of
  // step) and add a tiny non-repeating breathe to the light.
  function flicker(elapsedSeconds: number): void {
    for (const s of sheets) {
      s.material.uniforms.uTime.value = elapsedSeconds + s.seed * 5.0;
    }
    const lightWobble = 1 + 0.2 * fnoise(elapsedSeconds * 1.3 + 0.5) * intensity;
    light.intensity = LIGHT_MAX_INTENSITY * intensity * lightWobble;
  }

  // Start fully lit at a mid size; the game drives setIntensity/setSize each frame.
  setIntensity(1);
  setSize(0.5);

  return { group, light, setIntensity, setSize, setFan, flicker };
}

// --- Non-repeating 1-D value noise (cheap, no texture) — drives the light breathe -----
function hash1(n: number): number {
  const s = Math.sin(n * 12.9898) * 43758.5453;
  return s - Math.floor(s); // 0..1
}
function vnoise(x: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  return hash1(i) * (1 - u) + hash1(i + 1) * u; // 0..1
}
/** Two-octave value noise centered on 0, range ~[-0.75, 0.75]. */
function fnoise(x: number): number {
  return vnoise(x) - 0.5 + (vnoise(x * 2.3 + 11.7) - 0.5) * 0.5;
}
