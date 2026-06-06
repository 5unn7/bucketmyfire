/**
 * The cold-start engine dial — a big HOLD-TO-START circular control with a progress ring that
 * fills as the rotor spools. Present only between the briefing dismissal and full RPM, so it's
 * another piece of cold, fires-once mass lifted out of the HUD's per-frame core. The HUD owns one,
 * calls `show()` after the briefing, reads `hold` each frame to drive RPM, pushes the live RPM back
 * with `set(rpm, holding)`, and `hide()`s it once the rotors are up. `dispose()` tears down the
 * window key listeners on an in-place mission switch.
 */

import { UI, FS, FW, R, el, setBlur, clamp01 } from '../ui/theme';
import { AIRFRAME_OK } from './common';

export class EngineStart {
  private readonly root: HTMLElement;
  private holdState = false; // the START dial is pressed (pointer or Space/Enter) this frame
  private elt?: {
    wrap: HTMLDivElement;
    dial: HTMLDivElement;
    ring: HTMLDivElement;
    label: HTMLDivElement;
    sub: HTMLDivElement;
    onKey: (e: KeyboardEvent) => void;
    onKeyUp: (e: KeyboardEvent) => void;
  };

  constructor(root: HTMLElement) {
    this.root = root;
  }

  /** True while the START dial is being held (pointer drag or Space/Enter). Game reads this each
   *  frame to spool the rotor RPM up; releasing lets it bleed back down. */
  get hold(): boolean {
    return this.holdState;
  }

  /**
   * Show the cold-start dial: a big circular HOLD-TO-START control with a progress ring that fills
   * as the rotor spools. Surfaced by Game once the briefing is dismissed (and only when the engine
   * isn't already running). Holding it — by pointer, or Space/Enter on desktop — drives `hold`;
   * Game integrates RPM and calls `set`/`hide`.
   */
  show(): void {
    if (this.elt) return;

    // Click-through wrapper tucked into the BOTTOM-RIGHT, just above the DROP hero so the cold
    // start sits right under the thumb that will fly the aircraft. Right-aligned with the DROP
    // button; raised clear of the collective/DROP cluster. Only the dial itself is interactive.
    const wrap = el('div', {
      position: 'fixed',
      right: 'calc(var(--bmf-safe-r) + var(--bmf-edge))',
      bottom: 'calc(var(--bmf-safe-b) + var(--bmf-edge) + 124px)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: '7px',
      zIndex: '25',
      pointerEvents: 'none',
      transition: 'opacity 0.3s ease, transform 0.3s ease',
    });

    const size = 80;
    const dial = el('div', {
      position: 'relative',
      width: `${size}px`,
      height: `${size}px`,
      borderRadius: R.round,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      cursor: 'pointer',
      pointerEvents: 'auto',
      touchAction: 'none',
      background: 'radial-gradient(circle at 50% 40%, rgba(20,30,40,0.72), rgba(6,10,14,0.84))',
      border: `1px solid ${UI.strokeStrong}`,
      boxShadow: UI.shadowBtn,
      userSelect: 'none',
    });
    setBlur(dial);

    // Progress ring: a conic-gradient sweep masked down to a thin annulus around the dial.
    const ringPx = 5;
    const ring = el('div', {
      position: 'absolute',
      inset: `-${ringPx + 1}px`,
      borderRadius: R.round,
      background: `conic-gradient(${UI.accent} 0deg, rgba(255,255,255,0.08) 0deg)`,
      pointerEvents: 'none',
    });
    const ringMask = `radial-gradient(farthest-side, transparent calc(100% - ${ringPx}px), #000 calc(100% - ${ringPx}px))`;
    ring.style.setProperty('-webkit-mask', ringMask);
    ring.style.setProperty('mask', ringMask);

    const inner = el('div', {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: '2px',
      pointerEvents: 'none',
    });
    const label = el('div', { fontSize: FS.body, fontWeight: FW.heavy, letterSpacing: '1.5px', color: UI.text }, 'START');
    const sub = el('div', { fontSize: FS.label, fontWeight: FW.bold, letterSpacing: '1px', color: UI.dim }, '0%');
    inner.append(label, sub);
    dial.append(ring, inner);

    const caption = el(
      'div',
      { fontSize: FS.tag, fontWeight: FW.bold, letterSpacing: '1.2px', color: UI.accent, textShadow: '0 1px 8px rgba(0,0,0,0.7)', whiteSpace: 'nowrap' },
      'HOLD TO START',
    );
    wrap.append(dial, caption);

    // Pointer and keyboard holds are tracked separately and OR'd, so releasing one input doesn't
    // cancel a hold still active on the other.
    let pointerHeld = false;
    let keyHeld = false;
    const sync = (): void => {
      this.holdState = pointerHeld || keyHeld;
    };

    // Press handling. NB: do NOT stopPropagation — let the pointerdown bubble to window so HeliAudio
    // unlocks on this gesture. setPointerCapture keeps the hold alive if the finger drifts off.
    dial.addEventListener('pointerdown', (e) => {
      pointerHeld = true;
      sync();
      try {
        dial.setPointerCapture(e.pointerId);
      } catch {
        /* capture is best-effort */
      }
    });
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave'] as const) {
      dial.addEventListener(ev, () => {
        pointerHeld = false;
        sync();
      });
    }

    // Desktop convenience: hold Space or Enter to start (flight is frozen during the spool, so the
    // usual Space=drop binding is inert here).
    const onKey = (e: KeyboardEvent): void => {
      if (e.code === 'Space' || e.code === 'Enter') {
        e.preventDefault();
        keyHeld = true;
        sync();
      }
    };
    const onKeyUp = (e: KeyboardEvent): void => {
      if (e.code === 'Space' || e.code === 'Enter') {
        keyHeld = false;
        sync();
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);

    this.root.appendChild(wrap);
    this.elt = { wrap, dial, ring, label, sub, onKey, onKeyUp };
  }

  /** Update the dial to the live RPM (0..1) and held state — ring fill, % readout, hold glow. */
  set(rpm: number, holding: boolean): void {
    const e = this.elt;
    if (!e) return;
    const r = clamp01(rpm);
    const full = r >= 1;
    const col = full ? AIRFRAME_OK : UI.accent; // #8: reuse the documented in-world green const (was a 4th inline copy of the same hex)
    e.ring.style.background = `conic-gradient(${col} ${r * 360}deg, rgba(255,255,255,0.08) ${r * 360}deg)`;
    e.sub.textContent = `${Math.round(r * 100)}%`;
    e.label.textContent = full ? 'READY' : 'START';
    e.label.style.color = full ? col : UI.text;
    e.dial.style.boxShadow = holding || full ? `0 0 24px ${col}, ${UI.shadowBtn}` : UI.shadowBtn;
  }

  /** Tear down the dial (rotors are up) — detach key listeners, fade out, remove. Idempotent, so it
   *  doubles as the dispose path for an in-place mission switch. */
  hide(): void {
    const e = this.elt;
    if (!e) return;
    window.removeEventListener('keydown', e.onKey);
    window.removeEventListener('keyup', e.onKeyUp);
    this.holdState = false;
    this.elt = undefined;
    e.wrap.style.opacity = '0';
    e.wrap.style.transform = 'scale(0.85)';
    window.setTimeout(() => e.wrap.remove(), 320);
  }
}
