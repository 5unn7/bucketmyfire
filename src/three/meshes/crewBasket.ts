import * as THREE from 'three';

/**
 * The slung crew basket — what hangs on the longline in `payload:'crew'` missions instead of
 * the Bambi bucket. Procedural, zero assets, and it reuses the EXACT bucket sling contract
 * (`group` centered on its own origin, mouth/up toward +Y, `topAnchorY` where the rope clips
 * on) so `Game` swings it on the existing `BucketSim` pendulum with no new physics — only the
 * mesh and the transport state differ.
 *
 * A personnel transport basket: a low rectangular cage with mesh sides, a base skid, four
 * suspension straps fanning to a swivel head, and `setOccupied(true)` raising a couple of
 * simple seated figures so a carried crew reads at a glance.
 */

export interface CrewBasketMesh {
  group: THREE.Group;
  topAnchorY: number; // local Y of the swivel head — attach the longline here
  setOccupied(on: boolean): void; // show/hide the seated crew figures
}

const SCALE = 0.62; // match the bucket's read against the heli
const W = 2.2; // basket footprint (pre-scale)
const D = 1.5;
const H = 1.3;
const CABLE_RISE = 1.6;
const TOP_ANCHOR_Y = H / 2 + CABLE_RISE;

export function createCrewBasket(): CrewBasketMesh {
  const group = new THREE.Group();
  group.name = 'crewBasket';

  const frame = new THREE.MeshStandardMaterial({ color: 0xff7a18, roughness: 0.7, metalness: 0.1 }); // rescue orange
  const dark = new THREE.MeshStandardMaterial({ color: 0x2b2b2f, roughness: 0.6, metalness: 0.1 });
  const mesh = new THREE.MeshStandardMaterial({
    color: 0x3a3f44,
    roughness: 0.8,
    metalness: 0,
    transparent: true,
    opacity: 0.55,
    side: THREE.DoubleSide,
  });

  // Floor skid.
  const floor = new THREE.Mesh(new THREE.BoxGeometry(W, 0.14, D), dark);
  floor.position.y = -H / 2;
  floor.castShadow = true;
  group.add(floor);

  // Four corner posts + a top rail frame.
  const postGeo = new THREE.BoxGeometry(0.12, H, 0.12);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const p = new THREE.Mesh(postGeo, frame);
      p.position.set((sx * W) / 2, 0, (sz * D) / 2);
      group.add(p);
    }
  }
  const rail = (w: number, d: number, x: number, z: number) => {
    const r = new THREE.Mesh(new THREE.BoxGeometry(w, 0.12, d), frame);
    r.position.set(x, H / 2, z);
    group.add(r);
  };
  rail(W, 0.12, 0, -D / 2);
  rail(W, 0.12, 0, D / 2);
  rail(0.12, D, -W / 2, 0);
  rail(0.12, D, W / 2, 0);

  // Translucent mesh side panels (the cage netting).
  const sideLong = new THREE.Mesh(new THREE.PlaneGeometry(W, H), mesh);
  const sideLongB = sideLong.clone();
  sideLong.position.set(0, 0, -D / 2);
  sideLongB.position.set(0, 0, D / 2);
  group.add(sideLong, sideLongB);
  const sideShort = new THREE.Mesh(new THREE.PlaneGeometry(D, H), mesh);
  sideShort.rotation.y = Math.PI / 2;
  const sideShortB = sideShort.clone();
  sideShort.position.set(-W / 2, 0, 0);
  sideShortB.position.set(W / 2, 0, 0);
  group.add(sideShort, sideShortB);

  // Suspension straps → swivel head (mirrors the bucket).
  const swivelTop = new THREE.Vector3(0, TOP_ANCHOR_Y, 0);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const foot = new THREE.Vector3((sx * W) / 2, H / 2, (sz * D) / 2);
      group.add(strap(foot, swivelTop, dark));
    }
  }
  const swivel = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.12, 0.34, 8), dark);
  swivel.position.copy(swivelTop);
  group.add(swivel);

  // Seated crew figures (shown when occupied): a body capsule + helmet sphere each.
  const crew = new THREE.Group();
  const suit = new THREE.MeshStandardMaterial({ color: 0xf2c84b, roughness: 0.8 }); // hi-vis crew suits
  const helmet = new THREE.MeshStandardMaterial({ color: 0xeeeeee, roughness: 0.5 });
  for (const off of [-0.5, 0.5]) {
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 0.5, 4, 8), suit);
    body.position.set(off, -H / 2 + 0.55, 0);
    crew.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), helmet);
    head.position.set(off, -H / 2 + 1.15, 0);
    crew.add(head);
  }
  crew.visible = false;
  group.add(crew);

  group.scale.setScalar(SCALE);

  return {
    group,
    topAnchorY: TOP_ANCHOR_Y * SCALE,
    setOccupied: (on: boolean) => {
      crew.visible = on;
    },
  };
}

/** A thin strap spanning two points, oriented along them (same helper shape as the bucket). */
function strap(from: THREE.Vector3, to: THREE.Vector3, mat: THREE.Material): THREE.Mesh {
  const dir = new THREE.Vector3().subVectors(to, from);
  const len = dir.length();
  const m = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, len, 5), mat);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
  m.position.copy(from).addScaledVector(dir, 0.5);
  return m;
}
