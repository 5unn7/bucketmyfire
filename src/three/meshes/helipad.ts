import * as THREE from 'three';
import { FLIGHT, HELIPAD } from '../config';
import { loadPBR } from './pbrTextures';

/**
 * A procedural concrete helipad for the bases — the deck the helicopter cold-starts on and sets
 * down to refuel/re-rig. A chamfered concrete slab with a raised curb, painted hi-vis markings
 * (perimeter line, touchdown circle, "H", cardinal approach ticks), a flared apron that eases the
 * pad into the terrain, and a ring of emissive green perimeter lights that bloom at the dawn/dusk/
 * overcast missions so the pad reads as operational from the air.
 *
 * The slab + deck cap wear a downloaded CC0 concrete PBR set (HELIPAD.concrete — albedo/normal/
 * roughness, see public/textures/ATTRIBUTION.txt) so the surface reads as poured concrete, not flat
 * plastic; it falls back to the bare base colour if the texture is missing. Markings/lamps stay
 * procedural.
 *
 * Built in LOCAL space with the slab BOTTOM at y = 0 and its TOP at y = `FLIGHT.landClearance`, so
 * `Game` drops the group at `(x, groundHeightAt(x,z), z)` and the deck surface lands exactly at the
 * landing floor the flight model rests the skids on around the pad (no float, no snap on take-off).
 * Markings stack a hair proud of the deck so they never z-fight. All built once at load — no
 * per-frame cost, no lights (the green dots are emissive meshes, not point-lights → no recompiles).
 *
 * MATERIALS ARE SHARED SINGLETONS (one set for every pad, built lazily on first use) flagged
 * `userData.shared` so `Game.dispose()` skips them across the in-place mission switch — their
 * cached concrete textures ride along untouched. Only the per-pad GEOMETRY is rebuilt per mission.
 */

interface PadMaterials {
  base: THREE.MeshStandardMaterial;
  deck: THREE.MeshStandardMaterial;
  curb: THREE.MeshStandardMaterial;
  paint: THREE.MeshStandardMaterial;
  edge: THREE.MeshStandardMaterial;
  lamp: THREE.MeshStandardMaterial;
}

let MATS: PadMaterials | null = null;

/** Build the shared material set once. Concrete albedo/normal/roughness is tiled onto the slab base
 *  + deck cap; the curb/paint/lamp stay procedural. All flagged shared so dispose() leaves them be. */
function padMaterials(): PadMaterials {
  if (MATS) return MATS;

  // Concrete in two tones — a darker poured base + a lighter inset deck cap — so the pad reads as a
  // real slab with a rim. The PBR map carries the surface detail; the colour just tints it cool/warm.
  const base = new THREE.MeshStandardMaterial({ color: 0xb0b4b8, roughness: 1, metalness: 0.02 });
  const deck = new THREE.MeshStandardMaterial({ color: 0xc6cace, roughness: 1, metalness: 0.03 });
  // Curb stays a near-black weathered edge; paint a faintly self-lit hi-vis yellow so markings carry
  // at night/overcast; the perimeter line + ticks a worn off-white; the lamp glows aviation green.
  const curb = new THREE.MeshStandardMaterial({ color: 0x26282d, roughness: 0.95, metalness: 0.06 });
  const paint = new THREE.MeshStandardMaterial({ color: 0xe8c23a, roughness: 0.6, metalness: 0, emissive: 0x6a5300, emissiveIntensity: 0.3 });
  const edge = new THREE.MeshStandardMaterial({ color: 0xd9d2c2, roughness: 0.7, metalness: 0 });
  const lamp = new THREE.MeshStandardMaterial({ color: 0x0c1f15, emissive: 0x2be07a, emissiveIntensity: 1.9, roughness: 0.4, metalness: 0 });

  if (HELIPAD.textured) {
    const pbr = loadPBR(HELIPAD.concrete, HELIPAD.concreteRepeat, 8);
    for (const m of [base, deck]) {
      m.map = pbr.map;
      m.normalMap = pbr.normalMap;
      m.roughnessMap = pbr.roughnessMap; // map is authoritative; scalar roughness=1 just passes it through
      m.normalScale.set(HELIPAD.normalScale, HELIPAD.normalScale);
      m.needsUpdate = true;
    }
  }

  MATS = { base, deck, curb, paint, edge, lamp };
  for (const m of Object.values(MATS)) m.userData.shared = true; // survive Game.dispose() across switches
  return MATS;
}

export function createHelipad(radius = 7): THREE.Group {
  const group = new THREE.Group();
  group.name = 'helipad';
  const m = padMaterials();

  const deckTop = FLIGHT.landClearance; // local Y of the pad surface (skids rest here)
  const padH = deckTop; // slab height: bottom on the ground (y=0), top at the landing floor

  // Flared apron: a short concrete skirt that fans out from the slab base into the dirt, easing the
  // pad into the terrain so it reads as poured-in-place, not a chip dropped on the ground. Sunk a
  // touch below y=0 so its lower lip buries into the (uneven) terrain rather than hovering.
  const apron = new THREE.Mesh(new THREE.CylinderGeometry(radius + 0.25, radius + 1.7, padH * 0.9, 64, 1, true), m.base);
  apron.position.y = padH * 0.45 - 0.15;
  apron.receiveShadow = true;
  group.add(apron);

  // Slab: a smooth 64-seg cylinder, the top face drawn in tighter than the base for a bevelled lip.
  const slab = new THREE.Mesh(new THREE.CylinderGeometry(radius - 0.35, radius + 0.25, padH, 64), m.base);
  slab.position.y = padH / 2;
  slab.receiveShadow = true;
  slab.castShadow = false;
  group.add(slab);

  // Raised curb: a thin torus ringing the rim, so the deck has a real lip from the side and the eye
  // reads a contained pad rather than paint on the dirt.
  const curb = new THREE.Mesh(new THREE.TorusGeometry(radius - 0.28, 0.14, 10, 96), m.curb);
  curb.rotation.x = -Math.PI / 2;
  curb.position.y = deckTop;
  group.add(curb);

  // Lighter poured-deck cap inset inside the curb, a hair proud of the slab top.
  const deck = new THREE.Mesh(new THREE.CircleGeometry(radius - 0.55, 96), m.deck);
  deck.rotation.x = -Math.PI / 2;
  deck.position.y = deckTop + 0.006;
  deck.receiveShadow = true;
  group.add(deck);

  const markY = deckTop + 0.02; // painted markings, each stacked a hair proud to never z-fight
  const decal = (w: number, d: number, mat: THREE.Material): THREE.Mesh => new THREE.Mesh(new THREE.BoxGeometry(w, 0.05, d), mat);
  const stroke = radius * 0.12;

  // Off-white perimeter line just inside the curb — frames the deck.
  const borderR = radius - 0.95;
  const border = new THREE.Mesh(new THREE.RingGeometry(borderR - 0.32, borderR, 96), m.edge);
  border.rotation.x = -Math.PI / 2;
  border.position.y = markY;
  group.add(border);

  // Bold yellow touchdown circle (the aiming/positioning marking).
  const circle = new THREE.Mesh(new THREE.RingGeometry(radius * 0.5, radius * 0.64, 80), m.paint);
  circle.rotation.x = -Math.PI / 2;
  circle.position.y = markY + 0.004;
  group.add(circle);

  // Marker "H" centred in the circle: two uprights + a crossbar.
  const barL = radius * 0.58; // upright length (along local X)
  const legGap = radius * 0.3; // half-spacing between uprights (along local Z)
  for (const sgn of [-1, 1]) {
    const leg = decal(barL, stroke, m.paint);
    leg.position.set(0, markY + 0.008, sgn * legGap);
    group.add(leg);
  }
  const cross = decal(stroke, legGap * 2, m.paint);
  cross.position.set(0, markY + 0.008, 0);
  group.add(cross);

  // Four short alignment dashes at the cardinal edges — the approach ticks that frame a real pad.
  const dashLen = radius * 0.22;
  const dashR = radius - 1.55;
  for (let k = 0; k < 4; k++) {
    const ang = (k / 4) * Math.PI * 2;
    const dash = decal(dashLen, stroke * 0.9, m.edge);
    dash.position.set(Math.cos(ang) * dashR, markY, Math.sin(ang) * dashR);
    dash.rotation.y = -ang; // radial: long axis points out along the cardinal
    group.add(dash);
  }

  // Perimeter lights: a ring of small green lamps standing on the curb. Emissive (not point-lights),
  // so they bloom without a shader recompile and stay O(1). A short dark post + a glowing dome each.
  const lampGeo = new THREE.SphereGeometry(0.16, 10, 8);
  const postGeo = new THREE.CylinderGeometry(0.05, 0.06, 0.22, 8);
  const lampR = radius - 0.28;
  const LAMPS = 16;
  for (let k = 0; k < LAMPS; k++) {
    const ang = (k / LAMPS) * Math.PI * 2;
    const lx = Math.cos(ang) * lampR;
    const lz = Math.sin(ang) * lampR;
    const post = new THREE.Mesh(postGeo, m.curb);
    post.position.set(lx, deckTop + 0.11, lz);
    group.add(post);
    const lamp = new THREE.Mesh(lampGeo, m.lamp);
    lamp.position.set(lx, deckTop + 0.26, lz);
    group.add(lamp);
  }

  return group;
}
