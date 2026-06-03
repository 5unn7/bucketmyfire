import * as THREE from 'three';

/**
 * Procedural low-poly boreal wildlife (zero binary assets): a moose, a deer, and a loon,
 * each built from primitive boxes/cones the same way as the cabin + heli. Modeled facing
 * +X with feet (or the waterline, for the loon) at local y = 0, so the placer just drops
 * the group at a ground/water point and yaws it.
 *
 * Each factory returns the group plus its `head` node, which the `Fauna` manager dips for
 * grazing and bobs for idle life. These factories are also the **swap point** for the
 * hybrid plan: replace a `buildX()` body with a loaded CC0 glTF (same group contract) and
 * nothing downstream changes.
 */

export interface FaunaMesh {
  group: THREE.Group;
  head: THREE.Object3D; // dipped while grazing / bobbed for life
}

export type FaunaKind = 'moose' | 'deer' | 'loon';

export function createFauna(kind: FaunaKind): FaunaMesh {
  if (kind === 'moose') return buildMoose();
  if (kind === 'deer') return buildDeer();
  return buildLoon();
}

// --- Moose: tall, dark, humped shoulders, broad palmate antlers, a chin bell ----------
function buildMoose(): FaunaMesh {
  const g = new THREE.Group();
  g.name = 'moose';
  const hide = mat(0x4a3826);
  const dark = mat(0x2e2218);
  const legc = mat(0x33271b);
  const legH = 1.5;
  const bodyY = legH + 0.55;

  for (const [lx, lz] of [[0.85, 0.45], [0.85, -0.45], [-0.85, 0.45], [-0.85, -0.45]]) {
    box(g, legc, 0.18, legH, 0.18, lx, legH / 2, lz);
  }
  box(g, hide, 2.2, 1.15, 0.95, 0, bodyY, 0); // barrel body
  box(g, hide, 0.7, 0.55, 0.9, 0.7, bodyY + 0.7, 0); // shoulder hump

  const head = new THREE.Group();
  head.position.set(1.35, bodyY + 0.65, 0);
  box(head, hide, 0.45, 0.95, 0.4, 0, 0, 0, -0.5); // angled neck
  box(head, hide, 0.7, 0.45, 0.42, 0.45, 0.35, 0); // head
  box(head, dark, 0.5, 0.34, 0.34, 0.85, 0.2, 0); // drooping snout
  box(head, dark, 0.16, 0.34, 0.16, 0.35, -0.1, 0); // dewlap "bell"
  // Palmate antlers: a flat broad palm each side, tipped up and out.
  const bone = mat(0xbcae8e);
  for (const sz of [0.55, -0.55]) {
    box(head, bone, 0.55, 0.1, 0.42, 0.35, 0.55, sz, 0, 0, Math.sign(sz) * 0.35);
  }
  g.add(head);

  finalizeShadows(g);
  return { group: g, head };
}

// --- Deer: slender, tan, thin legs, small forward antlers, a flick of white tail -------
function buildDeer(): FaunaMesh {
  const g = new THREE.Group();
  g.name = 'deer';
  const coat = mat(0xa07845);
  const dark = mat(0x6e5232);
  const legH = 1.05;
  const bodyY = legH + 0.32;

  for (const [lx, lz] of [[0.5, 0.24], [0.5, -0.24], [-0.5, 0.24], [-0.5, -0.24]]) {
    box(g, dark, 0.1, legH, 0.1, lx, legH / 2, lz);
  }
  box(g, coat, 1.3, 0.6, 0.5, 0, bodyY, 0); // body
  box(g, mat(0xe8e2d0), 0.16, 0.18, 0.16, -0.62, bodyY + 0.18, 0); // white tail flag

  const head = new THREE.Group();
  head.position.set(0.62, bodyY + 0.35, 0);
  box(head, coat, 0.22, 0.55, 0.22, 0, 0, 0, -0.45); // neck up
  box(head, coat, 0.42, 0.26, 0.24, 0.28, 0.28, 0); // head
  box(head, dark, 0.28, 0.16, 0.18, 0.5, 0.2, 0); // muzzle
  for (const sz of [0.09, -0.09]) box(head, dark, 0.05, 0.32, 0.05, 0.18, 0.5, sz, 0, 0, sz > 0 ? 0.3 : -0.3); // antlers
  for (const sz of [0.12, -0.12]) box(head, coat, 0.05, 0.18, 0.12, 0.12, 0.42, sz); // ears
  g.add(head);

  finalizeShadows(g);
  return { group: g, head };
}

// --- Loon: a low waterbird, dark back + white breast, black head + dagger bill ---------
function buildLoon(): FaunaMesh {
  const g = new THREE.Group();
  g.name = 'loon';
  const back = mat(0x23232a);
  const white = mat(0xeef0f2);

  const body = new THREE.Mesh(new THREE.SphereGeometry(0.36, 10, 8), back);
  body.scale.set(1.0, 0.5, 0.62);
  body.position.set(0, 0.14, 0); // half-sunk in the water
  g.add(body);
  const belly = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 6), white);
  belly.scale.set(0.9, 0.3, 0.55);
  belly.position.set(-0.02, 0.05, 0);
  g.add(belly);

  const head = new THREE.Group();
  head.position.set(0.34, 0.26, 0);
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 6), mat(0x15151a));
  head.add(skull);
  const bill = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.26, 6), mat(0x111114));
  bill.rotation.z = -Math.PI / 2;
  bill.position.set(0.2, 0, 0);
  head.add(bill);
  g.add(head);

  finalizeShadows(g);
  return { group: g, head };
}

// --- helpers ---------------------------------------------------------------------------

function mat(color: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.0 });
}

/** Add a box of (w,h,d) at (x,y,z), optionally yawed (rotY) and rolled (rotZ). */
function box(
  parent: THREE.Object3D,
  material: THREE.Material,
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  rotZ = 0,
  rotX = 0,
  rotY = 0,
): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y, z);
  m.rotation.set(rotX, rotY, rotZ);
  parent.add(m);
  return m;
}

function finalizeShadows(group: THREE.Group): void {
  group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      m.castShadow = true;
      m.receiveShadow = true;
    }
  });
}
