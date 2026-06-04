import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { HelicopterMesh } from './helicopter';

/**
 * Selectable helicopter MODELS. Each entry swaps a downloaded glTF in BEHIND the
 * procedural Bell 205A-1 built by createHelicopter(), keeping the exact
 * { group, rotor, tailRotor } contract so nothing downstream changes. The
 * procedural model is shown immediately and stays as the instant fallback; when
 * the glTF finishes loading we clear the procedural visuals out of `group`, drop
 * the real model in, and re-parent its rotor(s) into the existing handles so the
 * caller's per-frame spin keeps working.
 *
 * Adding a heli = one entry here + one card in ui/profile.ts (HELIS). The Sketchfab
 * auto-convert renames nodes to Object_N (and merges some), so each model's rotor /
 * fuselage parts are identified by inspection and pinned per-spec below:
 *
 *   - Bell 205A-1 (uh1)  : node Object_13 = main rotor, Object_3 = tail rotor; the export is
 *     untextured (specular-glossiness clay modern GLTFLoader can't bind) so the body repaints
 *     wholesale.
 *   - Bell 212 (bell212) : a SINGLE merged mesh — no separable rotor node — so we SLICE the real
 *     main blades out of the mesh by a top-slab Y plane so they spin; the (unseparable) tail rotor
 *     gets a small procedural one. The slab plane is tuned to grab ONLY the two blades and EXCLUDE
 *     the rotor-head stabilizer/flybar (the perpendicular weighted bar that sits one band below
 *     the blades): sliced in, the flybar spins too and sweeps as a short second rotor — reading as
 *     duplicate / half-extra blades. Left in the body it stays static at the hub, like real
 *     rotor-head hardware. This is the one TEXTURED body, so its paint is split off the diffuse map
 *     (splitTexturedBody) — the orange panels repaint, the grey windows keep their texture.
 *   - UH-60 Black Hawk   : separable main + tail rotor nodes (NOTE both are GROUPs, not meshes — so
 *     blades are darkened by traversing the rotor handles, not by node identity). Its US Army skin
 *     is also spec-gloss → renders clay → repaints wholesale. GLTFLoader sanitizes node names
 *     (whitespace → '_'), so the specs use the sanitized form ('main rotor prop_7' → '..._prop_7').
 *
 * All three wear the High-Vis Hero fire-bomber livery (see Livery / makeBodyMat / paintLivery): a
 * crisp three-zone paint — light roof, signature flank, near-black sill — split by a thin EMISSIVE
 * cheatline that blooms through the post-fx, each ship in its own hue so the fleet reads as one.
 *
 * Orientation/scale are normalized per-spec: the model is yawed so its nose points
 * world +X, scaled so the fuselage is `targetLen` units nose-to-tail, centered in
 * X/Z, and seated with the skids at y = 0 (matching the procedural model's frame).
 */

/**
 * A "High-Vis Hero" fire-bomber livery: a crisp three-zone horizontal paint scheme baked as
 * vertex colours — a light ROOF, a signature FLANK, a near-black SILL/belly — split by a thin
 * hot LINE (the cheatline) that is rendered EMISSIVE so it blooms through the post-fx. Zones are
 * keyed to the body's own height fraction (0 = skids, 1 = cabin roof), so the scheme is
 * pose-independent and scale-independent. Every airframe wears the same grammar in its own hue,
 * which is what makes the three ships read as one fleet. See paintLivery().
 */
export interface Livery {
  roof: number; // upper band (light)
  flank: number; // signature mid band — the ship's identity colour
  sill: number; // lower band / belly (near-black)
  line: number; // thin cheatline at the roof/flank break (also the emissive glow colour)
  glass: number; // canopy tint for separable/transparent glass meshes
  blade: number; // rotor + tail-rotor colour (matte dark)
  roofAt: number; // height fraction ≥ this → roof
  sillAt: number; // height fraction ≤ this → sill
  lineAt: number; // height fraction at the cheatline centre
  lineHalf: number; // half-thickness of the cheatline (fraction)
  glow: number; // emissive intensity of the cheatline (blooms via post-fx)
}

export interface HeliModelSpec {
  /** glTF/glb URL, relative to the Vite base (prefixed at construction below). */
  url: string;
  /** Rotation about Y (rad) that points the model's NOSE down world +X. */
  yaw: number;
  /** Desired nose-to-tail length in world units (measured along X after `yaw`). */
  targetLen: number;
  /** Node measured for scale + fore/aft centering; falls back to the whole model. */
  fuselageNode?: string;
  /** Separable main-rotor node → re-parented into the spinnable `rotor` handle. */
  mainRotorNode?: string;
  /** Separable tail-rotor node → spun about the lateral hub axis. */
  tailRotorNode?: string;
  /** The fire-bomber paint scheme baked onto this airframe. Clay (untextured) exports are
   *  repainted wholesale; a textured body is split by its diffuse map so only the painted
   *  panels are recoloured and the windows/gear keep their texture (see splitTexturedBody). */
  livery: Livery;
  /** Merged single-mesh model: slice the MAIN rotor out of the mesh by a geometry-local
   *  Y plane (triangles whose centroid Y ≥ this) so the model's real blades spin. */
  splitRotorMinY?: number;
  /** Model has no separable/sliceable tail rotor → mount a small procedural one. */
  procTailRotor?: boolean;
}

// Vite serves `public/` at the site root (base: './'); BASE_URL makes the path
// portable across static hosts.
const BASE = import.meta.env.BASE_URL;

export const HELI_MODELS: Record<string, HeliModelSpec> = {
  // The hero: the OPTIMIZED Huey glb (gltf-transform weld+simplify+prune+webp,
  // ~40k tris / 1.9 MB, node names preserved so Object_13 stays separable).
  'bell-205a1': {
    url: BASE + 'models/uh1/huey-opt.glb',
    yaw: Math.PI, // model nose −X → world +X
    targetLen: 10.5,
    fuselageNode: 'Object_22',
    mainRotorNode: 'Object_13',
    tailRotorNode: 'Object_3',
    // Crimson tanker: white roof, fire-red flank, graphite belly, hot-amber cheatline.
    livery: {
      roof: 0xeceff1, flank: 0xc12a1b, sill: 0x16181d, line: 0xff8a1e, glass: 0x0d1622, blade: 0x1b1d22,
      roofAt: 0.66, sillAt: 0.2, lineAt: 0.6, lineHalf: 0.035, glow: 2.2,
    },
  },
  // Bell 212 — a single merged mesh (Bell204_0). Fore/aft runs along the model's Z, so a
  // −90° yaw swings it onto +X. No separable rotor node, but the main blades sit in a clean
  // top slab (geometry-local Y ≥ 0.80) — slice them out so the REAL blades spin. The plane is
  // 0.80, NOT lower: the rotor-head stabilizer/flybar bar lives in the band just below (Y ≈
  // 0.775–0.80) and, if sliced in, spins with the blades as a perpendicular short second rotor
  // (the "duplicate / half-extra blade" bug). At 0.80 it stays static in the body at the hub.
  // The tail rotor isn't separable, so it gets a small procedural one.
  'bell-212': {
    url: BASE + 'models/bell212/scene.gltf',
    yaw: -Math.PI / 2,
    targetLen: 11,
    fuselageNode: 'Bell204_0',
    splitRotorMinY: 0.8,
    procTailRotor: true,
    // Gold medium: the orange stock paint is split off its texture and repainted — white roof,
    // amber-gold flank, graphite belly, molten-orange cheatline; the grey windows keep their map.
    livery: {
      roof: 0xe9eced, flank: 0xd29a1f, sill: 0x1d1f24, line: 0xff5a26, glass: 0x0d1622, blade: 0x17181c,
      roofAt: 0.64, sillAt: 0.22, lineAt: 0.58, lineHalf: 0.035, glow: 2.0,
    },
  },
  // UH-60M Black Hawk (low poly). Nose at +Z (the tail rotor sits at −Z), so a +90°
  // yaw points it down +X. Both rotors are separable and keep the model's own livery.
  // NOTE: GLTFLoader sanitizes node names (whitespace → '_'), so the lookups below use
  // the SANITIZED form ('main rotor prop_7' → 'main_rotor_prop_7'), not the raw glTF name.
  'uh-60': {
    url: BASE + 'models/blackhawk/us_army_uh-60m_black_hawk_low_poly_model/scene.gltf',
    yaw: Math.PI / 2,
    targetLen: 12,
    fuselageNode: 'Fuselage_6',
    mainRotorNode: 'main_rotor_prop_7',
    tailRotorNode: 'TAIL_ROTOR_4',
    // Steel hi-vis: the spec-gloss army skin can't bind in modern three (renders clay), so it
    // repaints clean — bright steel roof, gunmetal flank, black belly, hi-vis safety-yellow line.
    livery: {
      roof: 0xdde4e9, flank: 0x8b939d, sill: 0x16181c, line: 0xffd21a, glass: 0x0d1622, blade: 0x17181c,
      roofAt: 0.66, sillAt: 0.2, lineAt: 0.6, lineHalf: 0.04, glow: 2.0,
    },
  },
};

/**
 * Swap the glTF for `heliId` in behind the procedural helicopter. Unknown / undefined
 * ids fall back to the hero Bell 205A-1, so an old save or a model-less pick is safe.
 */
export function swapInModel(heli: HelicopterMesh, heliId?: string): void {
  const spec = HELI_MODELS[heliId ?? ''] ?? HELI_MODELS['bell-205a1'];
  const { group, rotor, tailRotor } = heli;

  // Hide the procedural placeholder while the real model streams in, so players never
  // see the wrong airframe flash before it swaps. Revealed again only if the load fails
  // (the procedural model is then the fallback). Synchronous, so it hides from frame 1.
  const placeholder = group.children.slice();
  for (const c of placeholder) c.visible = false;

  new GLTFLoader().load(
    spec.url,
    (gltf) => {
      const model = gltf.scene;
      model.name = 'heliModel';
      model.rotation.y = spec.yaw;

      // --- Livery materials (shared across this airframe) ------------------
      // Build the three materials of the High-Vis Hero scheme up front: the vertex-coloured
      // BODY (its three-zone paint + emissive cheatline is baked later, in paintLivery, once
      // the rotor has been split off so the blades never get painted), a matte-dark BLADE, and
      // a tinted-glass CANOPY. Separable rotor/tail nodes go dark here; a merged-mesh model's
      // blades are darkened where they're sliced (below). Shadows on for every mesh.
      const liv = spec.livery;
      const bodyMat = makeBodyMat(liv);
      const bladeMat = new THREE.MeshStandardMaterial({ color: liv.blade, roughness: 0.45, metalness: 0.35 });
      const glassMat = new THREE.MeshStandardMaterial({ color: liv.glass, roughness: 0.1, metalness: 0.25, transparent: true, opacity: 0.55 });
      model.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        m.castShadow = true;
        m.receiveShadow = true;
      });

      // --- Normalize: scale off the fuselage, center X/Z, seat skids at y = 0 ----
      model.updateWorldMatrix(true, true);
      const fuselage = (spec.fuselageNode ? model.getObjectByName(spec.fuselageNode) : null) ?? model;
      const fbox = new THREE.Box3().setFromObject(fuselage);
      const flen = fbox.getSize(new THREE.Vector3()).x || 1;
      model.scale.setScalar(spec.targetLen / flen);

      model.updateWorldMatrix(true, true);
      const fb2 = new THREE.Box3().setFromObject(fuselage);
      const fc = fb2.getCenter(new THREE.Vector3());
      const whole = new THREE.Box3().setFromObject(model);
      const height = whole.getSize(new THREE.Vector3()).y; // model rests y ∈ [0, height]
      model.position.x -= fc.x; // fuselage centered fore-aft
      model.position.z -= fc.z; // centered laterally
      model.position.y -= whole.min.y; // rest the skids on y = 0

      // --- Swap procedural placeholder → real model, preserving the rotor handles ----
      group.clear();
      rotor.clear();
      tailRotor.clear();
      rotor.position.set(0, 0, 0);
      rotor.rotation.set(0, 0, 0);
      rotor.visible = true; // un-hide the handles we hid during the load
      tailRotor.visible = true;
      group.add(model, rotor);

      // --- Main rotor -------------------------------------------------------
      // Either a separable node, or — for a merged single-mesh model — the blades sliced
      // out of the mesh by a top-slab Y plane. Either way we spin the model's REAL geometry.
      // setFromObject yields WORLD centers, but the handles parent under `group`, whose matrix
      // is non-identity by the time this async load resolves (the heli has spawned at altitude
      // and is being flown). Map into group-local so the pivot rides with the airframe instead
      // of orbiting a stale world point. The blade slab is symmetric about the mast, so its
      // bbox center IS the hub — the same pivot logic serves both cases.
      model.updateWorldMatrix(true, true);
      const rotorMesh =
        (spec.mainRotorNode ? model.getObjectByName(spec.mainRotorNode) : null) ??
        (spec.splitRotorMinY !== undefined ? sliceRotorMesh(model, spec.splitRotorMinY) : null);
      if (rotorMesh) {
        model.updateWorldMatrix(true, true); // a sliced mesh was just added — refresh matrices
        const rc = new THREE.Box3().setFromObject(rotorMesh).getCenter(new THREE.Vector3());
        rotor.position.copy(group.worldToLocal(rc));
        rotor.attach(rotorMesh); // keeps world transform; now spins about the mast axis
      }

      // --- Tail rotor -------------------------------------------------------
      // Separable node → re-parent it; otherwise a small procedural tail rotor at the boom
      // tip. Either way it hangs off a −90°-yawed mount so the caller's tailRotor.rotation.x
      // sweeps the world X-Y plane (a sideways-facing anti-torque disc).
      model.updateWorldMatrix(true, true);
      const tailMesh = spec.tailRotorNode ? model.getObjectByName(spec.tailRotorNode) : null;
      if (tailMesh) {
        const hc = new THREE.Box3().setFromObject(tailMesh).getCenter(new THREE.Vector3());
        mountTailRotor(group, tailRotor, group.worldToLocal(hc));
        tailRotor.attach(tailMesh); // keeps world transform; now spins about the hub
      } else if (spec.procTailRotor) {
        // Nose points +X, so the tail tip is at −X; seat the rotor up at boom height.
        const tailX = whole.min.x - fc.x; // group-local boom tip after the centering shift
        mountTailRotor(group, tailRotor, new THREE.Vector3(tailX + spec.targetLen * 0.05, height * 0.66, 0));
        addProcTailRotor(tailRotor, spec.targetLen * 0.12);
      }

      // --- Body paint ------------------------------------------------------
      // The rotor + tail have been reparented OUT of `model`, so traversing it now yields only
      // the airframe. Tint any glass; collect the painted body. A CLAY (untextured) export is
      // repainted wholesale; a TEXTURED body is split off its diffuse map first so the windows
      // and gear keep their texture and only the painted panels recolour. Then bake the
      // three-zone livery + emissive cheatline over everything collected.
      model.updateWorldMatrix(true, true);
      const bodyMeshes: THREE.Mesh[] = [];
      const textured: THREE.Mesh[] = [];
      model.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        const mat = m.material as THREE.MeshStandardMaterial & { transparent?: boolean; opacity?: number };
        if (mat && (mat.transparent || (mat.opacity ?? 1) < 1)) m.material = glassMat;
        else if (mat && mat.map) textured.push(m); // defer — splitting mutates the tree mid-traverse
        else bodyMeshes.push(m);
      });
      for (const m of textured) {
        const paint = splitTexturedBody(m, bodyMat);
        if (paint) bodyMeshes.push(paint);
      }
      paintLivery(model, bodyMeshes, bodyMat);

      // --- Blades stay matte-dark ------------------------------------------
      // Done LAST, over the rotor HANDLES (which now hold every blade mesh after the reparenting
      // above), so it covers every shape a model throws at us — a separable node that's a GROUP
      // not a mesh (the UH-60), the sliced merged-mesh blade set (the 212), or the procedural tail
      // rotor — uniformly, and after the body paint so a blade can never keep a painted face.
      for (const handle of [rotor, tailRotor]) {
        handle.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh) m.material = bladeMat;
        });
      }
    },
    undefined,
    (err) => {
      // Load failed — reveal the procedural placeholder; it's a perfectly good fallback.
      for (const c of placeholder) c.visible = true;
      console.warn('[heli] glTF model failed to load; using procedural helicopter.', spec.url, err);
    },
  );
}

// --- Procedural rotors (for merged models with no separable rotor) ------------
const PROC_BLADE = new THREE.MeshStandardMaterial({ color: 0x191b1f, roughness: 0.5, metalness: 0.3 });
const PROC_HUB = new THREE.MeshStandardMaterial({ color: 0x70757d, roughness: 0.4, metalness: 0.7 });

/** A −90°-yawed mount under `group` carrying `tailRotor`, pivoted at `posLocal`, so that
 *  tailRotor.rotation.x sweeps the disc sideways (lateral hub axis = anti-torque). */
function mountTailRotor(group: THREE.Object3D, tailRotor: THREE.Object3D, posLocal: THREE.Vector3): void {
  const mount = new THREE.Group();
  mount.name = 'tailRotorMount';
  mount.position.copy(posLocal);
  mount.rotation.y = -Math.PI / 2; // local X → world lateral (Z) = the hub axis
  group.add(mount);
  mount.add(tailRotor);
  tailRotor.position.set(0, 0, 0);
  tailRotor.rotation.set(0, 0, 0);
}

/**
 * Slice the MAIN-ROTOR triangles out of a merged single-mesh model into their own mesh so
 * the model's REAL blades can spin. Rotor triangles are those whose centroid sits in the top
 * slab (geometry-local Y ≥ minY) — above the cabin and fin. The new mesh SHARES the source
 * attribute buffers (just a different index), so it's cheap and pixel-identical in place; the
 * source mesh keeps the body triangles. Returns the rotor mesh (added as a sibling so it
 * inherits the model transform), or null if nothing qualified.
 */
function sliceRotorMesh(model: THREE.Object3D, minY: number): THREE.Mesh | null {
  let src: THREE.Mesh | null = null;
  model.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && !src) src = m;
  });
  if (!src) return null;
  const mesh = src as THREE.Mesh;
  const geo = mesh.geometry;
  const pos = geo.attributes.position;
  const index = geo.index;
  const triCount = index ? index.count / 3 : pos.count / 3;
  const vi = (t: number, k: number): number => (index ? index.getX(t * 3 + k) : t * 3 + k);

  const bodyIdx: number[] = [];
  const rotorIdx: number[] = [];
  for (let t = 0; t < triCount; t++) {
    const a = vi(t, 0);
    const b = vi(t, 1);
    const c = vi(t, 2);
    const cy = (pos.getY(a) + pos.getY(b) + pos.getY(c)) / 3;
    (cy >= minY ? rotorIdx : bodyIdx).push(a, b, c);
  }
  if (!rotorIdx.length) return null;

  // Two sub-geometries over the SAME attribute buffers, distinguished only by index.
  const sub = (idx: number[]): THREE.BufferGeometry => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', pos);
    if (geo.attributes.normal) g.setAttribute('normal', geo.attributes.normal);
    if (geo.attributes.uv) g.setAttribute('uv', geo.attributes.uv);
    g.setIndex(idx);
    g.computeBoundingSphere();
    return g;
  };
  mesh.geometry = sub(bodyIdx); // the source mesh now draws only the body
  const rotorMesh = new THREE.Mesh(sub(rotorIdx), mesh.material);
  rotorMesh.name = 'mainRotorSliced';
  rotorMesh.castShadow = true;
  rotorMesh.receiveShadow = true;
  (mesh.parent ?? model).add(rotorMesh); // sibling → same transform, renders in place
  return rotorMesh;
}

/** Small hub + crossed blade pair built in the local Y-Z plane so it spins about X. */
function addProcTailRotor(parent: THREE.Object3D, radius: number): void {
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.12, radius * 0.12, radius * 0.2, 8), PROC_HUB);
  hub.rotation.z = Math.PI / 2; // hub axis along local X (the spin axis)
  hub.castShadow = true;
  parent.add(hub);
  for (let i = 0; i < 2; i++) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(radius * 0.06, radius * 2, radius * 0.12), PROC_BLADE);
    b.castShadow = true;
    b.rotation.x = (i * Math.PI) / 2; // one spans Y, the other Z
    parent.add(b);
  }
}

/**
 * The vertex-coloured BODY material. It draws the three-zone paint from the per-vertex `color`
 * attribute (baked by paintLivery) and adds the cheatline GLOW from a companion `glow` attribute:
 * a one-line onBeforeCompile patch pushes `glow * uGlow` into the emissive term so the cheatline
 * blooms through the post-fx. Patched once at construction (compiles once at load — no runtime
 * recompiles), and each airframe builds its own so `uGlow` carries that ship's accent.
 */
function makeBodyMat(liv: Livery): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.52, metalness: 0.18 });
  // Everything is driven by `aHeight` (the body's 0..1 height fraction, baked per vertex in
  // paintLivery) so the zones and cheatline are crisp PER-PIXEL — a low-poly fuselage gets a
  // sharp beltline, not a fat gradient smeared across a few big triangles. Uniforms carry this
  // ship's palette; compiled once at load (no runtime recompiles).
  const U = {
    uRoof: { value: new THREE.Color(liv.roof) },
    uFlank: { value: new THREE.Color(liv.flank) },
    uSill: { value: new THREE.Color(liv.sill) },
    uLineCol: { value: new THREE.Color(liv.line) },
    uRoofAt: { value: liv.roofAt },
    uSillAt: { value: liv.sillAt },
    uLineAt: { value: liv.lineAt },
    uLineHalf: { value: liv.lineHalf },
    uGlow: { value: liv.glow },
  };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, U);
    shader.vertexShader =
      'attribute float aHeight;\nvarying float vH;\n' +
      shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  vH = aHeight;');
    shader.fragmentShader =
      'varying float vH;\n' +
      'uniform vec3 uRoof; uniform vec3 uFlank; uniform vec3 uSill; uniform vec3 uLineCol;\n' +
      'uniform float uRoofAt; uniform float uSillAt; uniform float uLineAt; uniform float uLineHalf; uniform float uGlow;\n' +
      shader.fragmentShader
        .replace(
          '#include <color_fragment>',
          '#include <color_fragment>\n' +
            '  float lineM = 1.0 - smoothstep(0.0, uLineHalf, abs(vH - uLineAt));\n' +
            '  vec3 zc = uFlank;\n' +
            '  zc = mix(zc, uSill, smoothstep(uSillAt + 0.012, uSillAt - 0.012, vH));\n' +
            '  zc = mix(zc, uRoof, smoothstep(uRoofAt - 0.012, uRoofAt + 0.012, vH));\n' +
            '  zc = mix(zc, uLineCol, lineM);\n' +
            '  diffuseColor.rgb = zc;\n',
        )
        .replace(
          '#include <emissivemap_fragment>',
          '#include <emissivemap_fragment>\n' +
            '  totalEmissiveRadiance += (1.0 - smoothstep(0.0, uLineHalf, abs(vH - uLineAt))) * uLineCol * uGlow;\n',
        );
  };
  return mat;
}

/**
 * Split a TEXTURED body mesh into the painted panels vs the keepers. We sample the diffuse map at
 * each triangle's centroid UV: a saturated warm texel (the ship's stock paint colour) is a panel
 * to repaint; everything else (grey glazing, black gear, decals) keeps the original texture. The
 * source mesh is left holding the keepers; the painted triangles become a sibling mesh on the
 * shared buffers (just a different index) wearing `bodyMat`, which paintLivery then colours.
 * Returns that paint mesh, or null if nothing qualified / the map isn't readable.
 */
function splitTexturedBody(mesh: THREE.Mesh, bodyMat: THREE.Material): THREE.Mesh | null {
  const tex = (mesh.material as THREE.MeshStandardMaterial).map;
  const img = tex?.image as (HTMLImageElement | ImageBitmap | undefined);
  const geo = mesh.geometry;
  const uv = geo.attributes.uv;
  if (!img || !uv || !img.width) return null;
  const w = img.width;
  const h = img.height;
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img as CanvasImageSource, 0, 0);
  const px = ctx.getImageData(0, 0, w, h).data;
  const wrap = (t: number): number => t - Math.floor(t); // UVs can run outside [0,1]
  const isPaint = (u: number, vv: number): boolean => {
    const x = Math.min(w - 1, Math.floor(wrap(u) * w));
    const y = Math.min(h - 1, Math.floor(wrap(vv) * h)); // glTF v=0 is the top row (flipY=false)
    const i = (y * w + x) * 4;
    const r = px[i] / 255;
    const g = px[i + 1] / 255;
    const b = px[i + 2] / 255;
    return r - b > 0.22 && r > 0.38 && r >= g; // saturated warm paint → repaint
  };
  const index = geo.index;
  const triCount = index ? index.count / 3 : uv.count / 3;
  const vi = (t: number, k: number): number => (index ? index.getX(t * 3 + k) : t * 3 + k);
  const paintIdx: number[] = [];
  const keepIdx: number[] = [];
  for (let t = 0; t < triCount; t++) {
    const a = vi(t, 0);
    const b = vi(t, 1);
    const c = vi(t, 2);
    const cu = (uv.getX(a) + uv.getX(b) + uv.getX(c)) / 3;
    const cv2 = (uv.getY(a) + uv.getY(b) + uv.getY(c)) / 3;
    (isPaint(cu, cv2) ? paintIdx : keepIdx).push(a, b, c);
  }
  if (!paintIdx.length) return null;

  const sub = (idx: number[]): THREE.BufferGeometry => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', geo.attributes.position);
    if (geo.attributes.normal) g.setAttribute('normal', geo.attributes.normal);
    if (geo.attributes.uv) g.setAttribute('uv', geo.attributes.uv);
    g.setIndex(idx);
    g.computeBoundingSphere();
    return g;
  };
  mesh.geometry = sub(keepIdx); // source keeps its texture, minus the painted panels
  const paint = new THREE.Mesh(sub(paintIdx), bodyMat);
  paint.name = 'liveryPaint';
  paint.castShadow = true;
  paint.receiveShadow = true;
  (mesh.parent ?? mesh).add(paint);
  return paint;
}

/**
 * Bake the body's 0..1 height fraction into an `aHeight` vertex attribute and assign the livery
 * material — makeBodyMat's shader turns that height into the three-zone paint + cheatline per
 * pixel. Height is measured in the MODEL's frame (pose- and scale-independent) over the INDEXED
 * vertices only, so a sliced body that still shares a buffer with its blades isn't skewed by the
 * blade vertices sitting up at the mast.
 */
function paintLivery(model: THREE.Object3D, meshes: THREE.Mesh[], mat: THREE.Material): void {
  model.updateWorldMatrix(true, true);
  const invModel = model.matrixWorld.clone().invert();
  const v = new THREE.Vector3();

  // pass 1: model-local Y range over the painted (indexed) vertices only
  let minY = Infinity;
  let maxY = -Infinity;
  const toLocal: THREE.Matrix4[] = [];
  for (const m of meshes) {
    m.updateWorldMatrix(true, false);
    const t = invModel.clone().multiply(m.matrixWorld);
    toLocal.push(t);
    const pos = m.geometry.attributes.position;
    const idx = m.geometry.index;
    const n = idx ? idx.count : pos.count;
    for (let k = 0; k < n; k++) {
      v.fromBufferAttribute(pos, idx ? idx.getX(k) : k).applyMatrix4(t);
      if (v.y < minY) minY = v.y;
      if (v.y > maxY) maxY = v.y;
    }
  }
  const span = Math.max(1e-4, maxY - minY);

  // pass 2: write the per-vertex height fraction
  meshes.forEach((m, mi) => {
    const pos = m.geometry.attributes.position;
    const t = toLocal[mi];
    const hgt = new Float32Array(pos.count);
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(t);
      hgt[i] = (v.y - minY) / span;
    }
    m.geometry.setAttribute('aHeight', new THREE.Float32BufferAttribute(hgt, 1));
    m.material = mat;
  });
}
