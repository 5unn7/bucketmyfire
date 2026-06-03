import * as THREE from 'three';
import type { FireFieldView } from '../sim/FireSystem';

/**
 * The bridge that turns the engine-agnostic fire CELL FIELD into something shaders can read: one
 * fixed-size `DataTexture` (n×n, RGBA-uint8) repacked from `FireSystem.fieldView()` each frame.
 *
 *   - R = live HEAT (0..1 → 0..255): the actively-burning region. Terrain glows orange here.
 *   - G = SCORCH (0/255): the lasting burn scar. Terrain chars to charcoal here.
 *
 * The terrain material samples this in world space (`uv = (worldXZ - worldMin) / worldSize`) so the
 * whole burning AREA reads continuously — the ground itself carries the fire and its scar, filling
 * the gaps between the handful of flame billboards. ONE shared texture, allocated once; per frame
 * we only memcpy the field into `data` and flag `needsUpdate` (no realloc, no shader recompile) —
 * honoring the mobile-60fps invariant. The texture grid maps 1:1 onto the sim's `cz*n+cx` indexing
 * (DataTexture is `flipY=false`), so cell i lands at texel (cx,cz) with no flip.
 */
export class FireFieldTexture {
  readonly texture: THREE.DataTexture;
  /** World-space mapping for the sampler: uv = (worldXZ - worldMin) / worldSize. */
  readonly worldMin: number;
  readonly worldSize: number;

  private readonly data: Uint8Array;

  constructor(n: number, worldSize: number) {
    this.worldSize = worldSize;
    this.worldMin = -worldSize / 2;
    this.data = new Uint8Array(n * n * 4);
    this.texture = new THREE.DataTexture(this.data, n, n, THREE.RGBAFormat, THREE.UnsignedByteType);
    // Linear filtering softens the ~11.7u cell grid into smooth burn edges (no blocky char/glow);
    // no mipmaps (the texture is sampled at a stable world scale) and clamp at the world rim.
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.wrapS = this.texture.wrapT = THREE.ClampToEdgeWrapping;
    this.texture.needsUpdate = true;
  }

  /** Repack the live field into the texture. O(cells) memcpy — call once per frame after the sim. */
  pack(view: FireFieldView): void {
    const heat = view.heat;
    const scorch = view.scorch;
    const d = this.data;
    const N = heat.length;
    for (let i = 0; i < N; i++) {
      const h = heat[i];
      const o = i * 4;
      d[o] = h <= 0 ? 0 : h >= 1 ? 255 : (h * 255) | 0; // R = heat
      d[o + 1] = scorch[i] !== 0 ? 255 : 0; // G = scorch
      d[o + 2] = 0;
      d[o + 3] = 255;
    }
    this.texture.needsUpdate = true;
  }
}
