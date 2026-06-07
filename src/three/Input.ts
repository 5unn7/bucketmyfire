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
 *     single tap; a 'valve' bucket pours while held and pauses on release. The DROP
 *     button doubles as the BUCKET gauge — water rises inside it as you scoop.
 *   - Look around: press-and-drag ANYWHERE on the empty flight view (touch or mouse)
 *     to orbit the chase camera; release eases it back. (No dedicated button.)
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
import type { HighlightId } from './ui/coach/CoachDirector';

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
const STICK_DEADZONE = 0.18;
/** Expo shaping applied after the deadzone (1 = linear; 2 = quadratic). Small pushes
 *  produce much less output; you need a deliberate full push to reach full deflection. */
const STICK_EXPO = 2.2;

// Keyboard keys are on/off, so without this they'd always command FULL deflection
// (max speed / max turn) — twitchy next to the analog stick. These scale a held key
// down to a moderate "stick push" so flying on a desktop feels closer to touch.
const KEY_THROTTLE = 0.6; // forward/back gain for W/S / ↑↓
const KEY_TURN = 0.7; // turn-rate gain for A/D / ←→

/** Drop shadow under the bucket % readout — keeps the digits legible over the cyan water fill. */
const PCT_SHADOW = '0 1px 2px rgba(0,0,0,0.55)';

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
  private dropEnabled = true; // false while a crew low-hover hold owns the controls — DROP greys out + ignores taps/Space
  private btnSwap = false;
  private prevSwap = false; // last frame's swap level, for press-edge detection
  private btnDetach = false;
  private prevDetach = false; // last frame's detach level, for press-edge detection

  // Free-look: drag ANYWHERE on the flight view to orbit the camera 1:1 (the eye button was retired).
  // The deltas are ACCUMULATED across pointermoves and consumed (zeroed) once per frame by `look`.
  private lookActive = false;
  private lookYawAccum = 0; // horizontal orbit drag (rad) banked since the last `look` read
  private lookPitchAccum = 0; // vertical orbit drag (rad) banked since the last `look` read

  // Live joystick base radius (max thumb travel) — recomputed per breakpoint so the
  // pointer math below tracks the on-screen size.
  private stickR = 65;

  // Element refs resized by applyLayout().
  private stickBase!: HTMLDivElement;
  private stickThumb!: HTMLDivElement;
  private stickTicks: HTMLDivElement[] = [];
  private climbBtn!: HTMLDivElement;
  private descendBtn!: HTMLDivElement;
  private dropBtn!: HTMLDivElement;
  // The DROP hero IS the bucket: a cool water layer rises inside it as you scoop and drains as you
  // drop (carry + spend fused into one element). These three refs drive that fill + its % readout.
  private dropLabel!: HTMLDivElement; // the action word ("DROP" / "IGNITE") — relabelled by setActionLabel
  private dropPct!: HTMLDivElement; // the water % readout under the word
  private dropWater!: HTMLDivElement; // the rising water fill layer (clipped to the round button)
  private dropWaterActive = true; // false on crew/torch loadouts (no bucket) → fill hidden, button is just the action
  private flashBucketTimer = 0; // setTimeout id: restore the % readout after a drop-result tint
  private swapBtn!: HTMLDivElement;
  private detachBtn!: HTMLDivElement;
  private clusterRow!: HTMLDivElement;
  private helpBtn!: HTMLDivElement;
  private help!: HelpModal;
  /** The control currently spotlit by the coach (so a change clears the previous one). */
  private highlighted: HTMLElement | null = null;
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
    window.clearTimeout(this.flashBucketTimer);
    this.unsubLayout();
    this.help?.dispose();
    this.setHighlight(null); // drop any coach spotlight class before the elements go
    this.root?.remove();
  }

  /** Spotlight one on-screen control for the interactive coach (or clear with `null`). Toggles a single
   *  keyframed glow class on the existing stick/cluster/DROP elements — box-shadow only, so no relayout
   *  and no pointer-capture change. One class add/remove per CHANGE, not per frame. Driven by Game. */
  setHighlight(id: HighlightId | null): void {
    injectPulseStyles();
    const map: Record<HighlightId, HTMLElement | undefined> = {
      stick: this.stickBase,
      climb: this.climbBtn,
      descend: this.descendBtn,
      drop: this.dropBtn,
    };
    const next = id ? (map[id] ?? null) : null;
    if (next === this.highlighted) return;
    this.highlighted?.classList.remove('bmf-coach-pulse');
    next?.classList.add('bmf-coach-pulse');
    this.highlighted = next;
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

    // Collective: keyboard + buttons, clamped. (I = climb, J = descend.)
    let lift = 0;
    if (k.has('KeyI') || this.btnUp) lift += 1;
    if (k.has('KeyJ') || this.btnDown) lift -= 1;

    // Drop: Space (or the on-screen DROP button). Gated off while disabled (a crew low-hover hold) so a
    // held button or Space can't leak a phantom drop through.
    const drop = this.dropEnabled && (this.btnDrop || k.has('Space'));
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

  /** Relabel the primary action (DROP) button — Game sets it to "IGNITE" on a torch (helitorch) mission,
   *  where the same button lays a backburn instead of dropping water. Keyboard Space is unchanged. */
  setActionLabel(label: string): void {
    if (this.dropLabel) this.dropLabel.textContent = label;
  }

  /** Enable or disable the DROP action entirely. `Game` disables it during a crew low-hover hold (no bucket
   *  to drop): the hexagon greys out and stops intercepting taps + Space, so the inert control reads as
   *  inactive instead of a dead button you keep mashing. Change-guarded — safe to call every frame. */
  setDropEnabled(on: boolean): void {
    if (on === this.dropEnabled) return;
    this.dropEnabled = on;
    if (this.dropBtn) {
      this.dropBtn.style.pointerEvents = on ? '' : 'none';
      this.dropBtn.style.opacity = on ? '1' : '0.3';
      this.dropBtn.style.filter = on ? '' : 'grayscale(1)';
    }
    if (!on) this.btnDrop = false; // release any held press so it doesn't latch through the disable
  }

  /**
   * Drive the DROP "bucket": the water LEVEL `frac` (0..1) rising inside the button, the % readout, the
   * scooping glow, and the detached / inactive states. Game calls this each frame. `active` is false on
   * crew / torch loadouts (no bucket on the line) — the water fill hides and the button is just the
   * action word. While a drop-result flash owns the readout, the level keeps animating but the % text
   * is left alone until the flash clears.
   */
  setBucket(frac: number, opts: { active: boolean; scooping?: boolean; detached?: boolean }): void {
    if (!this.dropWater) return;
    if (opts.active !== this.dropWaterActive) {
      this.dropWaterActive = opts.active;
      this.dropWater.style.display = opts.active ? 'block' : 'none';
      this.dropPct.style.display = opts.active ? 'block' : 'none';
    }
    if (!opts.active) return;
    if (opts.detached) {
      // No bucket on the line — empty, dimmed, "NO" in warn-amber (RTB to a base to rig a fresh one).
      this.dropWater.style.height = '0%';
      this.dropWater.style.boxShadow = 'none';
      this.dropBtn.style.opacity = '0.6';
      if (!this.flashBucketTimer) {
        this.dropPct.textContent = 'NO';
        this.dropPct.style.color = UI.warn;
      }
      return;
    }
    this.dropBtn.style.opacity = '1';
    const f = frac < 0 ? 0 : frac > 1 ? 1 : frac;
    this.dropWater.style.height = `${Math.round(f * 100)}%`;
    this.dropWater.style.boxShadow = opts.scooping ? `inset 0 0 16px ${UI.accent}` : 'none'; // glow while filling → "keep dipping"
    if (this.flashBucketTimer) return; // a drop-result tint owns the % readout — don't fight it
    this.dropPct.textContent = `${Math.round(f * 100)}`;
    this.dropPct.style.color = opts.scooping ? UI.accentHi : UI.water;
  }

  /**
   * Flash the bucket % readout a drop-RESULT colour (green direct / amber too-high / red miss) for `ms`,
   * then restore — the quick confirmation of where the water landed (this was `HUD.flashGauge` before the
   * water gauge moved into the DROP button). Event-driven (one call per committed drop), so no per-frame cost.
   */
  flashBucket(color: string, ms: number): void {
    if (!this.dropPct) return;
    window.clearTimeout(this.flashBucketTimer);
    this.dropPct.style.color = color;
    this.dropPct.style.textShadow = `0 0 8px ${color}`;
    this.flashBucketTimer = window.setTimeout(() => {
      this.dropPct.style.textShadow = PCT_SHADOW;
      this.flashBucketTimer = 0;
    }, ms);
  }

  /** Show/hide the DETACH (jettison-bucket) button. Game shows it on a water mission while a bucket is
   *  attached — press it to release the slung bucket; you then RTB to a base for a fresh one. */
  setDetachVisible(on: boolean): void {
    if (this.detachBtn) this.detachBtn.style.display = on ? 'flex' : 'none';
  }

  /** Show/hide the contextual SWAP-loadout button. Game calls this each frame: it's only
   *  visible on a mixed crew+water mission while the heli is set down at the home base. */
  setSwapVisible(on: boolean): void {
    if (this.swapBtn) this.swapBtn.style.display = on ? 'flex' : 'none';
  }

  /** Free-look orbit for the chase camera, driven by a drag ANYWHERE on the empty flight view (the
   *  dedicated eye button was retired). Returns the orbit DELTA banked since the last read, then ZEROES
   *  it — so this MUST be read exactly once per frame (Game does, in chase.update). `active` stays true
   *  while dragging; on release ChaseCamera eases the view back to the default chase pose. */
  get look(): LookOffset {
    const yawDelta = this.lookYawAccum;
    const pitchDelta = this.lookPitchAccum;
    this.lookYawAccum = 0;
    this.lookPitchAccum = 0;
    return { active: this.lookActive, yawDelta, pitchDelta };
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

    // Collective + DROP cluster.
    const cb = Math.round(set.clusterBtn * k);
    for (const el of [this.climbBtn, this.descendBtn]) {
      Object.assign(el.style, { width: `${cb}px`, height: `${cb}px`, fontSize: `${Math.round(cb * 0.29)}px` });
    }
    const drop = Math.round(set.dropSize * k);
    Object.assign(this.dropBtn.style, { width: `${drop}px`, height: `${drop}px` });
    this.dropLabel.style.fontSize = `${Math.round(drop * 0.18)}px`; // the action word
    this.dropPct.style.fontSize = `${Math.round(drop * 0.15)}px`; // the water % readout (a touch smaller)
    this.clusterRow.style.gap = `${Math.round(set.gap * 1.7)}px`;

    // (Free-look is now a full-screen drag layer — no sized element to lay out here.)

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

    this.buildLookLayer(root); // first → sits BENEATH the controls; drags on empty space orbit the camera
    this.buildStick(root);
    this.buildCluster(root);
    this.buildDetachUI(root);
    this.buildSwapUI(root);
    this.buildHelpUI(root);

    this.root = root; // stored so dispose() can pull the whole overlay (and its listeners) at once
    parent.appendChild(root);
  }

  /** DETACH — top-left corner, hidden until Game calls setDetachVisible(true).
   *  Top-left puts it as far as possible from the joystick (bottom-left) and the
   *  action cluster (bottom-right), so it takes a deliberate upward reach to hit. */
  private buildDetachUI(root: HTMLElement): void {
    const detach = button('⊗  RELEASE BUCKET', {
      position: 'relative',
      display: 'none',
      padding: '0 16px',
      height: '40px',
      borderRadius: R.pill,
      fontSize: FS.meta,
      fontWeight: FW.bold,
      letterSpacing: '1.2px',
      color: '#ffe7df',
      borderColor: UI.warmStroke,
      boxShadow: `0 0 14px rgba(255,90,60,0.26), ${UI.shadowBtn}`,
    });
    this.detachBtn = detach;
    holdButton(detach, (on) => (this.btnDetach = on), UI.warm);

    const a = anchor('top-left');
    a.appendChild(detach);
    root.appendChild(a);
  }

  /** SWAP — bottom-centre, hidden until Game calls setSwapVisible(true).
   *  Re-rig bucket↔crew at the home base (mixed crew+water missions). */
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

  /** Right-hand cluster: a vertical collective pair (climb / descend) sitting just
   *  left of the DROP hero, all sharing one baseline so they read as one group. The DROP
   *  hero doubles as the BUCKET — a rising cyan water fill (carry) over the warm action (spend). */
  private buildCluster(root: HTMLElement): void {
    const climb = button('▲', { position: 'relative' });
    const descend = button('▼', { position: 'relative' });
    const drop = button('', {
      position: 'relative',
      overflow: 'hidden', // clip the rising water fill to the round button — the "bucket"
      background: UI.warmGlass,
      borderColor: UI.warmStroke,
      color: '#ffe7df',
      fontWeight: FW.bold,
      letterSpacing: '1.5px',
      boxShadow: `0 0 18px rgba(255,90,60,0.28), ${UI.shadowBtn}`,
    });
    // Bucket water — a cool layer that rises from the base with the bucket's fill and drains as you
    // drop, sitting BEHIND the label. Cool water under the warm action tells the fight story in one
    // place; the crest line reads as the surface. Driven by setBucket() each frame.
    const water = div({
      position: 'absolute',
      left: '0',
      right: '0',
      bottom: '0',
      height: '0%',
      background: `linear-gradient(to top, ${UI.waterBody}, rgba(86,196,238,0.10))`,
      borderTop: `1.5px solid ${UI.waterCrest}`,
      boxSizing: 'border-box',
      transition: 'height 0.16s ease, box-shadow 0.2s ease, opacity 0.2s ease',
      pointerEvents: 'none',
    });
    const content = div({
      position: 'relative', // paints above the absolutely-positioned water layer
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      lineHeight: '1',
      pointerEvents: 'none',
    });
    const lbl = div({}, 'DROP');
    const pct = div({ marginTop: '3px', fontWeight: FW.semibold, color: UI.water, textShadow: PCT_SHADOW }, '');
    pct.style.setProperty('font-variant-numeric', 'tabular-nums');
    content.append(lbl, pct);
    drop.append(water, content);
    this.climbBtn = climb;
    this.descendBtn = descend;
    this.dropBtn = drop;
    this.dropLabel = lbl;
    this.dropPct = pct;
    this.dropWater = water;
    holdButton(climb, (on) => (this.btnUp = on));
    holdButton(descend, (on) => (this.btnDown = on));
    holdButton(drop, (on) => (this.btnDrop = on), UI.warm);

    const col = div({ display: 'flex', flexDirection: 'column', gap: 'var(--bmf-gap)', alignItems: 'center' });
    col.appendChild(climb);
    col.appendChild(descend);

    const row = div({ display: 'flex', flexDirection: 'row', alignItems: 'flex-end' });
    row.appendChild(col);
    row.appendChild(drop);
    this.clusterRow = row;

    const a = anchor('bottom-right');
    a.appendChild(row);
    root.appendChild(a);
  }

  // --- Free-look: drag anywhere to orbit ------------------------------------

  /**
   * A transparent full-screen layer behind every control: a press-and-drag on the empty flight view
   * orbits the chase camera 1:1 with the drag (the dedicated eye button was retired). It sits at a low
   * z-index so the joystick, the collective/DROP cluster and the HUD's radar/help all intercept their
   * own touches first — only drags on "nothing" reach this. Each pointermove banks its delta (scaled by
   * the CAMERA.lookDrag* sensitivity); `look` drains that once per frame; release eases the view back.
   */
  private buildLookLayer(root: HTMLElement): void {
    const layer = div({
      position: 'fixed',
      inset: '0',
      pointerEvents: 'auto',
      touchAction: 'none',
      cursor: 'grab',
      zIndex: '1', // BELOW the controls (anchors are z 10) — empty space orbits, controls win where they sit
    });
    let pid = -1;
    let lastX = 0;
    let lastY = 0;

    const begin = (e: PointerEvent) => {
      pid = e.pointerId;
      lastX = e.clientX;
      lastY = e.clientY;
      this.lookActive = true;
      layer.setPointerCapture(e.pointerId);
      layer.style.cursor = 'grabbing';
    };
    const move = (e: PointerEvent) => {
      if (e.pointerId !== pid) return;
      // Bank the drag DELTA since the last move (consumed 1:1 by ChaseCamera). Drag right → orbit right;
      // drag down → raise the cam and look down on the heli (matches the retired eye's mapping).
      this.lookYawAccum += -(e.clientX - lastX) * CAMERA.lookDragYaw;
      this.lookPitchAccum += (e.clientY - lastY) * CAMERA.lookDragPitch;
      lastX = e.clientX;
      lastY = e.clientY;
    };
    const end = () => {
      pid = -1;
      this.lookActive = false; // ChaseCamera eases the view back to the default chase pose
      layer.style.cursor = 'grab';
    };
    layer.addEventListener('pointerdown', begin);
    layer.addEventListener('pointermove', move);
    layer.addEventListener('pointerup', end);
    layer.addEventListener('pointercancel', end);

    root.appendChild(layer);
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

// Coach spotlight — a soft cyan glow ring the interactive tutorial pulses onto a control. box-shadow
// only (follows each element's own border-radius), injected once; reduced-motion gets a static ring.
let pulseStylesInjected = false;
function injectPulseStyles(): void {
  if (pulseStylesInjected) return;
  pulseStylesInjected = true;
  const tag = document.createElement('style');
  tag.textContent = `
  @keyframes bmf-coach-pulse-kf {
    0%, 100% { box-shadow: 0 0 0 2px rgba(103,232,255,0.5), 0 0 16px 2px rgba(103,232,255,0.32); }
    50% { box-shadow: 0 0 0 3px rgba(103,232,255,0.95), 0 0 26px 7px rgba(103,232,255,0.55); }
  }
  .bmf-coach-pulse { animation: bmf-coach-pulse-kf 1.1s ease-in-out infinite; }
  @media (prefers-reduced-motion: reduce) {
    .bmf-coach-pulse { animation: none; box-shadow: 0 0 0 3px rgba(103,232,255,0.85), 0 0 18px 3px rgba(103,232,255,0.45); }
  }
  `;
  document.head.appendChild(tag);
}

/** Drop tiny stick jitter, rescale [DEADZONE..1] → [0..1], then apply expo shaping
 *  so small pushes produce proportionally less output — full deflection still reachable
 *  but requires a deliberate push. Keeps a resting thumb from drifting. */
function deadzone(v: number): number {
  const a = Math.abs(v);
  if (a < STICK_DEADZONE) return 0;
  const n = (a - STICK_DEADZONE) / (1 - STICK_DEADZONE);
  return Math.sign(v) * Math.pow(n, STICK_EXPO);
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
