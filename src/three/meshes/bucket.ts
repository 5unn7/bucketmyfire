import * as THREE from 'three';

/**
 * Procedural Bambi bucket for the 3D world — modeled to read as the real thing:
 * a tall safety-orange collapsible pail with a reinforced rim, hooped reinforcing
 * band, a set of suspension straps that fan UP from the rim to a single swivel
 * head (where the longline attaches), and a dump valve at the base.
 *
 * The rope/longline is NOT drawn here: the caller owns both endpoints (heli anchor
 * + the bucket's swivel head) and renders the rope separately. The straps converge
 * at local `topAnchorY` above the body, so the caller attaches the rope THERE — it
 * lands on the swivel, not the bucket's belly. Water drops emit from the bucket's
 * world position, not the heli's. Fly smooth to bomb true.
 *
 * Built from raw Three.js geometry — zero binary assets. The body is centered on
 * its own local origin (mouth faces +Y); the swivel + straps sit above it.
 *
 * `setFill(t)` (0..1) drives the internal blue water level and squashes the body a
 * hair when full so a heavy load reads heavier on the line.
 */

export interface BucketMesh {
  group: THREE.Group; // bucket body + straps + swivel, centered on its own local origin
  topAnchorY: number; // local Y of the swivel head — attach the longline here, not the body
  setFill(t: number): void; // 0..1 — internal water level (+ a touch heavier look when full)
}

// --- Dimensions (world units). The heli is ~8 units long; the bucket is small. ---
const HEIGHT = 2.4; // body height, centered on origin → spans y ∈ [-1.2, +1.2]
const TOP_RADIUS = 0.95; // open mouth at the top (+Y)
const BOTTOM_RADIUS = 0.82; // base (−Y) — only slightly narrower (Bambi pails are near-cylindrical)
const RADIAL_SEGMENTS = 14; // low-poly faceted look, mobile-friendly
const WALL_INSET = 0.1; // how far the water surface sits inside the rim, radius-wise
const STRAP_COUNT = 4; // suspension straps fanning rim → swivel
const CABLE_RISE = 1.5; // how far above the rim the straps converge
const TOP_ANCHOR_Y = HEIGHT / 2 + CABLE_RISE; // swivel-head Y (longline attaches here)

export function createBucket(): BucketMesh {
  const group = new THREE.Group();
  group.name = 'bucket';

  const orange = new THREE.MeshStandardMaterial({
    color: 0xe85a1a, // safety-orange canvas — the iconic Bambi look
    roughness: 0.8,
    metalness: 0.0,
    side: THREE.DoubleSide, // open mouth → we see the inner wall too
  });
  const dark = new THREE.MeshStandardMaterial({
    color: 0x2b2b2f, // straps, rim, swivel, valve — charcoal webbing/hardware
    roughness: 0.6,
    metalness: 0.1,
  });

  // Body: a near-cylindrical truncated cone, open-topped so the mouth reads as a
  // pail. Centered on local origin.
  const bodyGeo = new THREE.CylinderGeometry(
    TOP_RADIUS,
    BOTTOM_RADIUS,
    HEIGHT,
    RADIAL_SEGMENTS,
    1,
    true, // openEnded — no caps; it's an open bucket
  );
  const body = new THREE.Mesh(bodyGeo, orange);
  body.castShadow = true;
  group.add(body);

  // Closed base disc so the pail isn't a bottomless tube and water has a floor.
  const baseGeo = new THREE.CircleGeometry(BOTTOM_RADIUS, RADIAL_SEGMENTS);
  baseGeo.rotateX(Math.PI / 2); // face the disc downward, flat in XZ
  const base = new THREE.Mesh(baseGeo, orange);
  base.position.y = -HEIGHT / 2;
  base.castShadow = true;
  group.add(base);

  // Reinforced rim at the mouth + a mid-body hoop band — the dark webbing detail
  // that reads as a real Bambi bucket.
  const rimGeo = new THREE.TorusGeometry(TOP_RADIUS, 0.08, 6, RADIAL_SEGMENTS);
  rimGeo.rotateX(Math.PI / 2);
  const rim = new THREE.Mesh(rimGeo, dark);
  rim.position.y = HEIGHT / 2;
  rim.castShadow = true;
  group.add(rim);

  const bandGeo = new THREE.TorusGeometry((TOP_RADIUS + BOTTOM_RADIUS) / 2, 0.05, 6, RADIAL_SEGMENTS);
  bandGeo.rotateX(Math.PI / 2);
  const band = new THREE.Mesh(bandGeo, dark);
  band.position.y = -HEIGHT * 0.1;
  group.add(band);

  // Suspension straps: thin members fanning UP from evenly-spaced rim points to a
  // single convergence (the swivel head). This is the part that makes it read as a
  // slung bucket rather than a flowerpot.
  const swivelTop = new THREE.Vector3(0, TOP_ANCHOR_Y, 0);
  for (let i = 0; i < STRAP_COUNT; i++) {
    const a = (i / STRAP_COUNT) * Math.PI * 2;
    const foot = new THREE.Vector3(Math.cos(a) * TOP_RADIUS, HEIGHT / 2, Math.sin(a) * TOP_RADIUS);
    group.add(strap(foot, swivelTop, dark));
  }

  // Swivel head where the four straps meet and the longline clips on.
  const swivel = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.12, 0.34, 8), dark);
  swivel.position.copy(swivelTop);
  swivel.castShadow = true;
  group.add(swivel);

  // Dump valve: a short stub at the base center (where a real bucket releases).
  const valve = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 0.3, 10), dark);
  valve.position.y = -HEIGHT / 2 - 0.12;
  valve.castShadow = true;
  group.add(valve);

  // Water: a thin blue column inset from the inner wall. setFill() moves it up and
  // scales its depth with fill; hidden when empty. Starts at the base, empty.
  const waterGeo = new THREE.CylinderGeometry(
    TOP_RADIUS - WALL_INSET,
    BOTTOM_RADIUS - WALL_INSET,
    1, // unit height — setFill scales this on Y to the desired water depth
    RADIAL_SEGMENTS,
  );
  const waterMat = new THREE.MeshStandardMaterial({
    color: 0x2f7d96, // lake-blue water
    roughness: 0.25,
    metalness: 0.0,
    transparent: true,
    opacity: 0.9,
  });
  const water = new THREE.Mesh(waterGeo, waterMat);
  water.visible = false; // empty bucket shows no water
  group.add(water);

  // Inner usable depth for water: from just above the base to just below the rim.
  const FLOOR = -HEIGHT / 2 + 0.06; // sit slightly off the base so it doesn't z-fight
  const CEILING = HEIGHT / 2 - 0.1; // stop just shy of the rim at full
  const MAX_DEPTH = CEILING - FLOOR;

  function setFill(t: number): void {
    const fill = THREE.MathUtils.clamp(t, 0, 1);

    if (fill <= 0.02) {
      water.visible = false;
    } else {
      water.visible = true;
      // Water column rises with fill: scale the unit-height mesh to the depth,
      // then center it so its bottom sits on the floor and its top tracks upward.
      const depth = MAX_DEPTH * fill;
      water.scale.y = depth;
      water.position.y = FLOOR + depth / 2;
    }

    // Heavy read: a full bucket squashes a hair vertically. Subtle — up to ~5%.
    // Only the body squashes; straps/swivel/valve keep the rope attach point fixed.
    body.scale.y = 1 - 0.05 * fill;
  }

  // Start empty.
  setFill(0);

  return { group, topAnchorY: TOP_ANCHOR_Y, setFill };
}

/** A thin strap (capsule-ish cylinder) spanning two points, oriented along them. */
function strap(from: THREE.Vector3, to: THREE.Vector3, mat: THREE.Material): THREE.Mesh {
  const dir = new THREE.Vector3().subVectors(to, from);
  const len = dir.length();
  const geo = new THREE.CylinderGeometry(0.04, 0.04, len, 5);
  const mesh = new THREE.Mesh(geo, mat);
  // Cylinder is built along +Y; rotate it onto `dir`, then sit it at the midpoint.
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
  mesh.position.copy(from).addScaledVector(dir, 0.5);
  mesh.castShadow = true;
  return mesh;
}
