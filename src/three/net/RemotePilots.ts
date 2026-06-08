/**
 * Open Skies ghost pilots — the ONE Three-touching file in the free-for-all presence layer (Slice 3).
 * Given the latest remote pilot states from the transport (net/openSkies.ts, number-only), it spawns /
 * poses / retires a ghost helicopter per peer, smoothing each toward its latest broadcast pose so a
 * 12 Hz stream reads as a continuously-flying aircraft. Reuses `createHelicopter` so a ghost flies the
 * pilot's actual airframe, posed with the SAME convention as the local heli (`rotation.set(bank*sign,
 * yaw, pitch, 'YZX')`, Game.ts) — so a remote can never look different from a local.
 *
 * Each ghost also carries:
 *   • its OWN slung Bambi bucket + longline, hung on a `BucketSim` pendulum (the SAME engine-agnostic
 *     sim the local bucket uses, so a ghost's swing/sag matches a local exactly), fill driven by the
 *     broadcast `fill`, shown only while the peer signals a rigged bucket (FFA.poseFlagBucket);
 *   • a billboarded CALLSIGN label (a faint glass pill) floating above it, so a peer is easy to identify.
 * When a peer is pouring water (FFA.poseFlagDropping) we surface its bucket mouth via `forEachDrop` so
 * Game can pour spray from the shared pool — a remote douse reads the same as your own.
 *
 * Cheap by construction: ghosts are created on JOIN and removed on LEAVE (not per-frame), capped at
 * `FFA.netMaxRemotes`, and the per-frame work is an exponential lerp + a pendulum step + a few transform
 * writes per ghost. On leave/dispose a ghost is detached AND its per-instance geometry/material are freed
 * (disposeGhost), SKIPPING `userData.shared` materials (createHelicopter shares the blade/hub materials
 * with the local heli — disposing those would corrupt it).
 */
import * as THREE from 'three';
import { createHelicopter, type HelicopterMesh } from '../meshes/helicopter';
import { createBucket, type BucketMesh } from '../meshes/bucket';
import { BucketSim } from '../sim/BucketSim';
import { FLIGHT, FFA, BUCKET3D, SPRAY } from '../config';
import { UI } from '../ui/theme';
import type { RemoteState } from './openSkies';

// Scratch temps for posing a ghost's bucket + rope (no per-frame allocation — mobile-60fps invariant).
const _UP = new THREE.Vector3(0, 1, 0);
const _anchor = new THREE.Vector3();
const _ropeDir = new THREE.Vector3();
const _swingQuat = new THREE.Quaternion();
const _bucketQuat = new THREE.Quaternion();
const _swivel = new THREE.Vector3();

// No terrain/water field under a ghost — pass a floor far below so its BucketSim never reports contact.
const NO_OBSTACLE = -1e6;
// Callsign label geometry (like a mesh's local dims — colours come from the theme, see makeCallsign).
const LABEL_WORLD_H = 4.2; // sprite world height (units); width follows the rendered text's aspect
const LABEL_HEIGHT = 7.5; // how far above the heli origin the label floats (clears the rotor disc)

interface Ghost {
  mesh: HelicopterMesh;
  // The slung bucket + its longline, posed each frame off the smoothed heli pose.
  bucket: BucketMesh;
  bucketSim: BucketSim;
  rope: THREE.Line;
  ropeGeom: THREE.BufferGeometry;
  // The floating callsign label (billboard sprite) + its texture (freed on leave).
  label: THREE.Sprite;
  labelTex: THREE.Texture;
  // Smoothed RENDER pose (lerps toward the latest received target each frame).
  x: number;
  y: number;
  z: number;
  yaw: number;
  bank: number;
  pitch: number;
  fill: number; // smoothed bucket fill 0..1 — drives the bucket's water level + the rope's sag
  prevX: number; // last frame's smoothed XZ → derives heli velocity for the bucket's turn-out sway + spray
  prevZ: number;
  vx: number; // derived heli velocity (u/s) — carried into the spray so a ghost's curtain smears with travel
  vz: number;
  dropping: boolean; // peer is pouring water this frame (flag) → emit spray from the bucket mouth
  sprayDue: boolean; // cadence gate: this frame's spray puff is owed (throttled to SPRAY.emitInterval)
  sprayAccum: number; // seconds since the last puff
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

  /** The XZ of every live ghost — Game uses these to scatter its own respawn clear of occupied slots. */
  occupiedXZ(out: { x: number; z: number }[]): void {
    for (const g of this.ghosts.values()) out.push({ x: g.x, z: g.z });
  }

  /** Pour-spray hook: call `cb` once this frame for each ghost whose bucket should puff a spray sheet
   *  (the peer is dropping AND its throttle is due), with the bucket mouth's world pos + the ghost's
   *  derived velocity. Game owns the pooled spray, so it emits — this just reports WHERE/HOW. */
  forEachDrop(cb: (x: number, y: number, z: number, vx: number, vz: number) => void): void {
    for (const g of this.ghosts.values()) {
      if (!g.sprayDue) continue;
      g.sprayDue = false;
      const p = g.bucketSim.position;
      cb(p.x, p.y, p.z, g.vx, g.vz);
    }
  }

  dispose(): void {
    for (const g of this.ghosts.values()) this.disposeGhost(g);
    this.ghosts.clear();
  }

  /** Detach a ghost (heli + bucket + rope + label) from the scene AND free its per-instance GPU
   *  resources. Skips `userData.shared` materials (createHelicopter shares the blade/hub materials with
   *  the LOCAL heli — disposing them would corrupt it). Called on a pilot leaving AND on full dispose. */
  private disposeGhost(g: Ghost): void {
    this.scene.remove(g.mesh.group);
    this.scene.remove(g.bucket.group);
    this.scene.remove(g.rope);
    this.scene.remove(g.label);
    const free = (root: THREE.Object3D) =>
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        const mat = m.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((x) => !x.userData?.shared && x.dispose());
        else if (mat && !mat.userData?.shared) mat.dispose();
      });
    free(g.mesh.group);
    free(g.bucket.group);
    g.ropeGeom.dispose();
    (g.rope.material as THREE.Material).dispose();
    g.labelTex.dispose();
    (g.label.material as THREE.Material).dispose();
  }

  private spawn(r: RemoteState): Ghost {
    const mesh = createHelicopter(r.heli);
    this.scene.add(mesh.group);

    // Slung bucket + its own longline (mirrors Game's local rig). BucketSim's ctor hangs it `ropeLength`
    // below the spawn pose, so it starts under the ghost rather than streaking up from the origin.
    const bucket = createBucket();
    const bucketSim = new BucketSim(r.x, r.y, r.z);
    this.scene.add(bucket.group);
    const ropePts = BUCKET3D.ropeSegments + 1;
    const ropeGeom = new THREE.BufferGeometry();
    ropeGeom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(ropePts * 3), 3));
    const rope = new THREE.Line(ropeGeom, new THREE.LineBasicMaterial({ color: 0x2a2118 }));
    rope.frustumCulled = false;
    this.scene.add(rope);

    // Floating callsign — a faint glass pill that always faces the camera and reads on top.
    const { sprite: label, texture: labelTex } = makeCallsign(r.name);
    this.scene.add(label);

    return {
      mesh,
      bucket,
      bucketSim,
      rope,
      ropeGeom,
      label,
      labelTex,
      x: r.x,
      y: r.y,
      z: r.z,
      yaw: r.yaw,
      bank: r.bank,
      pitch: r.pitch,
      fill: r.fill,
      prevX: r.x,
      prevZ: r.z,
      vx: 0,
      vz: 0,
      dropping: false,
      sprayDue: false,
      sprayAccum: 0,
      agl: r.agl,
      fresh: true,
    };
  }

  private steer(g: Ghost, r: RemoteState, dt: number): void {
    // Exponential smoothing toward the latest broadcast pose — rides through the 12 Hz jitter without a
    // visible lag. Snap on first sight or a big jump (a respawn/teleport) so a ghost never streaks across
    // the whole map.
    const jumped = Math.hypot(r.x - g.x, r.z - g.z) > 200;
    const snap = g.fresh || jumped;
    const k = snap ? 1 : 1 - Math.exp(-dt / (FFA.netInterpMs / 1000));
    g.fresh = false;
    g.x += (r.x - g.x) * k;
    g.y += (r.y - g.y) * k;
    g.z += (r.z - g.z) * k;
    g.yaw = lerpAngle(g.yaw, r.yaw, k);
    g.bank = lerpAngle(g.bank, r.bank, k);
    g.pitch = lerpAngle(g.pitch, r.pitch, k);
    g.fill += (r.fill - g.fill) * k;
    g.agl = r.agl; // latest (the collision gate needs the current altitude, not a smoothed one)

    const grp = g.mesh.group;
    grp.position.set(g.x, g.y, g.z);
    grp.rotation.set(g.bank * g.mesh.bankSign, g.yaw, g.pitch, 'YZX');
    // Spin the rotors so a ghost reads as alive in the air, not parked (full-rate; ghosts are airborne).
    g.mesh.rotor.rotation.y += FLIGHT.rotorSpin * dt;
    g.mesh.tailRotor.rotation.x += FLIGHT.tailRotorSpin * dt;

    // Float the callsign above the heli (the sprite billboards toward the camera on its own).
    g.label.position.set(g.x, g.y + LABEL_HEIGHT, g.z);

    this.poseBucket(g, r, dt, snap);
  }

  /** Hang + swing the ghost's bucket under its smoothed heli pose, redraw the longline, and tick the
   *  pour-spray cadence. Mirrors Game.updateSlungBucket's posing, minus the scoop/scrape/drop + World
   *  queries (a ghost has no terrain or lake under it). Hidden unless the peer signals a rigged bucket so
   *  a DETACHed / crew / torch peer shows none. */
  private poseBucket(g: Ghost, r: RemoteState, dt: number, snap: boolean): void {
    const rigged = (r.flags & FFA.poseFlagBucket) !== 0;
    g.bucket.group.visible = rigged;
    g.rope.visible = rigged;
    if (!rigged) {
      g.prevX = g.x;
      g.prevZ = g.z;
      g.vx = 0;
      g.vz = 0;
      g.dropping = false;
      g.sprayDue = false;
      return; // nothing rigged → skip the sim/pose work entirely
    }

    // Cargo hook on the belly of the fuselage (same offset as the local rig).
    _anchor.set(g.x, g.y + BUCKET3D.bellyOffset, g.z);
    const fill = THREE.MathUtils.clamp(g.fill, 0, 1);

    if (snap) {
      // First sight / respawn: drop the bucket straight under the belly with motion zeroed, so it neither
      // streaks in nor flings outward from a bogus velocity spike on the smoothed position.
      g.bucketSim.parkAt(_anchor.x, _anchor.y - BUCKET3D.ropeLength, _anchor.z);
      g.prevX = g.x;
      g.prevZ = g.z;
      g.vx = 0;
      g.vz = 0;
    } else {
      // Heli horizontal velocity, derived from the smoothed RENDER motion — feeds the turn-out sway + spray.
      const vdt = dt > 0 ? dt : 1 / 60;
      g.vx = (g.x - g.prevX) / vdt;
      g.vz = (g.z - g.prevZ) / vdt;
      g.prevX = g.x;
      g.prevZ = g.z;
      g.bucketSim.update(dt * 1000, _anchor, g.vx, g.vz, fill, false, NO_OBSTACLE);
    }

    const bp = g.bucketSim.position;
    g.bucket.group.position.copy(bp);
    g.bucket.setFill(fill);

    // Hang the body ALONG the longline (partial lean by swingTilt), so the lateral lag also reads as the
    // bucket swinging out. No scoop tip — a ghost never dips into a (nonexistent) lake under it.
    _ropeDir.set(_anchor.x - bp.x, _anchor.y - bp.y, _anchor.z - bp.z).normalize();
    _swingQuat.setFromUnitVectors(_UP, _ropeDir);
    _bucketQuat.identity().slerp(_swingQuat, BUCKET3D.swingTilt);
    g.bucket.group.quaternion.copy(_bucketQuat);

    // Longline as a load-eased catenary between the belly hook and the bucket's (swung) swivel head.
    _swivel.set(0, g.bucket.topAnchorY, 0).applyQuaternion(_bucketQuat).add(bp);
    const sag = BUCKET3D.ropeSagEmpty + (BUCKET3D.ropeSagFull - BUCKET3D.ropeSagEmpty) * fill;
    const rp = g.ropeGeom.attributes.position as THREE.BufferAttribute;
    const segs = BUCKET3D.ropeSegments;
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const droop = sag * 4 * t * (1 - t); // parabolic bow: 0 at both ends, max at mid-span
      rp.setXYZ(
        i,
        _anchor.x + (_swivel.x - _anchor.x) * t,
        _anchor.y + (_swivel.y - _anchor.y) * t - droop,
        _anchor.z + (_swivel.z - _anchor.z) * t,
      );
    }
    rp.needsUpdate = true;

    // Pour-spray cadence: while the peer is dropping, owe a puff every SPRAY.emitInterval (same throttle
    // as the local drop). forEachDrop() consumes `sprayDue` and clears it; Game emits from the pool.
    g.dropping = (r.flags & FFA.poseFlagDropping) !== 0;
    if (g.dropping) {
      g.sprayAccum += dt;
      if (g.sprayAccum >= SPRAY.emitInterval) {
        g.sprayAccum = 0;
        g.sprayDue = true;
      }
    } else {
      g.sprayAccum = SPRAY.emitInterval; // primed so the first frame of the next drop puffs immediately
      g.sprayDue = false;
    }
  }
}

/** Shortest-path angle interpolation (so a ghost yaws the short way through ±π, never the long way). */
function lerpAngle(a: number, b: number, t: number): number {
  const tau = Math.PI * 2;
  const d = ((b - a) % tau + tau + Math.PI) % tau - Math.PI;
  return a + d * t;
}

/**
 * Build a billboarded callsign label: a faint frosted glass pill (the HUD chip fill) with the pilot's
 * name in the cockpit's cool accent. Drawn to a canvas → CanvasTexture → camera-facing Sprite, rendered
 * on top (depthTest off) so a peer is always easy to identify. Colours come from the shared theme; only
 * the geometry/typography are local (like a mesh's dimensions).
 */
function makeCallsign(name: string): { sprite: THREE.Sprite; texture: THREE.CanvasTexture } {
  const text = (name || 'Pilot').trim().slice(0, 16) || 'Pilot';
  const fontPx = 48;
  const padX = 30;
  const font = `600 ${fontPx}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  ctx.font = font;
  const textW = Math.ceil(ctx.measureText(text).width);
  // Resizing the canvas resets the 2D context, so size first, THEN re-set every draw state.
  canvas.width = textW + padX * 2;
  canvas.height = Math.round(fontPx * 1.7);

  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const w = canvas.width;
  const h = canvas.height;
  const r = h / 2;
  // Glass pill: frosted fill + a faint cool rim (matches the in-flight HUD chip).
  ctx.beginPath();
  ctx.moveTo(r, 0);
  ctx.arcTo(w, 0, w, h, r);
  ctx.arcTo(w, h, 0, h, r);
  ctx.arcTo(0, h, 0, 0, r);
  ctx.arcTo(0, 0, w, 0, r);
  ctx.closePath();
  ctx.fillStyle = UI.panel; // 'rgba(14,20,27,0.38)' — HUD frosted chip fill
  ctx.fill();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = UI.accentSoft; // soft cyan rim
  ctx.stroke();
  // Name in the interactive cool accent.
  ctx.fillStyle = UI.accent;
  ctx.fillText(text, w / 2, h / 2 + fontPx * 0.04);

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter; // no mipmaps on a non-pow2 label → stays crisp, no console warn
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false });
  const sprite = new THREE.Sprite(material);
  sprite.renderOrder = 12; // draw over the world so it's never hidden behind a hill
  sprite.scale.set(LABEL_WORLD_H * (w / h), LABEL_WORLD_H, 1);
  return { sprite, texture };
}
