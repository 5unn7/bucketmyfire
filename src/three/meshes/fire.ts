import * as THREE from 'three';

/**
 * Procedural forest fire for the 3D world.
 *
 * A small stack of camera-facing **flame billboards** textured with a procedurally-GENERATED
 * flame sprite (a blackbody-coloured tongue with licking edges baked from value noise) plus a
 * tiling flicker-noise texture scrolled upward in the shader to make the flame lick and boil.
 * The body sheets are ALPHA-blended (NormalBlending) so the flame reads as a SOLID, recognizable
 * shape against bright sky — the old pure-additive flame washed out to orange haze. A couple of
 * ADDITIVE textured sheets ride on top as the white-hot core glow, pushed into HDR so the bloom
 * pass haloes only the seat. Still ZERO downloaded assets: both textures are drawn into a canvas
 * at load (`flameTextures()`), generated ONCE and shared by every fire (no per-instance alloc).
 *
 * Conventions: Y is up; each billboard's BASE sits at local y = 0 and rises along +Y. The
 * billboards are Y-LOCKED (they rotate to face the camera horizontally but stay upright in the
 * world), so the fire reads as a volumetric column from any chase angle without ever tilting off
 * the ground. The caller sets `group.position` to a point on the terrain and the fire sits flush.
 * `setIntensity(t)`/`setSize(s)` are called when the fire's health changes; `flicker(elapsed)`
 * every frame advances the animation.
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

// Deterministic sheet layout. `mode` 0 = the alpha-blended BODY (the solid, visible flame, fanned
// across the footprint into a wall of fire); `mode` 1 = an additive HDR core GLOW (smaller, hotter,
// feeds the bloom pass). w = base width (units), h = height factor, (ox,oz) = a UNIT offset in
// [-1..1] that `apply()` scales by the fire's footprint (small spot → tight cluster, big blaze →
// a broad front whose edges meet neighbouring fires), seed = noise/sway phase.
const SHEETS: ReadonlyArray<{
  w: number;
  h: number;
  ox: number;
  oz: number;
  seed: number;
  mode: 0 | 1;
}> = [
  { w: 4.6, h: 0.62, ox: -1.0, oz: 0.3, seed: 0.1, mode: 0 }, // far-left wall
  { w: 4.0, h: 0.78, ox: -0.5, oz: -0.35, seed: 0.27, mode: 0 },
  { w: 3.8, h: 0.92, ox: -0.1, oz: 0.45, seed: 0.44, mode: 0 }, // tall left-of-centre body
  { w: 3.9, h: 0.86, ox: 0.32, oz: -0.2, seed: 0.61, mode: 0 },
  { w: 4.4, h: 0.66, ox: 0.95, oz: 0.35, seed: 0.78, mode: 0 }, // far-right wall
  { w: 2.6, h: 1.0, ox: 0.0, oz: 0.0, seed: 0.5, mode: 1 }, // white-hot core glow, tallest, centered
  { w: 2.0, h: 0.84, ox: -0.28, oz: 0.12, seed: 0.36, mode: 1 }, // inner glow lick
];

// LDR blackbody flame ramp BAKED into the sprite (0..1, canvas is 8-bit). A real fire is a
// TEMPERATURE gradient: a near-white core at the seat, cooling up through saturated orange to a
// deep blood-red at the licking tips. The additive glow sheets push these back into HDR so bloom
// grabs only the seat; the body sheets show them straight as a solid, readable flame.
const RAMP: ReadonlyArray<{ at: number; c: [number, number, number] }> = [
  { at: 0.0, c: [0.5, 0.05, 0.02] }, // dark blood-red (cooling tips)
  { at: 0.35, c: [0.92, 0.32, 0.05] }, // saturated deep orange (the flame body)
  { at: 0.66, c: [1.0, 0.72, 0.2] }, // hot yellow-orange
  { at: 1.0, c: [1.0, 0.96, 0.86] }, // near-white seat
];

const VERT = /* glsl */ `
  uniform float uTime;
  uniform float uWidth;   // effective base width (world units)
  uniform float uHeight;  // effective height (world units)
  uniform float uSeed;
  uniform float uFan;     // 0..1 rotor-downwash agitation (C4)
  varying vec2 vUv;
  void main() {
    vUv = uv;             // uv.y: 0 at base → 1 at the tip
    // Y-locked billboard: build the quad in view space from screen-right and
    // world-up-projected-into-view, so the flame always faces the camera but
    // stays standing upright on the ground.
    vec4 center = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    vec3 up = (viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz;
    vec3 right = vec3(1.0, 0.0, 0.0);
    // Width tapers toward the tip; a slow sway leans the upper flame. Under the rotor
    // downwash (uFan) the upper flame WHIPS harder and adds a fast chatter — the fire
    // visibly reacts as the heli hovers in to line up a drop.
    float w = uWidth * mix(1.0, 0.22, uv.y);
    float sway = sin(uTime * 2.1 + uSeed * 6.28) * 0.5 * uv.y * uWidth * 0.25;
    sway *= 1.0 + uFan * 1.6;
    sway += sin(uTime * 8.5 + uSeed * 9.0) * uFan * uv.y * uWidth * 0.18;
    vec3 p = center.xyz + right * (position.x * w + sway) + up * (uv.y * uHeight);
    gl_Position = projectionMatrix * vec4(p, 1.0);
  }`;

const FRAG = /* glsl */ `
  precision highp float;
  uniform sampler2D uFlame;   // baked flame sprite: rgb = blackbody colour, a = tapered shape
  uniform sampler2D uNoise;   // tiling grayscale flicker, scrolled upward for the lick
  uniform float uTime;
  uniform float uIntensity;   // 0..1 brightness + alpha
  uniform float uSeed;
  uniform float uMode;        // 0 = body (alpha-blended), 1 = core glow (additive HDR)
  varying vec2 vUv;

  void main() {
    vec2 uv = vUv;            // x: 0..1 across, y: 0 base → 1 tip
    // Two layers of tiling flicker scrolled UP at different rates: a slow churn the fast
    // chatter rides on. This is what makes the static sprite shape LICK and boil.
    float slow = texture2D(uNoise, vec2(uv.x * 0.7 + uSeed, uv.y * 1.1 - uTime * 0.5)).r;
    float fast = texture2D(uNoise, vec2(uv.x * 1.6 - uSeed * 2.0, uv.y * 2.3 - uTime * 1.15)).r;
    // The baked flame sprite carries the tapered tongue shape + colour (base at v=0).
    vec4 fl = texture2D(uFlame, uv);
    // Modulate the shape's coverage by the scrolled flicker so the edges lick + the crown breaks up.
    float a = fl.a * (0.34 + 0.9 * slow) * (0.7 + 0.5 * fast) * uIntensity;
    a *= smoothstep(1.0, 0.12, uv.y); // starve the crown so the dark smoke behind takes over
    // Densify the SEAT (body sheets only): the lower flame is a near-solid wall of fire so you
    // can't see the ground straight through the hot root when you fly in close, relaxing back
    // into translucent licking tongues toward the crown. The additive core glow (uMode 1) is
    // left a pure HDR highlight.
    if (uMode < 0.5) {
      float seat = 1.0 - smoothstep(0.0, 0.45, uv.y); // 1 at the base → 0 by ~45% up
      float solid = fl.a * uIntensity * (0.6 + 0.4 * fast); // the sprite's tongue, kept lively
      a = mix(a, max(a, solid), seat);
    }
    if (a <= 0.01) discard;

    vec3 col = fl.rgb;
    if (uMode > 0.5) {
      // Core glow: keep only the hottest part, square + boost the colour into HDR so the
      // bloom pass haloes just the white-hot seat (additive blend adds col·a to the frame).
      a = pow(clamp(a, 0.0, 1.0), 1.7);
      col = col * col * 2.8;
    }
    gl_FragColor = vec4(col, a);
  }`;

// A ground-hugging bed of glowing COALS at the fire's root. Real fire has an incandescent base —
// burning fuel and embers on the ground — so without it the flame billboards read as floating over
// orange-tinted dirt when you fly in close. This is a flat ADDITIVE disc lying on the terrain at
// the fire base: a radial incandescence (deep-red rim → orange → near-white heart) broken into
// discrete breathing coals by the shared flicker noise, with the hot heart pushed into HDR so the
// bloom pass haloes the seat. Pooled with the FireMesh (one disc per fire, never added/removed).
const BED_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

const BED_FRAG = /* glsl */ `
  precision highp float;
  uniform sampler2D uNoise;  // shared tiling flicker noise
  uniform float uTime;
  uniform float uIntensity;  // 0..1 — fades the whole bed with the fire
  uniform float uSeed;
  varying vec2 vUv;
  void main() {
    float r = length(vUv - 0.5) * 2.0;        // 0 at centre → 1 at the rim
    if (r >= 1.0) discard;
    float fall = pow(1.0 - r, 1.6);           // hot, dense heart easing to a soft ember rim
    // Discrete coals: two noise lattices crawling out of phase so the bed glints like live
    // embers instead of reading as one flat disc.
    float c1 = texture2D(uNoise, vUv * 3.5 + vec2(uSeed, uTime * 0.05)).r;
    float c2 = texture2D(uNoise, vUv * 7.0 - vec2(uSeed * 2.0, uTime * 0.09)).r;
    float coals = 0.4 + 0.6 * (0.6 * c1 + 0.5 * c2);
    float breathe = 0.85 + 0.15 * sin(uTime * 3.0 + uSeed * 6.28); // slow pulse with the fire
    float glow = fall * coals * breathe * uIntensity;
    // Blackbody ramp: deep-red rim → orange → near-white heart; hottest coals pushed past 1 (HDR).
    vec3 cool = vec3(0.7, 0.12, 0.02);
    vec3 mid  = vec3(1.0, 0.42, 0.10);
    vec3 hot  = vec3(1.0, 0.85, 0.55);
    vec3 col = mix(cool, mid, smoothstep(0.0, 0.55, fall));
    col = mix(col, hot, smoothstep(0.55, 1.0, fall * coals));
    col *= 1.0 + fall * fall * 2.2;           // HDR heart → the bloom pass haloes the seat
    gl_FragColor = vec4(col * glow, 1.0);     // additive: alpha is ignored, rgb is what's added
  }`;

// --- Baked procedural textures (generated ONCE, shared by every FireMesh) -------------------
// Built lazily on the first createFire() so module load is side-effect-free (and the verifier,
// which never imports this engine layer, never touches `document`).
let FLAME_TEX: THREE.Texture | null = null;
let NOISE_TEX: THREE.Texture | null = null;

function flameTextures(): { flame: THREE.Texture; noise: THREE.Texture } {
  if (!FLAME_TEX) FLAME_TEX = buildFlameSprite();
  if (!NOISE_TEX) NOISE_TEX = buildFlickerNoise();
  return { flame: FLAME_TEX, noise: NOISE_TEX };
}

/** Sample the LDR blackbody ramp at heat 0..1 → [r,g,b] in 0..1. */
function rampColor(heat: number): [number, number, number] {
  const h = heat < 0 ? 0 : heat > 1 ? 1 : heat;
  for (let i = 1; i < RAMP.length; i++) {
    if (h <= RAMP[i].at) {
      const a = RAMP[i - 1];
      const b = RAMP[i];
      const t = (h - a.at) / (b.at - a.at || 1);
      return [a.c[0] + (b.c[0] - a.c[0]) * t, a.c[1] + (b.c[1] - a.c[1]) * t, a.c[2] + (b.c[2] - a.c[2]) * t];
    }
  }
  return [...RAMP[RAMP.length - 1].c] as [number, number, number];
}

/**
 * Bake the flame SPRITE: a single tapered tongue with the blackbody ramp in rgb and a soft,
 * lick-eroded coverage in alpha. Base sits at the TOP row (v=0 after the texture's flipY), so the
 * shader samples it straight with uv. Static shape — the shader scrolls the noise over it for life.
 */
function buildFlameSprite(): THREE.Texture {
  const W = 96;
  const H = 192;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext('2d')!;
  const img = ctx.createImageData(W, H);
  const d = img.data;
  for (let py = 0; py < H; py++) {
    const t = py / (H - 1); // 0 at base (top row) → 1 at tip (bottom row); flipY maps it back
    const halfW = mix(1.0, 0.16, t); // wide seat, narrows to a point at the tip
    const vert = Math.pow(1 - t, 0.55); // dense low body, thinning crown
    for (let px = 0; px < W; px++) {
      const cx = (px / (W - 1)) * 2 - 1; // -1..1
      const hx = cx / halfW; // position within the tapered width
      const i = (py * W + px) * 4;
      if (hx <= -1 || hx >= 1) {
        d[i + 3] = 0;
        continue;
      }
      const edge = Math.pow(1 - Math.abs(hx), 1.25);
      const n = fbm2(cx * 3.2 + 11.0, t * 5.5 + 3.0); // licking detail
      // Body shape carved by noise + an upward erosion that bites harder toward the crown.
      let flame = edge * vert * (0.5 + 0.85 * n) - t * t * 1.2 * (1 - n);
      const alpha = smoothstep(0.16, 0.5, flame);
      if (alpha <= 0.003) {
        d[i + 3] = 0;
        continue;
      }
      // Heat field: hottest at the dense seat, cooling up the flame (biased to the base).
      const heat = clamp(flame * 1.25 * (1 - t * 0.6) + (1 - t) * 0.28, 0, 1);
      const [r, g, b] = rampColor(heat);
      d[i] = Math.round(r * 255);
      d[i + 1] = Math.round(g * 255);
      d[i + 2] = Math.round(b * 255);
      d[i + 3] = Math.round(alpha * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  return tex;
}

/**
 * Bake a seamlessly TILING grayscale noise the shader scrolls upward for the flame's flicker.
 * Two wrapped lattices (8² + 16²) bilinearly upsampled with modulo indexing → tiles perfectly in
 * both axes, so the vertical scroll never shows a seam.
 */
function buildFlickerNoise(): THREE.Texture {
  const S = 64;
  const cv = document.createElement('canvas');
  cv.width = S;
  cv.height = S;
  const ctx = cv.getContext('2d')!;
  const img = ctx.createImageData(S, S);
  const d = img.data;
  const a = lattice(8, 1779);
  const b = lattice(16, 9241);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = x / S;
      const v = y / S;
      const n = 0.62 * tileSample(a, 8, u, v) + 0.38 * tileSample(b, 16, u, v);
      const g = Math.round(clamp(n, 0, 1) * 255);
      const i = (y * S + x) * 4;
      d[i] = g;
      d[i + 1] = g;
      d[i + 2] = g;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  return tex;
}

export function createFire(): FireMesh {
  const group = new THREE.Group();
  group.name = 'fire';

  const { flame, noise } = flameTextures();
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
        uMode: { value: spec.mode },
        uFlame: { value: flame },
        uNoise: { value: noise },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false, // overlapping flames blend; they don't occlude the depth buffer
      // Body = NormalBlending → a SOLID, readable flame; core glow = AdditiveBlending → HDR bloom seat.
      blending: spec.mode === 1 ? THREE.AdditiveBlending : THREE.NormalBlending,
    });

    const mesh = new THREE.Mesh(geom, material);
    mesh.position.set(0, 0, 0); // apply() places it; offsets scale with the footprint
    mesh.renderOrder = spec.mode; // draw the additive glow after the body so the seat sits on top
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.frustumCulled = false; // the shader moves the verts; the source AABB is meaningless
    group.add(mesh);

    sheets.push({ mesh, material, baseW: spec.w, baseH: spec.h, ox: spec.ox, oz: spec.oz, seed: spec.seed });
  });

  // The glowing coal bed at the fire's root (see BED_FRAG): a flat additive disc lying a hair
  // above the terrain. apply() scales it to the footprint + brightens it with intensity; flicker()
  // advances it. A unit plane (half-extent 0.5) → scale = 2·radius gives a disc of that radius.
  const bedMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uIntensity: { value: 1 },
      uSeed: { value: 0.37 },
      uNoise: { value: noise },
    },
    vertexShader: BED_VERT,
    fragmentShader: BED_FRAG,
    transparent: true,
    depthWrite: false, // sits on the ground; never writes depth (no z-fight, doesn't occlude flames)
    depthTest: true, // but a hill between the camera and the fire still hides it
    blending: THREE.AdditiveBlending,
  });
  const bed = new THREE.Mesh(new THREE.PlaneGeometry(1, 1, 1, 1), bedMat);
  bed.rotation.x = -Math.PI / 2; // lie flat in the XZ plane
  bed.position.y = 0.2; // a hair above the terrain to avoid z-fighting
  bed.renderOrder = -1; // draw under the flame sheets
  bed.castShadow = false;
  bed.receiveShadow = false;
  bed.frustumCulled = false; // scaled per frame; the source AABB is meaningless
  group.add(bed);

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
    // Coal bed: underlie the whole flame fan (a touch past the outermost sheet) so the ground the
    // sheets root in glows rather than showing dirt; brighten with intensity (a roaring fire sits on
    // a blazing bed, a dying one on cooling embers). Never fully dark while the fire lives.
    const bedRadius = footprint * 1.1 + 3;
    bed.scale.set(bedRadius * 2, bedRadius * 2, 1);
    bedMat.uniforms.uIntensity.value = 0.35 + 0.65 * intensity;
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

  // Advance the flame animation. The shader scrolls the noise on its own from uTime; here we
  // just feed each sheet its own slightly-offset clock (so they're out of step) and add a tiny
  // non-repeating breathe to the light.
  function flicker(elapsedSeconds: number): void {
    for (const s of sheets) {
      s.material.uniforms.uTime.value = elapsedSeconds + s.seed * 5.0;
    }
    bedMat.uniforms.uTime.value = elapsedSeconds;
    const lightWobble = 1 + 0.2 * fnoise(elapsedSeconds * 1.3 + 0.5) * intensity;
    light.intensity = LIGHT_MAX_INTENSITY * intensity * lightWobble;
  }

  // Start fully lit at a mid size; the game drives setIntensity/setSize each frame.
  setIntensity(1);
  setSize(0.5);

  return { group, light, setIntensity, setSize, setFan, flicker };
}

// --- Baking helpers: value noise (sprite) + wrapped lattice noise (tiling flicker) ----------
function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0 || 1), 0, 1);
  return t * t * (3 - 2 * t);
}

// 2-D value noise for the sprite's licking detail (no tiling needed — it's a one-shot bake).
function vhash2(x: number, y: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function vnoise2(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = vhash2(ix, iy);
  const b = vhash2(ix + 1, iy);
  const c = vhash2(ix, iy + 1);
  const dd = vhash2(ix + 1, iy + 1);
  return mix(mix(a, b, ux), mix(c, dd, ux), uy);
}
function fbm2(x: number, y: number): number {
  let v = 0;
  let amp = 0.5;
  for (let i = 0; i < 4; i++) {
    v += amp * vnoise2(x, y);
    x *= 2.03;
    y *= 2.03;
    amp *= 0.5;
  }
  return v;
}

// A G×G grid of random values — sampled with WRAPPED (modulo) indices so it tiles seamlessly.
function lattice(G: number, seed: number): Float32Array {
  const a = new Float32Array(G * G);
  for (let i = 0; i < a.length; i++) {
    const s = Math.sin((i + 1) * 12.9898 + seed * 78.233) * 43758.5453;
    a[i] = s - Math.floor(s);
  }
  return a;
}
function tileSample(lat: Float32Array, G: number, u: number, v: number): number {
  const x = u * G;
  const y = v * G;
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const x0 = ((ix % G) + G) % G;
  const y0 = ((iy % G) + G) % G;
  const x1 = (x0 + 1) % G;
  const y1 = (y0 + 1) % G;
  const a = lat[y0 * G + x0];
  const b = lat[y0 * G + x1];
  const c = lat[y1 * G + x0];
  const dd = lat[y1 * G + x1];
  return mix(mix(a, b, ux), mix(c, dd, ux), uy);
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
