/**
 * Backburn control-line tracker (the helitorch / aerial-ignition mechanic) — engine-agnostic,
 * numbers only (the sim boundary): it imports nothing but its own types, owns no Three.js scene
 * and no DOM. `Game` reads its state each frame to tint the control-line markers and feed
 * `backburnLit` into the mission signals; the headless verifier drives the SAME class so the
 * "lay the line" objective is proven against real logic (parity with `CrewTransport`/`scenario`).
 *
 * THE TACTIC: a backburn (a.k.a. backfire / controlled burn) starves an advancing head fire by
 * DELIBERATELY burning the fuel between it and the town first — when the wildfire arrives, it hits
 * black ground and dies with nothing left to consume. In real ops this is often laid from the air
 * ("helitorch"). Here the pilot flies a marked CONTROL LINE between the head and the settlement and
 * lights each segment with the torch loadout; each lit segment seeds a real backfire (Game calls
 * `FireSystem.igniteAt` at the point), and the resulting scorched strip becomes a permanent firebreak
 * (spent fuel can't re-ignite) that stalls the head. The OBJECTIVE is simply to lay the whole line.
 *
 * A control line is an ordered row of points. You light a point by flying low over it with IGNITE
 * held — `tryLight` lights the nearest UNLIT point within a radius and returns it (so Game can seed
 * the backfire + play the torch SFX). Unlike a crew run there's no single "active" target: you're
 * laying a continuous line, so every unlit point reads as a live target and lights as you pass it.
 */

export interface BackburnPoint {
  x: number;
  z: number;
  label?: string;
}

/** A point as the renderer/HUD sees it — with a live lit flag for marker tinting. */
export interface BackburnView {
  x: number;
  z: number;
  lit: boolean; // this segment has been torched (its backfire is laid)
  label: string;
}

export class Backburn {
  private readonly pts: BackburnPoint[];
  private readonly _lit: boolean[];
  private _litCount = 0;

  constructor(points: BackburnPoint[]) {
    // Own a COPY — never alias the caller's array (mirrors CrewTransport's defensive copy).
    this.pts = [...points];
    this._lit = this.pts.map(() => false);
  }

  /** Total control-line segments to lay. */
  get total(): number {
    return this.pts.length;
  }

  /** How many segments have been torched so far (the `backburnLit` signal). */
  get lit(): number {
    return this._litCount;
  }

  /** Whether the whole line is laid (the win latch for a `backburn` objective). */
  get complete(): boolean {
    return this.total > 0 && this._litCount === this.total;
  }

  /**
   * Light the nearest UNLIT segment within `radius` of (x, z), if any. Returns the point that lit
   * (so Game can seed the backfire there + fire the torch SFX) or null if nothing was in reach.
   * Idempotent per segment — a segment can only be lit once.
   */
  tryLight(x: number, z: number, radius: number): BackburnPoint | null {
    let best = -1;
    let bestD = radius * radius;
    for (let i = 0; i < this.pts.length; i++) {
      if (this._lit[i]) continue;
      const dx = this.pts[i].x - x;
      const dz = this.pts[i].z - z;
      const d = dx * dx + dz * dz;
      if (d <= bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best < 0) return null;
    this._lit[best] = true;
    this._litCount++;
    return this.pts[best];
  }

  /** Marker view for the renderer: every point with its lit state (lit → done, unlit → live target). */
  get views(): BackburnView[] {
    return this.pts.map((p, i) => ({ x: p.x, z: p.z, lit: this._lit[i], label: p.label ?? 'Control line' }));
  }
}
