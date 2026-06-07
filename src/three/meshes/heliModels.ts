import * as THREE from 'three';
import { makeGLTFLoader } from './gltfLoader';
import { HelicopterMesh, populateProcRotorGroup, makeProcTailMount } from './helicopter';

/**
 * Selectable helicopter MODELS. Each entry swaps a downloaded glTF in BEHIND the
 * procedural Bell 205A-1 built by createHelicopter(), keeping the exact
 * { group, rotor, tailRotor } contract so nothing downstream changes. The
 * procedural model is shown immediately and stays as the instant fallback; when
 * the glTF finishes loading we clear the procedural visuals out of `group`, drop
 * the real model in, and re-parent its rotor(s) into the existing handles so the
 * caller's per-frame spin keeps working.
 *
 * Adding a heli = one entry here + one card in ui/profile.ts (HELIS). The Sketchfab
 * auto-convert renames nodes to Object_N (and merges some), so each model's rotor /
 * fuselage parts are identified by inspection and pinned per-spec below:
 *
 *   - Bell 205A-1 (uh1)  : node Object_13 = main rotor, Object_3 = tail rotor; the export is
 *     untextured (specular-glossiness clay modern GLTFLoader can't bind) so the body repaints
 *     wholesale.
 *   - Bell 212 (bell212) : a SINGLE merged mesh — no separable rotor node — so we SLICE the real
 *     main blades out of the mesh by a top-slab Y plane so they spin; the (unseparable) tail rotor
 *     gets a small procedural one. The slab plane is tuned to grab ONLY the two blades and EXCLUDE
 *     the rotor-head stabilizer/flybar (the perpendicular weighted bar that sits one band below
 *     the blades): sliced in, the flybar spins too and sweeps as a short second rotor — reading as
 *     duplicate / half-extra blades. Left in the body it stays static at the hub, like real
 *     rotor-head hardware. This is the one TEXTURED body, so its paint is split off the diffuse map
 *     (splitTexturedBody) — the orange panels repaint, the grey windows keep their texture.
 *   - UH-60 Black Hawk   : separable main + tail rotor nodes (NOTE both are GROUPs, not meshes — so
 *     blades are darkened by traversing the rotor handles, not by node identity). Its US Army skin
 *     is also spec-gloss → renders clay → repaints wholesale. GLTFLoader sanitizes node names
 *     (whitespace → '_'), so the specs use the sanitized form ('main rotor prop_7' → '..._prop_7').
 *
 * All three wear the High-Vis Hero fire-bomber livery (see Livery / makeBodyMat / paintLivery): a
 * crisp three-zone paint — light roof, signature flank, near-black sill — split by a thin EMISSIVE
 * cheatline that blooms through the post-fx, each ship in its own hue so the fleet reads as one.
 *
 * Orientation/scale are normalized per-spec: the model is yawed so its nose points
 * world +X, scaled so the fuselage is `targetLen` units nose-to-tail, centered in
 * X/Z, and seated with the skids at y = 0 (matching the procedural model's frame).
 */

/**
 * A "High-Vis Hero" fire-bomber livery: a crisp three-zone horizontal paint scheme baked as
 * vertex colours — a light ROOF, a signature FLANK, a near-black SILL/belly — split by a thin
 * hot LINE (the cheatline) that is rendered EMISSIVE so it blooms through the post-fx. Zones are
 * keyed to the body's own height fraction (0 = skids, 1 = cabin roof), so the scheme is
 * pose-independent and scale-independent. Every airframe wears the same grammar in its own hue,
 * which is what makes the three ships read as one fleet. See paintLivery().
 */
export interface Livery {
  roof: number; // upper band (light)
  flank: number; // signature mid band — the ship's identity colour
  sill: number; // lower band / belly (near-black)
  line: number; // thin cheatline at the roof/flank break (also the emissive glow colour)
  glass: number; // canopy tint for separable/transparent glass meshes
  blade: number; // rotor + tail-rotor colour (matte dark)
  roofAt: number; // height fraction ≥ this → roof
  sillAt: number; // height fraction ≤ this → sill
  lineAt: number; // height fraction at the cheatline centre
  lineHalf: number; // half-thickness of the cheatline (fraction)
  glow: number; // emissive intensity of the cheatline (blooms via post-fx)
}

export interface HeliModelSpec {
  /** glTF/glb URL, relative to the Vite base (prefixed at construction below). */
  url: string;
  /** Rotation about Y (rad) that points the model's NOSE down world +X. */
  yaw: number;
  /** Desired nose-to-tail length in world units (measured along X after `yaw`). */
  targetLen: number;
  /** Node measured for scale + fore/aft centering; falls back to the whole model. */
  fuselageNode?: string;
  /** Separable main-rotor node → re-parented into the spinnable `rotor` handle. */
  mainRotorNode?: string;
  /** Separable tail-rotor node → spun about the lateral hub axis. */
  tailRotorNode?: string;
  /** The fire-bomber paint scheme baked onto this airframe. Clay (untextured) exports are
   *  repainted wholesale; a textured body is split by its diffuse map so only the painted
   *  panels are recoloured and the windows/gear keep their texture (see splitTexturedBody). */
  livery: Livery;
  /** Visual roll sign. A chirality-MIRRORED glTF (left/right flipped — it renders fine, normals are
   *  self-consistent, but the shared flight `bank` rolls it the WRONG way) sets this to −1 so Game
   *  negates the roll for it. A lateral mirror leaves pitch/yaw untouched, so ONLY bank needs the flip.
   *  Default +1 (the 205/212 roll correctly off the shared sign). */
  bankSign?: number;
  /** Merged single-mesh model: slice the MAIN rotor out of the mesh by taking the top
   *  `splitRotorTopFrac` of the mesh's OWN local Y-extent (e.g. 0.12 = top 12%). Used to strip
   *  the model's blade geometry — either to spin it, or (with `useProcRotor`) to discard it. */
  splitRotorTopFrac?: number;
  /** Translate the whole MAIN-rotor disc (group-local units, applied AFTER the slice centroid).
   *  `[x, y, z]`: +x = toward the nose, +y = up, +z = starboard. Pivot AND blades move together,
   *  so it stays a clean centred spin — use it to lift the disc onto the mast and centre it over
   *  the body. Dial it live with the X/Y/Z sliders in the `?heliview` panel, then paste the
   *  readout here. Default [0,0,0]. */
  rotorOffset?: [number, number, number];
  /** Re-pivot the MAIN rotor's spin CENTRE WITHOUT moving the blades' rest pose (the handle shifts
   *  by +offset, the blades counter-shift by −offset). Use it to sit the spin axis on the true
   *  centre of the sliced blades so they don't sweep an off-centre/lopsided disc. `[x, _, z]` —
   *  only the horizontal axes matter (a Y-spin can't move a point vertically). Default [0,0,0]. */
  rotorPivotOffset?: [number, number, number];
  /** Translate the mounted TAIL rotor (group-local units) for a fine nudge after slicing/mounting.
   *  `[x, y, z]`: +x = toward the nose, +y = up, +z = starboard. */
  tailRotorOffset?: [number, number, number];
  /** Slice the model's OWN tail rotor out of the merged mesh by a box (in the mesh's LOCAL coords)
   *  and spin it — for a merged model whose tail rotor is real geometry but has no separable node.
   *  Align the box visually with the `?heliview` slice-box sliders, then paste the readout here. The
   *  sliced disc mounts + spins about its lateral hub axis (same path as a separable tail node). */
  tailRotorSlice?: { center: [number, number, number]; size: [number, number, number] };
  /** Model has no separable/sliceable tail rotor → mount a small procedural 2-blade one. */
  procTailRotor?: boolean;
  /** Scale multiplier for the procedural tail rotor (1 = default radius). Dial live in `?heliview`. */
  tailRotorScale?: number;
  /** Group-local Z offset for the procedural tail rotor mount. Default 0 (centerline).
   *  Positive = starboard. Use when the tail fin is at Z=0 and the rotor mounts on one side. */
  procTailRotorZ?: number;
  /** Replace both the main and tail rotor with the shared procedural 205A-1 assembly (hub,
   *  airfoil blades, flybar, gearbox). `splitRotorMinY` is still used to strip the merged
   *  mesh's blade geometry from the body so the proc rotor sits cleanly on top. */
  useProcRotor?: boolean;
  /** Brand icon decal on both cabin doors. `offset` = the PORT (+Z) door-centre in group-local
   *  (= world) units [+x nose, +y up, +z port]; the starboard copy mirrors to −z and faces outward.
   *  `size` = decal HEIGHT in world units (width locked to the icon's ~0.81:1 aspect). Dial live with
   *  the Door-logo sliders in `?heliview`, then paste the readout here. Omit → no door logo. */
  doorLogo?: { offset: [number, number, number]; size: number };
}

// Vite serves `public/` at the site root (base: './'); BASE_URL makes the path
// portable across static hosts.
const BASE = import.meta.env.BASE_URL;

export const HELI_MODELS: Record<string, HeliModelSpec> = {
  // The hero: the OPTIMIZED Huey glb (gltf-transform weld+simplify+prune+webp,
  // ~40k tris / 1.9 MB, node names preserved so Object_13 stays separable).
  'bell-205a1': {
    url: BASE + 'models/uh1/huey-opt.glb',
    yaw: Math.PI, // model nose −X → world +X
    targetLen: 10.5,
    fuselageNode: 'Object_22',
    mainRotorNode: 'Object_13',
    tailRotorNode: 'Object_3',
    // Crimson tanker: white roof, fire-red flank, graphite belly, hot-amber cheatline.
    livery: {
      roof: 0xeceff1, flank: 0xc12a1b, sill: 0x16181d, line: 0xff8a1e, glass: 0x0d1622, blade: 0x1b1d22,
      roofAt: 0.66, sillAt: 0.2, lineAt: 0.6, lineHalf: 0.035, glow: 2.2,
    },
    // Brand mark on both cabin doors ([fore/aft, height]; z fallback) — tuned in ?heliview.
    doorLogo: { offset: [0.5, 1.2, 0.55], size: 0.72 },
  },
  // Bell 212 — a single merged mesh (Bell204_0). Fore/aft runs along the model's Z, so a
  // −90° yaw swings it onto +X. No separable rotor node, so we SLICE the model's OWN main
  // blades out of the merged mesh by a top-Y slab and spin THAT real geometry (no procedural
  // rotor). Measured vertex layout (mesh Y-extent ≈ 0.90): cabin roof tops ~0.60, a tall thin
  // mast runs 0.60–0.78, the Bell-Hiller flybar sits 0.70–0.80, the two main blades are the
  // wide Z-span 3.07 slab at 0.80–0.85, and the hub caps 0.85–0.90. `splitRotorTopFrac: 0.11`
  // cuts at Y ≈ 0.80 — grabbing blades + hub while EXCLUDING the flybar one band below (which,
  // if sliced in, spins as a ghost perpendicular rotor). The unseparable tail rotor stays part
  // of the body (static). The mast stays on the body, so the spun blades sit on it, connected.
  'bell-212': {
    url: BASE + 'models/bell212/bell212.glb',
    yaw: -Math.PI / 2,
    targetLen: 11,
    fuselageNode: 'Bell204_0',
    splitRotorTopFrac: 0.11,
    // Rotor placement — dial live with the ?heliview sliders, then paste the readouts here.
    // All [toward-nose, up, starboard] in group-local units.
    rotorOffset: [-0.06, 0.08, 0], // main disc sits on the mast / centred over the body — LOCKED
    rotorPivotOffset: [1.16, 0, 0], // main spin centre on the blades' middle (X/Z only) — LOCKED
    // The model has NO tail-rotor geometry (only a fin), so spin a clean procedural 2-blade on it.
    // Position + size dialled live in ?heliview, then pasted here.
    procTailRotor: true,
    tailRotorOffset: [0.38, 0.32, 0.2], // on the fin — LOCKED
    tailRotorScale: 0.7, // LOCKED
    // Gold medium: the orange stock paint is split off its texture and repainted — white roof,
    // amber-gold flank, graphite belly, molten-orange cheatline; the grey windows keep their map.
    livery: {
      roof: 0xe9eced, flank: 0xd29a1f, sill: 0x1d1f24, line: 0xff5a26, glass: 0x0d1622, blade: 0x17181c,
      roofAt: 0.64, sillAt: 0.22, lineAt: 0.58, lineHalf: 0.035, glow: 2.0,
    },
    // Brand mark on both cabin doors ([fore/aft, height]; z fallback) — tuned in ?heliview.
    doorLogo: { offset: [1.4, 0.94, 0.84], size: 0.78 },
  },
  // UH-60M Black Hawk (low poly). Nose at +Z (the tail rotor sits at −Z), so a +90°
  // yaw points it down +X. Both rotors are separable and keep the model's own livery.
  // NOTE: GLTFLoader sanitizes node names (whitespace → '_'), so the lookups below use
  // the SANITIZED form ('main rotor prop_7' → 'main_rotor_prop_7'), not the raw glTF name.
  'uh-60': {
    url: BASE + 'models/blackhawk/us_army_uh-60m_black_hawk_low_poly_model/scene.gltf',
    yaw: Math.PI / 2,
    targetLen: 12,
    fuselageNode: 'Fuselage_6',
    mainRotorNode: 'main_rotor_prop_7',
    tailRotorNode: 'TAIL_ROTOR_4',
    // Banks correctly off the shared `bank` (default bankSign +1) — same chirality as the 205/212.
    // (An earlier −1 here, on a guess that this glTF was lateral-mirrored, actually rolled it the
    // WRONG way: a left turn lifted the wrong wing. The model is NOT mirrored, so no negation.)
    // Tactical olive: the spec-gloss army skin can't bind in modern three (renders clay), so it
    // repaints clean — pale-sage roof, olive-drab flank (its signature), near-black belly, hi-vis
    // safety-yellow line. Grounded military green; reads against forest + smoke, distinct from the
    // crimson 205 + gold 212.
    livery: {
      roof: 0xb9c2a6, flank: 0x4a5a36, sill: 0x14160f, line: 0xffd21a, glass: 0x0d1622, blade: 0x17181c,
      roofAt: 0.66, sillAt: 0.2, lineAt: 0.6, lineHalf: 0.04, glow: 2.0,
    },
    // Brand mark on both cabin doors ([fore/aft, height]; z fallback) — tuned in ?heliview.
    doorLogo: { offset: [-2.02, 1.16, 0.32], size: 0.78 },
  },
};

/**
 * Swap the glTF for `heliId` in behind the procedural helicopter. Unknown / undefined
 * ids fall back to the hero Bell 205A-1, so an old save or a model-less pick is safe.
 */
export function swapInModel(heli: HelicopterMesh, heliId?: string, onReady?: () => void): void {
  const spec = HELI_MODELS[heliId ?? ''] ?? HELI_MODELS['bell-205a1'];
  const { group, rotor, tailRotor } = heli;

  // Hide the procedural placeholder while the real model streams in, so players never
  // see the wrong airframe flash before it swaps. Revealed again only if the load fails
  // (the procedural model is then the fallback). Synchronous, so it hides from frame 1.
  const placeholder = group.children.slice();
  for (const c of placeholder) c.visible = false;

  makeGLTFLoader().load(
    spec.url,
    (gltf) => {
      const model = gltf.scene;
      model.name = 'heliModel';
      model.rotation.y = spec.yaw;
      // Mirrored-glTF roll fix: a left/right-flipped model rolls backwards off the shared `bank`, so
      // Game negates its roll. Set only now that the REAL model is in — a failed load keeps the +1
      // default for the procedural Bell 205 fallback (which is NOT mirrored).
      heli.bankSign = spec.bankSign ?? 1;

      // --- Livery materials (shared across this airframe) ------------------
      // Build the three materials of the High-Vis Hero scheme up front: the vertex-coloured
      // BODY (its three-zone paint + emissive cheatline is baked later, in paintLivery, once
      // the rotor has been split off so the blades never get painted), a matte-dark BLADE, and
      // a tinted-glass CANOPY. Separable rotor/tail nodes go dark here; a merged-mesh model's
      // blades are darkened where they're sliced (below). Shadows on for every mesh.
      const liv = spec.livery;
      const bodyMat = makeBodyMat(liv);
      const bladeMat = new THREE.MeshStandardMaterial({ color: liv.blade, roughness: 0.45, metalness: 0.35 });
      const glassMat = new THREE.MeshStandardMaterial({ color: liv.glass, roughness: 0.1, metalness: 0.25, transparent: true, opacity: 0.55 });
      model.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        m.castShadow = true;
        m.receiveShadow = true;
      });

      // --- Normalize: scale off the fuselage, center X/Z, seat skids at y = 0 ----
      model.updateWorldMatrix(true, true);
      const fuselage = (spec.fuselageNode ? model.getObjectByName(spec.fuselageNode) : null) ?? model;
      const fbox = new THREE.Box3().setFromObject(fuselage);
      const flen = fbox.getSize(new THREE.Vector3()).x || 1;
      model.scale.setScalar(spec.targetLen / flen);

      model.updateWorldMatrix(true, true);
      const fb2 = new THREE.Box3().setFromObject(fuselage);
      const fc = fb2.getCenter(new THREE.Vector3());
      const whole = new THREE.Box3().setFromObject(model);
      const height = whole.getSize(new THREE.Vector3()).y; // model rests y ∈ [0, height]
      model.position.x -= fc.x; // fuselage centered fore-aft
      model.position.z -= fc.z; // centered laterally
      model.position.y -= whole.min.y; // rest the skids on y = 0

      // --- Swap procedural placeholder → real model, preserving the rotor handles ----
      group.clear();
      rotor.clear();
      tailRotor.clear();
      rotor.position.set(0, 0, 0);
      rotor.rotation.set(0, 0, 0);
      rotor.visible = true; // un-hide the handles we hid during the load
      tailRotor.visible = true;
      group.add(model, rotor);

      // --- Main rotor -------------------------------------------------------
      model.updateWorldMatrix(true, true);
      const rotorMesh =
        (spec.mainRotorNode ? model.getObjectByName(spec.mainRotorNode) : null) ??
        (spec.splitRotorTopFrac !== undefined ? sliceRotorMesh(model, spec.splitRotorTopFrac) : null);

      if (spec.useProcRotor) {
        // Replace the merged mesh's blades with the shared procedural 205A-1 rotor (hub +
        // airfoil blades + flybar). Slice + DISCARD the model's own blade geometry so only the
        // proc rotor shows. Position MUST land up at the rotor plane, never the origin: the rotor
        // handle defaults to (0,0,0) = the skids, so a failed/empty slice would drop the rotor
        // under the belly. Default the hub to just below the model's top and only trust the
        // sliced-blade centroid Y when it's genuinely up high.
        let hubX = 0; // fore-aft: fuselage center (the model was centered to origin) unless the slab refines it
        let hubY = height * 0.95; // robust default: the model's top (skids rest at y=0)
        if (rotorMesh) {
          model.updateWorldMatrix(true, true);
          const c = group.worldToLocal(new THREE.Box3().setFromObject(rotorMesh).getCenter(new THREE.Vector3()));
          if (c.y > height * 0.5) { hubX = c.x; hubY = c.y; } // trust the slab only if it's actually up top
          rotorMesh.parent?.remove(rotorMesh); // discard sliced blades — body is now blade-free
        }
        rotor.position.set(hubX, hubY, 0); // Z=0: lateral symmetry is always safe
        populateProcRotorGroup(rotor, spec.targetLen / 10.5);
      } else if (rotorMesh) {
        // Standard path: spin the model's OWN blade geometry about its true centroid. attach()
        // keeps the mesh's world transform, so the pivot MUST be the mesh's real center (all three
        // axes) — forcing XZ=0 would orbit the blades around an off-center point.
        model.updateWorldMatrix(true, true);
        const rc = new THREE.Box3().setFromObject(rotorMesh).getCenter(new THREE.Vector3());
        rotor.position.copy(group.worldToLocal(rc));
        rotor.attach(rotorMesh); // keeps world transform; now spins about the mast axis
      }

      // Place the disc: translate the whole rotor onto the mast / over the body, then re-pivot the
      // spin centre onto the blades' true middle. The `?heliview` sliders drive the SAME maths.
      if (spec.rotorOffset) applyRotorOffset(rotor, new THREE.Vector3(...spec.rotorOffset));
      if (spec.rotorPivotOffset) applyRotorPivotOffset(rotor, new THREE.Vector3(...spec.rotorPivotOffset));

      // --- Tail rotor -------------------------------------------------------
      // Prefer a separable node; else slice the model's OWN tail rotor out of the merged mesh by a
      // box; else fall back to a procedural one. A sliced/separated disc mounts + spins about its
      // lateral hub axis (mountTailRotor's −90° yaw makes tailRotor.rotation.x sweep it sideways).
      model.updateWorldMatrix(true, true);
      const tailMesh = spec.tailRotorNode
        ? model.getObjectByName(spec.tailRotorNode)
        : spec.tailRotorSlice
          ? sliceMeshByBox(model, spec.tailRotorSlice.center, spec.tailRotorSlice.size, 'tailRotorSliced')
          : null;
      if (tailMesh) {
        const hc = new THREE.Box3().setFromObject(tailMesh).getCenter(new THREE.Vector3());
        const local = group.worldToLocal(hc);
        if (spec.tailRotorOffset) local.add(new THREE.Vector3(...spec.tailRotorOffset));
        mountTailRotor(group, tailRotor, local);
        tailRotor.attach(tailMesh); // keeps world transform; now spins about the hub
      } else if (spec.useProcRotor) {
        // Proc tail rotor: same 205A-1 assembly, scaled, positioned at the tail fin tip (starboard).
        const s = spec.targetLen / 10.5;
        const tailX = whole.min.x - fc.x; // group-local boom-tip X after centering
        const tailMount = makeProcTailMount(tailRotor, s);
        tailMount.position.set(tailX + spec.targetLen * 0.04, height * 0.72, 0.2 * s);
        group.add(tailMount);
      } else if (spec.procTailRotor) {
        // Clean procedural 2-BLADE tail rotor for a merged mesh that has NO tail-rotor geometry to
        // reuse (only a fin). Base spot = boom tip; `tailRotorOffset` nudges it onto the fin and
        // `tailRotorScale` sizes it — both dialled live in ?heliview.
        const tailX = whole.min.x - fc.x;
        const tailPos = new THREE.Vector3(tailX + spec.targetLen * 0.05, height * 0.66, spec.procTailRotorZ ?? 0);
        if (spec.tailRotorOffset) tailPos.add(new THREE.Vector3(...spec.tailRotorOffset));
        mountTailRotor(group, tailRotor, tailPos);
        addProcTailRotor(tailRotor, spec.targetLen * 0.12);
        if (spec.tailRotorScale) tailRotor.scale.setScalar(spec.tailRotorScale);
      }

      // --- Body paint ------------------------------------------------------
      // The rotor + tail have been reparented OUT of `model`, so traversing it now yields only
      // the airframe. Tint any glass; collect the painted body. A CLAY (untextured) export is
      // repainted wholesale; a TEXTURED body is split off its diffuse map first so the windows
      // and gear keep their texture and only the painted panels recolour. Then bake the
      // three-zone livery + emissive cheatline over everything collected.
      model.updateWorldMatrix(true, true);
      const bodyMeshes: THREE.Mesh[] = [];
      const textured: THREE.Mesh[] = [];
      model.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        const mat = m.material as THREE.MeshStandardMaterial & { transparent?: boolean; opacity?: number };
        if (mat && (mat.transparent || (mat.opacity ?? 1) < 1)) m.material = glassMat;
        else if (mat && mat.map) textured.push(m); // defer — splitting mutates the tree mid-traverse
        else bodyMeshes.push(m);
      });
      for (const m of textured) {
        const paint = splitTexturedBody(m, bodyMat);
        if (paint) bodyMeshes.push(paint);
      }
      paintLivery(model, bodyMeshes, bodyMat);

      // --- Blades stay matte-dark ------------------------------------------
      // For useProcRotor models the proc rotor already carries the right materials
      // (metal hub, dark blades, transparent disc) — skipping the paint loop preserves them.
      // For standard glTF rotors, paint every mesh in the rotor/tail handles dark.
      if (!spec.useProcRotor) {
        for (const handle of [rotor, tailRotor]) {
          handle.traverse((o) => {
            const m = o as THREE.Mesh;
            if (m.isMesh) m.material = bladeMat;
          });
        }
      }

      // --- Door logo -------------------------------------------------------
      // Stamp the brand mark on both cabin doors (no-op without spec.doorLogo). After the paint so
      // the livery never touches it; on `group` so it poses + banks with the airframe.
      addDoorLogos(group, spec);

      onReady?.(); // model + rotor fully assembled — dev viewer captures its pivot baseline here
    },
    undefined,
    (err) => {
      // Load failed — reveal the procedural placeholder; it's a perfectly good fallback.
      for (const c of placeholder) c.visible = true;
      console.warn('[heli] glTF model failed to load; using procedural helicopter.', spec.url, err);
    },
  );
}

// --- Procedural rotors (for merged models with no separable rotor) ------------
// MODULE-LEVEL shared materials reused across every helicopter instance / Game. Flagged
// `userData.shared` so Game.dispose()'s scene-teardown traversal SKIPS them — disposing a shared
// singleton would break the rotors of the next in-place mission. Any future shared GPU resource
// should carry the same flag.
const PROC_BLADE = new THREE.MeshStandardMaterial({ color: 0x191b1f, roughness: 0.5, metalness: 0.3 });
const PROC_HUB = new THREE.MeshStandardMaterial({ color: 0x70757d, roughness: 0.4, metalness: 0.7 });
PROC_BLADE.userData.shared = true;
PROC_HUB.userData.shared = true;

// --- Door logo decal (brand icon on both cabin doors) -------------------------
// The brand bucket-drop mark, rasterized ONCE from its SVG into a shared transparent CanvasTexture
// and a shared white material (both flagged `userData.shared` so Game.dispose()'s teardown skips
// them — same contract as PROC_BLADE/HUB). `addDoorLogos` stamps it on both cabin doors as two flat
// alpha-tested quads parented to the aircraft GROUP, so they pose + bank with the airframe. Placement
// is per-spec (`doorLogo`), tuned live in the ?heliview Door-logo panel.
const LOGO_ASPECT = 149.7 / 184.72; // brand icon viewBox w/h ≈ 0.81

let doorLogoTexture: THREE.Texture | null = null;
function getDoorLogoTexture(): THREE.Texture {
  if (doorLogoTexture) return doorLogoTexture;
  // CanvasTexture starts blank (fully transparent → alphaTest hides it) and is refreshed once the
  // SVG <img> decodes — the logo just pops in a frame later, like the glTF behind the proc fallback.
  const px = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = px;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.userData.shared = true;
  const img = new Image();
  img.onload = () => {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const w = px * LOGO_ASPECT; // fit the tall mark centred, aspect preserved
    ctx.clearRect(0, 0, px, px);
    ctx.drawImage(img, (px - w) / 2, 0, w, px);
    tex.needsUpdate = true;
  };
  img.src = BASE + 'brand/icon_white.svg';
  doorLogoTexture = tex;
  return tex;
}

let doorLogoMaterial: THREE.MeshStandardMaterial | null = null;
function getDoorLogoMaterial(): THREE.MeshStandardMaterial {
  if (doorLogoMaterial) return doorLogoMaterial;
  // Alpha-tested cutout (not blended) → writes depth, occludes cleanly, no transparency sorting.
  // polygonOffset pulls it toward the camera so it never z-fights the door panel it sits on.
  const mat = new THREE.MeshStandardMaterial({
    map: getDoorLogoTexture(),
    transparent: true,
    alphaTest: 0.45,
    roughness: 0.5,
    metalness: 0,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
  });
  mat.userData.shared = true;
  doorLogoMaterial = mat;
  return mat;
}

/**
 * Sit a door decal FLUSH on the body: raycast from outside the given side inward at (x, y), hit the
 * airframe surface, and seat the quad a hair proud of it — so the logo lands on the door no matter
 * each model's width (guessing an absolute lateral offset floated it off). All in group-local space
 * (the decal's parent), so it's correct wherever `group` sits in the world. `side` +1 = port (+Z),
 * −1 = starboard (−Z); the quad scales to (size·aspect, size) and faces outward. Falls back to
 * `fallbackZ` if the ray misses. Returns the resolved surface z (group-local). Shared by the loader
 * and the ?heliview tuner, so dragging X/Y keeps the logo welded to the body. */
const _logoRay = new THREE.Raycaster();
export function snapDoorLogo(
  group: THREE.Object3D, mesh: THREE.Object3D, side: 1 | -1, x: number, y: number, size: number, fallbackZ = 1,
): number {
  group.updateWorldMatrix(true, true); // refresh body world matrices before casting
  const body = group.getObjectByName('heliModel');
  let localZ = side * Math.abs(fallbackZ);
  if (body) {
    const reach = Math.max(30, size * 10);
    const origin = new THREE.Vector3(x, y, side * reach).applyMatrix4(group.matrixWorld);
    const dir = new THREE.Vector3(0, 0, -side).transformDirection(group.matrixWorld).normalize();
    _logoRay.set(origin, dir);
    const hit = _logoRay.intersectObject(body, true)[0]; // nearest = the outer door surface on this side
    if (hit) localZ = group.worldToLocal(hit.point.clone()).z;
  }
  const w = size * LOGO_ASPECT;
  mesh.scale.set(w, size, 1);
  mesh.position.set(x, y, localZ + side * 0.02); // a hair proud so it never z-fights the panel
  mesh.rotation.y = side > 0 ? 0 : Math.PI; // face outward on each side
  return localZ;
}

/** Stamp the brand icon on both cabin doors, snapped flush to the body. The quads are UNIT planes
 *  (scaled by snapDoorLogo), named `doorLogoPort`/`doorLogoStar` so the ?heliview tuner can move them.
 *  `offset` carries the door-centre [x = fore/aft, y = height]; z is only a fallback if the ray misses. */
function addDoorLogos(group: THREE.Object3D, spec: HeliModelSpec): void {
  if (!spec.doorLogo) return;
  const { offset, size } = spec.doorLogo;
  const mat = getDoorLogoMaterial();
  const port = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
  port.name = 'doorLogoPort';
  const star = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
  star.name = 'doorLogoStar';
  port.renderOrder = star.renderOrder = 3;
  group.add(port, star);
  snapDoorLogo(group, port, 1, offset[0], offset[1], size, offset[2]);
  snapDoorLogo(group, star, -1, offset[0], offset[1], size, offset[2]);
}

/**
 * Translate a spinnable rotor handle by `offset` (group-local units): the whole disc — pivot AND
 * blades — moves together, so it stays a clean centred spin while sliding to a new spot. Use it to
 * lift the disc onto the mast (+y) and centre it over the body (±x fore/aft, ±z lateral). NB a
 * Y-spin can't move a point vertically, so re-pivoting alone can never raise the disc — only this
 * whole-handle translation can. The `?heliview` sliders call this every frame against a captured
 * baseline; the loader calls it once from `spec.rotorOffset`. */
export function applyRotorOffset(rotor: THREE.Object3D, offset: THREE.Vector3): void {
  rotor.position.add(offset);
}

/**
 * Re-pivot a spinnable rotor handle by `offset` (group-local units) WITHOUT moving its blades'
 * rest pose: the handle shifts by +offset and every child counter-shifts by −offset, so the θ=0
 * pose is unchanged but the spin now orbits the new centre. Use it to sit the spin axis on the
 * true centre of the (sliced) blades. Horizontal only — a Y-spin can't move a point vertically.
 */
export function applyRotorPivotOffset(rotor: THREE.Object3D, offset: THREE.Vector3): void {
  rotor.position.add(offset);
  for (const child of rotor.children) child.position.sub(offset);
}

/** A −90°-yawed mount under `group` carrying `tailRotor`, pivoted at `posLocal`, so that
 *  tailRotor.rotation.x sweeps the disc sideways (lateral hub axis = anti-torque). */
function mountTailRotor(group: THREE.Object3D, tailRotor: THREE.Object3D, posLocal: THREE.Vector3): void {
  const mount = new THREE.Group();
  mount.name = 'tailRotorMount';
  mount.position.copy(posLocal);
  mount.rotation.y = -Math.PI / 2; // local X → world lateral (Z) = the hub axis
  group.add(mount);
  mount.add(tailRotor);
  tailRotor.position.set(0, 0, 0);
  tailRotor.rotation.set(0, 0, 0);
}

/**
 * Slice the MAIN-ROTOR triangles out of a merged single-mesh model into their own mesh so the
 * model's real blades (or, for `useProcRotor`, just the geometry we want to STRIP) can be lifted
 * out. `topFrac` is the fraction of the mesh's OWN local Y-extent, measured down from the top, to
 * treat as the rotor (e.g. 0.12 = the top 12%). Working off the mesh's measured Y-range — not an
 * absolute coordinate — makes the slice coordinate-system-independent, so it can't silently miss
 * (and dump the rotor under the belly) if a re-export shifts the model's local frame. The new mesh
 * SHARES the source attribute buffers (just a different index), so it's cheap and pixel-identical
 * in place; the source mesh keeps the body triangles. Returns the rotor mesh (added as a sibling so
 * it inherits the model transform), or null if nothing qualified.
 */
function sliceRotorMesh(model: THREE.Object3D, topFrac: number): THREE.Mesh | null {
  let src: THREE.Mesh | null = null;
  model.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && !src) src = m;
  });
  if (!src) return null;
  const mesh = src as THREE.Mesh;
  const geo = mesh.geometry;
  const pos = geo.attributes.position;
  const index = geo.index;
  const triCount = index ? index.count / 3 : pos.count / 3;
  const vi = (t: number, k: number): number => (index ? index.getX(t * 3 + k) : t * 3 + k);

  // Threshold from the mesh's OWN Y-range (coordinate-independent): top `topFrac` of the extent.
  let yMin = Infinity;
  let yMax = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (y < yMin) yMin = y;
    if (y > yMax) yMax = y;
  }
  const minY = yMax - topFrac * (yMax - yMin);

  const bodyIdx: number[] = [];
  const rotorIdx: number[] = [];
  for (let t = 0; t < triCount; t++) {
    const a = vi(t, 0);
    const b = vi(t, 1);
    const c = vi(t, 2);
    const cy = (pos.getY(a) + pos.getY(b) + pos.getY(c)) / 3;
    (cy >= minY ? rotorIdx : bodyIdx).push(a, b, c);
  }
  if (!rotorIdx.length) return null;

  // Two sub-geometries over the SAME attribute buffers, distinguished only by index.
  const sub = (idx: number[]): THREE.BufferGeometry => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', pos);
    if (geo.attributes.normal) g.setAttribute('normal', geo.attributes.normal);
    if (geo.attributes.uv) g.setAttribute('uv', geo.attributes.uv);
    g.setIndex(idx);
    g.computeBoundingSphere();
    return g;
  };
  mesh.geometry = sub(bodyIdx); // the source mesh now draws only the body
  const rotorMesh = new THREE.Mesh(sub(rotorIdx), mesh.material);
  rotorMesh.name = 'mainRotorSliced';
  rotorMesh.castShadow = true;
  rotorMesh.receiveShadow = true;
  (mesh.parent ?? model).add(rotorMesh); // sibling → same transform, renders in place
  return rotorMesh;
}

/**
 * Slice the triangles whose centroid falls inside an axis-aligned BOX (in the mesh's OWN local
 * coords) out of a merged single-mesh model into their own mesh — the box-region analogue of
 * `sliceRotorMesh`'s top-slab. Used to lift a tail rotor that's real geometry but has no separable
 * node (align the box in `?heliview`). Shares the source attribute buffers; the source keeps the
 * rest. Returns the sliced mesh (sibling → same transform, renders in place), or null if empty.
 */
function sliceMeshByBox(
  model: THREE.Object3D,
  center: [number, number, number],
  size: [number, number, number],
  name: string,
): THREE.Mesh | null {
  let src: THREE.Mesh | null = null;
  model.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && !src) src = m;
  });
  if (!src) return null;
  const mesh = src as THREE.Mesh;
  const geo = mesh.geometry;
  const pos = geo.attributes.position;
  const index = geo.index;
  const triCount = index ? index.count / 3 : pos.count / 3;
  const vi = (t: number, k: number): number => (index ? index.getX(t * 3 + k) : t * 3 + k);

  const [cx, cy, cz] = center;
  const hx = size[0] / 2;
  const hy = size[1] / 2;
  const hz = size[2] / 2;
  const inBox = (a: number, b: number, c: number): boolean => {
    const mx = (pos.getX(a) + pos.getX(b) + pos.getX(c)) / 3;
    const my = (pos.getY(a) + pos.getY(b) + pos.getY(c)) / 3;
    const mz = (pos.getZ(a) + pos.getZ(b) + pos.getZ(c)) / 3;
    return Math.abs(mx - cx) <= hx && Math.abs(my - cy) <= hy && Math.abs(mz - cz) <= hz;
  };

  const bodyIdx: number[] = [];
  const rotorIdx: number[] = [];
  for (let t = 0; t < triCount; t++) {
    const a = vi(t, 0);
    const b = vi(t, 1);
    const c = vi(t, 2);
    (inBox(a, b, c) ? rotorIdx : bodyIdx).push(a, b, c);
  }
  if (!rotorIdx.length) return null;

  const sub = (idx: number[]): THREE.BufferGeometry => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', pos);
    if (geo.attributes.normal) g.setAttribute('normal', geo.attributes.normal);
    if (geo.attributes.uv) g.setAttribute('uv', geo.attributes.uv);
    g.setIndex(idx);
    g.computeBoundingSphere();
    return g;
  };
  mesh.geometry = sub(bodyIdx);
  const rotorMesh = new THREE.Mesh(sub(rotorIdx), mesh.material);
  rotorMesh.name = name;
  rotorMesh.castShadow = true;
  rotorMesh.receiveShadow = true;
  (mesh.parent ?? model).add(rotorMesh);
  return rotorMesh;
}

/** A 2-BLADE tail rotor: a hub + a single blade bar through it (= two opposed blades), built in the
 *  local Y-Z plane so it spins about X (the lateral hub axis after mountTailRotor's −90° yaw). */
function addProcTailRotor(parent: THREE.Object3D, radius: number): void {
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.14, radius * 0.14, radius * 0.22, 10), PROC_HUB);
  hub.rotation.z = Math.PI / 2; // hub axis along local X (the spin axis)
  hub.castShadow = true;
  parent.add(hub);
  // One bar spanning the full diameter = a clean 2-blade rotor (slightly tapered via tip insets).
  const blade = new THREE.Mesh(new THREE.BoxGeometry(radius * 0.05, radius * 2, radius * 0.18), PROC_BLADE);
  blade.castShadow = true;
  parent.add(blade);
}

/**
 * The vertex-coloured BODY material. It draws the three-zone paint from the per-vertex `color`
 * attribute (baked by paintLivery) and adds the cheatline GLOW from a companion `glow` attribute:
 * a one-line onBeforeCompile patch pushes `glow * uGlow` into the emissive term so the cheatline
 * blooms through the post-fx. Patched once at construction (compiles once at load — no runtime
 * recompiles), and each airframe builds its own so `uGlow` carries that ship's accent.
 */
function makeBodyMat(liv: Livery): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.52, metalness: 0.18 });
  // Everything is driven by `aHeight` (the body's 0..1 height fraction, baked per vertex in
  // paintLivery) so the zones and cheatline are crisp PER-PIXEL — a low-poly fuselage gets a
  // sharp beltline, not a fat gradient smeared across a few big triangles. Uniforms carry this
  // ship's palette; compiled once at load (no runtime recompiles).
  const U = {
    uRoof: { value: new THREE.Color(liv.roof) },
    uFlank: { value: new THREE.Color(liv.flank) },
    uSill: { value: new THREE.Color(liv.sill) },
    uLineCol: { value: new THREE.Color(liv.line) },
    uRoofAt: { value: liv.roofAt },
    uSillAt: { value: liv.sillAt },
    uLineAt: { value: liv.lineAt },
    uLineHalf: { value: liv.lineHalf },
    uGlow: { value: liv.glow },
  };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, U);
    shader.vertexShader =
      'attribute float aHeight;\nvarying float vH;\n' +
      shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  vH = aHeight;');
    shader.fragmentShader =
      'varying float vH;\n' +
      'uniform vec3 uRoof; uniform vec3 uFlank; uniform vec3 uSill; uniform vec3 uLineCol;\n' +
      'uniform float uRoofAt; uniform float uSillAt; uniform float uLineAt; uniform float uLineHalf; uniform float uGlow;\n' +
      shader.fragmentShader
        .replace(
          '#include <color_fragment>',
          '#include <color_fragment>\n' +
            '  float lineM = 1.0 - smoothstep(0.0, uLineHalf, abs(vH - uLineAt));\n' +
            '  vec3 zc = uFlank;\n' +
            '  zc = mix(zc, uSill, smoothstep(uSillAt + 0.012, uSillAt - 0.012, vH));\n' +
            '  zc = mix(zc, uRoof, smoothstep(uRoofAt - 0.012, uRoofAt + 0.012, vH));\n' +
            '  zc = mix(zc, uLineCol, lineM);\n' +
            '  diffuseColor.rgb = zc;\n',
        )
        .replace(
          '#include <emissivemap_fragment>',
          '#include <emissivemap_fragment>\n' +
            '  totalEmissiveRadiance += (1.0 - smoothstep(0.0, uLineHalf, abs(vH - uLineAt))) * uLineCol * uGlow;\n',
        );
  };
  return mat;
}

/**
 * Split a TEXTURED body mesh into the painted panels vs the keepers. We sample the diffuse map at
 * each triangle's centroid UV: a saturated warm texel (the ship's stock paint colour) is a panel
 * to repaint; everything else (grey glazing, black gear, decals) keeps the original texture. The
 * source mesh is left holding the keepers; the painted triangles become a sibling mesh on the
 * shared buffers (just a different index) wearing `bodyMat`, which paintLivery then colours.
 * Returns that paint mesh, or null if nothing qualified / the map isn't readable.
 */
function splitTexturedBody(mesh: THREE.Mesh, bodyMat: THREE.Material): THREE.Mesh | null {
  const tex = (mesh.material as THREE.MeshStandardMaterial).map;
  const img = tex?.image as (HTMLImageElement | ImageBitmap | undefined);
  const geo = mesh.geometry;
  const uv = geo.attributes.uv;
  if (!img || !uv || !img.width) return null;
  const w = img.width;
  const h = img.height;
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img as CanvasImageSource, 0, 0);
  const px = ctx.getImageData(0, 0, w, h).data;
  const wrap = (t: number): number => t - Math.floor(t); // UVs can run outside [0,1]
  const isPaint = (u: number, vv: number): boolean => {
    const x = Math.min(w - 1, Math.floor(wrap(u) * w));
    const y = Math.min(h - 1, Math.floor(wrap(vv) * h)); // glTF v=0 is the top row (flipY=false)
    const i = (y * w + x) * 4;
    const r = px[i] / 255;
    const g = px[i + 1] / 255;
    const b = px[i + 2] / 255;
    return r - b > 0.22 && r > 0.38 && r >= g; // saturated warm paint → repaint
  };
  const index = geo.index;
  const triCount = index ? index.count / 3 : uv.count / 3;
  const vi = (t: number, k: number): number => (index ? index.getX(t * 3 + k) : t * 3 + k);
  const paintIdx: number[] = [];
  const keepIdx: number[] = [];
  for (let t = 0; t < triCount; t++) {
    const a = vi(t, 0);
    const b = vi(t, 1);
    const c = vi(t, 2);
    const cu = (uv.getX(a) + uv.getX(b) + uv.getX(c)) / 3;
    const cv2 = (uv.getY(a) + uv.getY(b) + uv.getY(c)) / 3;
    (isPaint(cu, cv2) ? paintIdx : keepIdx).push(a, b, c);
  }
  if (!paintIdx.length) return null;

  const sub = (idx: number[]): THREE.BufferGeometry => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', geo.attributes.position);
    if (geo.attributes.normal) g.setAttribute('normal', geo.attributes.normal);
    if (geo.attributes.uv) g.setAttribute('uv', geo.attributes.uv);
    g.setIndex(idx);
    g.computeBoundingSphere();
    return g;
  };
  mesh.geometry = sub(keepIdx); // source keeps its texture, minus the painted panels
  const paint = new THREE.Mesh(sub(paintIdx), bodyMat);
  paint.name = 'liveryPaint';
  paint.castShadow = true;
  paint.receiveShadow = true;
  (mesh.parent ?? mesh).add(paint);
  return paint;
}

/**
 * Bake the body's 0..1 height fraction into an `aHeight` vertex attribute and assign the livery
 * material — makeBodyMat's shader turns that height into the three-zone paint + cheatline per
 * pixel. Height is measured in the MODEL's frame (pose- and scale-independent) over the INDEXED
 * vertices only, so a sliced body that still shares a buffer with its blades isn't skewed by the
 * blade vertices sitting up at the mast.
 */
function paintLivery(model: THREE.Object3D, meshes: THREE.Mesh[], mat: THREE.Material): void {
  model.updateWorldMatrix(true, true);
  const invModel = model.matrixWorld.clone().invert();
  const v = new THREE.Vector3();

  // pass 1: model-local Y range over the painted (indexed) vertices only
  let minY = Infinity;
  let maxY = -Infinity;
  const toLocal: THREE.Matrix4[] = [];
  for (const m of meshes) {
    m.updateWorldMatrix(true, false);
    const t = invModel.clone().multiply(m.matrixWorld);
    toLocal.push(t);
    const pos = m.geometry.attributes.position;
    const idx = m.geometry.index;
    const n = idx ? idx.count : pos.count;
    for (let k = 0; k < n; k++) {
      v.fromBufferAttribute(pos, idx ? idx.getX(k) : k).applyMatrix4(t);
      if (v.y < minY) minY = v.y;
      if (v.y > maxY) maxY = v.y;
    }
  }
  const span = Math.max(1e-4, maxY - minY);

  // pass 2: write the per-vertex height fraction
  meshes.forEach((m, mi) => {
    const pos = m.geometry.attributes.position;
    const t = toLocal[mi];
    const hgt = new Float32Array(pos.count);
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(t);
      hgt[i] = (v.y - minY) / span;
    }
    m.geometry.setAttribute('aHeight', new THREE.Float32BufferAttribute(hgt, 1));
    m.material = mat;
  });
}
