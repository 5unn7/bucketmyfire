import * as THREE from 'three';
import { WASH } from '../config';

/**
 * Rotor downwash signal (Track C4). Engine-agnostic — it owns only numbers, like the
 * other sims (no Three scene objects, no DOM). The column of air a helicopter throws
 * down only reaches the surface when the aircraft is LOW, so this turns the flight
 * sim's AGL into two plain scalars the rest of the game reads as signals:
 *
 *   surface      0..1 — how hard the downwash hits the ground/water directly below.
 *                Ramps in as the heli descends toward the floor (squared, so it's
 *                sharply localized to low passes) and a touch stronger on the
 *                collective. `Game` uses it to dimple water (ripple rings), flatten the
 *                canopy (foliage bend), and fan nearby flames.
 *   groundEffect 0..1 — the in-ground-effect cushion: the rotor riding its own
 *                downwash close to the surface. `HelicopterSim` turns this into a
 *                buoyant lift assist so low scooping passes float (gated so a full
 *                descent still bottoms out on the floor).
 *
 * `Game` feeds it AGL each frame (using last frame's value — one-frame lag is
 * imperceptible, same as the bucket-dip read) and reads the scalars back.
 */
export class RotorWash {
  private _surface = 0;
  private _groundEffect = 0;

  /**
   * Recompute the signals.
   * @param agl height above the flight floor (units).
   * @param collective lift demand, -1 (descend) … +1 (climb).
   */
  update(agl: number, collective: number): void {
    const a = Number.isFinite(agl) ? Math.max(0, agl) : WASH.reach;
    const prox = 1 - THREE.MathUtils.clamp(a / WASH.reach, 0, 1);
    const effort = 0.75 + 0.25 * THREE.MathUtils.clamp(collective, 0, 1);
    this._surface = prox * prox * effort; // squared → only the low passes really blow
    this._groundEffect = 1 - THREE.MathUtils.clamp(a / WASH.groundReach, 0, 1);
  }

  /** 0..1 downwash strength reaching the surface directly below the heli. */
  get surface(): number {
    return this._surface;
  }

  /** 0..1 in-ground-effect cushion (1 on the deck → 0 a rotor-span up). */
  get groundEffect(): number {
    return this._groundEffect;
  }
}
