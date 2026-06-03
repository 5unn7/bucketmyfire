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
 *   - Bell 205A-1 (uh1)  : node Object_13 = main rotor, Object_3 = tail rotor; the
 *     export is untextured (specular-glossiness clay) so we bake the fire livery on.
 *   - Bell 212 (bell212) : a SINGLE merged mesh — no separable rotor node — so we keep its
 *     own textures and SLICE the real main blades out of the mesh by a top-slab Y plane so
 *     they spin; the (unseparable) tail rotor gets a small procedural one.
 *   - UH-60 Black Hawk   : separable main + tail rotor nodes; keeps its own (textured)
 *     US Army livery. NOTE: GLTFLoader sanitizes node names (whitespace → '_'), so the
 *     specs use the sanitized form ('main rotor prop_7' → 'main_rotor_prop_7').
 *
 * Orientation/scale are normalized per-spec: the model is yawed so its nose points
 * world +X, scaled so the fuselage is `targetLen` units nose-to-tail, centered in
 * X/Z, and seated with the skids at y = 0 (matching the procedural model's frame).
 */

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
  /** Untextured export → bake the white-over-red fire-bomber livery as vertex colors. */
  repaintLivery?: boolean;
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
    repaintLivery: true,
  },
  // Bell 212 — a single merged mesh (Bell204_0). Fore/aft runs along the model's Z, so a
  // −90° yaw swings it onto +X. No separable rotor node, but the main blades sit in a clean
  // top slab (geometry-local Y ≥ 0.77, above the cabin/fin) — slice them out so the REAL
  // blades spin. The tail rotor isn't separable, so it gets a small procedural one.
  'bell-212': {
    url: BASE + 'models/bell212/scene.gltf',
    yaw: -Math.PI / 2,
    targetLen: 11,
    fuselageNode: 'Bell204_0',
    splitRotorMinY: 0.77,
    procTailRotor: true,
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

      // --- Materials -------------------------------------------------------
      // Repaint only untextured exports (the Huey's specular-glossiness clay that
      // modern GLTFLoader can't bind). Textured models keep their own materials;
      // either way we enable shadows. Separable rotors stay matte-dark.
      const rotorMesh0 = spec.mainRotorNode ? model.getObjectByName(spec.mainRotorNode) : null;
      const tailMesh0 = spec.tailRotorNode ? model.getObjectByName(spec.tailRotorNode) : null;
      if (spec.repaintLivery) {
        const bodyMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.1 });
        const dark = new THREE.MeshStandardMaterial({ color: 0x23262b, roughness: 0.5, metalness: 0.35 });
        const glass = new THREE.MeshStandardMaterial({ color: 0x3d586e, roughness: 0.1, metalness: 0.25, transparent: true, opacity: 0.55 });
        const bodyMeshes: THREE.Mesh[] = [];
        model.traverse((o) => {
          const m = o as THREE.Mesh;
          if (!m.isMesh) return;
          m.castShadow = true;
          m.receiveShadow = true;
          const mat = m.material as THREE.Material & { transparent?: boolean; opacity?: number };
          if (m === rotorMesh0 || m === tailMesh0) m.material = dark;
          else if (mat && (mat.transparent || (mat.opacity ?? 1) < 1)) m.material = glass;
          else bodyMeshes.push(m);
        });
        paintFireLivery(model, bodyMeshes, bodyMat);
      } else {
        model.traverse((o) => {
          const m = o as THREE.Mesh;
          if (!m.isMesh) return;
          m.castShadow = true;
          m.receiveShadow = true;
        });
      }

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
 * Bake a water-bomber livery (white upper, fire-red lower) onto untextured body
 * meshes as a `color` vertex attribute. The split is computed in the MODEL's own
 * frame (pose-independent), as a fraction of the body's height — so it tracks the
 * aircraft no matter how the game poses it. Assigns the shared vertex-color material.
 */
function paintFireLivery(model: THREE.Object3D, meshes: THREE.Mesh[], mat: THREE.Material): void {
  const white = new THREE.Color(0.95, 0.94, 0.9);
  const red = new THREE.Color(0.78, 0.12, 0.08);
  model.updateWorldMatrix(true, true);
  const invModel = model.matrixWorld.clone().invert();
  const v = new THREE.Vector3();

  // pass 1: body height range in model-local Y
  let minY = Infinity;
  let maxY = -Infinity;
  const toLocal: THREE.Matrix4[] = [];
  for (const m of meshes) {
    m.updateWorldMatrix(true, false);
    const t = invModel.clone().multiply(m.matrixWorld);
    toLocal.push(t);
    const pos = m.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(t);
      if (v.y < minY) minY = v.y;
      if (v.y > maxY) maxY = v.y;
    }
  }
  const split = minY + 0.42 * (maxY - minY); // lower ~42% wears the red

  // pass 2: write per-vertex colors
  meshes.forEach((m, k) => {
    const pos = m.geometry.attributes.position;
    const col = new Float32Array(pos.count * 3);
    const t = toLocal[k];
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(t);
      const c = v.y < split ? red : white;
      col[i * 3] = c.r;
      col[i * 3 + 1] = c.g;
      col[i * 3 + 2] = c.b;
    }
    m.geometry.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    m.material = mat;
  });
}
