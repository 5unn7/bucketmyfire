import * as THREE from 'three';
import { WATER, RIPPLE_SLOTS } from '../config';

/**
 * A fixed pool of expanding ripple rings on the water (B1). The whole pool is ONE
 * uniform — an array of `RIPPLE_SLOTS` vec4s, each `(x, z, age, strength)` — so the
 * water shader reads a constant-size array and nothing about the program changes as
 * rings come and go (no recompiles). `age < 0` marks a free slot.
 *
 * Rings are spawned by gameplay: a scooping bucket dip (gentle) and a water-drop
 * impact (punchier). Each ages out over `WATER.rippleLife`; a new spawn claims a
 * free slot, or recycles the oldest if the pool is full.
 */
export class Ripples {
  /** Shared with the water material: vec4[RIPPLE_SLOTS] = (x, z, age, strength). */
  readonly uniform: { value: THREE.Vector4[] };

  constructor() {
    const slots: THREE.Vector4[] = [];
    for (let i = 0; i < RIPPLE_SLOTS; i++) slots.push(new THREE.Vector4(0, 0, -1, 0));
    this.uniform = { value: slots };
  }

  /** Spawn a ring at world (x, z). `strength` is the normal/foam punch. */
  spawn(x: number, z: number, strength: number): void {
    const slots = this.uniform.value;
    let pick = 0;
    let oldest = -Infinity;
    for (let i = 0; i < slots.length; i++) {
      const age = slots[i].z;
      if (age < 0) {
        pick = i;
        break; // free slot — take it
      }
      if (age > oldest) {
        oldest = age;
        pick = i; // track the oldest as the fallback victim
      }
    }
    slots[pick].set(x, z, 0, strength);
  }

  /** Age every active ring; retire those past their life. */
  update(dt: number): void {
    if (!Number.isFinite(dt) || dt <= 0) return;
    const slots = this.uniform.value;
    for (let i = 0; i < slots.length; i++) {
      const r = slots[i];
      if (r.z < 0) continue;
      r.z += dt;
      if (r.z >= WATER.rippleLife) r.z = -1; // free the slot
    }
  }
}
