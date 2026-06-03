import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { HelicopterMesh } from './helicopter';

/**
 * Swaps a downloaded glTF Bell UH-1 "Huey" in BEHIND the procedural helicopter,
 * keeping the exact { group, rotor, tailRotor } contract so nothing downstream
 * changes. The procedural model built by createHelicopter() is shown immediately and
 * stays as the fallback; when the glTF finishes loading we clear the procedural
 * visuals out of `group` and drop the real model in, re-parenting its main rotor into
 * the existing `rotor` wrapper so the caller's per-frame spin keeps working.
 *
 * Asset: "Bell UH-1 Iroquois (Huey)" by helijah (Sketchfab, Standard license —
 * commercial use OK WITH CREDIT). Attribution must appear in-game/credits.
 *
 * The Sketchfab auto-convert renamed every node to Object_N and merged materials, so
 * parts are identified by inspection (see gltf-inspect.html):
 *   - Object_13 = the entire main-rotor assembly (blades + mast + flybar) → spinnable.
 *   - the tail rotor is merged into the tail body and is NOT separable → stays static.
 */

// Vite serves `public/` at the site root (base: './'). This is the OPTIMIZED glb
// (gltf-transform: weld + simplify + prune + webp): 98k → ~40k tris, 6.9 MB → 1.9 MB,
// node names preserved so Object_13 (main rotor) stays separable.
const MODEL_URL = import.meta.env.BASE_URL + 'models/uh1/huey-opt.glb';
const FUSELAGE_NODE = 'Object_22'; // full body mesh — used to scale to the game's size
const MAIN_ROTOR_NODE = 'Object_13'; // blades + mast + flybar, as one mesh
const TAIL_ROTOR_NODE = 'Object_3'; // the model's own 2-blade tail rotor (hub + blades)

const TARGET_FUSELAGE_LEN = 10.5; // world units nose-to-tail (matches the procedural model)

export function swapInHueyModel(heli: HelicopterMesh): void {
  const { group, rotor, tailRotor } = heli;
  new GLTFLoader().load(
    MODEL_URL,
    (gltf) => {
      const model = gltf.scene;
      model.name = 'hueyModel';

      // The model's nose points −X; the game flies nose-first along +X, so flip it.
      model.rotation.y = Math.PI;

      // The Sketchfab export is "DefaultWhite" + specular-glossiness materials that
      // modern GLTFLoader can't bind (→ flat clay grey). Re-skin it: a fire-bomber
      // livery (white over red) baked onto the body as vertex colors, a dark rotor,
      // and tinted glass for the transparent panes.
      const bodyMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.1 });
      const dark = new THREE.MeshStandardMaterial({ color: 0x23262b, roughness: 0.5, metalness: 0.35 });
      const glass = new THREE.MeshStandardMaterial({ color: 0x3d586e, roughness: 0.1, metalness: 0.25, transparent: true, opacity: 0.55 });
      const rotorMesh0 = model.getObjectByName(MAIN_ROTOR_NODE);
      const tailMesh0 = model.getObjectByName(TAIL_ROTOR_NODE);
      const bodyMeshes: THREE.Mesh[] = [];
      model.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        m.castShadow = true;
        m.receiveShadow = true;
        const mat = m.material as THREE.Material & { transparent?: boolean; opacity?: number };
        if (m === rotorMesh0 || m === tailMesh0) m.material = dark; // rotors stay dark
        else if (mat && (mat.transparent || (mat.opacity ?? 1) < 1)) m.material = glass;
        else bodyMeshes.push(m); // gets the livery bake below
      });
      paintFireLivery(model, bodyMeshes, bodyMat);

      // --- Normalize: scale to the game's size off the fuselage, then seat it:
      //     fuselage centered in X/Z, skids' bottom at y = 0. ---
      model.updateWorldMatrix(true, true);
      const fuselage = model.getObjectByName(FUSELAGE_NODE) ?? model;
      const fbox = new THREE.Box3().setFromObject(fuselage);
      const flen = fbox.getSize(new THREE.Vector3()).x || 1;
      model.scale.setScalar(TARGET_FUSELAGE_LEN / flen);

      model.updateWorldMatrix(true, true);
      const fb2 = new THREE.Box3().setFromObject(fuselage);
      const fc = fb2.getCenter(new THREE.Vector3());
      const whole = new THREE.Box3().setFromObject(model);
      model.position.x -= fc.x; // fuselage centered fore-aft
      model.position.z -= fc.z; // centered laterally
      model.position.y -= whole.min.y; // rest the skids on y = 0

      // --- Swap procedural → real, preserving the rotor / tailRotor handles ---
      group.clear();
      rotor.clear();
      tailRotor.clear();
      rotor.position.set(0, 0, 0);
      rotor.rotation.set(0, 0, 0);
      group.add(model, rotor);

      // --- Re-parent the main rotor into the spinnable wrapper, pivoting on the mast ---
      model.updateWorldMatrix(true, true);
      const rotorMesh = model.getObjectByName(MAIN_ROTOR_NODE);
      if (rotorMesh) {
        const rc = new THREE.Box3().setFromObject(rotorMesh).getCenter(new THREE.Vector3());
        // setFromObject yields a WORLD-space center, but `rotor` parents under `group`,
        // whose world matrix is non-identity by the time this async load resolves (the heli
        // has spawned at altitude and is being flown). Map it into group-local space so the
        // pivot rides with the airframe instead of orbiting a stale world point.
        rotor.position.copy(group.worldToLocal(rc));
        rotor.attach(rotorMesh); // keeps world transform; now spins about the mast axis
      }

      // --- Tail rotor: spin the MODEL's OWN tail rotor (Object_3). Re-parent it into the
      //     tailRotor handle on a mount yawed −90° so the caller's tailRotor.rotation.x
      //     spins it about the lateral hub axis (a sideways-facing anti-torque disc). ---
      model.updateWorldMatrix(true, true);
      const tailMesh = model.getObjectByName(TAIL_ROTOR_NODE);
      if (tailMesh) {
        const hc = new THREE.Box3().setFromObject(tailMesh).getCenter(new THREE.Vector3());
        const tailMount = new THREE.Group();
        tailMount.name = 'tailRotorMount';
        // hc is WORLD-space; tailMount parents under `group` (already posed at the heli's
        // altitude/attitude when this async load lands), so map it into group-local space.
        // Without this the hub pivot sat a full startAltitude above the tail and the blades
        // swept a huge arc every frame — the tail rotor appeared to detach and glitch.
        tailMount.position.copy(group.worldToLocal(hc)); // pivot on the hub
        tailMount.rotation.y = -Math.PI / 2; // local X → world lateral (Z) = the hub axis
        group.add(tailMount);
        tailMount.add(tailRotor);
        tailRotor.position.set(0, 0, 0);
        tailRotor.rotation.set(0, 0, 0);
        tailRotor.attach(tailMesh); // keeps world transform; now spins about the hub
      }
    },
    undefined,
    (err) => {
      // Keep the procedural model — it's a perfectly good fallback.
      console.warn('[huey] glTF model failed to load; using procedural helicopter.', err);
    },
  );
}

/**
 * Bake a water-bomber livery (white upper, fire-red lower) onto the untextured body
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
