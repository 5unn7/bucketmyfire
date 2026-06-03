import * as THREE from 'three';
import { FIRE3D, FIREHEAD } from '../config';

/**
 * Fire-HEAD chevrons — the "where do I drop?" read. Wildfire suppression is about hitting the HEAD
 * (the hot, downwind-advancing front), not the flanks or the burned-out heel. This is a FIXED pool of
 * flat ground arrowheads (one per possible rendered fire, `FIRE3D.maxActive`) that Game positions on
 * each fire's leading edge, ROTATED to point the way the fire is running, scaled by its size class, and
 * faded by how hot it is relative to the strongest head — so the priority drop zone pops at a glance.
 *
 * One shared geometry; per-slot `MeshBasicMaterial` for independent opacity. Built once, mutated per
 * frame — zero per-frame allocation, no shader recompile (honours the mobile-60fps invariants). The
 * hot amber colour is deliberately distinct from the green predicted-impact ring (`DropMarker`).
 */
export class FireHeadMarkers {
  private readonly meshes: THREE.Mesh[] = [];
  private readonly mats: THREE.MeshBasicMaterial[] = [];

  constructor(scene: THREE.Scene) {
    const geom = chevronGeom();
    for (let i = 0; i < FIRE3D.maxActive; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: FIREHEAD.color,
        transparent: true,
        opacity: 0,
        depthWrite: false, // a ground decal — don't occlude
        side: THREE.DoubleSide,
      });
      const m = new THREE.Mesh(geom, mat);
      m.visible = false;
      m.frustumCulled = false; // tiny + moved each frame; skip the cull test
      m.renderOrder = 3; // draw over the terrain (and the green drop ring)
      scene.add(m);
      this.meshes.push(m);
      this.mats.push(mat);
    }
  }

  /**
   * Place head chevron `i` at world (x,z) on the ground, pointing along the unit downwind vector
   * (wx,wz), sized by the fire's size class, at `opacity`. Slots are filled compactly (0..shown-1).
   */
  show(i: number, x: number, z: number, groundY: number, wx: number, wz: number, size: number, opacity: number): void {
    const m = this.meshes[i];
    m.position.set(x, groundY + FIREHEAD.lift, z);
    m.rotation.y = Math.atan2(-wz, wx); // local +X (the chevron tip) → world (wx,wz)
    const s = FIREHEAD.sizeBase + FIREHEAD.sizePerSize * size;
    m.scale.set(s, 1, s);
    this.mats[i].opacity = opacity;
    m.visible = true;
  }

  /** Hide every slot from `n` upward (the fires that aren't heads this frame). */
  hideFrom(n: number): void {
    for (let i = n; i < this.meshes.length; i++) this.meshes[i].visible = false;
  }
}

/** A flat filled chevron/arrowhead in the XZ plane (y=0), tip at +X — two tris with a notched tail. */
function chevronGeom(): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  const v = new Float32Array([
    1.0, 0, 0.0, -0.5, 0, 0.7, -0.1, 0, 0.0, // upper wing
    1.0, 0, 0.0, -0.1, 0, 0.0, -0.5, 0, -0.7, // lower wing
  ]);
  g.setAttribute('position', new THREE.BufferAttribute(v, 3));
  g.computeVertexNormals();
  return g;
}
