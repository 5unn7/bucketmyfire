import * as THREE from 'three';
import { MISSIONS } from '../config';

/**
 * A landing-zone marker (the crew delivery/evacuation mechanic) — procedural, zero assets:
 * a painted ground ring with a center pad and a tall translucent light/smoke beacon so the
 * zone reads from altitude. Built once per zone and positioned by `Game`; `setState` recolors
 * it (no geometry churn, no shader recompiles — the mobile-60fps invariant):
 *   - `active`   — a valid next target (bright cyan, beacon lit)
 *   - `inactive` — a zone of the wrong role for the current carry state (dimmed)
 *   - `done`     — satisfied (greyed, beacon dropped to a stub)
 *   - `lost`     — the fire reached the trapped family first (dead ashen red, beacon out)
 */

export type ZoneState = 'home' | 'active' | 'inactive' | 'done' | 'lost';

export interface LandingZoneMesh {
  group: THREE.Group;
  setState(state: ZoneState): void;
  /** External override for the vertical beacon column (the ring/pad stay put). `Game` hides it while
   * the heli is parked on the pad — the green home column otherwise shoots straight up through the
   * parked airframe. Independent of `setState`, so ordering between the two never matters. */
  setBeaconVisible(visible: boolean): void;
}

// Pass `home: true` for the reusable BASE pad — it then renders a distinct green, ALWAYS lit, so
// home is unmistakable regardless of the carry state (the player always knows where to return).
export function createLandingZone(home = false): LandingZoneMesh {
  const group = new THREE.Group();
  group.name = 'landingZone';

  const ringR = MISSIONS.lzRadius * 0.72; // painted ring a little inside the trigger radius
  const ringMat = new THREE.MeshStandardMaterial({
    color: MISSIONS.zoneSmoke,
    emissive: MISSIONS.zoneSmoke,
    emissiveIntensity: 1.4,
    roughness: 0.7,
    metalness: 0,
    transparent: true,
    opacity: 0.85,
    side: THREE.DoubleSide,
  });

  // Painted ground ring (flat annulus) + a center cross pad — the classic helipad mark.
  const ringGeo = new THREE.RingGeometry(ringR - 1.4, ringR, 40);
  ringGeo.rotateX(-Math.PI / 2);
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.position.y = 0.25; // sit just above the ground to avoid z-fighting
  group.add(ring);

  const padGeo = new THREE.RingGeometry(2.4, 4.0, 28);
  padGeo.rotateX(-Math.PI / 2);
  const pad = new THREE.Mesh(padGeo, ringMat);
  pad.position.y = 0.25;
  group.add(pad);

  // Vertical beacon: a tall, soft, additive column visible across the map. Tapered cone so
  // it reads like a marker flare / smoke marker rising from the pad.
  const beaconMat = new THREE.MeshBasicMaterial({
    color: MISSIONS.zoneSmoke,
    transparent: true,
    opacity: 0.28,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const beacon = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 2.6, 60, 12, 1, true), beaconMat);
  beacon.position.y = 30;
  group.add(beacon);

  // The beacon's lit-state is the AND of what the current zone state wants (off only on `done`) and
  // the external override (`Game` hides it while the heli is parked on the pad). Tracked separately so
  // a per-frame `setState('home')` can't stomp the override and vice-versa.
  let beaconWanted = true;
  let beaconShown = true;
  const applyBeacon = (): void => {
    beacon.visible = beaconWanted && beaconShown;
  };

  function setState(state: ZoneState): void {
    if (state === 'home') {
      // The base: a distinct green, always lit and beaconed — your home reference all mission long.
      const green = new THREE.Color(MISSIONS.zoneHome);
      ringMat.color.copy(green);
      ringMat.emissive.copy(green);
      ringMat.emissiveIntensity = 1.5;
      ringMat.opacity = 0.9;
      beaconWanted = true;
      beaconMat.color.copy(green);
      beaconMat.opacity = 0.3;
    } else if (state === 'done') {
      const grey = new THREE.Color(MISSIONS.zoneSmokeDone);
      ringMat.color.copy(grey);
      ringMat.emissive.copy(grey);
      ringMat.emissiveIntensity = 0.3;
      ringMat.opacity = 0.5;
      beaconWanted = false;
    } else if (state === 'lost') {
      // The fire reached the family first — the pad goes a dead, ashen red and the beacon drops out.
      const red = new THREE.Color(MISSIONS.zoneLost);
      ringMat.color.copy(red);
      ringMat.emissive.copy(red);
      ringMat.emissiveIntensity = 0.45;
      ringMat.opacity = 0.45;
      beaconWanted = false;
    } else {
      const tint = new THREE.Color(MISSIONS.zoneSmoke);
      ringMat.color.copy(tint);
      ringMat.emissive.copy(tint);
      const on = state === 'active';
      // ONLY the active target throws the tall beacon column — an inactive (next-in-line) crew zone
      // keeps just a faint painted ground ring, so exactly ONE place "lights up" and the player is
      // never torn between two cyan markers. The beacon re-lights on this zone once it's the target.
      ringMat.emissiveIntensity = on ? 1.6 : 0.35;
      ringMat.opacity = on ? 0.9 : 0.32;
      beaconWanted = on;
      beaconMat.opacity = on ? 0.34 : 0;
    }
    applyBeacon();
  }

  function setBeaconVisible(visible: boolean): void {
    beaconShown = visible;
    applyBeacon();
  }

  setState(home ? 'home' : 'inactive');
  return { group, setState, setBeaconVisible };
}
