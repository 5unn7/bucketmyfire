import * as THREE from 'three';

/**
 * Procedural low-poly helicopter styled after a Bell 205B / UH-1 "Huey" —
 * the classic single-engine water-bomber.
 *
 * Zero binary assets: every part is a Three.js geometry primitive (box, cylinder,
 * sphere) welded together under a few Groups, then shaded by the scene's
 * directional sun + ambient with MeshStandardMaterial. Swap-in real art later by
 * replacing this whole factory — nothing else needs the internals, only the
 * { group, rotor, tailRotor } handles.
 *
 * What makes it read as a Huey (and not a generic chopper):
 *  - rounded "turtledeck" cabin roof over a tall, square-shouldered cabin;
 *  - a chin that slopes DOWN and forward into a wrap-around greenhouse canopy;
 *  - the raised engine cowling hump (+ exhaust stack) behind the rotor mast,
 *    tapering into a long, slender tail boom;
 *  - swept vertical fin + a mid-boom synchronized elevator;
 *  - tubular skids that curve up at the front;
 *  - and the signature two-blade teetering rotor with a STABILIZER BAR (flybar)
 *    mounted 90° to the blades, weighted paddles on its tips.
 *
 * Conventions the flight model depends on (do not break these):
 *  - Y is up. The aircraft flies in the XZ plane; altitude is along +Y.
 *  - The NOSE points +X (local +X is forward). The tail boom extends toward -X.
 *  - Centered on the local origin in X/Z, and shifted so the SKIDS' BOTTOM sits
 *    at ~y = 0. The caller does `group.position.y = altitude` for ground clearance,
 *    so the model already rests correctly on the ground plane at altitude 0.
 *
 * Scale: vehicle-sized. Overall length ~9 world units nose-to-tail in a world
 * that is hundreds of units across. Low poly throughout — a few hundred triangles
 * total to stay comfortable at mobile 60fps.
 */

export interface HelicopterMesh {
  group: THREE.Group; // the whole aircraft
  rotor: THREE.Object3D; // MAIN rotor — caller spins this about its local Y each frame
  tailRotor: THREE.Object3D; // tail rotor — caller spins this about its local X (or Z) each frame
}

export function createHelicopter(): HelicopterMesh {
  const group = new THREE.Group();
  group.name = 'helicopter';

  // --- Palette: a clean civilian Bell 205B firefighting livery ---
  // Warm white shell, bold red cheatline/trim, dark engine + boom-top, steel gear.
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0xf0ede4, roughness: 0.5, metalness: 0.08 });
  const redMat = new THREE.MeshStandardMaterial({ color: 0xcf2118, roughness: 0.45, metalness: 0.1 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x33373d, roughness: 0.6, metalness: 0.25 });
  const metalMat = new THREE.MeshStandardMaterial({ color: 0x6a6f77, roughness: 0.4, metalness: 0.7 });
  const bladeMat = new THREE.MeshStandardMaterial({ color: 0x1b1d21, roughness: 0.55, metalness: 0.25 });
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0x86bbe6,
    roughness: 0.12,
    metalness: 0.15,
    transparent: true,
    opacity: 0.5,
  });

  // Helper: solid parts cast shadows (caller may enable shadow maps).
  const solid = (mesh: THREE.Mesh, name: string): THREE.Mesh => {
    mesh.name = name;
    mesh.castShadow = true;
    return mesh;
  };
  // Helper: a cylinder laid along the X axis (Three's cylinders default to +Y).
  const tubeX = (rTop: number, rBot: number, len: number, seg: number, mat: THREE.Material) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBot, len, seg), mat);
    m.rotation.z = Math.PI / 2;
    return m;
  };

  // === FUSELAGE ============================================================
  // Tall, square-shouldered lower cabin (the doors live here)...
  const cabin = solid(new THREE.Mesh(new THREE.BoxGeometry(3.5, 1.5, 2.15), bodyMat), 'cabin');
  cabin.position.set(0.6, 1.5, 0);
  group.add(cabin);

  // ...capped by a rounded "turtledeck" roof — a fat cylinder lying along X.
  // This single curve is most of the Huey's cabin read.
  const roof = solid(tubeX(1.02, 1.02, 3.5, 12, bodyMat), 'roof');
  roof.position.set(0.6, 2.05, 0);
  roof.scale.set(1, 1, 0.93); // squeeze the cross-section to the cabin width
  group.add(roof);

  // Red cheatline stripe wrapping the cabin sides at door-sill height.
  const stripe = solid(new THREE.Mesh(new THREE.BoxGeometry(3.55, 0.34, 2.2), redMat), 'cheatline');
  stripe.position.set(0.6, 1.62, 0);
  group.add(stripe);

  // Dark belly pan under the cabin.
  const belly = solid(new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.5, 2.0), darkMat), 'belly');
  belly.position.set(0.6, 0.92, 0);
  group.add(belly);

  // --- Nose: a chin that juts forward and DROOPS below the cabin floor ---
  const chin = solid(new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.25, 1.95), bodyMat), 'chin');
  chin.position.set(2.7, 1.2, 0);
  group.add(chin);

  // Drooping rounded nose cap — sits LOW and tapered, below the cabin roofline,
  // for the Huey's characteristic snout.
  const noseCap = solid(new THREE.Mesh(new THREE.SphereGeometry(1.0, 12, 8), bodyMat), 'noseCap');
  noseCap.scale.set(0.72, 0.82, 0.9);
  noseCap.position.set(3.3, 1.02, 0);
  group.add(noseCap);

  // === GREENHOUSE GLASS ====================================================
  // Wrap-around windscreen: a flattened sphere sweeping from the roof down to the
  // chin, kept just under the roofline so the roof stays the high point.
  const windscreen = new THREE.Mesh(new THREE.SphereGeometry(1.05, 14, 10), glassMat);
  windscreen.name = 'windscreen';
  windscreen.scale.set(1.32, 0.96, 1.0);
  windscreen.position.set(2.25, 1.92, 0);
  group.add(windscreen);

  // Lower chin "bubble" windows (the Huey's footwell glass).
  const chinGlass = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.85, 1.75), glassMat);
  chinGlass.name = 'chinGlass';
  chinGlass.position.set(2.95, 1.28, 0);
  group.add(chinGlass);

  // Door windows down each side of the cabin.
  for (const z of [-1.06, 1.06]) {
    const win = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.7, 0.06), glassMat);
    win.name = 'doorWindow';
    win.position.set(0.7, 2.0, z);
    group.add(win);
  }

  // === ENGINE DECK + TAIL BOOM ============================================
  // Raised engine cowling hump behind the rotor mast — the Huey's "back".
  const cowl = solid(new THREE.Mesh(new THREE.BoxGeometry(1.7, 1.05, 1.65), darkMat), 'engineCowl');
  cowl.position.set(-1.45, 2.35, 0);
  group.add(cowl);

  // A rounded top to the cowl so it blends to the boom.
  const cowlTop = solid(tubeX(0.78, 0.78, 1.7, 10, darkMat), 'engineCowlTop');
  cowlTop.position.set(-1.45, 2.55, 0);
  cowlTop.scale.set(1, 1, 0.95);
  group.add(cowlTop);

  // Exhaust stack venting up-and-aft off the engine deck.
  const exhaust = solid(new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 0.9, 8), metalMat), 'exhaust');
  exhaust.rotation.z = Math.PI / 2.6; // cant it back
  exhaust.position.set(-2.3, 2.85, 0);
  group.add(exhaust);

  // Long, slender tapering tail boom reaching back toward -X.
  const boom = solid(tubeX(0.24, 0.5, 4.6, 9, bodyMat), 'tailBoom');
  boom.position.set(-3.8, 2.05, 0);
  group.add(boom);

  // Red trim band near the boom tip.
  const boomBand = solid(tubeX(0.27, 0.27, 0.5, 9, redMat), 'boomBand');
  boomBand.position.set(-5.6, 2.05, 0);
  group.add(boomBand);

  // Mid-boom synchronized elevator (horizontal stabilizer).
  const elevator = solid(new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.12, 2.5), bodyMat), 'elevator');
  elevator.position.set(-3.2, 2.05, 0);
  group.add(elevator);

  // Swept-back vertical fin at the very tail.
  const fin = solid(new THREE.Mesh(new THREE.BoxGeometry(1.3, 1.6, 0.16), redMat), 'tailFin');
  fin.rotation.z = -0.32; // sweep the top of the fin aft
  fin.position.set(-6.0, 2.75, 0);
  group.add(fin);

  // Small ventral fin under the boom tip.
  const ventral = solid(new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.7, 0.14), darkMat), 'ventralFin');
  ventral.rotation.z = 0.5;
  ventral.position.set(-6.0, 1.65, 0);
  group.add(ventral);

  // === MAIN ROTOR (returned as `rotor`) ===================================
  // Mast lifts the hub above the cabin; the rotor Object3D is centered on the
  // mast axis so spinning it about its own +Y looks correct.
  const mast = solid(new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.18, 0.85, 8), metalMat), 'mast');
  mast.position.set(0.6, 3.15, 0);
  group.add(mast);

  const rotor = new THREE.Group();
  rotor.name = 'mainRotor';
  rotor.position.set(0.6, 3.5, 0); // sit on top of the mast, over the cabin

  // Teetering hub: a wide flat "saddle" — chunkier than a plain cylinder.
  const hub = solid(new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.22, 0.5), metalMat), 'rotorHub');
  rotor.add(hub);
  const hubCap = solid(new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.3, 8), metalMat), 'rotorHubCap');
  rotor.add(hubCap);

  // Two long blades, span ~9.4 along the X axis, with pale tips.
  const bladeGeo = new THREE.BoxGeometry(9.4, 0.07, 0.46);
  const bladeA = solid(new THREE.Mesh(bladeGeo, bladeMat), 'rotorBladeA');
  const bladeB = solid(new THREE.Mesh(bladeGeo, bladeMat), 'rotorBladeB');
  bladeB.rotation.y = Math.PI; // opposite blade of the SAME 2-blade rotor (180°)
  rotor.add(bladeA, bladeB);
  for (const sgn of [-1, 1]) {
    const tip = solid(new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.075, 0.47), bodyMat), 'bladeTip');
    tip.position.set(sgn * 4.4, 0, 0);
    rotor.add(tip);
  }

  // --- Stabilizer bar (flybar): the signature Huey detail ---
  // A slim weighted bar mounted 90° to the blades, shorter than the rotor span,
  // with a small paddle weight on each tip. Spins with the rotor.
  const flybar = solid(new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 4.6, 6), metalMat), 'flybar');
  flybar.rotation.x = Math.PI / 2; // lay it along Z (perpendicular to the blades)
  flybar.position.y = 0.16; // ride just above the blades
  rotor.add(flybar);
  for (const sgn of [-1, 1]) {
    const weight = solid(new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.4, 8), darkMat), 'flybarWeight');
    weight.rotation.x = Math.PI / 2;
    weight.position.set(0, 0.16, sgn * 2.25);
    rotor.add(weight);
  }

  // Faint translucent disc so the spin reads as a blur even when slow.
  const discMat = new THREE.MeshStandardMaterial({
    color: 0xcccccc,
    roughness: 0.9,
    metalness: 0.0,
    transparent: true,
    opacity: 0.1,
    side: THREE.DoubleSide,
  });
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(4.8, 4.8, 0.02, 24), discMat);
  disc.name = 'rotorDisc';
  rotor.add(disc);

  group.add(rotor);

  // === TAIL ROTOR (returned as `tailRotor`) ===============================
  // On the LEFT side of the fin (real Hueys carry it on the port side). The
  // caller spins this about its local X; blades are built in the YZ plane so an
  // X spin sweeps them like a real tail rotor.
  const tailRotor = new THREE.Group();
  tailRotor.name = 'tailRotor';
  tailRotor.position.set(-6.0, 2.75, 0.3);

  const tailHub = solid(new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.2, 6), metalMat), 'tailRotorHub');
  tailHub.rotation.z = Math.PI / 2; // hub axis along X
  tailRotor.add(tailHub);

  const tBladeGeo = new THREE.BoxGeometry(0.05, 1.7, 0.2);
  const tBladeA = solid(new THREE.Mesh(tBladeGeo, bladeMat), 'tailBladeA');
  const tBladeB = solid(new THREE.Mesh(tBladeGeo, bladeMat), 'tailBladeB');
  tBladeB.rotation.x = Math.PI / 2;
  tailRotor.add(tBladeA, tBladeB);

  group.add(tailRotor);

  // === LANDING SKIDS ======================================================
  // Tubular rails with bottoms at y≈0, curving up at the front, on angled struts.
  const railGeo = new THREE.CylinderGeometry(0.11, 0.11, 4.4, 6);
  for (const z of [-0.98, 0.98]) {
    const rail = solid(new THREE.Mesh(railGeo, metalMat), 'skidRail');
    rail.rotation.z = Math.PI / 2;
    rail.position.set(0.1, 0.12, z);
    group.add(rail);

    // Up-curved front toe of the skid.
    const toe = solid(new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.9, 6), metalMat), 'skidToe');
    toe.rotation.z = Math.PI / 2 - 0.6; // tip the front up
    toe.position.set(2.5, 0.32, z);
    group.add(toe);
  }

  // A-frame cross struts from the rails up to the belly.
  const strutGeo = new THREE.CylinderGeometry(0.07, 0.07, 2.1, 5);
  for (const x of [1.4, -0.9]) {
    const strut = solid(new THREE.Mesh(strutGeo, metalMat), 'skidStrut');
    strut.rotation.x = Math.PI / 2; // span across Z
    strut.position.set(x, 0.6, 0);
    group.add(strut);
  }

  return { group, rotor, tailRotor };
}
