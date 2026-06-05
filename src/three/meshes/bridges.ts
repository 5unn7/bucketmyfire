import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { BRIDGE } from '../config';
import type { World } from '../World';

/**
 * Procedural truss bridges where a road/town crosses a river — SCENIC features + skill gates. Each
 * `BRIDGE.sites` entry spans the authored river named there at the point nearest its real lat/lon,
 * low over the water. The dare: descend below the deck and thread the helicopter UNDER it. Clip the
 * deck, the truss, or a bank pier and you STRIKE.
 *
 * Three pieces, all procedural (zero assets), all built ONCE at load — no per-frame work, no
 * recompiles (the mobile-60fps invariants):
 *   1. `computeBridgeSites(world)` — resolves WHERE each bridge sits: the nearest river point to the
 *      site's lat/lon, the flow tangent there, and the water surface Y. Skips sites whose river isn't
 *      on the active map (so non-SK maps get none).
 *   2. `createBridge(site)` — the mesh: two triangulated truss planes (merged to ONE steel draw call),
 *      a concrete deck slab + two bank piers (ONE concrete draw call), posed at the site.
 *   3. `BridgeCollider` — pure-number collision: `strike()` (did the airframe hit a solid part?) and
 *      `pass()` (is it cleanly under the deck, and on which side?). No THREE, no scene — like a sim.
 * Dimensions are SHARED across every bridge (the `BRIDGE` config), so the collider + mesh read them.
 */

// --- Placement -----------------------------------------------------------------

/** Where a bridge sits: its label + the river point + flow tangent (unit `a*`) + the local water surface. */
export interface BridgeSite {
  name: string; // labels the clean-pass radio call (e.g. 'Prince Albert')
  x: number;
  z: number;
  surfaceY: number; // river water level here — the bridge's vertical datum (everything is measured up from this)
  ax: number; // unit flow tangent (the axis you thread along, under the deck)
  az: number;
}

/**
 * Resolve every configured bridge site against the world: for each `BRIDGE.sites` entry, project its
 * real lat/lon, find the point on its named river polyline nearest that point, take the segment's
 * direction as the flow tangent, and sample the water surface. Sites whose river isn't on the active
 * map are skipped (empty list off-SK / when disabled).
 */
export function computeBridgeSites(world: World): BridgeSite[] {
  if (!BRIDGE.enabled) return [];
  const out: BridgeSite[] = [];
  for (const spec of BRIDGE.sites) {
    const path = world.namedRiverPath(spec.river);
    if (!path) continue; // that river isn't on this map
    const near = world.projectLatLon(spec.near.lat, spec.near.lon);

    // Nearest point on the polyline to `near` (project it onto each segment, keep the best).
    let best: { x: number; z: number; ax: number; az: number } | null = null;
    let bestD = Infinity;
    for (let i = 0; i < path.length - 1; i++) {
      const a = path[i];
      const b = path[i + 1];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const l2 = dx * dx + dz * dz || 1;
      let t = ((near.x - a.x) * dx + (near.z - a.z) * dz) / l2;
      t = Math.max(0, Math.min(1, t));
      const px = a.x + dx * t;
      const pz = a.z + dz * t;
      const d = (px - near.x) ** 2 + (pz - near.z) ** 2;
      if (d < bestD) {
        bestD = d;
        const l = Math.hypot(dx, dz) || 1;
        best = { x: px, z: pz, ax: dx / l, az: dz / l };
      }
    }
    if (!best) continue;

    // Water surface at the centreline (the carved channel), falling back to the bed/bank if the query
    // lands just off the meandered channel — the deck rides `deckClearance` above whichever it is.
    const wl = world.waterLevelAt(best.x, best.z);
    const surfaceY = wl ?? world.groundHeightAt(best.x, best.z);
    out.push({ name: spec.name, x: best.x, z: best.z, surfaceY, ax: best.ax, az: best.az });
  }
  return out;
}

// --- Collision (pure numbers — no THREE, no scene) -----------------------------

/**
 * Static airframe-vs-bridge collision over one bridge's LOCAL frame: `u` runs along the flow (the
 * tunnel axis you thread), `v` runs across the span (bank to bank), `y` is height above the water.
 * One cheap transform + a few box tests per query — O(1) per bridge, so a handful of bridges is free.
 */
export class BridgeCollider {
  private readonly cx: number;
  private readonly cz: number;
  private readonly ax: number;
  private readonly az: number;
  private readonly surfaceY: number;
  private readonly halfSpan: number;
  private readonly halfRoad: number;
  private readonly deckUnderY: number; // deck underside (local Y) — the tunnel ceiling
  private readonly deckTopY: number;
  private readonly trussTopY: number;
  private readonly pierC: number; // |v| of each pier centre
  private readonly halfPier: number;
  private readonly channelHalf: number; // safe lateral half-width (between the piers)

  constructor(site: BridgeSite) {
    this.cx = site.x;
    this.cz = site.z;
    this.ax = site.ax;
    this.az = site.az;
    this.surfaceY = site.surfaceY;
    this.halfSpan = BRIDGE.span / 2;
    this.halfRoad = BRIDGE.roadway / 2;
    this.deckUnderY = BRIDGE.deckClearance;
    this.deckTopY = BRIDGE.deckClearance + BRIDGE.deckThickness;
    this.trussTopY = this.deckTopY + BRIDGE.trussHeight;
    this.halfPier = BRIDGE.pierWidth / 2;
    this.pierC = this.halfSpan - this.halfPier;
    this.channelHalf = this.halfSpan - BRIDGE.pierWidth;
  }

  /** Project a world point into this bridge's local (u = along-flow, v = across-span, y = above water). */
  private local(px: number, py: number, pz: number): { u: number; v: number; y: number } {
    const dx = px - this.cx;
    const dz = pz - this.cz;
    return {
      u: dx * this.ax + dz * this.az, // along the flow
      v: dx * this.az - dz * this.ax, // across the span
      y: py - this.surfaceY,
    };
  }

  /**
   * Did the airframe (belly at `py`, rotor `heliTopRise` above, disc radius `heliReach`) hit a SOLID
   * part of the bridge? Two volumes: the deck+truss superstructure (everything from the underside up,
   * within the deck footprint), and the two bank piers (full height up to the deck). The clear tunnel
   * is below the underside, above the water, between the piers — passing through there returns false.
   */
  strike(px: number, py: number, pz: number): boolean {
    const { u, v, y } = this.local(px, py, pz);
    const reach = BRIDGE.heliReach;
    const top = y + BRIDGE.heliTopRise;

    // Deck slab + truss superstructure: solid from the underside up through the truss top.
    if (Math.abs(u) <= this.halfRoad + reach && Math.abs(v) <= this.halfSpan + reach) {
      if (top >= this.deckUnderY && y <= this.trussTopY) return true;
    }
    // Bank piers: solid columns from the water up to the deck, one at each span end.
    if (Math.abs(u) <= this.halfRoad + reach && y <= this.deckTopY) {
      if (Math.abs(v - this.pierC) <= this.halfPier + reach) return true;
      if (Math.abs(v + this.pierC) <= this.halfPier + reach) return true;
    }
    return false;
  }

  /**
   * Is the airframe cleanly UNDER the deck (in the central channel, fully below the underside, above
   * the water)? `u` is returned too so the caller can tell which side it entered/exited from — a
   * clean pass-through is an entry on one side and an exit on the other without ever striking.
   */
  pass(px: number, py: number, pz: number): { under: boolean; u: number } {
    const { u, v, y } = this.local(px, py, pz);
    const under =
      Math.abs(v) <= this.channelHalf && // between the piers
      Math.abs(u) <= this.halfRoad && // within the deck depth
      y + BRIDGE.heliTopRise < this.deckUnderY && // rotor disc clears the underside
      y > -4; // above the water, not somehow below the bed
    return { under, u };
  }
}

// --- Mesh ----------------------------------------------------------------------

const _UP = new THREE.Vector3(0, 1, 0);
const _ONE = new THREE.Vector3(1, 1, 1);

/** Push a square-section beam (cross-section `t`×`t`) running from A to B into `out`. */
function pushBeam(
  out: THREE.BufferGeometry[],
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  t: number,
): void {
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-4) return;
  const g = new THREE.BoxGeometry(t, len, t); // modelled along local +Y, then rotated onto the A→B axis
  const dir = new THREE.Vector3(dx, dy, dz).multiplyScalar(1 / len);
  const q = new THREE.Quaternion().setFromUnitVectors(_UP, dir);
  const m = new THREE.Matrix4().compose(new THREE.Vector3((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2), q, _ONE);
  g.applyMatrix4(m);
  out.push(g);
}

/** One vertical truss plane (chords + end posts + a Warren zigzag of `trussBays` triangles) at z = `zside`. */
function buildTrussPlane(steel: THREE.BufferGeometry[], zside: number, deckTopY: number, trussTopY: number): void {
  const halfSpan = BRIDGE.span / 2;
  const bayW = BRIDGE.span / BRIDGE.trussBays;
  const t = BRIDGE.trussBeam;
  // Bottom + top chords (full length) and the two end posts that close the plane.
  pushBeam(steel, -halfSpan, deckTopY, zside, halfSpan, deckTopY, zside, t);
  pushBeam(steel, -halfSpan, trussTopY, zside, halfSpan, trussTopY, zside, t);
  pushBeam(steel, -halfSpan, deckTopY, zside, -halfSpan, trussTopY, zside, t);
  pushBeam(steel, halfSpan, deckTopY, zside, halfSpan, trussTopY, zside, t);
  // Zigzag diagonals B_i → T_i → B_{i+1}: each pair frames one triangle (the "5–6 triangle" look).
  for (let i = 0; i < BRIDGE.trussBays; i++) {
    const b0 = -halfSpan + i * bayW;
    const b1 = -halfSpan + (i + 1) * bayW;
    const tm = -halfSpan + (i + 0.5) * bayW;
    pushBeam(steel, b0, deckTopY, zside, tm, trussTopY, zside, t);
    pushBeam(steel, tm, trussTopY, zside, b1, deckTopY, zside, t);
  }
}

export interface Bridge {
  group: THREE.Group;
  collider: BridgeCollider;
  name: string; // the site label (for the clean-pass radio call / QA)
  /** A flyable approach point upstream of the bridge (QA convenience: teleport here to find it). */
  fly: { x: number; y: number; z: number };
}

/**
 * Build one bridge mesh at a resolved site. Two merged meshes (steel truss, concrete deck+piers) +
 * a collider. Geometry is generated once here; `Game` adds `group` to the scene and never rebuilds.
 */
export function createBridge(site: BridgeSite): Bridge {
  const group = new THREE.Group();
  group.name = `bridge:${site.name}`;

  const halfSpan = BRIDGE.span / 2;
  const halfRoad = BRIDGE.roadway / 2;
  const deckTopY = BRIDGE.deckClearance + BRIDGE.deckThickness;
  const trussTopY = deckTopY + BRIDGE.trussHeight;

  // --- Steel superstructure: two truss planes (one each side of the roadway) + a few top braces ---
  const steel: THREE.BufferGeometry[] = [];
  buildTrussPlane(steel, halfRoad, deckTopY, trussTopY);
  buildTrussPlane(steel, -halfRoad, deckTopY, trussTopY);
  // Transverse top bracing at each top node so the two planes read as one 3D structure, not two ribbons.
  const bayW = BRIDGE.span / BRIDGE.trussBays;
  for (let i = 0; i <= BRIDGE.trussBays; i++) {
    const x = -halfSpan + i * bayW;
    pushBeam(steel, x, trussTopY, halfRoad, x, trussTopY, -halfRoad, BRIDGE.trussBeam * 0.85);
  }

  const steelMat = new THREE.MeshStandardMaterial({ color: 0x5d6b6e, metalness: 0.55, roughness: 0.6 });
  const steelGeo = mergeGeometries(steel);
  steel.forEach((g) => g.dispose());
  const steelMesh = new THREE.Mesh(steelGeo, steelMat);
  steelMesh.castShadow = true;
  group.add(steelMesh);

  // --- Concrete deck slab + two bank piers (merged into one mesh) ---
  const concrete: THREE.BufferGeometry[] = [];
  const deck = new THREE.BoxGeometry(BRIDGE.span, BRIDGE.deckThickness, BRIDGE.roadway);
  deck.translate(0, BRIDGE.deckClearance + BRIDGE.deckThickness / 2, 0);
  concrete.push(deck);
  const pierBottom = -8; // founded a little below the surface so the piers read as planted, not floating
  const pierH = BRIDGE.deckClearance - pierBottom;
  const pierC = halfSpan - BRIDGE.pierWidth / 2;
  for (const sx of [pierC, -pierC]) {
    const pier = new THREE.BoxGeometry(BRIDGE.pierWidth, pierH, BRIDGE.roadway * 1.1);
    pier.translate(sx, pierBottom + pierH / 2, 0);
    concrete.push(pier);
  }
  const concreteMat = new THREE.MeshStandardMaterial({ color: 0x8c857a, metalness: 0, roughness: 0.92 });
  const concreteGeo = mergeGeometries(concrete);
  concrete.forEach((g) => g.dispose());
  const concreteMesh = new THREE.Mesh(concreteGeo, concreteMat);
  concreteMesh.castShadow = true;
  concreteMesh.receiveShadow = true;
  group.add(concreteMesh);

  // Pose the whole structure at the site: local +X → across the span, local +Z → along the flow.
  group.position.set(site.x, site.surfaceY, site.z);
  group.rotation.y = Math.atan2(site.ax, site.az);

  const fly = {
    x: site.x - site.ax * 70,
    y: site.surfaceY + BRIDGE.deckClearance * 0.45,
    z: site.z - site.az * 70,
  };

  return { group, collider: new BridgeCollider(site), name: site.name, fly };
}
