/**
 * Open Skies ghost pilots — the ONE Three-touching file in the free-for-all presence layer (Slice 3).
 * Given the latest remote pilot states from the transport (net/openSkies.ts, number-only), it spawns /
 * poses / retires a ghost helicopter per peer, smoothing each toward its latest broadcast pose so a
 * 12 Hz stream reads as a continuously-flying aircraft. Reuses `createHelicopter` so a ghost flies the
 * pilot's actual airframe, posed with the SAME convention as the local heli (`rotation.set(bank*sign,
 * yaw, pitch, 'YZX')`, Game.ts) — so a remote can never look different from a local.
 *
 * Cheap by construction: ghosts are created on JOIN and removed on LEAVE (not per-frame), capped at
 * `FFA.netMaxRemotes`, and the per-frame work is an exponential lerp + a transform write per ghost.
 * On leave/dispose a ghost is detached AND its per-instance geometry/material are freed (disposeGhost),
 * SKIPPING `userData.shared` materials (createHelicopter shares the blade/hub materials with the local
 * heli — disposing those would corrupt it).
 */
import * as THREE from 'three';
import { createHelicopter, type HelicopterMesh } from '../meshes/helicopter';
import { FLIGHT, FFA } from '../config';
import type { RemoteState } from './openSkies';

interface Ghost {
  mesh: HelicopterMesh;
  // Smoothed RENDER pose (lerps toward the latest received target each frame).
  x: number;
  y: number;
  z: number;
  yaw: number;
  bank: number;
  pitch: number;
  agl: number; // latest broadcast height above floor — gates the collision test on "both airborne"
  fresh: boolean; // first frame → snap, don't streak in from the origin
}

export class RemotePilots {
  private readonly ghosts = new Map<string, Ghost>();

  constructor(private readonly scene: THREE.Scene) {}

  /** Reconcile the ghost set with the live remote states, then interpolate + pose each. */
  sync(remotes: RemoteState[], dt: number): void {
    const seen = new Set<string>();
    for (const r of remotes) {
      // Honor the cap: ignore NEW peers past the limit (existing ghosts keep updating).
      if (!this.ghosts.has(r.id) && this.ghosts.size >= FFA.netMaxRemotes) continue;
      seen.add(r.id);
      let g = this.ghosts.get(r.id);
      if (!g) {
        g = this.spawn(r);
        this.ghosts.set(r.id, g);
      }
      this.steer(g, r, dt);
    }
    // Retire ghosts whose pilot is gone (left, or stale-pruned by the transport) — free their GPU too.
    for (const [id, g] of this.ghosts) {
      if (!seen.has(id)) {
        this.disposeGhost(g);
        this.ghosts.delete(id);
      }
    }
  }

  /** Number of ghost pilots currently in the sky. */
  get count(): number {
    return this.ghosts.size;
  }

  /** True if any AIRBORNE ghost's RENDERED position is within `r` of (x,y,z) — the pilot-vs-pilot
   *  collision test. We collide with what the player actually SEES (the smoothed pose), and skip a ghost
   *  below `minGhostAgl` so a low pass over a parked / briefing / just-respawned-low peer doesn't kill you
   *  ("both ships must be airborne", matching the local-side gate). */
  collides(x: number, y: number, z: number, r: number, minGhostAgl: number): boolean {
    const r2 = r * r;
    for (const g of this.ghosts.values()) {
      if (g.agl < minGhostAgl) continue;
      const dx = g.x - x;
      const dy = g.y - y;
      const dz = g.z - z;
      if (dx * dx + dy * dy + dz * dz < r2) return true;
    }
    return false;
  }

  dispose(): void {
    for (const g of this.ghosts.values()) this.disposeGhost(g);
    this.ghosts.clear();
  }

  /** Detach a ghost from the scene AND free its per-instance GPU resources. Skips `userData.shared`
   *  materials (createHelicopter shares the blade/hub materials with the LOCAL heli — disposing them
   *  would corrupt it). Called on both a pilot leaving mid-session and on full dispose. */
  private disposeGhost(g: Ghost): void {
    this.scene.remove(g.mesh.group);
    g.mesh.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => !x.userData?.shared && x.dispose());
      else if (mat && !mat.userData?.shared) mat.dispose();
    });
  }

  private spawn(r: RemoteState): Ghost {
    const mesh = createHelicopter(r.heli);
    this.scene.add(mesh.group);
    return { mesh, x: r.x, y: r.y, z: r.z, yaw: r.yaw, bank: r.bank, pitch: r.pitch, agl: r.agl, fresh: true };
  }

  private steer(g: Ghost, r: RemoteState, dt: number): void {
    // Exponential smoothing toward the latest broadcast pose — rides through the 12 Hz jitter without a
    // visible lag. Snap on first sight or a big jump (a respawn/teleport) so a ghost never streaks across
    // the whole map.
    const jumped = Math.hypot(r.x - g.x, r.z - g.z) > 200;
    const k = g.fresh || jumped ? 1 : 1 - Math.exp(-dt / (FFA.netInterpMs / 1000));
    g.fresh = false;
    g.x += (r.x - g.x) * k;
    g.y += (r.y - g.y) * k;
    g.z += (r.z - g.z) * k;
    g.yaw = lerpAngle(g.yaw, r.yaw, k);
    g.bank = lerpAngle(g.bank, r.bank, k);
    g.pitch = lerpAngle(g.pitch, r.pitch, k);
    g.agl = r.agl; // latest (the collision gate needs the current altitude, not a smoothed one)

    const grp = g.mesh.group;
    grp.position.set(g.x, g.y, g.z);
    grp.rotation.set(g.bank * g.mesh.bankSign, g.yaw, g.pitch, 'YZX');
    // Spin the rotors so a ghost reads as alive in the air, not parked (full-rate; ghosts are airborne).
    g.mesh.rotor.rotation.y += FLIGHT.rotorSpin * dt;
    g.mesh.tailRotor.rotation.x += FLIGHT.tailRotorSpin * dt;
  }
}

/** Shortest-path angle interpolation (so a ghost yaws the short way through ±π, never the long way). */
function lerpAngle(a: number, b: number, t: number): number {
  const tau = Math.PI * 2;
  let d = ((b - a) % tau + tau + Math.PI) % tau - Math.PI;
  return a + d * t;
}
