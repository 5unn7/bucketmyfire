import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/**
 * Loads the CC-BY "Ultimate 3D Animal Pack" (WildMesh 3D) and carves the individual
 * animals out of its display scene into clean, reusable PROTOTYPES — each recentered to
 * the origin with feet at y = 0 and scaled to a sensible world height — so the `Fauna`
 * manager can clone + scatter them. This is the model half of the hybrid plan; trees stay
 * procedural. The boar is deliberately skipped (per design). Attribution: see CREDITS.md.
 *
 * The pack lays every animal out in one "Forest Pack" group; some (moose, deer) keep their
 * antlers as separate sibling nodes, so we gather a list of nodes per animal and preserve
 * their relative transforms before normalizing.
 */

export type AnimalKind = 'moose' | 'deer' | 'bear' | 'wolf' | 'fox' | 'rabbit';

// node name(s) in scene.gltf → target world height (units). Moose/deer carry a separate
// antler node that must come along. Heights kept well under the ~6u tree canopy.
const PACK: Record<AnimalKind, { nodes: string[]; height: number }> = {
  moose: { nodes: ['Moose.001', 'Forest Pack_M_Moose_Antler_0'], height: 3.0 },
  deer: { nodes: ['Deer_M.001', 'Deer_Antler'], height: 1.8 },
  bear: { nodes: ['Bear.001'], height: 1.5 },
  wolf: { nodes: ['Wolf.001'], height: 1.1 },
  fox: { nodes: ['Fox.001'], height: 0.7 },
  rabbit: { nodes: ['Rabbit.001'], height: 0.45 },
};

// Optimized pack: resized to 1024 + webp via gltf-transform (59 MB → 4.4 MB), node
// names preserved so extract() still finds each animal. BASE_URL keeps it correct under
// vite's base: './' (sub-path deploys), matching hueyModel.ts.
const PACK_URL = import.meta.env.BASE_URL + 'animals/animals-opt.glb';

export type AnimalPrototypes = Partial<Record<AnimalKind, THREE.Group>>;

/** Load the pack once and return a normalized prototype per animal (empty map on failure).
 *  `enabled` gates the ~4.4 MB fetch+decode (audit PERF-3): pass false on a low-end tier to SKIP it
 *  entirely and let the caller fall back to procedural fauna — no download, no GLTF parse. */
export function loadAnimalPack(enabled = true): Promise<AnimalPrototypes> {
  if (!enabled) return Promise.resolve({}); // low tier → procedural fallback, never touch the network
  return new Promise((resolve) => {
    new GLTFLoader().load(
      PACK_URL,
      (gltf) => {
        const root = gltf.scene;
        root.updateWorldMatrix(true, true);
        const out: AnimalPrototypes = {};
        for (const kind of Object.keys(PACK) as AnimalKind[]) {
          const proto = extract(root, PACK[kind].nodes, PACK[kind].height);
          if (proto) out[kind] = proto;
        }
        resolve(out);
      },
      undefined,
      () => resolve({}), // on error, the manager falls back to procedural fauna
    );
  });
}

/**
 * Gather the named nodes (cloned, keeping their pack-relative transforms) into one group,
 * then recenter it to the origin (XZ centered, feet on y = 0) and scale to `targetHeight`,
 * so the result drops cleanly onto a terrain point and faces a canonical direction.
 */
function extract(root: THREE.Object3D, names: string[], targetHeight: number): THREE.Group | null {
  const collected = new THREE.Group();
  for (const name of names) {
    const node = root.getObjectByName(name);
    if (!node) continue;
    const clone = node.clone(true);
    clone.position.copy(node.position);
    clone.quaternion.copy(node.quaternion);
    clone.scale.copy(node.scale);
    clone.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.castShadow = true;
        m.receiveShadow = true;
      }
    });
    collected.add(clone);
  }
  if (collected.children.length === 0) return null;

  // Normalize: measure, recenter XZ + drop to y=0, then scale to the target height.
  collected.updateWorldMatrix(true, true);
  const box = new THREE.Box3().setFromObject(collected);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);
  const scale = size.y > 1e-4 ? targetHeight / size.y : 1;
  collected.position.set(-center.x, -box.min.y, -center.z);

  const proto = new THREE.Group();
  proto.scale.setScalar(scale);
  proto.add(collected);
  proto.name = 'animalProto';
  return proto;
}
