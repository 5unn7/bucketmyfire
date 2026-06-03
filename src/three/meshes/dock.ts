import * as THREE from 'three';

/**
 * A procedural lakeside jetty for the base depot (Track A5 polish) — a timber deck on posts
 * reaching out over the water, so the waterfront base reads as a real floatplane/boat dock
 * instead of a building that merely happens to sit near a lake. Zero binary assets: a few
 * boxes (deck + rails) and cylinders (pilings + a couple of fuel barrels).
 *
 * Built in LOCAL space with the SHORE end at the origin and the deck running along local +X
 * out over the water (deck top at y=0). `Game` positions the group at the shoreline and yaws
 * it so +X points at the lake, setting `group.position.y` to the lake's water surface.
 */
export function createDock(length = 16): THREE.Group {
  const L = length;
  const group = new THREE.Group();
  group.name = 'dock';

  const plank = new THREE.MeshStandardMaterial({ color: 0x6b5337, roughness: 0.95, metalness: 0 });
  const post = new THREE.MeshStandardMaterial({ color: 0x4a3a25, roughness: 1, metalness: 0 });

  const deckW = 3.2;
  const deckT = 0.28;
  // Deck slab: top sits at y=0, spanning x∈[0, L].
  const deck = new THREE.Mesh(new THREE.BoxGeometry(L, deckT, deckW), plank);
  deck.position.set(L / 2, -deckT / 2, 0);
  deck.castShadow = true;
  deck.receiveShadow = true;
  group.add(deck);

  // Low side rails so the edge reads from altitude.
  for (const sgn of [-1, 1]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(L, 0.5, 0.18), plank);
    rail.position.set(L / 2, 0.25, sgn * (deckW / 2 - 0.1));
    rail.castShadow = true;
    group.add(rail);
  }

  // Pilings: pairs of posts at a few stations, dropping from the deck underside into the water.
  const stations = Math.max(3, Math.round(L / 4));
  const pileH = 6; // long enough to disappear into the lakebed near shore
  for (let i = 0; i < stations; i++) {
    const px = (L * (i + 0.5)) / stations;
    for (const sgn of [-1, 1]) {
      const pile = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, pileH, 8), post);
      pile.position.set(px, -deckT - pileH / 2 + 0.2, sgn * (deckW / 2 - 0.35));
      pile.castShadow = true;
      group.add(pile);
    }
  }

  // A couple of fuel barrels parked near the shore end for flavour.
  const barrelMat = new THREE.MeshStandardMaterial({ color: 0x3a5a3a, roughness: 0.7, metalness: 0.2 });
  for (let i = 0; i < 2; i++) {
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 1.1, 12), barrelMat);
    b.position.set(2.0 + i * 0.1, 0.55, (i === 0 ? -1 : 1) * 0.8);
    b.castShadow = true;
    group.add(b);
  }

  return group;
}
