import * as THREE from 'three';
import { swapInModel } from './heliModels';

/**
 * Procedural HIGH-POLY Bell 205A-1 — the civilian single-engine derivative of the
 * UH-1H "Huey", in a northern-Saskatchewan firefighting livery (white over fire-red).
 *
 * This is the game's hero model. Unlike the rest of the scene it is allowed real
 * geometry density: only ONE helicopter is ever on screen, so a few thousand
 * triangles is well within the mobile-60fps budget. All generation is one-time at
 * load — nothing here runs per frame except the caller spinning rotor / tailRotor.
 *
 * Zero binary assets: the fuselage is a single LOFTED hull (smooth superellipse
 * cross-sections morphing nose → cabin → boom) with its livery baked into vertex
 * colors; every other part is a Three primitive, a TubeGeometry swept along a curve,
 * or an ExtrudeGeometry airfoil. Swap-in real art later by replacing this one factory
 * — nothing downstream needs the internals, only the { group, rotor, tailRotor } handles.
 *
 * What makes it read as a 205A-1 (and not a generic chopper):
 *  - the lofted Huey silhouette: blunt drooping chin → tall SQUARE-SHOULDERED cabin
 *    with a flat-ish roof → long slender up-swept tail boom;
 *  - a wrap-around greenhouse with the signature angled CHIN BUBBLE windows;
 *  - a slim engine-deck (T53 cowling) fairing behind the mast with a forward intake
 *    and an upturned aft exhaust stack;
 *  - the two-blade teetering rotor with a full head: swashplate, pitch links, grips,
 *    and the STABILIZER BAR (flybar) crossed 90° to the blades with weighted paddles;
 *  - the synchronized mid-boom elevator, a swept fin, and the 2-blade tail rotor on
 *    TOP of the fin facing RIGHT (starboard) — the 205A-1 tractor layout;
 *  - tubular skids swept up at the toe on two arched cross-tubes.
 *
 * Conventions the flight model depends on (DO NOT break these):
 *  - Y is up. The aircraft flies in the XZ plane; altitude is along +Y.
 *  - The NOSE points +X (local +X is forward). The tail boom extends toward -X.
 *  - Starboard (pilot's right) is +Z  [right = forward × up = +X × +Y = +Z].
 *  - Centered on the local origin in X/Z, with the SKIDS' BOTTOM at ~y = 0, so the
 *    caller's `group.position.y = altitude` rests the craft on the ground at altitude 0.
 *
 * Scale: ~10 world units nose-to-tail; main-rotor diameter ~11 (slightly larger than
 * the fuselage, as on the real aircraft).
 */

export interface HelicopterMesh {
  group: THREE.Group; // the whole aircraft
  rotor: THREE.Object3D; // MAIN rotor — caller spins this about its local Y each frame
  tailRotor: THREE.Object3D; // tail rotor — caller spins this about its local X each frame
  /** Visual roll sign (+1 normal, −1 for a chirality-MIRRORED glTF whose left/right is flipped, so the
   *  shared flight `bank` would roll it backwards). Game multiplies `bank` by this when posing. Set by
   *  swapInModel once the real model is in; stays +1 for the procedural Bell 205 fallback. */
  bankSign: number;
}

export function createHelicopter(heliId?: string): HelicopterMesh {
  const group = new THREE.Group();
  group.name = 'helicopter';

  // --- Palette ------------------------------------------------------------
  const warmWhite = new THREE.Color(0.95, 0.94, 0.9);
  const fireRed = new THREE.Color(0.8, 0.13, 0.09);

  const hullMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.46, metalness: 0.12 });
  const redMat = new THREE.MeshStandardMaterial({ color: fireRed, roughness: 0.45, metalness: 0.12 });
  const deckMat = new THREE.MeshStandardMaterial({ color: 0x44484f, roughness: 0.55, metalness: 0.35 });
  const metalMat = new THREE.MeshStandardMaterial({ color: 0x70757d, roughness: 0.38, metalness: 0.75 });
  const darkMetalMat = new THREE.MeshStandardMaterial({ color: 0x3a3e44, roughness: 0.45, metalness: 0.6 });
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0x3d586e,
    roughness: 0.08,
    metalness: 0.25,
    transparent: true,
    opacity: 0.55,
  });
  const lightMat = new THREE.MeshStandardMaterial({ color: 0xfff4d0, emissive: 0xffe9a8, emissiveIntensity: 0.9, roughness: 0.3 });

  // --- tiny helpers -------------------------------------------------------
  const solid = (mesh: THREE.Mesh, name: string): THREE.Mesh => {
    mesh.name = name;
    mesh.castShadow = true;
    return mesh;
  };
  const tubeX = (rTop: number, rBot: number, len: number, seg: number, mat: THREE.Material) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBot, len, seg), mat);
    m.rotation.z = Math.PI / 2;
    return m;
  };
  const sweptTube = (pts: THREE.Vector3[], r: number, mat: THREE.Material, name: string) => {
    const curve = new THREE.CatmullRomCurve3(pts);
    return solid(new THREE.Mesh(new THREE.TubeGeometry(curve, Math.max(8, pts.length * 4), r, 6, false), mat), name);
  };

  // === FUSELAGE — the lofted hull =========================================
  // Each station is a body cross-section at world-X = `x`: a superellipse in the Z-Y
  // plane, centered at height `cy`, half-width `w`, rising `top` / dropping `bot`,
  // with squareness `n` (n=2 ellipse → larger = boxy with rounded corners). Lofting
  // consecutive stations skins the whole pod-and-boom as ONE smooth mesh. A high `n`
  // in the cabin gives the Huey's square-shouldered, flat-roofed read; the boom
  // relaxes back to round. cy climbs aft for the signature up-sweep.
  type Station = { x: number; cy: number; w: number; top: number; bot: number; n: number };
  const stations: Station[] = [
    { x: 4.05, cy: 1.04, w: 0.4, top: 0.32, bot: 0.4, n: 2.6 }, // blunt nose tip, drooped
    { x: 3.75, cy: 1.12, w: 0.8, top: 0.5, bot: 0.62, n: 3.0 }, // chin
    { x: 3.3, cy: 1.33, w: 1.1, top: 0.9, bot: 0.78, n: 3.8 }, // cockpit front (greenhouse)
    { x: 2.6, cy: 1.46, w: 1.24, top: 1.0, bot: 0.8, n: 5.2 }, // cockpit/cabin
    { x: 1.7, cy: 1.5, w: 1.28, top: 1.04, bot: 0.8, n: 7.0 }, // cabin — slab-sided, flat roof
    { x: 0.7, cy: 1.5, w: 1.28, top: 1.04, bot: 0.8, n: 7.5 },
    { x: -0.3, cy: 1.5, w: 1.25, top: 1.02, bot: 0.79, n: 7.0 }, // cabin (sliding doors)
    { x: -1.1, cy: 1.52, w: 1.12, top: 0.92, bot: 0.73, n: 5.0 }, // cabin rear
    { x: -1.8, cy: 1.6, w: 0.7, top: 0.62, bot: 0.54, n: 3.2 }, // boom neck
    { x: -2.5, cy: 1.7, w: 0.4, top: 0.4, bot: 0.36, n: 2.4 },
    { x: -3.3, cy: 1.8, w: 0.31, top: 0.32, bot: 0.3, n: 2.1 }, // round boom
    { x: -4.2, cy: 1.92, w: 0.27, top: 0.27, bot: 0.26, n: 2.0 },
    { x: -5.1, cy: 2.04, w: 0.23, top: 0.23, bot: 0.23, n: 2.0 },
    { x: -5.7, cy: 2.13, w: 0.2, top: 0.2, bot: 0.2, n: 2.0 }, // boom end / fin root
  ];

  const hull = solid(new THREE.Mesh(buildHull(stations, 20, warmWhite, fireRed), hullMat), 'fuselage');
  hull.receiveShadow = true;
  group.add(hull);

  // === GREENHOUSE GLASS (flush — no protruding frames) =====================
  // Wrap-around windscreen: a scaled sphere hugging the cockpit FRONT (sits low and
  // forward so it reads as a windshield, not a roof hatch), tilted nose-down.
  const windscreen = new THREE.Mesh(new THREE.SphereGeometry(1.0, 14, 10), glassMat);
  windscreen.name = 'windscreen';
  windscreen.scale.set(0.95, 0.82, 1.04);
  windscreen.rotation.z = 0.18; // tilt with the cockpit slope
  windscreen.position.set(3.2, 1.55, 0);
  group.add(windscreen);
  // thin center windscreen post (down the middle of the glass)
  const post = solid(new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.05, 0.05), deckMat), 'windscreenPost');
  post.rotation.z = 0.62;
  post.position.set(3.5, 1.6, 0);
  group.add(post);
  // signature chin-bubble windows under the pilots' feet — small DOWN-facing panes
  // (thin in Y so they lie under the chin and never cross the centerline)
  for (const side of [-1, 1]) {
    const chin = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.04, 0.34), glassMat);
    chin.name = 'chinBubble';
    chin.rotation.x = side * 0.12;
    chin.position.set(3.55, 0.9, side * 0.32);
    group.add(chin);
  }
  // Side glazing — flush panes that lie FLAT on each side (thin axis along Z, so they
  // never spear through the cabin). One big sliding-door window, a cockpit window, and
  // a rear quarter light per side.
  for (const side of [-1, 1]) {
    const door = new THREE.Mesh(new THREE.BoxGeometry(1.95, 0.66, 0.05), glassMat);
    door.name = 'doorWindow';
    door.position.set(0.5, 1.78, side * 1.31); // just proud of the cabin skin
    group.add(door);
    const cockpitSide = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.55, 0.05), glassMat);
    cockpitSide.name = 'cockpitWindow';
    cockpitSide.position.set(2.45, 1.72, side * 1.27);
    group.add(cockpitSide);
    const quarter = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.42, 0.05), glassMat);
    quarter.name = 'quarterWindow';
    quarter.position.set(-1.35, 1.74, side * 1.13);
    group.add(quarter);
  }

  // === ENGINE DECK (T53 cowling) — slim fairing on the cabin roof ===========
  const deck = solid(tubeX(0.36, 0.34, 2.1, 10, deckMat), 'engineDeck');
  deck.scale.set(1, 0.9, 1.5); // flatten + widen
  deck.position.set(-0.55, 2.5, 0);
  group.add(deck);
  // forward intake screen at the front of the deck
  const intake = solid(new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.34, 0.9), darkMetalMat), 'intakeScreen');
  intake.position.set(0.55, 2.5, 0);
  group.add(intake);
  // upturned exhaust stack blowing aft over the boom
  const exhaust = solid(new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.18, 0.8, 8), metalMat), 'exhaust');
  exhaust.rotation.z = Math.PI / 2.5;
  exhaust.position.set(-1.6, 2.55, 0);
  group.add(exhaust);

  // === TAIL SURFACES ======================================================
  // Swept vertical fin (red), built as an extruded swept trapezoid. Tall enough to
  // carry the tail rotor on top.
  const finShape = new THREE.Shape();
  finShape.moveTo(0, 0);
  finShape.lineTo(1, 0.0);
  finShape.lineTo(1.15, 1.6);
  finShape.lineTo(0.5, 1.7);
  finShape.closePath();
  const finGeo = new THREE.ExtrudeGeometry(finShape, { depth: 0.12, bevelEnabled: true, bevelSize: 0.03, bevelThickness: 0.03, bevelSegments: 2 });
  finGeo.translate(0, 0, -0.06);
  const fin = solid(new THREE.Mesh(finGeo, redMat), 'tailFin');
  fin.rotation.y = Math.PI; // shape +X → world -X (sweep up-and-aft)
  fin.position.set(-5.35, 1.95, 0);
  group.add(fin);

  // Synchronized mid-boom elevator (horizontal stabilizer).
  const elevator = solid(new THREE.Mesh(airfoilSpan(0.7, 0.11, 2.6), hullMatPlainWhite(warmWhite)), 'elevator');
  elevator.position.set(-3.1, 1.78, 0);
  group.add(elevator);

  // Tail skid loop guarding the tail beneath the rotor.
  group.add(
    sweptTube(
      [new THREE.Vector3(-5.6, 1.78, 0), new THREE.Vector3(-5.95, 1.5, 0), new THREE.Vector3(-6.0, 1.4, 0)],
      0.05,
      metalMat,
      'tailSkid',
    ),
  );

  // === MAIN ROTOR HEAD ====================================================
  const mastX = 0.3;
  const hubY = 3.4;
  const mast = solid(new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.14, 1.0, 8), metalMat), 'mast');
  mast.position.set(mastX, hubY - 0.5, 0);
  group.add(mast);
  const swashLower = solid(new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.045, 6, 12), darkMetalMat), 'swashplateLower');
  swashLower.rotation.x = Math.PI / 2;
  swashLower.position.set(mastX, hubY - 0.28, 0);
  group.add(swashLower);

  const rotor = new THREE.Group();
  rotor.name = 'mainRotor';
  rotor.position.set(mastX, hubY, 0);
  populateProcRotorGroup(rotor, 1.0); // scale=1 = canonical 205A-1 proportions
  group.add(rotor);

  // === TAIL ROTOR — on the fin, disc facing RIGHT (+Z, starboard) ===========
  const tailRotor = new THREE.Group();
  tailRotor.name = 'tailRotor';
  const tailMountGrp = makeProcTailMount(tailRotor, 1.0);
  tailMountGrp.position.set(-5.85, 2.7, 0.2);
  group.add(tailMountGrp);

  // === LANDING GEAR — tubular skids =======================================
  for (const side of [-1, 1]) {
    group.add(
      sweptTube(
        [
          new THREE.Vector3(-1.95, 0.12, side * 1.0),
          new THREE.Vector3(-1.0, 0.1, side * 1.0),
          new THREE.Vector3(1.4, 0.1, side * 1.0),
          new THREE.Vector3(2.1, 0.2, side * 1.0),
          new THREE.Vector3(2.55, 0.46, side * 0.97),
          new THREE.Vector3(2.7, 0.66, side * 0.95),
        ],
        0.075,
        metalMat,
        'skidRail',
      ),
    );
    const shoe = solid(new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.05, 0.1), darkMetalMat), 'skidShoe');
    shoe.position.set(-0.2, 0.04, side * 1.0);
    group.add(shoe);
  }
  for (const x of [1.25, -0.75]) {
    group.add(
      sweptTube(
        [
          new THREE.Vector3(x, 0.12, -1.0),
          new THREE.Vector3(x, 0.78, -0.5),
          new THREE.Vector3(x, 0.95, 0),
          new THREE.Vector3(x, 0.78, 0.5),
          new THREE.Vector3(x, 0.12, 1.0),
        ],
        0.06,
        metalMat,
        'skidCrossTube',
      ),
    );
  }

  // === FINISHING DETAILS ==================================================
  for (const side of [-1, 1]) {
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.085, 8, 6), lightMat);
    lamp.name = 'landingLight';
    lamp.position.set(3.78, 0.92, side * 0.28);
    group.add(lamp);
  }
  const pitot = solid(new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.6, 6), metalMat), 'pitot');
  pitot.rotation.z = Math.PI / 2;
  pitot.position.set(3.5, 2.32, 0.22);
  group.add(pitot);
  group.add(sweptTube([new THREE.Vector3(-2.3, 2.05, 0), new THREE.Vector3(-2.45, 2.6, 0.04)], 0.016, darkMetalMat, 'antenna'));
  const navRed = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 6), new THREE.MeshStandardMaterial({ color: 0xff2a2a, emissive: 0xff0000, emissiveIntensity: 0.7 }));
  navRed.position.set(-1.1, 1.55, -1.18);
  group.add(navRed);
  const navGreen = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 6), new THREE.MeshStandardMaterial({ color: 0x2aff5a, emissive: 0x00ff33, emissiveIntensity: 0.7 }));
  navGreen.position.set(-1.1, 1.55, 1.18);
  group.add(navGreen);

  const heli: HelicopterMesh = { group, rotor, tailRotor, bankSign: 1 };
  // Try to swap in the selected downloaded glTF behind this same contract; the
  // procedural model above stays visible as the instant fallback if the load fails
  // (or if the chosen heli has no model — it falls back to the hero Bell 205A-1).
  swapInModel(heli, heliId);
  return heli;
}

/* ========================================================================
 * Geometry builders (module-private)
 * ===================================================================== */

/**
 * Loft a closed superellipse cross-section through every station to skin the whole
 * fuselage as ONE smooth, vertex-colored mesh. Livery is baked per-vertex: white
 * upper body, fire-red lower (the recognizable firefighting split). Winding is chosen
 * so computeVertexNormals() yields OUTWARD normals (CCW front faces); rings wrap
 * seamlessly (modulo R) and caps reuse ring verts so shading welds across the hull.
 */
function buildHull(
  stations: { x: number; cy: number; w: number; top: number; bot: number; n: number }[],
  R: number,
  white: THREE.Color,
  red: THREE.Color,
): THREE.BufferGeometry {
  const S = stations.length;
  const positions: number[] = [];
  const colors: number[] = [];
  const push = (x: number, y: number, z: number, c: THREE.Color) => {
    positions.push(x, y, z);
    colors.push(c.r, c.g, c.b);
  };

  for (let i = 0; i < S; i++) {
    const st = stations[i];
    for (let j = 0; j < R; j++) {
      const th = (j / R) * Math.PI * 2;
      const c = Math.cos(th);
      const s = Math.sin(th);
      const z = st.w * Math.sign(c) * Math.pow(Math.abs(c), 2 / st.n);
      const hy = s >= 0 ? st.top : st.bot;
      const y = st.cy + hy * Math.sign(s) * Math.pow(Math.abs(s), 2 / st.n);
      const lv = (y - st.cy) / (s >= 0 ? st.top : st.bot); // -1 belly .. +1 roof
      push(st.x, y, z, lv < -0.32 ? red : white);
    }
  }
  const noseApex = positions.length / 3;
  push(stations[0].x + 0.18, stations[0].cy - 0.04, 0, white);
  const tailApex = positions.length / 3;
  const last = stations[S - 1];
  push(last.x - 0.1, last.cy, 0, red);

  const idx: number[] = [];
  for (let i = 0; i < S - 1; i++) {
    for (let j = 0; j < R; j++) {
      const a = i * R + j;
      const b = i * R + ((j + 1) % R);
      const c = (i + 1) * R + ((j + 1) % R);
      const d = (i + 1) * R + j;
      idx.push(a, b, c, a, c, d);
    }
  }
  for (let j = 0; j < R; j++) idx.push(noseApex, (j + 1) % R, j); // nose cap (faces +X)
  const base = (S - 1) * R;
  for (let j = 0; j < R; j++) idx.push(tailApex, base + j, base + ((j + 1) % R)); // tail cap

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

// --- Shared materials for the exported proc-rotor builders -------------------
// Module-level singletons reused across all helicopter instances and game restarts.
// Flagged `userData.shared` so Game.dispose()'s scene traversal skips them.
const PROC_ROTOR_METAL = new THREE.MeshStandardMaterial({ color: 0x70757d, roughness: 0.38, metalness: 0.75 });
const PROC_ROTOR_DARK  = new THREE.MeshStandardMaterial({ color: 0x3a3e44, roughness: 0.45, metalness: 0.6 });
const PROC_ROTOR_BLADE = new THREE.MeshStandardMaterial({ color: 0x191b1f, roughness: 0.5,  metalness: 0.3 });
const PROC_ROTOR_DISC  = new THREE.MeshStandardMaterial({ color: 0xcccccc, roughness: 0.9,  metalness: 0, transparent: true, opacity: 0.07, side: THREE.DoubleSide });
PROC_ROTOR_METAL.userData.shared = true;
PROC_ROTOR_DARK.userData.shared  = true;
PROC_ROTOR_BLADE.userData.shared = true;
PROC_ROTOR_DISC.userData.shared  = true;

/**
 * Populate `target` with the Bell 205A-1 / Bell 212 two-blade main-rotor assembly:
 * upper swashplate, hub box + cap, blade grips + pitch links, two airfoil blades
 * (pre-coned), the Bell-Hiller stabilizer bar (flybar) with weighted paddles, and a
 * faint translucent disc so the spin reads as a blur. `scale` = targetLen / 10.5
 * (the canonical 205A-1 baseline). Caller positions `target` at the mast hub and
 * increments `target.rotation.y` each frame.
 */
export function populateProcRotorGroup(target: THREE.Object3D, scale: number): void {
  const s = scale;
  const cast = (m: THREE.Mesh, name: string): THREE.Mesh => { m.name = name; m.castShadow = true; return m; };

  const swashU = cast(new THREE.Mesh(new THREE.TorusGeometry(0.22*s, 0.04*s, 6, 12), PROC_ROTOR_METAL), 'swashplateUpper');
  swashU.rotation.x = Math.PI / 2; swashU.position.y = -0.18*s;
  target.add(swashU);

  const hub = cast(new THREE.Mesh(new THREE.BoxGeometry(0.66*s, 0.18*s, 0.3*s), PROC_ROTOR_METAL), 'rotorHub');
  target.add(hub);
  const hubCap = cast(new THREE.Mesh(new THREE.CylinderGeometry(0.16*s, 0.2*s, 0.2*s, 8), PROC_ROTOR_METAL), 'rotorHubCap');
  hubCap.position.y = 0.15*s;
  target.add(hubCap);

  for (const sgn of [-1, 1]) {
    const grip = cast(new THREE.Mesh(new THREE.CylinderGeometry(0.09*s, 0.09*s, 0.5*s, 8), PROC_ROTOR_METAL), 'bladeGrip');
    grip.rotation.z = Math.PI / 2; grip.position.set(sgn * 0.52*s, 0, 0);
    target.add(grip);
    const link = cast(new THREE.Mesh(new THREE.CylinderGeometry(0.022*s, 0.022*s, 0.32*s, 6), PROC_ROTOR_DARK), 'pitchLink');
    link.position.set(sgn * 0.42*s, -0.12*s, 0.16*s); link.rotation.x = 0.2;
    target.add(link);
  }

  const bladeGeo = airfoilSpan(0.5*s, 0.06*s, 5.0*s);
  bladeGeo.rotateY(Math.PI / 2); bladeGeo.rotateZ(0.045); bladeGeo.translate(0.68*s, 0, 0);
  for (const sgn of [-1, 1]) {
    const blade = cast(new THREE.Mesh(bladeGeo, PROC_ROTOR_BLADE), 'rotorBlade');
    blade.rotation.y = sgn < 0 ? Math.PI : 0;
    target.add(blade);
  }

  const flybar = cast(new THREE.Mesh(new THREE.CylinderGeometry(0.035*s, 0.035*s, 4.0*s, 8), PROC_ROTOR_METAL), 'flybar');
  flybar.rotation.x = Math.PI / 2; flybar.position.y = 0.2*s;
  target.add(flybar);
  for (const sgn of [-1, 1]) {
    const wt = cast(new THREE.Mesh(new THREE.CapsuleGeometry(0.09*s, 0.26*s, 3, 6), PROC_ROTOR_DARK), 'flybarWeight');
    wt.rotation.x = Math.PI / 2; wt.position.set(0, 0.2*s, sgn * 1.95*s);
    target.add(wt);
    const rod = cast(new THREE.Mesh(new THREE.CylinderGeometry(0.018*s, 0.018*s, 0.32*s, 6), PROC_ROTOR_DARK), 'flybarLink');
    rod.position.set(0, 0.06*s, sgn * 0.5*s); rod.rotation.x = sgn * 0.4;
    target.add(rod);
  }

  const disc = new THREE.Mesh(new THREE.CylinderGeometry(5.4*s, 5.4*s, 0.02*s, 24), PROC_ROTOR_DISC);
  disc.name = 'rotorDisc';
  target.add(disc);
}

/**
 * Build the tail-rotor MOUNT group that carries `tailTarget` (the spin group).
 * Also populates `tailTarget` with a gearbox-flanking hub cylinder + single airfoil
 * blade. Mount has rotation.y = −π/2 so `tailTarget.rotation.x` sweeps the disc
 * sideways (anti-torque). `scale` = targetLen / 10.5. Caller positions the returned
 * mount in the parent group, then adds it with `group.add(mount)`.
 */
export function makeProcTailMount(tailTarget: THREE.Object3D, scale: number): THREE.Group {
  const s = scale;
  const cast = (m: THREE.Mesh, name: string): THREE.Mesh => { m.name = name; m.castShadow = true; return m; };

  const mount = new THREE.Group();
  mount.name = 'tailRotorMount';
  mount.rotation.y = -Math.PI / 2;

  const gearbox = cast(new THREE.Mesh(new THREE.SphereGeometry(0.17*s, 8, 6), PROC_ROTOR_METAL), 'tailGearbox');
  gearbox.scale.set(1.2, 1, 1); gearbox.position.z = -0.1*s;
  mount.add(gearbox);

  tailTarget.position.set(0, 0, 0);
  tailTarget.rotation.set(0, 0, 0);
  mount.add(tailTarget);

  const tailHub = cast(new THREE.Mesh(new THREE.CylinderGeometry(0.08*s, 0.08*s, 0.22*s, 8), PROC_ROTOR_METAL), 'tailRotorHub');
  tailHub.rotation.z = Math.PI / 2;
  tailTarget.add(tailHub);

  const tBlade = airfoilSpan(0.15*s, 0.04*s, 1.7*s);
  tBlade.rotateX(Math.PI / 2); // span → local Y (disc plane)
  tailTarget.add(cast(new THREE.Mesh(tBlade, PROC_ROTOR_BLADE), 'tailBlade'));

  return mount;
}

/**
 * A symmetric lenticular airfoil (ellipse cross-section: `chord` × `thick`) extruded
 * along Z for `span`, centered on Z, with a small bevel so the ends round off. Used
 * for the rotor blades, the elevator, and the tail-rotor bar.
 */
export function airfoilSpan(chord: number, thick: number, span: number): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.absellipse(0, 0, chord / 2, thick / 2, 0, Math.PI * 2, false, 0);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: span,
    bevelEnabled: true,
    bevelSize: thick * 0.4,
    bevelThickness: thick * 0.4,
    bevelSegments: 1,
    curveSegments: 8,
    steps: 1,
  });
  geo.translate(0, 0, -span / 2);
  geo.computeVertexNormals();
  return geo;
}

/** A plain (non-vertex-colored) white standard material for parts that share the hull tone. */
function hullMatPlainWhite(white: THREE.Color): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: white.clone(), roughness: 0.46, metalness: 0.12 });
}
