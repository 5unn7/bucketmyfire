import * as THREE from 'three';
import { DROP_FX } from '../config';

/**
 * Predicted water-impact ring (concern 1 — "how do I know I'm hitting the spot?"). A single
 * Game-owned `THREE.Mesh` (a flat annulus) added to the scene ONCE and mutated per frame — no
 * per-frame allocation, no shader recompile (it follows the `WaterSpray` discipline). Game positions
 * it at the SAME drifted impact center + footprint radius the douse uses (via `resolveDrop`), so the
 * ring literally previews where the water will land — accounting for the bucket's height and the wind
 * drift — and recolors green / amber / red for "this bites" / "too high" / "you'll miss".
 *
 * Engine-touching (owns a Mesh), so it lives outside `sim/`. `show()` while carrying water low,
 * `hide()` otherwise.
 */
export class DropMarker {
  private readonly mesh: THREE.Mesh;
  private readonly mat: THREE.MeshBasicMaterial;

  constructor(scene: THREE.Scene) {
    // Unit-radius annulus in the XY plane (inner 0.84 → a ~16%-of-radius rim). Laid flat (rot -90° X)
    // so it sits on the ground; scaled to the footprint radius each frame.
    const geom = new THREE.RingGeometry(0.84, 1, 48);
    this.mat = new THREE.MeshBasicMaterial({
      color: DROP_FX.markerColorInBand,
      transparent: true,
      opacity: 0,
      depthWrite: false, // a ground decal — don't occlude
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(geom, this.mat);
    this.mesh.rotation.x = -Math.PI / 2; // lie flat in the world XZ plane
    this.mesh.visible = false;
    this.mesh.frustumCulled = false; // tiny; skip the cull test
    this.mesh.renderOrder = 2; // draw over the terrain
    scene.add(this.mesh);
  }

  /** Place + size + tint the ring at a predicted impact (world XZ, footprint radius, ground height). */
  show(cx: number, cz: number, radius: number, color: number, opacity: number, groundY: number): void {
    this.mesh.position.set(cx, groundY + DROP_FX.markerLift, cz);
    this.mesh.scale.set(radius, radius, 1);
    this.mat.color.setHex(color);
    this.mat.opacity = opacity;
    this.mesh.visible = true;
  }

  hide(): void {
    this.mesh.visible = false;
  }
}
