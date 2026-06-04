import * as THREE from 'three';

/**
 * A little knot of fire-crew figures for a landing zone — the "crew" you set down and pick up in
 * `payload:'crew'` missions now that the heli LANDS instead of slinging a basket. Procedural, zero
 * assets: each figure is a hi-vis capsule body + helmet sphere + a small pack, stood on its feet so
 * the group origin sits at ground level (`Game` drops it at the LZ's `groundHeightAt`).
 *
 * The figures MOVE with the ferry: `Game` drives `setMode` from the crew-transport state each frame,
 * so a pickup/drop reads as real motion (no per-frame allocation — just lerps over a fixed pool):
 *   - `standing`     — waiting at their arc positions (a pending pickup, or a crew just set down)
 *   - `boarding`(t)  — t 0..1: walk from their arc IN to the heli (group centre) and fade aboard
 *   - `disembarking`(t) — t 0..1: emerge at the heli and walk OUT to their arc positions
 *   - `hidden`       — aboard / not yet arrived (group invisible)
 */

export type CrewMode = 'hidden' | 'standing' | 'boarding' | 'disembarking';

export interface CrewFigures {
  group: THREE.Group;
  /** Pose the crew for the current ferry state. `t` (0..1) is the board/disembark dwell progress. */
  setMode(mode: CrewMode, t?: number): void;
}

export function createCrewFigures(count = 3): CrewFigures {
  const group = new THREE.Group();
  group.name = 'crewFigures';

  const suit = new THREE.MeshStandardMaterial({ color: 0xf2c84b, roughness: 0.85, metalness: 0 }); // hi-vis
  const helmet = new THREE.MeshStandardMaterial({ color: 0xeeeeee, roughness: 0.5 });
  const pack = new THREE.MeshStandardMaterial({ color: 0x394049, roughness: 0.8 });

  const bodyGeo = new THREE.CapsuleGeometry(0.26, 0.7, 4, 8); // legs+torso
  const headGeo = new THREE.SphereGeometry(0.2, 10, 8);
  const packGeo = new THREE.BoxGeometry(0.34, 0.5, 0.22);

  // Each figure remembers its STAND position (the arc) + the facing it holds while idle; the walk
  // animations lerp it between that stand and the group centre (under the heli).
  const figs: { node: THREE.Group; stand: THREE.Vector3; faceOut: number }[] = [];

  const ring = 1.1; // cluster radius on the ground
  for (let i = 0; i < count; i++) {
    const a = (i / Math.max(1, count)) * Math.PI * 1.4 - Math.PI * 0.7;
    const fx = Math.cos(a) * ring * (0.5 + (0.5 * ((i * 7) % 5)) / 5);
    const fz = Math.sin(a) * ring * (0.5 + (0.5 * ((i * 5) % 4)) / 4);
    const node = new THREE.Group();

    const body = new THREE.Mesh(bodyGeo, suit);
    body.position.y = 0.61; // capsule half-height (0.35 + 0.26) above the feet
    body.castShadow = true;
    node.add(body);

    const head = new THREE.Mesh(headGeo, helmet);
    head.position.y = 1.3;
    head.castShadow = true;
    node.add(head);

    const bag = new THREE.Mesh(packGeo, pack);
    bag.position.set(0, 0.7, -0.32);
    node.add(bag);

    const faceOut = a + Math.PI; // face outward from the cluster centre while idle
    node.position.set(fx, 0, fz);
    node.rotation.y = faceOut;
    group.add(node);
    figs.push({ node, stand: new THREE.Vector3(fx, 0, fz), faceOut });
  }

  function setMode(mode: CrewMode, t = 0): void {
    if (mode === 'hidden') {
      group.visible = false;
      return;
    }
    group.visible = true;

    if (mode === 'standing') {
      for (const f of figs) {
        f.node.position.copy(f.stand);
        f.node.rotation.y = f.faceOut;
        f.node.scale.setScalar(1);
        f.node.visible = true;
      }
      return;
    }

    // boarding/disembarking: `c` = fraction toward the centre (0 = at stand, 1 = under the heli).
    const c = THREE.MathUtils.clamp(mode === 'boarding' ? t : 1 - t, 0, 1);
    const k = 1 - c; // 1 at the stand, 0 at the centre
    const moving = t > 0.001 && t < 0.999;
    const bob = moving ? Math.abs(Math.sin(t * Math.PI * 4)) * 0.06 : 0; // small step bob while walking
    for (const f of figs) {
      f.node.position.set(f.stand.x * k, bob, f.stand.z * k);
      f.node.scale.setScalar(THREE.MathUtils.lerp(0.25, 1, k)); // shrink into / grow out of the cabin
      f.node.visible = k > 0.08; // gone once aboard (boarding end) / appears as they step out (disembark start)
      // Face the way they walk: inward toward the heli when boarding, back out when disembarking.
      f.node.rotation.y = mode === 'boarding' ? f.faceOut + Math.PI : f.faceOut;
    }
  }

  setMode('hidden');
  return { group, setMode };
}
