import * as THREE from 'three';

/**
 * A little knot of standing fire-crew figures for a landing zone — the "crew" you set down and
 * pick up in `payload:'crew'` missions now that the heli LANDS instead of slinging a basket.
 * Procedural, zero assets: each figure is a hi-vis capsule body + helmet sphere + a small pack,
 * stood on its feet so the group origin sits at ground level (`Game` drops it at the LZ's
 * `groundHeightAt`). `Game` toggles the whole group's visibility from the crew-transport state —
 * waiting at a pending pickup, vanished once boarded, standing again at the drop-off — so it reads
 * as "crews getting in / getting out" with no per-frame work (just a `.visible` flip).
 */
export function createCrewFigures(count = 3): THREE.Group {
  const group = new THREE.Group();
  group.name = 'crewFigures';

  const suit = new THREE.MeshStandardMaterial({ color: 0xf2c84b, roughness: 0.85, metalness: 0 }); // hi-vis
  const helmet = new THREE.MeshStandardMaterial({ color: 0xeeeeee, roughness: 0.5 });
  const pack = new THREE.MeshStandardMaterial({ color: 0x394049, roughness: 0.8 });

  const bodyGeo = new THREE.CapsuleGeometry(0.26, 0.7, 4, 8); // legs+torso
  const headGeo = new THREE.SphereGeometry(0.2, 10, 8);
  const packGeo = new THREE.BoxGeometry(0.34, 0.5, 0.22);

  // Stand them in a loose arc facing roughly outward, jittered deterministically (index-based)
  // so they don't line up like cones. Feet at y = 0; capsule centre sits half its height up.
  const ring = 1.1; // cluster radius on the ground
  for (let i = 0; i < count; i++) {
    const a = (i / Math.max(1, count)) * Math.PI * 1.4 - Math.PI * 0.7;
    const fx = Math.cos(a) * ring * (0.5 + 0.5 * ((i * 7) % 5) / 5);
    const fz = Math.sin(a) * ring * (0.5 + 0.5 * ((i * 5) % 4) / 4);
    const figure = new THREE.Group();

    const body = new THREE.Mesh(bodyGeo, suit);
    body.position.y = 0.61; // capsule half-height (0.35 + 0.26) above the feet
    body.castShadow = true;
    figure.add(body);

    const head = new THREE.Mesh(headGeo, helmet);
    head.position.y = 1.3;
    head.castShadow = true;
    figure.add(head);

    const bag = new THREE.Mesh(packGeo, pack);
    bag.position.set(0, 0.7, -0.32);
    figure.add(bag);

    figure.position.set(fx, 0, fz);
    figure.rotation.y = a + Math.PI; // face outward from the cluster centre
    group.add(figure);
  }

  return group;
}
