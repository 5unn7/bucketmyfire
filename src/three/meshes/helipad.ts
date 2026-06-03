import * as THREE from 'three';
import { FLIGHT } from '../config';

/**
 * A procedural concrete helipad for the base — the deck the water-bomber sits on for a cold start
 * (Track A5 polish, same ethos as the lakeside dock). Zero binary assets: a low cylinder slab, a
 * painted touchdown ring, and a marker "H" built from two posts + a crossbar.
 *
 * Built in LOCAL space with the slab BOTTOM at y = 0 and its TOP at y = `FLIGHT.landClearance`, so
 * `Game` drops the group at `(x, groundHeightAt(x,z), z)` and the deck surface lands exactly at the
 * landing floor the flight model rests the skids on around the pad (no float, no snap on take-off).
 * The markings sit a hair proud of the deck so they never z-fight.
 */
export function createHelipad(radius = 7): THREE.Group {
  const group = new THREE.Group();
  group.name = 'helipad';

  const deckTop = FLIGHT.landClearance; // local Y of the pad surface (skids rest here)
  const padH = deckTop; // slab height: bottom on the ground (y=0), top at the landing floor

  const concrete = new THREE.MeshStandardMaterial({ color: 0x3b4047, roughness: 0.92, metalness: 0.04 });
  const paint = new THREE.MeshStandardMaterial({ color: 0xe8c23a, roughness: 0.7, metalness: 0 }); // weathered yellow

  // Slab: a low cylinder, top face at y = deckTop.
  const slab = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius + 0.25, padH, 40), concrete);
  slab.position.y = padH / 2;
  slab.receiveShadow = true;
  slab.castShadow = false;
  group.add(slab);

  const markY = deckTop + 0.02; // markings just above the deck

  // Touchdown ring (a flat annulus painted on the deck).
  const ring = new THREE.Mesh(new THREE.RingGeometry(radius * 0.62, radius * 0.72, 48), paint);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = markY;
  group.add(ring);

  // Marker "H": two uprights + a crossbar (thin flat boxes lying on the deck).
  const barW = radius * 0.5; // overall H height (along local X)
  const legGap = radius * 0.34; // spacing between the two uprights (along local Z)
  const stroke = radius * 0.12;
  const legGeo = new THREE.BoxGeometry(barW, 0.06, stroke);
  for (const sgn of [-1, 1]) {
    const leg = new THREE.Mesh(legGeo, paint);
    leg.position.set(0, markY, sgn * legGap);
    group.add(leg);
  }
  const cross = new THREE.Mesh(new THREE.BoxGeometry(stroke, 0.06, legGap * 2), paint);
  cross.position.set(0, markY, 0);
  group.add(cross);

  return group;
}
