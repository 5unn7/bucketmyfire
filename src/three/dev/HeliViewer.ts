import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { createHelicopter, type HelicopterMesh } from '../meshes/helicopter';
import { swapInModel, snapDoorLogo, HELI_MODELS } from '../meshes/heliModels';
import { HELIS } from '../ui/profile';
import { resolveHeliClass } from '../config';
import { FrameContext } from '../render/FrameContext';
import { createSkyDome } from '../sky/SkyDome';
import { applyAtmosphere, SKY_PRESETS, SUN_DISTANCE } from '../sky/TimeOfDay';
import { signalFirstFrame } from '../splashSignal';

/**
 * Helicopter viewer — the `?heliview` route, reached from the `?dev` hub. A turntable showroom for the three
 * selectable airframes: each ship is built through the SAME `createHelicopter` + `swapInModel` the game uses
 * (the real glTF streamed in behind the procedural fallback, full fire-bomber livery, spinning rotors), and a
 * side panel shows the catalog spec bars + the real `HELI_CLASSES` numbers. READ-ONLY — tune the numbers in
 * the Config panel (also on the hub). Lazy-loaded from main.ts so none of it ships in a player's bundle.
 */

const SPIN_MAIN = 6; // main-rotor spin (rad/s) — slow enough to read the airframe, fast enough to feel alive
const SPIN_TAIL = 13;

type Axis = 'x' | 'y' | 'z';

/** One live control group in the rotor tuner (a titled set of axis sliders + a paste-able readout). */
interface TuneGroup {
  mode: 'disc' | 'pivot' | 'tail';
  specKey: 'rotorOffset' | 'rotorPivotOffset' | 'tailRotorOffset';
  title: string;
  hint: string;
  axes: Axis[];
  offset: THREE.Vector3; // current absolute value (spec-space)
  baked: THREE.Vector3; // value already baked in the spec (applied at load)
  sliders: Partial<Record<Axis, HTMLInputElement>>;
  chips: Partial<Record<Axis, HTMLElement>>;
  readout: HTMLElement;
}

export class HeliViewer {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly controls: OrbitControls;
  private readonly frame = new FrameContext();
  private readonly sun = new THREE.DirectionalLight();
  private readonly hemi = new THREE.HemisphereLight();
  private heli: HelicopterMesh | null = null;
  private heliId: string;
  private prevTime = 0;
  private readonly stats: HTMLElement;
  private readonly tabs: HTMLButtonElement[] = [];

  // --- Live rotor tuner (the ?heliview sliders) ------------------------------
  private readonly tunerPanel: HTMLElement;
  private readonly tuneGroups: TuneGroup[] = [];
  // Baselines captured AFTER load (already include any baked spec offsets); sliders apply a delta.
  private rotorBase: THREE.Vector3 | null = null;
  private rotorChildBases: THREE.Vector3[] = [];

  // --- Procedural tail-rotor placement (position the mount + scale the disc) -------------------
  private tailMount: THREE.Object3D | null = null; // the 'tailRotorMount' group we translate
  private tailMountBase: THREE.Vector3 | null = null; // its rest position (incl. baked offset)
  private readonly tailOffset = new THREE.Vector3(); // current position (spec-space)
  private readonly tailOffsetBaked = new THREE.Vector3();
  private tailScale = 1; // current size multiplier
  private tailScaleBaked = 1;
  private readonly tailPosSliders: Record<'x' | 'y' | 'z', HTMLInputElement> = {} as never;
  private readonly tailPosChips: Record<'x' | 'y' | 'z', HTMLElement> = {} as never;
  private tailScaleSlider: HTMLInputElement | null = null;
  private tailScaleChip: HTMLElement | null = null;
  private tailReadout: HTMLElement | null = null;

  // --- Door-logo placement (brand icon on both cabin doors; ALL 3 airframes) ------------------
  private logoPort: THREE.Object3D | null = null;
  private logoStar: THREE.Object3D | null = null;
  private readonly logoOffset = new THREE.Vector3(); // door-centre: x fore/aft, y height, z = resolved surface
  private readonly logoOffsetBaked = new THREE.Vector3();
  private logoSize = 1; // current decal height (world units)
  private logoSizeBaked = 1;
  private readonly logoSliders: Record<'x' | 'y', HTMLInputElement> = {} as never;
  private readonly logoChips: Record<'x' | 'y', HTMLElement> = {} as never;
  private logoSizeSlider: HTMLInputElement | null = null;
  private logoSizeChip: HTMLElement | null = null;
  private logoReadout: HTMLElement | null = null;
  private logoPanel: HTMLElement | null = null;

  constructor(private readonly container: HTMLElement) {
    this.heliId = HELIS[0].id;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 2000);
    this.camera.position.set(15, 9, 19);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.target.set(0, 3, 0);
    this.controls.minDistance = 8;
    this.controls.maxDistance = 90;
    this.controls.maxPolarAngle = Math.PI * 0.52; // don't drop under the pad
    this.controls.autoRotate = true; // gentle turntable; any drag pauses it via the user-interaction default
    this.controls.autoRotateSpeed = 0.8;

    // Lights + sky — the golden-hour preset + the same atmosphere helper the game uses.
    this.scene.add(this.hemi, this.sun, this.sun.target);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.near = 0.5;
    sc.far = 140;
    sc.left = sc.bottom = -35;
    sc.right = sc.top = 35;
    const sky = SKY_PRESETS.golden;
    this.sun.position.copy(sky.sunDir).multiplyScalar(SUN_DISTANCE);
    applyAtmosphere(this.scene, this.sun, this.hemi, sky);
    this.scene.add(createSkyDome(this.frame, sky));

    this.buildPad();
    this.stats = this.buildUI();
    this.tunerPanel = this.buildTunerPanel();
    this.logoPanel = this.buildLogoPanel();
    this.loadHeli(this.heliId);

    window.addEventListener('resize', this.onResize);
    this.renderer.setAnimationLoop(this.tick);
    signalFirstFrame(); // hand the static splash off to the viewer
  }

  /** A dark helipad disc with a hi-vis ring over a ground plane, so the airframe reads against a stage. */
  private buildPad(): void {
    const ground = new THREE.Mesh(new THREE.CircleGeometry(60, 64), new THREE.MeshStandardMaterial({ color: 0x2a2e25, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(7.5, 7.5, 0.25, 56), new THREE.MeshStandardMaterial({ color: 0x23262b, roughness: 0.9 }));
    pad.position.y = 0.12;
    pad.receiveShadow = true;
    this.scene.add(pad);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(6.4, 0.13, 8, 72), new THREE.MeshStandardMaterial({ color: 0xffd21a, emissive: 0x4a3600, roughness: 0.6 }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.26;
    this.scene.add(ring);
  }

  /** Build (or rebuild) the airframe for `id` through the real game path: procedural fallback + glTF swap. */
  private loadHeli(id: string): void {
    if (this.heli) {
      this.scene.remove(this.heli.group);
      disposeObject(this.heli.group);
    }
    this.heliId = id;

    // Reset the tuner for the new airframe; only the 212 exposes it for now.
    this.rotorBase = null;
    this.rotorChildBases = [];
    this.tailMount = null;
    this.tailMountBase = null;
    this.logoPort = null;
    this.logoStar = null;
    this.syncTunerFromSpec(id); // seed each group from the spec's baked offsets
    this.syncLogoFromSpec(id); // seed the door-logo panel from the spec
    this.tunerPanel.style.display = id === 'bell-212' ? 'block' : 'none';

    const heli = createHelicopter(id);
    // onReady fires once the real glTF rotor + tail are assembled — capture their rest transforms.
    swapInModel(heli, id, () => this.captureBaselines());
    heli.group.position.set(0, 0.25, 0);
    this.scene.add(heli.group);
    this.heli = heli;
    this.renderStats();
    this.tabs.forEach((t) => (t.style.background = t.dataset.id === id ? '#c12a1b' : 'rgba(255,255,255,0.06)'));
  }

  // --- Rotor tuner -------------------------------------------------------------

  /** Capture the loaded main-rotor rest transform (already includes any baked spec offsets), then
   *  apply the current slider state. Called from swapInModel's onReady. */
  private captureBaselines(): void {
    if (!this.heli) return;
    this.rotorBase = this.heli.rotor.position.clone();
    this.rotorChildBases = this.heli.rotor.children.map((c) => c.position.clone());
    // The proc tail rotor hangs under a 'tailRotorMount' group — that's what we translate/scale.
    this.tailMount = this.heli.tailRotor.parent;
    this.tailMountBase = this.tailMount ? this.tailMount.position.clone() : null;
    // Door-logo decals (added by swapInModel before this onReady) — grab them so the panel moves them.
    this.logoPort = this.heli.group.getObjectByName('doorLogoPort') ?? null;
    this.logoStar = this.heli.group.getObjectByName('doorLogoStar') ?? null;
    this.applyTuner();
    this.applyLogo();
  }

  /** Re-derive rotor + tail transforms from the captured baselines + the live slider DELTAS off the
   *  baked spec values (so slider==baked reproduces the loaded pose exactly; readouts paste 1:1). */
  private applyTuner(): void {
    if (!this.heli || !this.rotorBase) return;
    const rotor = this.heli.rotor;
    const disc = this.group('disc');
    const pivot = this.group('pivot');
    const dTrans = disc.offset.clone().sub(disc.baked); // whole-disc translation delta
    const dPivot = pivot.offset.clone().sub(pivot.baked); // re-pivot delta

    rotor.position.copy(this.rotorBase).add(dTrans).add(dPivot);
    rotor.children.forEach((c, i) => this.rotorChildBases[i] && c.position.copy(this.rotorChildBases[i]).sub(dPivot));

    for (const g of this.tuneGroups) this.refreshGroupReadout(g);
    this.applyTail();
  }

  /** Place + size the procedural tail rotor: translate its mount by the slider delta off the baked
   *  offset, scale the spin handle. Updates the paste-able readout. */
  private applyTail(): void {
    if (this.tailMount && this.tailMountBase) {
      this.tailMount.position.copy(this.tailMountBase).add(this.tailOffset).sub(this.tailOffsetBaked);
    }
    if (this.heli) this.heli.tailRotor.scale.setScalar(this.tailScale);
    if (this.tailReadout) {
      const o = this.tailOffset;
      this.tailReadout.textContent = `tailRotorOffset: [${o.x.toFixed(2)}, ${o.y.toFixed(2)}, ${o.z.toFixed(2)}], tailRotorScale: ${this.tailScale.toFixed(2)}`;
    }
  }

  // --- Door-logo tuner ---------------------------------------------------------

  /** Seed the door-logo panel (offsets, size, sliders) from the spec, and hide it for an airframe
   *  with no `doorLogo`. Opens exactly where the game sits, so the readout pastes 1:1. */
  private syncLogoFromSpec(id: string): void {
    const dl = HELI_MODELS[id]?.doorLogo;
    if (this.logoPanel) this.logoPanel.style.display = dl ? 'block' : 'none';
    const off = dl?.offset ?? [0, 0, 0];
    this.logoOffset.set(off[0], off[1], off[2]);
    this.logoOffsetBaked.copy(this.logoOffset);
    this.logoSize = dl?.size ?? 1;
    this.logoSizeBaked = this.logoSize;
    for (const axis of ['x', 'y'] as const) {
      if (this.logoSliders[axis]) this.logoSliders[axis].value = String(this.logoOffset[axis]);
      if (this.logoChips[axis]) this.logoChips[axis].textContent = this.logoOffset[axis].toFixed(2);
    }
    if (this.logoSizeSlider) this.logoSizeSlider.value = String(this.logoSize);
    if (this.logoSizeChip) this.logoSizeChip.textContent = this.logoSize.toFixed(2);
    this.refreshLogoReadout();
  }

  /** Re-seat both door decals flush on the body via snapDoorLogo (z is found by raycast, so dragging
   *  X/Y keeps them welded to the door). Records the resolved port-side z for the readout. */
  private applyLogo(): void {
    if (!this.heli) return;
    const g = this.heli.group;
    const { x, y } = this.logoOffset;
    if (this.logoPort) this.logoOffset.z = snapDoorLogo(g, this.logoPort, 1, x, y, this.logoSize, this.logoOffsetBaked.z);
    if (this.logoStar) snapDoorLogo(g, this.logoStar, -1, x, y, this.logoSize, this.logoOffsetBaked.z);
    this.refreshLogoReadout();
  }

  private refreshLogoReadout(): void {
    if (!this.logoReadout) return;
    const o = this.logoOffset;
    this.logoReadout.textContent = `doorLogo: { offset: [${o.x.toFixed(2)}, ${o.y.toFixed(2)}, ${o.z.toFixed(2)}], size: ${this.logoSize.toFixed(2)} }`;
  }

  /** Seed every group's current + baked offset (and its DOM) from the spec, so the panel opens
   *  exactly where the game sits. */
  private syncTunerFromSpec(id: string): void {
    const spec = HELI_MODELS[id];
    for (const g of this.tuneGroups) {
      const baked = (spec?.[g.specKey] as [number, number, number] | undefined) ?? [0, 0, 0];
      g.baked.set(baked[0], baked[1], baked[2]);
      g.offset.copy(g.baked);
      for (const axis of g.axes) {
        if (g.sliders[axis]) g.sliders[axis]!.value = String(g.offset[axis]);
        if (g.chips[axis]) g.chips[axis]!.textContent = g.offset[axis].toFixed(2);
      }
      this.refreshGroupReadout(g);
    }

    // Seed the tail position + scale from the spec.
    const off = spec?.tailRotorOffset ?? [0, 0, 0];
    this.tailOffset.set(off[0], off[1], off[2]);
    this.tailOffsetBaked.copy(this.tailOffset);
    this.tailScale = spec?.tailRotorScale ?? 1;
    this.tailScaleBaked = this.tailScale;
    for (const axis of ['x', 'y', 'z'] as const) {
      if (this.tailPosSliders[axis]) this.tailPosSliders[axis].value = String(this.tailOffset[axis]);
      if (this.tailPosChips[axis]) this.tailPosChips[axis].textContent = this.tailOffset[axis].toFixed(2);
    }
    if (this.tailScaleSlider) this.tailScaleSlider.value = String(this.tailScale);
    if (this.tailScaleChip) this.tailScaleChip.textContent = this.tailScale.toFixed(2);
  }

  private group(mode: TuneGroup['mode']): TuneGroup {
    return this.tuneGroups.find((g) => g.mode === mode)!;
  }

  private refreshGroupReadout(g: TuneGroup): void {
    const o = g.offset;
    g.readout.textContent = `${g.specKey}: [${o.x.toFixed(2)}, ${o.y.toFixed(2)}, ${o.z.toFixed(2)}]`;
  }

  // --- UI ----------------------------------------------------------------------

  private buildUI(): HTMLElement {
    // Back to the hub.
    const back = el('button', '← Tools', {
      position: 'fixed', top: '14px', left: '14px', zIndex: '20',
      padding: '8px 14px', font: '600 13px system-ui, sans-serif', letterSpacing: '0.5px',
      color: '#dfe9f5', background: 'rgba(12,16,20,0.8)', border: '1px solid rgba(255,255,255,0.14)',
      borderRadius: '8px', cursor: 'pointer', backdropFilter: 'blur(6px)',
    });
    back.addEventListener('click', () => (location.search = '?dev'));
    this.container.appendChild(back);

    // Stats / switcher panel (right side).
    const panel = el('div', '', {
      position: 'fixed', top: '14px', right: '14px', width: '300px', zIndex: '20',
      padding: '16px', color: '#e8eef4', font: '13px system-ui, sans-serif', lineHeight: '1.5',
      background: 'rgba(12,16,20,0.82)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '12px',
      backdropFilter: 'blur(8px)', boxShadow: '0 10px 30px rgba(0,0,0,0.4)',
    });

    // Airframe switch buttons.
    const tabRow = el('div', '', { display: 'flex', gap: '6px', marginBottom: '14px' });
    for (const h of HELIS) {
      const b = el('button', h.name.replace('Bell ', '').replace('UH-60 Black Hawk', 'UH-60'), {
        flex: '1', padding: '8px 4px', font: '600 12px system-ui, sans-serif',
        color: '#fff', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)',
        borderRadius: '8px', cursor: 'pointer',
      }) as HTMLButtonElement;
      b.dataset.id = h.id;
      b.addEventListener('click', () => this.loadHeli(h.id));
      tabRow.appendChild(b);
      this.tabs.push(b);
    }
    panel.appendChild(tabRow);

    const body = el('div', '', {});
    panel.appendChild(body);
    this.container.appendChild(panel);
    return body;
  }

  /** The live rotor tuner (bottom-left): three collapsible groups — main-disc position, main spin
   *  centre, and tail-rotor position. Each group's readout is the exact spec line to paste in. */
  private buildTunerPanel(): HTMLElement {
    const panel = el('div', '', {
      position: 'fixed', bottom: '14px', left: '14px', width: '300px', maxHeight: '90vh', overflowY: 'auto', zIndex: '20',
      padding: '14px 16px', color: '#e8eef4', font: '13px system-ui, sans-serif',
      background: 'rgba(12,16,20,0.86)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '12px',
      backdropFilter: 'blur(8px)', boxShadow: '0 10px 30px rgba(0,0,0,0.4)', display: 'none',
    });
    panel.appendChild(el('div', 'Bell 212 rotor tuner', { font: '700 14px system-ui, sans-serif', color: '#fff', marginBottom: '10px' }));

    this.buildTuneGroup(panel, {
      mode: 'disc', specKey: 'rotorOffset',
      title: 'Main disc — position', hint: 'Lift onto the mast / centre over the body.',
      axes: ['x', 'y', 'z'],
    });
    this.buildTuneGroup(panel, {
      mode: 'pivot', specKey: 'rotorPivotOffset',
      title: 'Main disc — spin centre', hint: "Move the blades' centre of rotation (X/Z only).",
      axes: ['x', 'z'],
    });
    this.buildTailSection(panel);

    this.container.appendChild(panel);
    return panel;
  }

  /** The procedural tail-rotor section: position (X/Y/Z translate the mount) + size (scale), all
   *  live. Place the spinning 2-blade rotor on the fin, then paste the readout into the 212 spec. */
  private buildTailSection(panel: HTMLElement): void {
    const section = el('div', '', { margin: '6px 0 14px', paddingTop: '10px', borderTop: '1px solid rgba(255,255,255,0.08)' });
    section.appendChild(el('div', 'Tail rotor (procedural 2-blade)', { font: '700 12px system-ui, sans-serif', color: '#fff' }));
    section.appendChild(el('div', 'Place the spinning 2-blade on the fin.', { color: '#9fb2c4', fontSize: '11px', margin: '1px 0 8px' }));

    const LABELS: Record<'x' | 'y' | 'z', string> = { x: 'X — nose ↔ tail', y: 'Y — up ↕ down', z: 'Z — port ↔ starboard' };
    for (const axis of ['x', 'y', 'z'] as const) {
      const row = el('div', '', { margin: '7px 0' });
      const head = el('div', '', { display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#9fb2c4', marginBottom: '3px' });
      head.appendChild(el('span', LABELS[axis], {}));
      const chip = el('span', this.tailOffset[axis].toFixed(2), { color: '#fff', fontFamily: 'ui-monospace, monospace' });
      head.appendChild(chip);
      row.appendChild(head);
      const slider = document.createElement('input');
      slider.type = 'range';
      slider.min = '-6';
      slider.max = '6';
      slider.step = '0.02';
      slider.value = String(this.tailOffset[axis]);
      slider.style.width = '100%';
      slider.style.accentColor = '#ff8a1e';
      slider.addEventListener('input', () => {
        this.tailOffset[axis] = parseFloat(slider.value);
        chip.textContent = this.tailOffset[axis].toFixed(2);
        this.applyTail();
      });
      row.appendChild(slider);
      section.appendChild(row);
      this.tailPosSliders[axis] = slider;
      this.tailPosChips[axis] = chip;
    }

    // Size (scale)
    const srow = el('div', '', { margin: '7px 0' });
    const shead = el('div', '', { display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#9fb2c4', marginBottom: '3px' });
    shead.appendChild(el('span', 'Size ×', {}));
    const schip = el('span', this.tailScale.toFixed(2), { color: '#fff', fontFamily: 'ui-monospace, monospace' });
    shead.appendChild(schip);
    srow.appendChild(shead);
    const sslider = document.createElement('input');
    sslider.type = 'range';
    sslider.min = '0.2';
    sslider.max = '3';
    sslider.step = '0.02';
    sslider.value = String(this.tailScale);
    sslider.style.width = '100%';
    sslider.style.accentColor = '#ff8a1e';
    sslider.addEventListener('input', () => {
      this.tailScale = parseFloat(sslider.value);
      schip.textContent = this.tailScale.toFixed(2);
      this.applyTail();
    });
    srow.appendChild(sslider);
    section.appendChild(srow);
    this.tailScaleSlider = sslider;
    this.tailScaleChip = schip;

    const readout = el('div', 'tailRotorOffset: …', {
      marginTop: '8px', padding: '6px 8px', borderRadius: '7px', fontSize: '10px', fontFamily: 'ui-monospace, monospace',
      color: '#ffd21a', background: 'rgba(255,210,26,0.08)', border: '1px solid rgba(255,210,26,0.25)', cursor: 'pointer', userSelect: 'all',
    });
    readout.title = 'Click to copy — paste into the bell-212 spec in heliModels.ts';
    readout.addEventListener('click', () => void navigator.clipboard?.writeText(readout.textContent ?? ''));
    this.tailReadout = readout;
    section.appendChild(readout);

    const reset = el('button', 'Reset to baked', {
      marginTop: '8px', width: '100%', padding: '6px', font: '600 11px system-ui, sans-serif',
      color: '#dfe9f5', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.14)',
      borderRadius: '8px', cursor: 'pointer',
    });
    reset.addEventListener('click', () => {
      this.tailOffset.copy(this.tailOffsetBaked);
      this.tailScale = this.tailScaleBaked;
      for (const axis of ['x', 'y', 'z'] as const) {
        this.tailPosSliders[axis].value = String(this.tailOffset[axis]);
        this.tailPosChips[axis].textContent = this.tailOffset[axis].toFixed(2);
      }
      if (this.tailScaleSlider) this.tailScaleSlider.value = String(this.tailScale);
      if (this.tailScaleChip) this.tailScaleChip.textContent = this.tailScale.toFixed(2);
      this.applyTail();
    });
    section.appendChild(reset);

    panel.appendChild(section);
  }

  /** The live door-logo placer (bottom-right): X/Y/Z move the PORT decal (starboard mirrors), a size
   *  slider scales both, and the readout is the exact `doorLogo` line to paste into the airframe spec.
   *  Visible for every airframe that has a `doorLogo`. */
  private buildLogoPanel(): HTMLElement {
    const panel = el('div', '', {
      position: 'fixed', bottom: '14px', right: '14px', width: '300px', maxHeight: '90vh', overflowY: 'auto', zIndex: '20',
      padding: '14px 16px', color: '#e8eef4', font: '13px system-ui, sans-serif',
      background: 'rgba(12,16,20,0.86)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '12px',
      backdropFilter: 'blur(8px)', boxShadow: '0 10px 30px rgba(0,0,0,0.4)', display: 'none',
    });
    panel.appendChild(el('div', 'Door logo', { font: '700 14px system-ui, sans-serif', color: '#fff', marginBottom: '2px' }));
    panel.appendChild(el('div', 'Brand mark on both doors — snaps flush to the body; X/Y place it.', { color: '#9fb2c4', fontSize: '11px', marginBottom: '8px' }));

    const LABELS: Record<'x' | 'y', string> = { x: 'X — nose ↔ tail', y: 'Y — up ↕ down' };
    for (const axis of ['x', 'y'] as const) {
      const row = el('div', '', { margin: '7px 0' });
      const head = el('div', '', { display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#9fb2c4', marginBottom: '3px' });
      head.appendChild(el('span', LABELS[axis], {}));
      const chip = el('span', this.logoOffset[axis].toFixed(2), { color: '#fff', fontFamily: 'ui-monospace, monospace' });
      head.appendChild(chip);
      row.appendChild(head);
      const slider = document.createElement('input');
      slider.type = 'range';
      slider.min = '-6';
      slider.max = '6';
      slider.step = '0.02';
      slider.value = String(this.logoOffset[axis]);
      slider.style.width = '100%';
      slider.style.accentColor = '#ff8a1e';
      slider.addEventListener('input', () => {
        this.logoOffset[axis] = parseFloat(slider.value);
        chip.textContent = this.logoOffset[axis].toFixed(2);
        this.applyLogo();
      });
      row.appendChild(slider);
      panel.appendChild(row);
      this.logoSliders[axis] = slider;
      this.logoChips[axis] = chip;
    }

    // Size (decal height)
    const srow = el('div', '', { margin: '7px 0' });
    const shead = el('div', '', { display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#9fb2c4', marginBottom: '3px' });
    shead.appendChild(el('span', 'Size (height)', {}));
    const schip = el('span', this.logoSize.toFixed(2), { color: '#fff', fontFamily: 'ui-monospace, monospace' });
    shead.appendChild(schip);
    srow.appendChild(shead);
    const sslider = document.createElement('input');
    sslider.type = 'range';
    sslider.min = '0.2';
    sslider.max = '4';
    sslider.step = '0.02';
    sslider.value = String(this.logoSize);
    sslider.style.width = '100%';
    sslider.style.accentColor = '#ff8a1e';
    sslider.addEventListener('input', () => {
      this.logoSize = parseFloat(sslider.value);
      schip.textContent = this.logoSize.toFixed(2);
      this.applyLogo();
    });
    srow.appendChild(sslider);
    panel.appendChild(srow);
    this.logoSizeSlider = sslider;
    this.logoSizeChip = schip;

    const readout = el('div', 'doorLogo: …', {
      marginTop: '8px', padding: '6px 8px', borderRadius: '7px', fontSize: '10px', fontFamily: 'ui-monospace, monospace',
      color: '#ffd21a', background: 'rgba(255,210,26,0.08)', border: '1px solid rgba(255,210,26,0.25)', cursor: 'pointer', userSelect: 'all',
    });
    readout.title = 'Click to copy — paste into the airframe spec in heliModels.ts';
    readout.addEventListener('click', () => void navigator.clipboard?.writeText(readout.textContent ?? ''));
    this.logoReadout = readout;
    panel.appendChild(readout);

    const reset = el('button', 'Reset to baked', {
      marginTop: '8px', width: '100%', padding: '6px', font: '600 11px system-ui, sans-serif',
      color: '#dfe9f5', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.14)',
      borderRadius: '8px', cursor: 'pointer',
    });
    reset.addEventListener('click', () => {
      this.logoOffset.copy(this.logoOffsetBaked);
      this.logoSize = this.logoSizeBaked;
      for (const axis of ['x', 'y'] as const) {
        this.logoSliders[axis].value = String(this.logoOffset[axis]);
        this.logoChips[axis].textContent = this.logoOffset[axis].toFixed(2);
      }
      if (this.logoSizeSlider) this.logoSizeSlider.value = String(this.logoSize);
      if (this.logoSizeChip) this.logoSizeChip.textContent = this.logoSize.toFixed(2);
      this.applyLogo();
    });
    panel.appendChild(reset);

    this.container.appendChild(panel);
    return panel;
  }

  /** Build one titled control group (its sliders + value chips + copy-able readout) and register it
   *  in `tuneGroups`. `def` carries the static shape; live offsets are filled by syncTunerFromSpec. */
  private buildTuneGroup(
    panel: HTMLElement,
    def: { mode: TuneGroup['mode']; specKey: TuneGroup['specKey']; title: string; hint: string; axes: Axis[] },
  ): void {
    const group: TuneGroup = {
      ...def, offset: new THREE.Vector3(), baked: new THREE.Vector3(),
      sliders: {}, chips: {}, readout: document.createElement('div'),
    };

    const section = el('div', '', { margin: '6px 0 14px', paddingTop: '10px', borderTop: '1px solid rgba(255,255,255,0.08)' });
    section.appendChild(el('div', def.title, { font: '700 12px system-ui, sans-serif', color: '#fff' }));
    section.appendChild(el('div', def.hint, { color: '#9fb2c4', fontSize: '11px', margin: '1px 0 8px' }));

    const LABELS: Record<Axis, string> = { x: 'X — nose ↔ tail', y: 'Y — up ↕ down', z: 'Z — port ↔ starboard' };
    for (const axis of def.axes) this.addAxisSlider(section, group, axis, LABELS[axis]);

    Object.assign(group.readout.style, {
      marginTop: '8px', padding: '6px 8px', borderRadius: '7px', fontSize: '10.5px', fontFamily: 'ui-monospace, monospace',
      color: '#ffd21a', background: 'rgba(255,210,26,0.08)', border: '1px solid rgba(255,210,26,0.25)', cursor: 'pointer', userSelect: 'all',
    } as Partial<CSSStyleDeclaration>);
    group.readout.title = 'Click to copy — paste into the bell-212 spec in heliModels.ts';
    group.readout.addEventListener('click', () => void navigator.clipboard?.writeText(group.readout.textContent ?? ''));
    section.appendChild(group.readout);

    const reset = el('button', 'Reset to baked', {
      marginTop: '8px', width: '100%', padding: '6px', font: '600 11px system-ui, sans-serif',
      color: '#dfe9f5', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.14)',
      borderRadius: '8px', cursor: 'pointer',
    });
    reset.addEventListener('click', () => {
      group.offset.copy(group.baked);
      for (const axis of group.axes) {
        if (group.sliders[axis]) group.sliders[axis]!.value = String(group.offset[axis]);
        if (group.chips[axis]) group.chips[axis]!.textContent = group.offset[axis].toFixed(2);
      }
      this.applyTuner();
    });
    section.appendChild(reset);

    panel.appendChild(section);
    this.tuneGroups.push(group);
  }

  /** One labelled axis slider (±6 units, 0.02 step) bound to a group's offset; updates live. */
  private addAxisSlider(section: HTMLElement, group: TuneGroup, axis: Axis, label: string): void {
    const row = el('div', '', { margin: '7px 0' });
    const head = el('div', '', { display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#9fb2c4', marginBottom: '3px' });
    head.appendChild(el('span', label, {}));
    const val = el('span', '0.00', { color: '#fff', fontFamily: 'ui-monospace, monospace' });
    head.appendChild(val);
    row.appendChild(head);

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = '-6';
    slider.max = '6';
    slider.step = '0.02';
    slider.value = '0';
    slider.style.width = '100%';
    slider.style.accentColor = '#ff8a1e';
    slider.addEventListener('input', () => {
      group.offset[axis] = parseFloat(slider.value);
      val.textContent = group.offset[axis].toFixed(2);
      this.applyTuner();
    });
    row.appendChild(slider);
    section.appendChild(row);
    group.sliders[axis] = slider;
    group.chips[axis] = val;
  }

  /** Render the selected airframe's name, blurb, catalog spec bars, and real HELI_CLASSES numbers. */
  private renderStats(): void {
    const item = HELIS.find((h) => h.id === this.heliId);
    const cls = resolveHeliClass(this.heliId);
    if (!item) return;
    this.stats.replaceChildren();

    this.stats.appendChild(el('div', item.name, { font: '700 18px system-ui, sans-serif', color: '#fff' }));
    this.stats.appendChild(el('div', item.tagline, { color: '#9fb2c4', fontSize: '12px', marginBottom: '10px' }));
    this.stats.appendChild(el('div', item.blurb, { color: '#c4d0db', fontSize: '12px', marginBottom: '14px' }));

    // Catalog spec bars (0..1) — the at-a-glance read.
    for (const s of item.specs ?? []) this.stats.appendChild(bar(s.label, s.value));

    // Real class numbers (the source of truth — HELI_CLASSES).
    const grid = el('div', '', { display: 'grid', gridTemplateColumns: '1fr auto', gap: '3px 10px', marginTop: '14px', fontSize: '12px' });
    const stat = (label: string, value: string): void => {
      grid.appendChild(el('div', label, { color: '#9fb2c4' }));
      grid.appendChild(el('div', value, { color: '#fff', fontWeight: '600', textAlign: 'right' }));
    };
    stat('Bucket', `${cls.capacity} L`);
    stat('Fill rate', `${cls.fillRate} L/s`);
    stat('Top speed', `${cls.speedMul.toFixed(2)}×`);
    stat('Engine power', `${cls.powerMul.toFixed(2)}×`);
    stat('Climb', `${cls.climbMul.toFixed(2)}×`);
    stat('Yaw rate', `${cls.yawMul.toFixed(2)}×`);
    stat('Toughness', `${cls.toughness.toFixed(2)}×`);
    this.stats.appendChild(grid);
  }

  // --- loop --------------------------------------------------------------------

  private tick = (time: number): void => {
    const dt = this.prevTime ? Math.min((time - this.prevTime) / 1000, 0.1) : 0.016;
    this.prevTime = time;
    if (this.heli) {
      this.heli.rotor.rotation.y += dt * SPIN_MAIN;
      this.heli.tailRotor.rotation.x += dt * SPIN_TAIL;
    }
    this.controls.update();
    this.frame.update(dt, 1, 0.4, this.sun.position, this.controls.target);
    this.renderer.render(this.scene, this.camera);
  };

  private onResize = (): void => {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  };
}

// --- DOM + dispose helpers ----------------------------------------------------

/** Minimal styled-element helper (self-contained — the dev tools don't pull the player theme). */
function el(tag: string, text: string, style: Partial<CSSStyleDeclaration>): HTMLElement {
  const e = document.createElement(tag);
  if (text) e.textContent = text;
  Object.assign(e.style, style);
  return e;
}

/** A labelled 0..1 meter bar (the catalog spec read). */
function bar(label: string, value: number): HTMLElement {
  const wrap = el('div', '', { margin: '4px 0' });
  const head = el('div', '', { display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#9fb2c4', marginBottom: '2px' });
  head.appendChild(el('span', label, {}));
  head.appendChild(el('span', `${Math.round(value * 100)}`, {}));
  const track = el('div', '', { height: '5px', borderRadius: '3px', background: 'rgba(255,255,255,0.1)', overflow: 'hidden' });
  track.appendChild(el('div', '', { width: `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`, height: '100%', background: 'linear-gradient(90deg,#ff8a1e,#c12a1b)' }));
  wrap.append(head, track);
  return wrap;
}

/** Recursively dispose an object's geometries/materials so airframe switches don't leak GPU memory. */
function disposeObject(o: THREE.Object3D): void {
  o.traverse((c) => {
    const m = c as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    const mat = m.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((x) => !x.userData.shared && x.dispose());
    else if (mat && !mat.userData.shared) mat.dispose();
  });
}

/** Boot the helicopter viewer into the container (called from main.ts for the `?heliview` route). */
export function bootHeliViewer(container: HTMLElement): HeliViewer {
  return new HeliViewer(container);
}
