/**
 * Unified flight input: keyboard + on-screen touch controls, merged behind one
 * `read()`. This is a mobile-browser game, so the touch UI is always present
 * (it also works with a mouse) and the keyboard is a desktop convenience.
 *
 * Controls (real-helicopter layout — TWO 2-axis sticks, each self-centring so a release HOLDS):
 *   - LEFT stick = cyclic. UP/DOWN = forward/back throttle (W/S, ↑/↓); LEFT/RIGHT = lateral STRAFE
 *     (A/D), a sideways slide perpendicular to the nose. Push further for more; ease off to creep.
 *   - RIGHT stick = pedals + collective. LEFT/RIGHT = YAW the nose (Q/E, ←/→); UP/DOWN = altitude
 *     (climb / descend; I/J). Letting go holds your heading + altitude band.
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
 * Layout: every cluster is mounted on a responsive, safe-area-aware `anchor()` (see `ui/theme.ts`) and
 * SIZED by the injected `.bmf-hud` stylesheet (hud/styles.ts) — fluid `clamp()` vars (--stick / --drop /
 * --detach / --help) that reflow between portrait/landscape/desktop with no per-orientation JS here.
 */
import { CAMERA } from './config';
import type { LookOffset } from './ChaseCamera';
import { UI, FW, FS, R, div, button, setBlur, anchor, prefersReducedMotion, accentAlpha } from './ui/theme';
import { makeIconSvg } from './ui/svgIcons';
import { injectHudStyles } from './hud/styles';
import { HelpModal, hasSeenHelp, markHelpSeen } from './ui/HelpModal';
import type { HighlightId } from './ui/coach/CoachDirector';

export interface ControlState {
  turn: number; // -1 turn left .. +1 turn right (yaw / pedals — RIGHT stick X)
  throttle: number; // -1 reverse .. +1 forward (variable along the nose — LEFT stick Y)
  lateral: number; // -1 strafe left .. +1 strafe right (sideways cyclic — LEFT stick X)
  lift: number; // -1 descend .. +1 climb (collective — RIGHT stick Y)
  drop: boolean; // DROP held this frame (the 'valve' bucket pours while held)
  dropPressed: boolean; // DROP went down THIS frame (edge) — a one-tap 'bambi' dump trigger
  swapPressed: boolean; // SWAP went down THIS frame (edge) — re-rig bucket↔crew at base (mixed missions)
  detachPressed: boolean; // DETACH went down THIS frame (edge) — jettison the slung bucket (RTB to re-rig)
}

/** Stick travel below this fraction reads as zero, then rescales smoothly. */
const STICK_DEADZONE = 0.15;
/** Expo shaping applied after the deadzone (1 = linear; 2 = quadratic). Small pushes
 *  produce much less output; you need a deliberate full push to reach full deflection.
 *  Higher = calmer stick — softens small/mid pushes so mobile flying isn't twitchy. */
const STICK_EXPO = 2.7;

// Keyboard keys are on/off, so without this they'd always command FULL deflection
// (max speed / max turn) — twitchy next to the analog stick. These scale a held key
// down to a moderate "stick push" so flying on a desktop feels closer to touch.
const KEY_THROTTLE = 0.6; // forward/back gain for W/S / ↑↓
const KEY_LATERAL = 0.7; // sideways-strafe gain for A/D
const KEY_TURN = 0.9; // yaw-rate gain for Q/E / ←→

/** Drop shadow under the bucket % readout — keeps the digits legible over the cyan water fill. */
const PCT_SHADOW = '0 1px 2px rgba(0,0,0,0.55)';

export class Input {
  private readonly held = new Set<string>();

  // Touch state. Two 2-axis sticks (real-helicopter layout):
  //   LEFT (cyclic):  X = lateral strafe, Y = throttle (fwd / back).
  //   RIGHT (pedals + collective): X = yaw, Y = altitude. Both self-centre on release.
  private leftX = 0; // -1..1, right = strafe right
  private leftY = 0; // -1..1, up = forward
  private leftActive = false;
  private rightX = 0; // -1..1, right = yaw right
  private rightY = 0; // -1..1, up = climb
  private rightActive = false;
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

  // The joystick "radius" (max thumb travel) is read LIVE from each dish's measured size in makeJoystick.
  // The dishes are CSS-sized now (the --stick clamp var in hud/styles.ts), so there's no per-breakpoint
  // pixel state to keep here — the pointer math tracks the on-screen size for free.

  // Element refs (the controls themselves are CSS-sized via the `.bmf-hud` clamp vars). Only the stick
  // BASES are kept — the coach spotlights them; the knobs + ticks live under each base and need no ref.
  private leftBase!: HTMLDivElement;
  private rightBase!: HTMLDivElement;
  private dropBtn!: HTMLDivElement;
  // The DROP hero IS the bucket: a cool water layer rises inside it as you scoop and drains as you
  // drop (carry + spend fused into one element). These three refs drive that fill + its % readout.
  private dropLabel!: HTMLDivElement; // the action word ("DROP" / "IGNITE") — relabelled by setActionLabel
  private dropPct!: HTMLDivElement; // the water % readout under the word
  private dropWater!: HTMLDivElement; // the rising water fill layer (clipped to the round button)
  private dropWave!: HTMLDivElement; // the animated wave riding the water surface (a sloshing crest)
  private dropWaterActive = true; // false on crew/torch loadouts (no bucket) → fill hidden, button is just the action
  private flashBucketTimer = 0; // setTimeout id: restore the % readout after a drop-result tint
  private swapBtn!: HTMLDivElement;
  private detachBtn!: HTMLDivElement; // the small round RELEASE-BUCKET button (clustered above DROP)
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
    // No layout subscription: the controls are CSS-sized (clamp vars) and reflow on resize for free.
  }

  /** Teardown for an in-place mission switch: detach the window listeners + layout subscription,
   *  dispose the help modal (its body-level scrim), and remove the touch-UI overlay (which detaches
   *  every pointer listener on the buttons/stick inside it). Idempotent. */
  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    window.clearTimeout(this.flashBucketTimer);
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
      stick: this.leftBase, // movement lives on the left cyclic stick
      // climb/descend (altitude) are the right stick's vertical axis — point both at it.
      climb: this.rightBase,
      descend: this.rightBase,
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

    // Keyboard (real-heli split): W/S (or ↑/↓) throttle, A/D strafe, Q/E (or ←/→) yaw, I/J collective.
    let kThrottle = 0;
    let kLateral = 0;
    let kTurn = 0;
    if (k.has('KeyW') || k.has('ArrowUp')) kThrottle += KEY_THROTTLE; // forward
    if (k.has('KeyS') || k.has('ArrowDown')) kThrottle -= KEY_THROTTLE; // reverse
    if (k.has('KeyA')) kLateral -= KEY_LATERAL; // strafe left
    if (k.has('KeyD')) kLateral += KEY_LATERAL; // strafe right
    if (k.has('KeyQ') || k.has('ArrowLeft')) kTurn -= KEY_TURN; // yaw left
    if (k.has('KeyE') || k.has('ArrowRight')) kTurn += KEY_TURN; // yaw right

    // Each touch stick overrides the keyboard for its own axes when engaged (deadzoned + rescaled).
    // LEFT = cyclic (throttle + lateral); RIGHT = pedals + collective (yaw + altitude). Both self-centre,
    // so releasing holds heading + altitude.
    const throttle = this.leftActive ? deadzone(this.leftY) : kThrottle;
    const lateral = this.leftActive ? deadzone(this.leftX) : kLateral;
    const turn = this.rightActive ? deadzone(this.rightX) : kTurn;
    let lift = 0;
    if (this.rightActive) {
      lift = deadzone(this.rightY);
    } else {
      if (k.has('KeyI')) lift += 1;
      if (k.has('KeyJ')) lift -= 1;
    }

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

    return { turn, throttle, lateral, lift, drop, dropPressed, swapPressed, detachPressed };
  }

  /** Relabel the primary action (DROP) button — Game sets it to "IGNITE" on a torch (helitorch) mission,
   *  where the same button lays a backburn instead of dropping water. Keyboard Space is unchanged. */
  setActionLabel(label: string): void {
    if (this.dropLabel) this.dropLabel.textContent = label;
  }

  /** Enable or disable the DROP action entirely. `Game` disables it during a crew low-hover hold (no bucket
   *  to drop): the button greys out and stops intercepting taps + Space, so the inert control reads as
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
      this.dropWave.style.opacity = '0';
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
    this.dropWave.style.opacity = f > 0.02 ? '1' : '0'; // the surface wave only when there's water
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

  // --- Touch UI -------------------------------------------------------------
  // Sizing is CSS now (the --stick / --drop / --detach / --help clamp vars on `.bmf-hud`, hud/styles.ts):
  // the sticks, DROP hero, RELEASE button and "?" help scale fluidly with the viewport and reflow on resize
  // for free — no per-breakpoint JS. The pointer math reads each dish's live measured radius in makeJoystick.

  private buildTouchUI(parent: HTMLElement): void {
    injectHudStyles(); // the `.bmf-hud` stylesheet (idempotent) — sizes these controls via --stick / --drop / …
    const root = div({
      position: 'fixed',
      inset: '0',
      pointerEvents: 'none',
      touchAction: 'none',
      zIndex: '10',
    });
    root.className = 'bmf-hud'; // carry the token + sizing vars onto this overlay root too

    this.buildLookLayer(root); // first → sits BENEATH the controls; drags on empty space orbit the camera
    this.buildLeftStick(root);
    this.buildRightControls(root); // right stick + the DROP / RELEASE-BUCKET cluster
    this.buildSwapUI(root);
    this.buildHelpUI(root);

    this.root = root; // stored so dispose() can pull the whole overlay (and its listeners) at once
    parent.appendChild(root);
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

  /** Build one 2-axis virtual joystick — a frosted dish with a 4-way tick cross and a glowing cyan knob,
   *  so it reads as an instrument rather than a flat blob. Both flight sticks share it; the caller maps the
   *  normalised knob offset to its axes via `apply(nx, ny)` (ny is UP-positive). `clear()` fires on release
   *  — the knob springs back to centre, so the axes return to 0 (heading + altitude hold). */
  private makeJoystick(opts: {
    apply: (nx: number, ny: number) => void;
    clear: () => void;
  }): { base: HTMLDivElement; thumb: HTMLDivElement; ticks: HTMLDivElement[] } {
    const base = div({
      position: 'relative',
      borderRadius: R.round,
      background: 'radial-gradient(circle at 50% 42%, rgba(24,34,44,0.34), rgba(8,12,18,0.52))',
      border: `1px solid ${UI.strokeStrong}`,
      boxShadow: `inset 0 1px 22px rgba(0,0,0,0.42), ${UI.shadowBtn}`,
      pointerEvents: 'auto',
      touchAction: 'none',
    });
    base.className = 'stick'; // diameter from CSS (--stick); the pointer math reads the live measured size
    setBlur(base);
    // Inner guide ring.
    base.appendChild(
      div({ position: 'absolute', inset: '20px', borderRadius: R.round, border: '1px solid rgba(255,255,255,0.08)' }),
    );

    // Four faint axis ticks (N/E/S/W) → "this stick moves in every direction". The CSS `.stick-tick` sets
    // the transform-origin (the stick centre) off the --stick var; the per-tick rotate stays inline.
    const ticks: HTMLDivElement[] = [];
    for (let i = 0; i < 4; i++) {
      const tick = div({
        position: 'absolute',
        left: '50%',
        top: '6px',
        width: '2px',
        height: '8px',
        marginLeft: '-1px',
        borderRadius: R.xs,
        background: accentAlpha(0.35),
        transform: `rotate(${i * 90}deg)`,
      });
      tick.className = 'stick-tick';
      ticks.push(tick);
      base.appendChild(tick);
    }

    const thumb = div({
      position: 'absolute',
      left: '50%',
      top: '50%',
      borderRadius: R.round,
      background: `radial-gradient(circle at 40% 34%, rgba(255,255,255,0.55), ${UI.knobHi})`,
      border: `1.5px solid ${UI.accentSoft}`,
      boxShadow: '0 3px 10px rgba(0,0,0,0.45)',
      transition: 'box-shadow 0.12s ease, border-color 0.12s ease',
      pointerEvents: 'none',
    });
    thumb.className = 'stick-thumb'; // knob size + centring offset from CSS (--stick)
    base.appendChild(thumb);

    const setKnobActive = (on: boolean) => {
      thumb.style.boxShadow = on
        ? `0 0 16px ${UI.accentSoft}, 0 3px 10px rgba(0,0,0,0.45)`
        : '0 3px 10px rgba(0,0,0,0.45)';
      thumb.style.borderColor = on ? UI.accent : UI.accentSoft;
    };

    let pid = -1;
    const onMove = (e: PointerEvent) => {
      const rect = base.getBoundingClientRect();
      const rad = Math.min(rect.width, rect.height) / 2; // live radius from the CSS-sized dish (no stored px)
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dx = e.clientX - cx;
      const dy = e.clientY - cy;
      const dist = Math.min(Math.hypot(dx, dy), rad);
      const ang = Math.atan2(dy, dx);
      const tx = Math.cos(ang) * dist;
      const ty = Math.sin(ang) * dist;
      thumb.style.transform = `translate(${tx}px, ${ty}px)`;
      opts.apply(tx / rad, -ty / rad); // push up → +1 (screen-up is −y)
      setKnobActive(true);
    };
    const release = () => {
      pid = -1;
      thumb.style.transform = 'translate(0px, 0px)';
      setKnobActive(false);
      opts.clear();
    };
    base.addEventListener('pointerdown', (e) => {
      pid = e.pointerId;
      base.setPointerCapture(e.pointerId);
      onMove(e);
    });
    base.addEventListener('pointermove', (e) => {
      if (e.pointerId === pid) onMove(e);
    });
    base.addEventListener('pointerup', release);
    base.addEventListener('pointercancel', release);

    return { base, thumb, ticks };
  }

  /** LEFT cyclic stick (bottom-left): X = lateral strafe, Y = throttle (forward / back). */
  private buildLeftStick(root: HTMLElement): void {
    const { base } = this.makeJoystick({
      apply: (nx, ny) => {
        this.leftX = nx; // push right → strafe right
        this.leftY = ny; // push up → forward
        this.leftActive = true;
      },
      clear: () => {
        this.leftActive = false;
        this.leftX = 0;
        this.leftY = 0;
      },
    });
    this.leftBase = base;

    const a = anchor('bottom-left');
    a.appendChild(base);
    root.appendChild(a);
  }

  /** RIGHT controls (bottom-right): the cyclic-pedals + collective stick (X = yaw, Y = altitude) in the
   *  corner — the right thumb's home — with the DROP / RELEASE-BUCKET cluster a short roll inboard. The
   *  held flight control sits in the corner; the actions are inboard, so a quick drop never fights the
   *  stick and DROP isn't the fat-finger target the corner is. */
  private buildRightControls(root: HTMLElement): void {
    const { base } = this.makeJoystick({
      apply: (nx, ny) => {
        this.rightX = nx; // push right → yaw right
        this.rightY = ny; // push up → climb
        this.rightActive = true;
      },
      clear: () => {
        this.rightActive = false;
        this.rightX = 0;
        this.rightY = 0;
      },
    });
    this.rightBase = base;

    const cluster = this.buildDropCluster();

    const row = div({
      display: 'flex',
      flexDirection: 'row',
      alignItems: 'flex-end',
      gap: 'calc(var(--bmf-gap) * 1.9)',
    });
    row.append(cluster, base); // [DROP + RELEASE] [stick] — stick outermost (corner = thumb home)

    const a = anchor('bottom-right');
    a.appendChild(row);
    root.appendChild(a);
  }

  /** The DROP + RELEASE-BUCKET cluster, inboard of the right stick. DROP is a round WATER-GAUGE button
   *  (warm): a cool water layer rises with the bucket's fill and drains as you drop, behind the warm
   *  action word, with an animated crest sloshing on its surface (the round button clips the fill to a
   *  filling porthole). RELEASE BUCKET is a small round button stacked ABOVE it — clustered with DROP
   *  (not stranded on the screen edge), but clearly smaller + up-and-inboard so a rare jettison is never
   *  a fat-finger DROP; hidden until Game calls setDetachVisible(true). Returns the column to mount. */
  private buildDropCluster(): HTMLDivElement {
    const drop = button('', {
      position: 'relative',
      overflow: 'hidden', // clip the rising water fill to the round silhouette
      background: UI.warmGlass,
      borderColor: UI.warmStroke,
      color: UI.warmText,
      fontWeight: FW.bold,
      letterSpacing: '1.5px',
      boxShadow: `${UI.emberGlow}, ${UI.shadowBtn}`,
    });
    drop.className = 'drop'; // diameter from CSS (--drop)
    const water = div({
      position: 'absolute',
      left: '0',
      right: '0',
      bottom: '0',
      height: '0%',
      background: `linear-gradient(to top, ${UI.waterBody}, rgba(86,196,238,0.10))`,
      boxSizing: 'border-box',
      transition: 'height 0.16s ease, box-shadow 0.2s ease, opacity 0.2s ease',
      pointerEvents: 'none',
    });
    const wave = div({
      position: 'absolute',
      left: '0',
      top: '-3px', // ride ON the surface
      width: '200%', // two wave tiles wide so a -28px translate loops seamlessly
      height: '8px',
      backgroundRepeat: 'repeat-x',
      backgroundSize: '28px 8px',
      pointerEvents: 'none',
    });
    wave.style.backgroundImage = `url("data:image/svg+xml,${encodeURIComponent(waterWaveSvg())}")`;
    injectWaveStyles();
    if (!prefersReducedMotion()) wave.style.animation = 'bmf-water-wave 1.15s linear infinite'; // sloshing crest
    water.appendChild(wave);
    const content = div({
      position: 'relative', // paints above the water layer
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      lineHeight: '1',
      pointerEvents: 'none',
    });
    const lbl = div({}, 'DROP');
    lbl.className = 'drop-label'; // font-size from CSS (--drop)
    const pct = div({ marginTop: '3px', fontWeight: FW.semibold, color: UI.water, textShadow: PCT_SHADOW }, '');
    pct.className = 'drop-pct';
    pct.style.setProperty('font-variant-numeric', 'tabular-nums');
    content.append(lbl, pct);
    drop.append(water, content);
    this.dropBtn = drop;
    this.dropLabel = lbl;
    this.dropPct = pct;
    this.dropWater = water;
    this.dropWave = wave;
    holdButton(drop, (on) => (this.btnDrop = on), UI.warm);

    // RELEASE BUCKET — a small round, warm button above DROP, hidden until shown (water missions only).
    const detach = button('', {
      position: 'relative',
      display: 'none',
      background: UI.warmGlass,
      borderColor: UI.warmStroke,
      color: UI.warmText,
      boxShadow: `${UI.emberGlow}, ${UI.shadowBtn}`,
    });
    detach.className = 'detach-btn'; // size from CSS (--detach)
    detach.appendChild(makeIconSvg('bucket-release', 20));
    this.detachBtn = detach;
    holdButton(detach, (on) => (this.btnDetach = on), UI.warm);

    // Column: RELEASE above DROP. The row aligns to its BOTTOM, so DROP stays put when RELEASE toggles.
    const col = div({ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'calc(var(--bmf-gap) * 1.4)' });
    col.append(detach, drop);
    return col;
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

    // Size from CSS (--help, floored at 44px); the "?" glyph font-size is set inline because theme.button()
    // pins its own fontSize that a class rule can't beat. The inline calc still resolves off the --help var.
    const icon = button('?', { position: 'relative', color: UI.dim, fontWeight: FW.semibold, fontSize: 'calc(var(--help) * 0.5)' });
    icon.className = 'help-btn';
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
    0%, 100% { box-shadow: 0 0 0 2px ${accentAlpha(0.5)}, 0 0 16px 2px ${accentAlpha(0.32)}; }
    50% { box-shadow: 0 0 0 3px ${accentAlpha(0.95)}, 0 0 26px 7px ${accentAlpha(0.55)}; }
  }
  .bmf-coach-pulse { animation: bmf-coach-pulse-kf 1.1s ease-in-out infinite; }
  @media (prefers-reduced-motion: reduce) {
    .bmf-coach-pulse { animation: none; box-shadow: 0 0 0 3px ${accentAlpha(0.85)}, 0 0 18px 3px ${accentAlpha(0.45)}; }
  }
  `;
  document.head.appendChild(tag);
}

/** The SVG for the sloshing water crest — one wave cycle over 28px, tiled + scrolled to animate. */
function waterWaveSvg(): string {
  return `<svg xmlns='http://www.w3.org/2000/svg' width='28' height='8' viewBox='0 0 28 8'><path d='M0 5 Q 7 1 14 5 T 28 5' fill='none' stroke='${UI.waterCrest}' stroke-width='1.6'/></svg>`;
}

// The crest-scroll keyframe (translate one tile so a 200%-wide, repeat-x wave loops seamlessly).
let waveStylesInjected = false;
function injectWaveStyles(): void {
  if (waveStylesInjected) return;
  waveStylesInjected = true;
  const tag = document.createElement('style');
  tag.textContent = '@keyframes bmf-water-wave { from { transform: translateX(0); } to { transform: translateX(-28px); } }';
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
