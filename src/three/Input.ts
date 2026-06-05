/**
 * Unified flight input: keyboard + on-screen touch controls, merged behind one
 * `read()`. This is a mobile-browser game, so the touch UI is always present
 * (it also works with a mouse) and the keyboard is a desktop convenience.
 *
 * Controls (helicopter-style — you steer the nose, not a world direction):
 *   - Turn the nose: push the left stick LEFT/RIGHT, or A/D / ←/→.
 *   - Forward / back (variable speed): push the stick UP/DOWN, or W/S / ↑/↓.
 *     Push the stick further for more speed; ease off to creep in precisely.
 *   - Altitude (collective): on-screen ▲/▼, or I (climb) / J (descend).
 *   - Drop water: the DROP button, or Space. A 'bambi' bucket dumps fully on a
 *     single tap; a 'valve' bucket pours while held and pauses on release.
 *
 * A "?" help icon toggles the quick-start modal (`ui/HelpModal`) — a how-to-play
 * tutorial plus the controls reference. It auto-opens once for a first-time pilot.
 *
 * Scooping is NOT a button — you descend over a lake until the slung bucket
 * dips into the water and fills (handled in Game from the bucket's height).
 *
 * Layout: every cluster is mounted on a responsive, safe-area-aware `anchor()`
 * (see `ui/theme.ts`) and sized per breakpoint from `onLayout` (see `ui/layout.ts`)
 * — so the pad clears notches and reflows between portrait/landscape/desktop with
 * no per-orientation special-casing here.
 */
import { CAMERA } from './config';
import type { LookOffset } from './ChaseCamera';
import { UI, FW, FS, R, div, button, setBlur, anchor } from './ui/theme';
import { onLayout, type LayoutState } from './ui/layout';
import { HelpModal, hasSeenHelp, markHelpSeen } from './ui/HelpModal';

export interface ControlState {
  turn: number; // -1 turn left .. +1 turn right
  throttle: number; // -1 reverse .. +1 forward (variable along the nose)
  lift: number; // -1 descend .. +1 climb
  drop: boolean; // DROP held this frame (the 'valve' bucket pours while held)
  dropPressed: boolean; // DROP went down THIS frame (edge) — a one-tap 'bambi' dump trigger
  swapPressed: boolean; // SWAP went down THIS frame (edge) — re-rig bucket↔crew at base (mixed missions)
  detachPressed: boolean; // DETACH went down THIS frame (edge) — jettison the slung bucket (RTB to re-rig)
}

/** Stick travel below this fraction reads as zero, then rescales smoothly. */
const STICK_DEADZONE = 0.12;

// Keyboard keys are on/off, so without this they'd always command FULL deflection
// (max speed / max turn) — twitchy next to the analog stick. These scale a held key
// down to a moderate "stick push" so flying on a desktop feels closer to touch.
const KEY_THROTTLE = 0.6; // forward/back gain for W/S / ↑↓
const KEY_TURN = 0.7; // turn-rate gain for A/D / ←→

export class Input {
  private readonly held = new Set<string>();

  // Touch state.
  private stickTurn = 0; // -1..1, right = turn right
  private stickThrottle = 0; // -1..1, up = forward
  private stickActive = false;
  private btnUp = false;
  private btnDown = false;
  private btnDrop = false;
  private prevDrop = false; // last frame's drop level, for press-edge detection
  private btnSwap = false;
  private prevSwap = false; // last frame's swap level, for press-edge detection
  private btnDetach = false;
  private prevDetach = false; // last frame's detach level, for press-edge detection

  // Collective slider (replaces digital ▲/▼ buttons).
  private sliderActive = false;
  private sliderLift = 0;
  private collectiveKnob!: HTMLDivElement;
  private collectiveTrack!: HTMLDivElement;

  // Free-look ("eye" button): drag sets orbit VELOCITY, release eases back.
  private lookActive = false;
  private lookYawRate = 0;
  private lookPitchRate = 0;

  // Live joystick base radius (max thumb travel) — recomputed per breakpoint so the
  // pointer math below tracks the on-screen size.
  private stickR = 65;

  // Element refs resized by applyLayout().
  private stickBase!: HTMLDivElement;
  private stickThumb!: HTMLDivElement;
  private stickTicks: HTMLDivElement[] = [];
  private dropBtn!: HTMLDivElement;
  private swapBtn!: HTMLDivElement;
  private detachBtn!: HTMLDivElement;
  private clusterRow!: HTMLDivElement;
  private eyeBtn!: HTMLDivElement;
  private eyeSvg!: SVGElement;
  private helpBtn!: HTMLDivElement;
  private help!: HelpModal;
  // Teardown handles (in-place mission switch): the touch-UI root, the three window key listeners,
  // and the layout subscription — all stored so dispose() can detach them and a dead game's input
  // never lingers bound to window / firing on resize. (Listeners on elements INSIDE `root` go away
  // for free when the root is removed.)
  private root!: HTMLDivElement;
  private readonly onKeyDown: (e: KeyboardEvent) => void;
  private readonly onKeyUp: (e: KeyboardEvent) => void;
  private readonly onBlur: () => void;
  private readonly unsubLayout: () => void;

  constructor(parent: HTMLElement) {
    this.onKeyDown = (e: KeyboardEvent): void => {
      this.held.add(e.code);
      if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
    };
    this.onKeyUp = (e: KeyboardEvent): void => void this.held.delete(e.code);
    this.onBlur = (): void => this.held.clear();
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);

    this.buildTouchUI(parent);
    this.unsubLayout = onLayout((s) => this.applyLayout(s)); // size + reflow now and on every resize/orientation change
  }

  /** Teardown for an in-place mission switch: detach the window listeners + layout subscription,
   *  dispose the help modal (its body-level scrim), and remove the touch-UI overlay (which detaches
   *  every pointer listener on the buttons/stick inside it). Idempotent. */
  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    this.unsubLayout();
    this.help?.dispose();
    this.root?.remove();
  }

  read(): ControlState {
    const k = this.held;

    // Keyboard steering: A/D (or ←/→) turn the nose; W/S (or ↑/↓) throttle.
    let kTurn = 0;
    let kThrottle = 0;
    if (k.has('KeyW') || k.has('ArrowUp')) kThrottle += KEY_THROTTLE; // forward
    if (k.has('KeyS') || k.has('ArrowDown')) kThrottle -= KEY_THROTTLE; // reverse
    if (k.has('KeyA') || k.has('ArrowLeft')) kTurn -= KEY_TURN; // turn left
    if (k.has('KeyD') || k.has('ArrowRight')) kTurn += KEY_TURN; // turn right

    // Touch stick overrides the keyboard when engaged (deadzoned + rescaled).
    const turn = this.stickActive ? deadzone(this.stickTurn) : kTurn;
    const throttle = this.stickActive ? deadzone(this.stickThrottle) : kThrottle;

    // Collective: analog slider (touch) or keyboard fallback.
    let lift = 0;
    if (this.sliderActive) {
      lift = this.sliderLift;
    } else {
      if (k.has('KeyI') || this.btnUp) lift += 1;
      if (k.has('KeyJ') || this.btnDown) lift -= 1;
    }

    // Drop: Space (or the on-screen DROP button).
    const drop = this.btnDrop || k.has('Space');
    const dropPressed = drop && !this.prevDrop; // rising edge → one-tap dump trigger
    this.prevDrop = drop;

    // Swap loadout (G, or the contextual SWAP button) — edge-detected, one re-rig per press.
    const swap = this.btnSwap || k.has('KeyG');
    const swapPressed = swap && !this.prevSwap;
    this.prevSwap = swap;

    // Detach the bucket (B, or the DETACH button) — edge-detected, one jettison per press.
    const detach = this.btnDetach || k.has('KeyB');
    const detachPressed = detach && !this.prevDetach;
    this.prevDetach = detach;

    return { turn, throttle, lift, drop, dropPressed, swapPressed, detachPressed };
  }

  /** Relabel the primary action (DROP) button — Game sets it to "IGNITE" on a torch (helitorch) sortie,
   *  where the same button lays a backburn instead of dropping water. Keyboard Space is unchanged. */
  setActionLabel(label: string): void {
    if (this.dropBtn) this.dropBtn.textContent = label;
  }

  /** Show/hide the DETACH (jettison-bucket) button. Game shows it on a water sortie while a bucket is
   *  attached — press it to release the slung bucket; you then RTB to a base for a fresh one. */
  setDetachVisible(on: boolean): void {
    if (this.detachBtn) this.detachBtn.style.display = on ? 'flex' : 'none';
  }

  /** Show/hide the contextual SWAP-loadout button. Game calls this each frame: it's only
   *  visible on a mixed crew+water mission while the heli is set down at the home base. */
  setSwapVisible(on: boolean): void {
    if (this.swapBtn) this.swapBtn.style.display = on ? 'flex' : 'none';
  }

  /** Free-look orbit for the chase camera, driven by the "eye" button drag.
   *  Returns orbit RATES (rad/sec); `active` is false once released, so the camera
   *  eases back to the default pose. */
  get look(): LookOffset {
    return { active: this.lookActive, yawRate: this.lookYawRate, pitchRate: this.lookPitchRate };
  }

  /** The "?" help button. Game mounts it under the radar (HUD.mountUnderRadar) so it lives in
   *  the minimap's top-right corner rather than floating at the bottom of the screen. */
  get helpButton(): HTMLDivElement {
    return this.helpBtn;
  }

  // --- Responsive sizing ----------------------------------------------------

  /** Size + reflow the controls for the active breakpoint. Anchors handle
   *  position + safe-area in CSS; this only sets the per-element pixel sizes that
   *  must be exact (and keeps `stickR` in sync with the pointer math). */
  private applyLayout(s: LayoutState): void {
    const k = s.compact ? 0.92 : 1;
    const set = s.set;

    // Joystick.
    const R = Math.round(set.stickRadius * k);
    this.stickR = R;
    const d = R * 2;
    Object.assign(this.stickBase.style, { width: `${d}px`, height: `${d}px` });
    const thumb = Math.round(R * 0.92);
    Object.assign(this.stickThumb.style, {
      width: `${thumb}px`,
      height: `${thumb}px`,
      marginLeft: `${-thumb / 2}px`,
      marginTop: `${-thumb / 2}px`,
    });
    for (const t of this.stickTicks) t.style.transformOrigin = `1px ${R - 6}px`;

    // Collective slider + DROP cluster.
    const cb = Math.round(set.clusterBtn * k);
    const drop = Math.round(set.dropSize * k);
    Object.assign(this.dropBtn.style, { width: `${drop}px`, height: `${drop}px`, fontSize: `${Math.round(drop * 0.16)}px` });
    this.clusterRow.style.gap = `${Math.round(set.gap * 1.7)}px`;

    // Collective slider — same height footprint as the old two-button column.
    const slH = cb * 2 + set.gap;
    const slW = 26;
    Object.assign(this.collectiveTrack.style, { width: `${slW}px`, height: `${slH}px` });
    const kW = slW - 4;
    const kH = Math.round(slW * 0.82);
    Object.assign(this.collectiveKnob.style, { width: `${kW}px`, height: `${kH}px` });

    // Detach circle — proportional to the cluster.
    const det = Math.round(cb * 0.56);
    Object.assign(this.detachBtn.style, { width: `${det}px`, height: `${det}px`, fontSize: `${Math.round(det * 0.44)}px` });

    // Free-look eye — sits in the lower-right, lifted above the collective/DROP cluster.
    const eye = Math.round(set.eyeSize * k);
    // The cluster's footprint above the bottom edge: the taller of the climb+descend
    // column (2 buttons + their gap) vs the DROP hero. Float the eye that far up plus a
    // separation gap, so it lands in the lower half and clears the buttons on any screen.
    const colH = cb * 2 + set.gap;
    const clusterH = Math.max(colH, drop);
    const lift = clusterH + Math.round(set.gap * 2.5);
    Object.assign(this.eyeBtn.style, { width: `${eye}px`, height: `${eye}px`, marginBottom: `${lift}px` });
    const glyph = Math.round(eye * 0.52);
    this.eyeSvg.setAttribute('width', `${glyph}`);
    this.eyeSvg.setAttribute('height', `${glyph}`);

    // Help.
    const help = Math.round(set.helpSize * k);
    Object.assign(this.helpBtn.style, { width: `${help}px`, height: `${help}px`, fontSize: `${Math.round(help * 0.5)}px` });
  }

  // --- Touch UI -------------------------------------------------------------

  private buildTouchUI(parent: HTMLElement): void {
    const root = div({
      position: 'fixed',
      inset: '0',
      pointerEvents: 'none',
      touchAction: 'none',
      zIndex: '10',
    });

    this.buildStick(root);
    this.buildCluster(root);
    this.buildSwapUI(root);
    this.buildLookUI(root);
    this.buildHelpUI(root);

    this.root = root; // stored so dispose() can pull the whole overlay (and its listeners) at once
    parent.appendChild(root);
  }

  /** Contextual bottom-centre SWAP button (re-rig bucket↔crew at home base, mixed missions). */
  private buildSwapUI(root: HTMLElement): void {
    const swap = button('⇄ SWAP', {
      position: 'relative',
      display: 'none',
      padding: '0 18px',
      height: '46px',
      borderRadius: R.pill,
      fontSize: FS.body,
      fontWeight: FW.bold,
      letterSpacing: '1.5px',
      color: UI.text,
      borderColor: UI.accentSoft,
      boxShadow: `0 0 16px ${UI.accent}33, ${UI.shadowBtn}`,
    });
    this.swapBtn = swap;
    holdButton(swap, (on) => (this.btnSwap = on));

    const col = div({ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px', marginBottom: '14px' });
    col.appendChild(swap);
    const a = anchor('bottom-center');
    a.appendChild(col);
    root.appendChild(a);
  }

  /** Virtual joystick (bottom-left) — a frosted dish with hairline axis ticks and a
   *  glowing cyan knob, so it reads as an instrument rather than a flat blob. */
  private buildStick(root: HTMLElement): void {
    const base = div({
      position: 'relative',
      borderRadius: R.round,
      background: 'radial-gradient(circle at 50% 42%, rgba(24,34,44,0.34), rgba(8,12,18,0.52))',
      border: `1px solid ${UI.strokeStrong}`,
      boxShadow: `inset 0 1px 22px rgba(0,0,0,0.42), ${UI.shadowBtn}`,
      pointerEvents: 'auto',
      touchAction: 'none',
    });
    setBlur(base);
    // Inner guide ring.
    base.appendChild(
      div({ position: 'absolute', inset: '20px', borderRadius: R.round, border: '1px solid rgba(255,255,255,0.08)' }),
    );
    // Four faint axis ticks (N/E/S/W) — origin set per size in applyLayout().
    for (let i = 0; i < 4; i++) {
      const tick = div({
        position: 'absolute',
        left: '50%',
        top: '6px',
        width: '2px',
        height: '8px',
        marginLeft: '-1px',
        borderRadius: R.xs,
        background: 'rgba(103,232,255,0.35)',
        transform: `rotate(${i * 90}deg)`,
      });
      this.stickTicks.push(tick);
      base.appendChild(tick);
    }
    const thumb = div({
      position: 'absolute',
      left: '50%',
      top: '50%',
      borderRadius: R.round,
      background: 'radial-gradient(circle at 40% 34%, rgba(255,255,255,0.55), rgba(150,182,202,0.24))',
      border: `1.5px solid ${UI.accentSoft}`,
      boxShadow: '0 3px 10px rgba(0,0,0,0.45)',
      transition: 'box-shadow 0.12s ease, border-color 0.12s ease',
      pointerEvents: 'none',
    });
    base.appendChild(thumb);
    this.stickBase = base;
    this.stickThumb = thumb;

    const setKnobActive = (on: boolean) => {
      thumb.style.boxShadow = on
        ? `0 0 16px ${UI.accentSoft}, 0 3px 10px rgba(0,0,0,0.45)`
        : '0 3px 10px rgba(0,0,0,0.45)';
      thumb.style.borderColor = on ? UI.accent : UI.accentSoft;
    };

    let stickId = -1;
    const onStick = (e: PointerEvent) => {
      const R = this.stickR;
      const rect = base.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dx = e.clientX - cx;
      const dy = e.clientY - cy;
      const dist = Math.min(Math.hypot(dx, dy), R);
      const ang = Math.atan2(dy, dx);
      const tx = Math.cos(ang) * dist;
      const ty = Math.sin(ang) * dist;
      thumb.style.transform = `translate(${tx}px, ${ty}px)`;
      this.stickTurn = tx / R; // push right → turn right
      this.stickThrottle = -ty / R; // push up → forward (screen-up is −y)
      this.stickActive = true;
      setKnobActive(true);
    };
    const releaseStick = () => {
      stickId = -1;
      this.stickActive = false;
      this.stickTurn = 0;
      this.stickThrottle = 0;
      thumb.style.transform = 'translate(0px, 0px)';
      setKnobActive(false);
    };
    base.addEventListener('pointerdown', (e) => {
      stickId = e.pointerId;
      base.setPointerCapture(e.pointerId);
      onStick(e);
    });
    base.addEventListener('pointermove', (e) => {
      if (e.pointerId === stickId) onStick(e);
    });
    base.addEventListener('pointerup', releaseStick);
    base.addEventListener('pointercancel', releaseStick);

    const a = anchor('bottom-left');
    a.appendChild(base);
    root.appendChild(a);
  }

  /** Right-hand cluster:
   *   - DETACH (✂) — small ember circle, top-left of the group, jettison the slung bucket.
   *   - Collective slider — vertical frosted capsule (drag up = climb, drag down = descend).
   *   - DROP hero — warm action button on the right.
   */
  private buildCluster(root: HTMLElement): void {
    // Small circular DETACH button — ember/fire register (cutting the rope is a real commitment).
    const detach = button('✂', {
      position: 'relative',
      display: 'none',
      background: 'radial-gradient(circle at 38% 32%, rgba(255,140,70,0.22), rgba(30,10,5,0.55))',
      borderColor: 'rgba(255,130,60,0.65)',
      color: '#ffd4a4',
      fontWeight: FW.bold,
      fontSize: '18px',
      borderRadius: R.round,
      boxShadow: `0 0 14px rgba(255,90,40,0.32), ${UI.shadowBtn}`,
    });
    this.detachBtn = detach;
    holdButton(detach, (on) => (this.btnDetach = on), UI.ember);

    const slider = this.buildCollectiveSlider();

    const drop = button('DROP', {
      position: 'relative',
      background: UI.warmGlass,
      borderColor: UI.warmStroke,
      color: '#ffe7df',
      fontWeight: FW.bold,
      letterSpacing: '1.5px',
      boxShadow: `0 0 18px rgba(255,90,60,0.28), ${UI.shadowBtn}`,
    });
    this.dropBtn = drop;
    holdButton(drop, (on) => (this.btnDrop = on), UI.warm);

    // Bottom row: [slider | DROP], baseline-aligned.
    const row = div({ display: 'flex', flexDirection: 'row', alignItems: 'flex-end' });
    row.appendChild(slider);
    row.appendChild(drop);
    this.clusterRow = row;

    // Top row: detach circle left-aligned (hidden until Game shows it).
    const topRow = div({ display: 'flex', alignItems: 'center', marginBottom: '6px' });
    topRow.appendChild(detach);

    const wrapper = div({ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' });
    wrapper.appendChild(topRow);
    wrapper.appendChild(row);

    const a = anchor('bottom-right');
    a.appendChild(wrapper);
    root.appendChild(a);
  }

  /** Vertical collective slider — drag up to climb, drag down to descend; springs to neutral on release.
   *  Styled as a cockpit throttle: frosted capsule track, cyan notch at centre, active fill
   *  cyan (climb) or ember (sink), flat frosted knob. Keyboard I/J still work when inactive. */
  private buildCollectiveSlider(): HTMLDivElement {
    const track = div({
      position: 'relative',
      borderRadius: '13px',
      background:
        'linear-gradient(180deg, rgba(103,232,255,0.13) 0%, rgba(8,14,22,0.56) 36%, rgba(8,14,22,0.56) 64%, rgba(255,106,44,0.11) 100%)',
      border: '1px solid rgba(103,232,255,0.22)',
      boxShadow: 'inset 0 1px 16px rgba(0,0,0,0.45), 0 4px 16px rgba(0,0,0,0.35)',
      pointerEvents: 'auto',
      touchAction: 'none',
      cursor: 'ns-resize',
      overflow: 'hidden',
    });
    setBlur(track);

    // Centre notch — the neutral-lift datum line.
    track.appendChild(
      div({
        position: 'absolute',
        left: '4px',
        right: '4px',
        height: '1px',
        top: '50%',
        transform: 'translateY(-0.5px)',
        background: 'rgba(103,232,255,0.45)',
        pointerEvents: 'none',
      }),
    );

    // Avionics-style labels.
    const mkLabel = (text: string, pos: 'top' | 'bottom', color: string): HTMLDivElement => {
      const el = div({
        position: 'absolute',
        [pos]: '4px',
        left: '0',
        right: '0',
        textAlign: 'center',
        fontSize: '7px',
        letterSpacing: '0.5px',
        color,
        fontFamily: 'monospace',
        pointerEvents: 'none',
      });
      el.textContent = text;
      return el;
    };
    track.appendChild(mkLabel('CLB', 'top', 'rgba(103,232,255,0.50)'));
    track.appendChild(mkLabel('SNK', 'bottom', 'rgba(255,106,44,0.48)'));

    // Active-direction fill bar.
    const fill = div({
      position: 'absolute',
      left: '3px',
      right: '3px',
      height: '0',
      top: '50%',
      borderRadius: '4px',
      background: 'rgba(103,232,255,0.28)',
      pointerEvents: 'none',
    });
    track.appendChild(fill);

    // Draggable knob — flat frosted pill.
    const knob = div({
      position: 'absolute',
      left: '50%',
      top: '50%',
      transform: 'translate(-50%, -50%)',
      borderRadius: '8px',
      background: 'radial-gradient(circle at 40% 34%, rgba(255,255,255,0.55), rgba(150,182,202,0.24))',
      border: `1.5px solid ${UI.accentSoft}`,
      boxShadow: '0 2px 10px rgba(0,0,0,0.45)',
      transition: 'box-shadow 0.12s ease, border-color 0.12s ease',
      pointerEvents: 'none',
    });
    track.appendChild(knob);
    this.collectiveKnob = knob;
    this.collectiveTrack = track;

    const setLift = (clientY: number): void => {
      const rect = track.getBoundingClientRect();
      const kh = knob.offsetHeight || 20;
      const travel = rect.height - kh;
      if (travel <= 0) return;
      const relY = clamp(clientY - rect.top - kh / 2, 0, travel);
      this.sliderLift = 1 - (relY / travel) * 2; // +1 at top (climb), -1 at bottom (sink)

      knob.style.top = `${relY + kh / 2}px`;
      knob.style.transform = 'translate(-50%, -50%)';

      const centerY = rect.height / 2;
      const knobCY = relY + kh / 2;
      if (this.sliderLift >= 0) {
        fill.style.top = `${knobCY}px`;
        fill.style.height = `${Math.max(0, centerY - knobCY)}px`;
        fill.style.background = 'rgba(103,232,255,0.28)';
      } else {
        fill.style.top = `${centerY}px`;
        fill.style.height = `${Math.max(0, knobCY - centerY)}px`;
        fill.style.background = 'rgba(255,106,44,0.22)';
      }
    };

    const releaseSlider = (): void => {
      this.sliderActive = false;
      this.sliderLift = 0;
      knob.style.top = '50%';
      knob.style.transform = 'translate(-50%, -50%)';
      fill.style.height = '0';
      knob.style.borderColor = UI.accentSoft;
      knob.style.boxShadow = '0 2px 10px rgba(0,0,0,0.45)';
    };

    let sliderId = -1;
    track.addEventListener('pointerdown', (e) => {
      sliderId = e.pointerId;
      track.setPointerCapture(e.pointerId);
      this.sliderActive = true;
      setLift(e.clientY);
      knob.style.borderColor = UI.accent;
      knob.style.boxShadow = `0 0 14px ${UI.accentSoft}, 0 2px 10px rgba(0,0,0,0.45)`;
    });
    track.addEventListener('pointermove', (e) => {
      if (e.pointerId !== sliderId) return;
      setLift(e.clientY);
    });
    track.addEventListener('pointerup', releaseSlider);
    track.addEventListener('pointercancel', releaseSlider);

    return track;
  }

  // --- Free-look "eye" button -----------------------------------------------

  /** An eye icon (right edge, mid-screen) you press-and-drag to orbit the camera.
   *  Drag = orbit SPEED, not distance: a small push held in any direction spins the
   *  view continuously (a full 360° either way), so the button can sit near the edge
   *  and you never run out of room. Release returns to the default chase pose. */
  private buildLookUI(root: HTMLElement): void {
    const icon = button('', { position: 'relative', cursor: 'grab' });
    icon.innerHTML = EYE_SVG;
    this.eyeBtn = icon;
    this.eyeSvg = icon.querySelector('svg') as SVGElement;

    const R = CAMERA.lookPadRadius;
    let pid = -1;
    let startX = 0;
    let startY = 0;

    const begin = (e: PointerEvent) => {
      e.stopPropagation();
      pid = e.pointerId;
      startX = e.clientX;
      startY = e.clientY;
      this.lookActive = true;
      this.lookYawRate = 0;
      this.lookPitchRate = 0;
      icon.setPointerCapture(e.pointerId);
      icon.style.filter = 'brightness(1.6)';
      icon.style.cursor = 'grabbing';
    };
    const move = (e: PointerEvent) => {
      if (e.pointerId !== pid) return;
      // Displacement from the press point → orbit speed (deadzoned + clamped to ±1).
      // Drag right → orbit right; drag down → raise the cam and look down on the heli.
      const nx = deadzone(clamp((e.clientX - startX) / R, -1, 1));
      const ny = deadzone(clamp((e.clientY - startY) / R, -1, 1));
      this.lookYawRate = -nx * CAMERA.lookYawRate;
      this.lookPitchRate = ny * CAMERA.lookPitchRate;
    };
    const end = () => {
      pid = -1;
      this.lookActive = false; // ChaseCamera eases the view back to the default pose
      this.lookYawRate = 0;
      this.lookPitchRate = 0;
      icon.style.filter = 'none';
      icon.style.cursor = 'grab';
    };
    icon.addEventListener('pointerdown', begin);
    icon.addEventListener('pointermove', move);
    icon.addEventListener('pointerup', end);
    icon.addEventListener('pointercancel', end);

    // Lower-right, floated a clear gap ABOVE the collective/DROP cluster (the lift is
    // computed per-breakpoint in applyLayout from the cluster's footprint, so it sits
    // in the lower half on every screen without overlapping the buttons below it).
    const a = anchor('bottom-right');
    a.appendChild(icon);
    root.appendChild(a);
  }

  // --- Help / quick-start ---------------------------------------------------

  /** A "?" icon that opens the quick-start modal (`ui/HelpModal`) — a how-to-play tutorial plus
   *  the touch/keyboard controls reference. It auto-opens ONCE for a first-time pilot (gated in
   *  localStorage) so the greeting shows exactly once but stays reopenable forever. The icon is
   *  mounted under the radar by Game (HUD.mountUnderRadar); the modal owns its own body-level
   *  scrim, so nothing extra is parented here. */
  private buildHelpUI(_root: HTMLElement): void {
    this.help = new HelpModal();

    const icon = button('?', { position: 'relative', color: UI.dim, fontWeight: FW.semibold });
    this.helpBtn = icon;
    icon.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.help.toggle();
    });
    // NB: the first-run auto-open is deliberately NOT here — it used to stack the quick-start ON TOP
    // OF the pre-flight briefing card. Game calls openHelpFirstTime() AFTER the briefing's BEGIN.
  }

  /** Open the quick-start ONCE for a first-time pilot (gated in localStorage), then never auto-again
   *  (the "?" button still reopens it anytime). Game calls this after the briefing is dismissed, so
   *  the tutorial follows the mission brief instead of stacking on top of it. */
  openHelpFirstTime(): void {
    if (hasSeenHelp()) return;
    markHelpSeen();
    this.help.open();
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Eye glyph for the free-look button (stroked SVG, scales crisply at any size). */
const EYE_SVG =
  '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#eaf6ff" ' +
  'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/>' +
  '<circle cx="12" cy="12" r="3"/></svg>';

/** Drop tiny stick jitter, then rescale [DEADZONE..1] back to [0..1] so the full
 *  control range is still reachable. Keeps a resting thumb from drifting. */
function deadzone(v: number): number {
  const a = Math.abs(v);
  if (a < STICK_DEADZONE) return 0;
  return Math.sign(v) * ((a - STICK_DEADZONE) / (1 - STICK_DEADZONE));
}

/** Wire a div to call `set(true)` while pressed and `set(false)` on release, with
 *  an accent ring + glow on press (warm for DROP, cyan otherwise). */
function holdButton(node: HTMLElement, set: (on: boolean) => void, accent: string = UI.accent): void {
  const restShadow = node.style.boxShadow;
  const restBorder = node.style.borderColor;
  const press = (e: PointerEvent) => {
    set(true);
    node.setPointerCapture(e.pointerId);
    node.style.filter = 'brightness(1.25)';
    node.style.borderColor = accent;
    node.style.boxShadow = `0 0 18px ${accent}, inset 0 0 14px ${accent}55`;
  };
  const release = () => {
    set(false);
    node.style.filter = 'none';
    node.style.borderColor = restBorder;
    node.style.boxShadow = restShadow;
  };
  node.addEventListener('pointerdown', press);
  node.addEventListener('pointerup', release);
  node.addEventListener('pointercancel', release);
  node.addEventListener('pointerleave', release);
}
