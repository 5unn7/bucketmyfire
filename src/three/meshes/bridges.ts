import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { BRIDGE } from '../config';

/**
 * Procedural truss bridges where a road/town crosses a river — SCENIC features + skill gates. Each
 * `BRIDGE.sites` entry spans the authored river named there at the point nearest its real lat/lon,
 * low over the water. The dare: descend below the deck and thread the helicopter UNDER it. Clip the
 * deck, the truss, or a bank pier and you STRIKE.
 *
 * Three pieces, all procedural (zero assets), all built ONCE at load — no per-frame work, no
 * recompiles (the mobile-60fps invariants):
 *   1. WHERE each bridge sits is resolved by `World.resolveBridgeSites` (the dry-bank crossing search) and
 *      read back via `world.bridgeSites()`; both Game and the editor build their meshes from that one list.
 *   2. `createBridge(site)` — the mesh: two triangulated truss planes (merged to ONE steel draw call),
 *      a concrete deck slab + two bank piers (ONE concrete draw call), posed at the site.
 *   3. `BridgeCollider` — pure-number collision: `strike()` (did the airframe hit a solid part?) and
 *      `pass()` (is it cleanly under the deck, and on which side?). No THREE, no scene — like a sim.
 * Dimensions are SHARED across every bridge (the `BRIDGE` config), so the collider + mesh read them.
 */

// --- Placement -----------------------------------------------------------------

/** Where a bridge sits: its label + the river point + flow tangent (unit `a*`) + the local water surface.
 *  Produced by `World.resolveBridgeSites` and consumed by `createBridge` / `BridgeCollider`. */
export interface BridgeSite {
  name: string; // labels the clean-pass radio call (e.g. 'Prince Albert')
  x: number;
  z: number;
  surfaceY: number; // river water level here — the bridge's vertical datum (everything is measured up from this)
  ax: number; // unit flow tangent (the axis you thread along, under the deck)
  az: number;
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
    this.trussTopY = this.deckTopY + BRIDGE.trussHeight + BRIDGE.trussPeakRise; // covers the camelback peak — a conservative ceiling for the solid superstructure
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

/**
 * Top-chord height (LOCAL Y) at panel node `i` — a polygonal camelback peaking at midspan (a Parker
 * truss). The bearings (i = 0 / i = N) sit at deck level; the inclined end posts rise to the first
 * interior node, and the chord arches up to `trussHeight + trussPeakRise` over the channel centre.
 */
function trussTopChordY(i: number, deckTopY: number): number {
  const N = BRIDGE.trussBays;
  if (i <= 0 || i >= N) return deckTopY;
  const f = Math.sin((Math.PI * i) / N); // 0 at the ends → 1 at the centre
  return deckTopY + BRIDGE.trussHeight + BRIDGE.trussPeakRise * f;
}

/**
 * One vertical truss plane at z = `zside`: a flat bottom chord at deck level, a POLYGONAL (camelback)
 * top chord, inclined end posts at the bearings, a vertical at every interior panel point, and
 * interior diagonals that lean UP toward midspan — i.e. a Parker/Pratt through-truss, the rusted-
 * railway-bridge look (verticals + center-leaning diagonals), not a plain Warren zigzag.
 */
function buildTrussPlane(steel: THREE.BufferGeometry[], zside: number, deckTopY: number): void {
  const halfSpan = BRIDGE.span / 2;
  const N = BRIDGE.trussBays;
  const bayW = BRIDGE.span / N;
  const t = BRIDGE.trussBeam;
  const x = (i: number) => -halfSpan + i * bayW;
  const ty = (i: number) => trussTopChordY(i, deckTopY);

  // Bottom chord (flat, full length) — the deck-level chord you fly under.
  pushBeam(steel, x(0), deckTopY, zside, x(N), deckTopY, zside, t);
  // Inclined end posts: each bearing up to the first/last interior top node.
  pushBeam(steel, x(0), deckTopY, zside, x(1), ty(1), zside, t);
  pushBeam(steel, x(N), deckTopY, zside, x(N - 1), ty(N - 1), zside, t);
  // Polygonal top chord across the interior nodes (the camelback).
  for (let i = 1; i < N - 1; i++) {
    pushBeam(steel, x(i), ty(i), zside, x(i + 1), ty(i + 1), zside, t);
  }
  // Vertical at every interior panel point (the Pratt hangers).
  for (let i = 1; i < N; i++) {
    pushBeam(steel, x(i), deckTopY, zside, x(i), ty(i), zside, t * 0.9);
  }
  // Interior diagonals, each leaning UP toward midspan (bottom-outer → top-inner).
  const centre = N / 2;
  for (let p = 1; p <= N - 2; p++) {
    if (p + 0.5 < centre) {
      pushBeam(steel, x(p), deckTopY, zside, x(p + 1), ty(p + 1), zside, t * 0.85);
    } else {
      pushBeam(steel, x(p + 1), deckTopY, zside, x(p), ty(p), zside, t * 0.85);
    }
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

  // --- Steel superstructure: two Parker/Pratt truss planes + overhead bracing (a through-truss) ---
  const steel: THREE.BufferGeometry[] = [];
  buildTrussPlane(steel, halfRoad, deckTopY);
  buildTrussPlane(steel, -halfRoad, deckTopY);
  // Overhead bracing ties the two planes into one 3D box (so it reads as a tunnel you fly under, not
  // two flat ribbons): a transverse strut at each top node + an X sway-brace across each top panel.
  const N = BRIDGE.trussBays;
  const bayW = BRIDGE.span / N;
  const nodeX = (i: number) => -halfSpan + i * bayW;
  for (let i = 1; i < N; i++) {
    const ty = trussTopChordY(i, deckTopY);
    pushBeam(steel, nodeX(i), ty, halfRoad, nodeX(i), ty, -halfRoad, BRIDGE.trussBeam * 0.7);
  }
  for (let i = 1; i < N - 1; i++) {
    const y0 = trussTopChordY(i, deckTopY);
    const y1 = trussTopChordY(i + 1, deckTopY);
    pushBeam(steel, nodeX(i), y0, halfRoad, nodeX(i + 1), y1, -halfRoad, BRIDGE.trussBeam * 0.5);
    pushBeam(steel, nodeX(i), y0, -halfRoad, nodeX(i + 1), y1, halfRoad, BRIDGE.trussBeam * 0.5);
  }

  const steelMat = new THREE.MeshStandardMaterial({
    color: BRIDGE.steelColor,
    metalness: BRIDGE.steelMetalness,
    roughness: BRIDGE.steelRoughness,
  });
  const steelGeo = mergeGeometries(steel);
  steel.forEach((g) => g.dispose());
  // Defense-in-depth: mergeGeometries returns null on mismatched attributes; reading `.attributes`
  // or `new Mesh(null)` then throws — the same class as the settlement freeze. Skip the sub-mesh
  // rather than crash the whole bridge build.
  if (steelGeo) {
    // Bake a vertical weathering tint: rust-streaked + darker near the deck, cleaner steel up at the
    // crown. One-time, multiplies the base rust colour — no texture, no shader recompile.
    if (BRIDGE.weathering) {
      const pos = steelGeo.attributes.position;
      const rise = BRIDGE.trussHeight + BRIDGE.trussPeakRise || 1;
      const col = new Float32Array(pos.count * 3);
      for (let i = 0; i < pos.count; i++) {
        const f = Math.min(1, Math.max(0, (pos.getY(i) - deckTopY) / rise));
        const v = 0.62 + 0.4 * f; // brightness: dark/rusty low → near-full at the crown
        col[i * 3] = v;
        col[i * 3 + 1] = v * 0.93; // warm (rust) bias
        col[i * 3 + 2] = v * 0.84;
      }
      steelGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      steelMat.vertexColors = true;
    }
    const steelMesh = new THREE.Mesh(steelGeo, steelMat);
    steelMesh.castShadow = true;
    group.add(steelMesh);
  }

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
  if (concreteGeo) {
    const concreteMesh = new THREE.Mesh(concreteGeo, concreteMat);
    concreteMesh.castShadow = true;
    concreteMesh.receiveShadow = true;
    group.add(concreteMesh);
  }

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
