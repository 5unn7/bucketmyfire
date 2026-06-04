import * as THREE from 'three';
import { FLIGHT } from '../config';

/**
 * A procedural concrete helipad for the bases — the deck the water-bomber cold-starts on and sets
 * down to refuel/re-rig. Zero binary assets: a chamfered concrete slab with a raised curb, painted
 * hi-vis markings (perimeter line, touchdown circle, "H", cardinal approach ticks), and a ring of
 * emissive green perimeter lights that bloom at the dawn/dusk/overcast missions so the pad reads as
 * operational from the air.
 *
 * Built in LOCAL space with the slab BOTTOM at y = 0 and its TOP at y = `FLIGHT.landClearance`, so
 * `Game` drops the group at `(x, groundHeightAt(x,z), z)` and the deck surface lands exactly at the
 * landing floor the flight model rests the skids on around the pad (no float, no snap on take-off).
 * Markings stack a hair proud of the deck so they never z-fight. All built once at load — no
 * per-frame cost, no lights (the green dots are emissive meshes, not point-lights → no recompiles).
 */
export function createHelipad(radius = 7): THREE.Group {
  const group = new THREE.Group();
  group.name = 'helipad';

  const deckTop = FLIGHT.landClearance; // local Y of the pad surface (skids rest here)
  const padH = deckTop; // slab height: bottom on the ground (y=0), top at the landing floor

  // Concrete in two tones — a darker poured base + a lighter inset deck cap — so the pad reads as a
  // real slab with a rim, not a flat disc. Paint is a faintly self-lit hi-vis yellow so the markings
  // still carry at night/overcast; the perimeter line + ticks are a worn off-white; the curb is a
  // near-black weathered edge. The lamp glows green (aviation perimeter lighting) and blooms.
  const base = new THREE.MeshStandardMaterial({ color: 0x33373d, roughness: 0.96, metalness: 0.03 });
  const deckMat = new THREE.MeshStandardMaterial({ color: 0x474d55, roughness: 0.9, metalness: 0.05 });
  const curbMat = new THREE.MeshStandardMaterial({ color: 0x26282d, roughness: 0.95, metalness: 0.06 });
  const paint = new THREE.MeshStandardMaterial({ color: 0xe8c23a, roughness: 0.6, metalness: 0, emissive: 0x6a5300, emissiveIntensity: 0.3 });
  const edge = new THREE.MeshStandardMaterial({ color: 0xd9d2c2, roughness: 0.7, metalness: 0 });
  const lampMat = new THREE.MeshStandardMaterial({ color: 0x0c1f15, emissive: 0x2be07a, emissiveIntensity: 1.9, roughness: 0.4, metalness: 0 });

  // Slab: a smooth 64-seg cylinder, the top face drawn in tighter than the base for a bevelled lip.
  const slab = new THREE.Mesh(new THREE.CylinderGeometry(radius - 0.35, radius + 0.25, padH, 64), base);
  slab.position.y = padH / 2;
  slab.receiveShadow = true;
  slab.castShadow = false;
  group.add(slab);

  // Raised curb: a thin torus ringing the rim, so the deck has a real lip from the side and the eye
  // reads a contained pad rather than paint on the dirt.
  const curb = new THREE.Mesh(new THREE.TorusGeometry(radius - 0.28, 0.14, 8, 72), curbMat);
  curb.rotation.x = -Math.PI / 2;
  curb.position.y = deckTop;
  group.add(curb);

  // Lighter poured-deck cap inset inside the curb, a hair proud of the slab top.
  const deck = new THREE.Mesh(new THREE.CircleGeometry(radius - 0.55, 64), deckMat);
  deck.rotation.x = -Math.PI / 2;
  deck.position.y = deckTop + 0.006;
  deck.receiveShadow = true;
  group.add(deck);

  const markY = deckTop + 0.02; // painted markings, each stacked a hair proud to never z-fight
  const decal = (w: number, d: number, mat: THREE.Material): THREE.Mesh => new THREE.Mesh(new THREE.BoxGeometry(w, 0.05, d), mat);
  const stroke = radius * 0.12;

  // Off-white perimeter line just inside the curb — frames the deck.
  const borderR = radius - 0.95;
  const border = new THREE.Mesh(new THREE.RingGeometry(borderR - 0.32, borderR, 72), edge);
  border.rotation.x = -Math.PI / 2;
  border.position.y = markY;
  group.add(border);

  // Bold yellow touchdown circle (the aiming/positioning marking).
  const circle = new THREE.Mesh(new THREE.RingGeometry(radius * 0.5, radius * 0.64, 64), paint);
  circle.rotation.x = -Math.PI / 2;
  circle.position.y = markY + 0.004;
  group.add(circle);

  // Marker "H" centred in the circle: two uprights + a crossbar.
  const barL = radius * 0.58; // upright length (along local X)
  const legGap = radius * 0.3; // half-spacing between uprights (along local Z)
  for (const sgn of [-1, 1]) {
    const leg = decal(barL, stroke, paint);
    leg.position.set(0, markY + 0.008, sgn * legGap);
    group.add(leg);
  }
  const cross = decal(stroke, legGap * 2, paint);
  cross.position.set(0, markY + 0.008, 0);
  group.add(cross);

  // Four short alignment dashes at the cardinal edges — the approach ticks that frame a real pad.
  const dashLen = radius * 0.22;
  const dashR = radius - 1.55;
  for (let k = 0; k < 4; k++) {
    const ang = (k / 4) * Math.PI * 2;
    const dash = decal(dashLen, stroke * 0.9, edge);
    dash.position.set(Math.cos(ang) * dashR, markY, Math.sin(ang) * dashR);
    dash.rotation.y = -ang; // radial: long axis points out along the cardinal
    group.add(dash);
  }

  // Perimeter lights: a ring of small green lamps standing on the curb. Emissive (not point-lights),
  // so they bloom without a shader recompile and stay O(1). A short dark post + a glowing dome each.
  const lampGeo = new THREE.SphereGeometry(0.16, 8, 6);
  const postGeo = new THREE.CylinderGeometry(0.05, 0.06, 0.22, 6);
  const lampR = radius - 0.28;
  const LAMPS = 16;
  for (let k = 0; k < LAMPS; k++) {
    const ang = (k / LAMPS) * Math.PI * 2;
    const lx = Math.cos(ang) * lampR;
    const lz = Math.sin(ang) * lampR;
    const post = new THREE.Mesh(postGeo, curbMat);
    post.position.set(lx, deckTop + 0.11, lz);
    group.add(post);
    const lamp = new THREE.Mesh(lampGeo, lampMat);
    lamp.position.set(lx, deckTop + 0.26, lz);
    group.add(lamp);
  }

  return group;
}
