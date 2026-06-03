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

// Design tokens — mirror HUD.ts's glass-cockpit language so the touch controls
// read as part of the same cockpit as the instruments: dark frosted glass,
// hairline strokes, one cyan accent. (Kept local to avoid coupling Input → HUD;
// if these ever drift, lift both into a shared theme module.)
const UI = {
  accent: '#67e8ff',
  accentSoft: 'rgba(103,232,255,0.55)',
  glass: 'rgba(12,18,25,0.42)', // frosted panel fill (a touch more opaque than the HUD chips so buttons hold up over bright terrain)
  stroke: 'rgba(255,255,255,0.18)',
  blur: 'blur(12px) saturate(120%)',
  shadow: '0 6px 22px rgba(0,0,0,0.40)',
  text: 'rgba(234,246,255,0.95)',
  dim: 'rgba(255,255,255,0.5)',
  warm: '#ff7a45', // the DROP / fire accent
  warmGlass: 'rgba(44,17,13,0.46)',
  warmStroke: 'rgba(255,138,110,0.85)',
  font: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
};

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

    // Virtual joystick (bottom-left) — a frosted dish with hairline axis ticks and
    // a glowing cyan knob, so it reads as an instrument rather than a flat blob.
    const R = 65; // base radius
    const base = div({
      position: 'fixed',
      left: '32px',
      bottom: '32px',
      width: `${R * 2}px`,
      height: `${R * 2}px`,
      borderRadius: '50%',
      background: 'radial-gradient(circle at 50% 42%, rgba(24,34,44,0.34), rgba(8,12,18,0.52))',
      border: `1px solid ${UI.stroke}`,
      boxShadow: `inset 0 1px 22px rgba(0,0,0,0.42), ${UI.shadow}`,
      pointerEvents: 'auto',
      touchAction: 'none',
    });
    setBlur(base);
    // Inner guide ring + four faint axis ticks (N/E/S/W) to hint the stick travel.
    base.appendChild(
      div({
        position: 'absolute',
        inset: '20px',
        borderRadius: '50%',
        border: '1px solid rgba(255,255,255,0.08)',
      }),
    );
    for (let i = 0; i < 4; i++) {
      base.appendChild(
        div({
          position: 'absolute',
          left: '50%',
          top: '6px',
          width: '2px',
          height: '8px',
          marginLeft: '-1px',
          borderRadius: '1px',
          background: 'rgba(103,232,255,0.35)',
          transformOrigin: `1px ${R - 6}px`,
          transform: `rotate(${i * 90}deg)`,
        }),
      );
    }
    const thumb = div({
      position: 'absolute',
      left: '50%',
      top: '50%',
      width: '60px',
      height: '60px',
      marginLeft: '-30px',
      marginTop: '-30px',
      borderRadius: '50%',
      background: 'radial-gradient(circle at 40% 34%, rgba(255,255,255,0.55), rgba(150,182,202,0.24))',
      border: `1.5px solid ${UI.accentSoft}`,
      boxShadow: '0 3px 10px rgba(0,0,0,0.45)',
      transition: 'box-shadow 0.12s ease, border-color 0.12s ease',
      pointerEvents: 'none',
    });
    base.appendChild(thumb);
    root.appendChild(base);

    const setKnobActive = (on: boolean) => {
      thumb.style.boxShadow = on
        ? `0 0 16px ${UI.accentSoft}, 0 3px 10px rgba(0,0,0,0.45)`
        : '0 3px 10px rgba(0,0,0,0.45)';
      thumb.style.borderColor = on ? UI.accent : UI.accentSoft;
    };

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

    // Right-hand cluster: a vertical collective pair (climb / descend) sitting just
    // left of the DROP hero, all sharing one baseline so they read as one group.
    const climb = button('▲', { right: '148px', bottom: '100px', width: '76px', height: '76px', fontSize: '22px' });
    const descend = button('▼', { right: '148px', bottom: '16px', width: '76px', height: '76px', fontSize: '22px' });
    const drop = button('DROP', {
      right: '28px',
      bottom: '38px',
      width: '100px',
      height: '100px',
      background: UI.warmGlass,
      borderColor: UI.warmStroke,
      color: '#ffe7df',
      fontSize: '16px',
      fontWeight: '700',
      letterSpacing: '1.5px',
      boxShadow: `0 0 18px rgba(255,90,60,0.28), ${UI.shadow}`,
    });
    holdButton(climb, (on) => (this.btnUp = on));
    holdButton(descend, (on) => (this.btnDown = on));
    holdButton(drop, (on) => (this.btnDrop = on), UI.warm);
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
      right: '36px',
      top: '50%',
      transform: 'translateY(-50%)',
      width: '58px',
      height: '58px',
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
      borderRadius: '16px',
      background: 'rgba(10,16,22,0.92)',
      border: `1px solid ${UI.stroke}`,
      color: UI.text,
      fontFamily: UI.font,
      fontSize: '15px',
      lineHeight: '1.4',
      boxShadow: '0 12px 44px rgba(0,0,0,0.55)',
    });
    setBlur(panel);
    panel.appendChild(
      div(
        {
          fontSize: '13px',
          fontWeight: '700',
          letterSpacing: '3px',
          marginBottom: '14px',
          color: UI.accent,
        },
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

    // Bottom-center: the radar moved to the top-right, freeing this spot, and it
    // stays clear of the joystick (bottom-left) and the climb/drop cluster (bottom-right).
    const icon = button('?', {
      left: '50%',
      bottom: '18px',
      transform: 'translateX(-50%)',
      width: '38px',
      height: '38px',
      fontSize: '19px',
      color: UI.dim,
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
  row.appendChild(div({ color: UI.dim }, label));
  row.appendChild(div({ fontWeight: '600', whiteSpace: 'nowrap', color: UI.text }, keys));
  parent.appendChild(row);
}

/** Add backdrop-blur (with the -webkit- prefix iOS/Safari still needs). */
function setBlur(node: HTMLElement): void {
  node.style.backdropFilter = UI.blur;
  node.style.setProperty('-webkit-backdrop-filter', UI.blur);
}

function button(label: string, style: Partial<CSSStyleDeclaration>): HTMLDivElement {
  const node = div({
    position: 'fixed',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '50%',
    background: UI.glass,
    border: `1px solid ${UI.stroke}`,
    color: UI.text,
    fontFamily: UI.font,
    fontSize: '24px',
    fontWeight: '600',
    boxShadow: UI.shadow,
    userSelect: 'none',
    pointerEvents: 'auto',
    touchAction: 'none',
    ...style,
  });
  setBlur(node);
  node.textContent = label;
  return node;
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
