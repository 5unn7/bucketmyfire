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
 * A "?" help icon (top-right) toggles an on-screen controls panel; it shows once
 * on first load so a new pilot sees the scheme.
 *
 * Scooping is NOT a button — you descend over a lake until the slung bucket
 * dips into the water and fills (handled in Game from the bucket's height).
 */
import { CAMERA } from './config';
import type { LookOffset } from './ChaseCamera';

export interface ControlState {
  turn: number; // -1 turn left .. +1 turn right
  throttle: number; // -1 reverse .. +1 forward (variable along the nose)
  lift: number; // -1 descend .. +1 climb
  drop: boolean; // DROP held this frame (the 'valve' bucket pours while held)
  dropPressed: boolean; // DROP went down THIS frame (edge) — a one-tap 'bambi' dump trigger
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

  // Free-look ("eye" button): drag sets orbit VELOCITY, release eases back.
  private lookActive = false;
  private lookYawRate = 0;
  private lookPitchRate = 0;

  constructor(parent: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      this.held.add(e.code);
      if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.held.delete(e.code));
    window.addEventListener('blur', () => this.held.clear());

    this.buildTouchUI(parent);
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

    // Drop: Space (or the on-screen DROP button).
    const drop = this.btnDrop || k.has('Space');
    const dropPressed = drop && !this.prevDrop; // rising edge → one-tap dump trigger
    this.prevDrop = drop;

    return { turn, throttle, lift, drop, dropPressed };
  }

  /** Free-look orbit for the chase camera, driven by the "eye" button drag.
   *  Returns orbit RATES (rad/sec); `active` is false once released, so the camera
   *  eases back to the default pose. */
  get look(): LookOffset {
    return { active: this.lookActive, yawRate: this.lookYawRate, pitchRate: this.lookPitchRate };
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

    // Virtual joystick (bottom-left).
    const R = 65; // base radius
    const base = div({
      position: 'fixed',
      left: '34px',
      bottom: '34px',
      width: `${R * 2}px`,
      height: `${R * 2}px`,
      borderRadius: '50%',
      background: 'rgba(255,255,255,0.10)',
      border: '2px solid rgba(255,255,255,0.25)',
      pointerEvents: 'auto',
      touchAction: 'none',
    });
    const thumb = div({
      position: 'absolute',
      left: '50%',
      top: '50%',
      width: '58px',
      height: '58px',
      marginLeft: '-29px',
      marginTop: '-29px',
      borderRadius: '50%',
      background: 'rgba(255,255,255,0.28)',
      pointerEvents: 'none',
    });
    base.appendChild(thumb);
    root.appendChild(base);

    let stickId = -1;
    const onStick = (e: PointerEvent) => {
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
    };
    const releaseStick = () => {
      stickId = -1;
      this.stickActive = false;
      this.stickTurn = 0;
      this.stickThrottle = 0;
      thumb.style.transform = 'translate(0px, 0px)';
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

    // Right-hand cluster: climb / descend + drop.
    const climb = button('▲', { right: '120px', bottom: '120px', width: '74px', height: '74px' });
    const descend = button('▼', { right: '120px', bottom: '34px', width: '74px', height: '74px' });
    const drop = button('DROP', {
      right: '30px',
      bottom: '46px',
      width: '92px',
      height: '92px',
      background: 'rgba(178,58,46,0.35)',
      borderColor: 'rgba(255,120,100,0.9)',
      fontSize: '17px',
    });
    holdButton(climb, (on) => (this.btnUp = on));
    holdButton(descend, (on) => (this.btnDown = on));
    holdButton(drop, (on) => (this.btnDrop = on));
    root.appendChild(climb);
    root.appendChild(descend);
    root.appendChild(drop);

    this.buildLookUI(root);
    this.buildHelpUI(root);

    parent.appendChild(root);
  }

  // --- Free-look "eye" button -----------------------------------------------

  /** An eye icon (right edge, mid-screen) you press-and-drag to orbit the camera.
   *  Drag = orbit SPEED, not distance: a small push held in any direction spins the
   *  view continuously (a full 360° either way), so the button can sit near the edge
   *  and you never run out of room. Release returns to the default chase pose (the
   *  ease-back lives in ChaseCamera; here we just zero the rates and drop `active`). */
  private buildLookUI(root: HTMLElement): void {
    const icon = button('', {
      right: '40px',
      top: '50%',
      transform: 'translateY(-50%)',
      width: '60px',
      height: '60px',
      background: 'rgba(0,0,0,0.4)',
      borderColor: 'rgba(255,255,255,0.55)',
      cursor: 'grab',
    });
    icon.innerHTML = EYE_SVG;

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

    root.appendChild(icon);
  }

  // --- Help / controls hint -------------------------------------------------

  /** A "?" icon (top-right) that toggles a controls panel. Shown once on load so
   *  a first-time pilot sees the scheme, then dismissable with any tap. */
  private buildHelpUI(root: HTMLElement): void {
    // Full-screen scrim behind the panel: any tap on it closes the help.
    const overlay = div({
      position: 'fixed',
      inset: '0',
      display: 'none',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'rgba(0,0,0,0.5)',
      pointerEvents: 'auto',
      touchAction: 'none',
      zIndex: '20',
    });

    const panel = div({
      maxWidth: '320px',
      margin: '0 18px',
      padding: '20px 24px',
      borderRadius: '14px',
      background: 'rgba(12,20,16,0.92)',
      border: '1px solid rgba(255,255,255,0.2)',
      color: '#eaf6ff',
      fontFamily: 'system-ui, sans-serif',
      fontSize: '15px',
      lineHeight: '1.4',
      boxShadow: '0 10px 40px rgba(0,0,0,0.5)',
    });
    panel.appendChild(
      div(
        { fontSize: '18px', fontWeight: '700', letterSpacing: '1px', marginBottom: '12px' },
        'CONTROLS',
      ),
    );
    helpRow(panel, 'Turn', 'stick ◄ ► · A D');
    helpRow(panel, 'Forward / Back', 'stick ▲ ▼ · W S');
    helpRow(panel, 'Climb', '▲ · I');
    helpRow(panel, 'Descend', '▼ · J');
    helpRow(panel, 'Drop water', 'DROP · Space');
    panel.appendChild(
      div(
        { marginTop: '12px', fontSize: '13px', opacity: '0.8', lineHeight: '1.5' },
        'Scoop by flying low over a lake and descending until the bucket dips in.',
      ),
    );
    panel.appendChild(
      div(
        { marginTop: '12px', fontSize: '12px', opacity: '0.6', textAlign: 'center' },
        'tap to close',
      ),
    );
    overlay.appendChild(panel);

    const icon = button('?', {
      right: '18px',
      top: '52px',
      width: '36px',
      height: '36px',
      fontSize: '20px',
      background: 'rgba(0,0,0,0.4)',
      borderColor: 'rgba(255,255,255,0.55)',
    });

    const setOpen = (open: boolean) => {
      overlay.style.display = open ? 'flex' : 'none';
    };
    icon.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      setOpen(true);
    });
    overlay.addEventListener('pointerdown', () => setOpen(false));

    root.appendChild(icon);
    root.appendChild(overlay);

    setOpen(true); // show the scheme once on first load
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

// --- DOM helpers ------------------------------------------------------------

function div(style: Partial<CSSStyleDeclaration>, text?: string): HTMLDivElement {
  const node = document.createElement('div');
  Object.assign(node.style, style);
  if (text !== undefined) node.textContent = text;
  return node;
}

/** One "Label …… keys" line in the help panel (label left, keys right). */
function helpRow(parent: HTMLElement, label: string, keys: string): void {
  const row = div({
    display: 'flex',
    justifyContent: 'space-between',
    gap: '18px',
    padding: '3px 0',
  });
  row.appendChild(div({ opacity: '0.85' }, label));
  row.appendChild(div({ fontWeight: '600', whiteSpace: 'nowrap' }, keys));
  parent.appendChild(row);
}

function button(label: string, style: Partial<CSSStyleDeclaration>): HTMLDivElement {
  const node = div({
    position: 'fixed',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '50%',
    background: 'rgba(255,255,255,0.12)',
    border: '2px solid rgba(255,255,255,0.4)',
    color: '#eaf6ff',
    fontFamily: 'system-ui, sans-serif',
    fontSize: '24px',
    fontWeight: '600',
    userSelect: 'none',
    pointerEvents: 'auto',
    touchAction: 'none',
    ...style,
  });
  node.textContent = label;
  return node;
}

/** Wire a div to call `set(true)` while pressed and `set(false)` on release. */
function holdButton(node: HTMLElement, set: (on: boolean) => void): void {
  const press = (e: PointerEvent) => {
    set(true);
    node.setPointerCapture(e.pointerId);
    node.style.filter = 'brightness(1.5)';
  };
  const release = () => {
    set(false);
    node.style.filter = 'none';
  };
  node.addEventListener('pointerdown', press);
  node.addEventListener('pointerup', release);
  node.addEventListener('pointercancel', release);
  node.addEventListener('pointerleave', release);
}
