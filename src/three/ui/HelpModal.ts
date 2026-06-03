/**
 * Help / quick-start modal — the "?" button's panel, upgraded from a bare key list
 * into a card that does double duty:
 *
 *   1. THE JOB — a four-beat "how to play" tutorial (fly → scoop → drop → protect),
 *      so a brand-new pilot understands the core loop, not just the buttons.
 *   2. CONTROLS — the full touch + keyboard reference, as styled key-caps.
 *
 * It's pure DOM in the shared cockpit visual language (same dark-glass gradient and
 * cyan/fire accents as the onboarding screen), owns no Three.js, and injects its own
 * stylesheet once so hover/scroll/keyframes stay crisp.
 *
 * Lifecycle: `Input` builds ONE instance, wires the "?" icon to `toggle()`, and
 * auto-`open()`s it once for a first-time pilot (gated by `hasSeenHelp()` /
 * `markHelpSeen()` in localStorage) so the greeting shows exactly once but stays
 * reopenable forever. The scrim mounts to `document.body` at a high z-index so it
 * layers above the HUD and the pre-flight briefing card.
 */

import { UI } from './theme';

const SEEN_KEY = 'bmf.help.seen.v1';

/** Has the pilot already been shown the quick-start once? (false if storage is blocked.) */
export function hasSeenHelp(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === '1';
  } catch {
    return false;
  }
}

/** Remember that the quick-start has been shown, so it never auto-pops again. */
export function markHelpSeen(): void {
  try {
    localStorage.setItem(SEEN_KEY, '1');
  } catch {
    // storage blocked — it'll just greet again next session, harmless
  }
}

// --- content ----------------------------------------------------------------

/** The "how to play" loop, in order. `tone` picks the chip accent (water/fire/cyan). */
interface Step {
  glyph: string;
  title: string;
  body: string;
  tone: 'cyan' | 'water' | 'fire';
}
const STEPS: Step[] = [
  {
    glyph: '🚁',
    title: 'Fly the nose',
    body: 'Steer where the nose points and add throttle along it. She carries real momentum — ease off early to stop.',
    tone: 'cyan',
  },
  {
    glyph: '💧',
    title: 'Scoop water',
    body: 'Fly low over a lake and descend until the slung bucket dips in. It fills on its own — there is no scoop button.',
    tone: 'water',
  },
  {
    glyph: '🔥',
    title: 'Bomb the fire',
    body: 'Line up over the flames and hit DROP. Water lands under the bucket, so fly straight and level for a true hit.',
    tone: 'fire',
  },
  {
    glyph: '🏠',
    title: 'Protect & win',
    body: 'Keep fires off the cabins and your base, and refuel at base when low. Put every fire out to clear the sortie.',
    tone: 'cyan',
  },
];

/** A control row: an action and the touch + keyboard ways to do it. */
interface Ctrl {
  action: string;
  touch: string; // on-screen glyph hint
  keys: string[]; // keyboard cap labels (empty → touch-only)
}
const CONTROLS: Ctrl[] = [
  { action: 'Turn the nose', touch: '🕹 ◄ ►', keys: ['A', 'D'] },
  { action: 'Speed (fwd / back)', touch: '🕹 ▲ ▼', keys: ['W', 'S'] },
  { action: 'Climb', touch: '▲', keys: ['I'] },
  { action: 'Descend', touch: '▼', keys: ['J'] },
  { action: 'Drop water', touch: 'DROP', keys: ['Space'] },
  { action: 'Look around', touch: '👁 drag', keys: [] },
];

// --- styles (injected once) -------------------------------------------------

let stylesInjected = false;
function injectStyles(): void {
  if (stylesInjected) return;
  stylesInjected = true;
  const css = `
  .bmf-help-scrim {
    position: fixed; inset: 0; z-index: 60;
    display: none; align-items: center; justify-content: center;
    padding: 18px; box-sizing: border-box;
    background: rgba(4,8,12,0.6);
    -webkit-backdrop-filter: blur(3px); backdrop-filter: blur(3px);
    pointer-events: auto; touch-action: none;
    font-family: ${UI.font}; color: ${UI.text};
  }
  .bmf-help-scrim.is-open { display: flex; animation: bmf-help-fade 0.22s ease both; }
  .bmf-help-scrim * { box-sizing: border-box; }
  @keyframes bmf-help-fade { from { opacity: 0; } to { opacity: 1; } }
  @keyframes bmf-help-rise { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: none; } }

  .bmf-help-card {
    position: relative; width: 100%; max-width: 540px;
    max-height: calc(100dvh - 36px); overflow-y: auto; -webkit-overflow-scrolling: touch;
    padding: 22px 24px 20px; border-radius: 20px;
    border: 1px solid rgba(255,255,255,0.14);
    background:
      radial-gradient(130% 80% at 50% -10%, rgba(103,232,255,0.12), transparent 60%),
      radial-gradient(120% 80% at 85% 115%, rgba(255,122,69,0.10), transparent 55%),
      linear-gradient(180deg, #0c1a15 0%, #0a1410 62%, #0e160f 100%);
    box-shadow: 0 24px 70px rgba(0,0,0,0.6);
    animation: bmf-help-rise 0.28s ease both;
  }
  .bmf-help-card::-webkit-scrollbar { width: 8px; }
  .bmf-help-card::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.16); border-radius: 99px; }

  .bmf-help-kicker { font-size: 11px; letter-spacing: 0.26em; text-transform: uppercase; color: ${UI.accent}; opacity: 0.85; font-weight: 700; margin: 0; }
  .bmf-help-title { margin: 4px 0 0; font-size: 25px; font-weight: 800; letter-spacing: 0.02em; }
  .bmf-help-title .em { color: ${UI.fire}; }

  .bmf-help-x {
    position: absolute; top: 14px; right: 14px; width: 34px; height: 34px;
    display: flex; align-items: center; justify-content: center;
    border-radius: 50%; border: 1px solid rgba(255,255,255,0.16);
    background: rgba(255,255,255,0.06); color: ${UI.text};
    font-size: 18px; line-height: 1; cursor: pointer; padding: 0;
    transition: background 0.15s, border-color 0.15s, transform 0.12s;
  }
  .bmf-help-x:hover { background: rgba(255,255,255,0.12); border-color: ${UI.accentSoft}; }
  .bmf-help-x:active { transform: scale(0.94); }

  .bmf-help-sec { font-size: 11px; letter-spacing: 0.2em; text-transform: uppercase; color: ${UI.accent}; opacity: 0.8; font-weight: 700; margin: 22px 0 12px; }

  /* How-to-play steps */
  .bmf-help-steps { display: grid; gap: 12px; }
  .bmf-help-step { display: grid; grid-template-columns: 46px 1fr; gap: 14px; align-items: start; }
  .bmf-help-glyph {
    width: 46px; height: 46px; border-radius: 13px; display: flex; align-items: center; justify-content: center;
    font-size: 23px; background: rgba(103,232,255,0.10); border: 1px solid rgba(103,232,255,0.30);
    box-shadow: inset 0 0 16px rgba(103,232,255,0.10);
  }
  .bmf-help-glyph.t-water { background: rgba(86,196,238,0.12); border-color: rgba(86,196,238,0.34); box-shadow: inset 0 0 16px rgba(86,196,238,0.12); }
  .bmf-help-glyph.t-fire { background: rgba(255,122,69,0.13); border-color: rgba(255,122,69,0.40); box-shadow: inset 0 0 16px rgba(255,122,69,0.14); }
  .bmf-help-steptitle { font-size: 15.5px; font-weight: 700; margin: 1px 0 0; }
  .bmf-help-stepbody { font-size: 13px; line-height: 1.5; color: rgba(231,247,255,0.72); margin: 3px 0 0; }

  /* Controls rows */
  .bmf-help-row {
    display: flex; align-items: center; justify-content: space-between; gap: 14px; flex-wrap: wrap;
    padding: 9px 0; border-top: 1px solid rgba(255,255,255,0.07);
  }
  .bmf-help-row:first-child { border-top: none; }
  .bmf-help-act { font-size: 14px; color: rgba(255,255,255,0.82); }
  .bmf-help-ctrls { display: flex; align-items: center; gap: 8px; }
  .bmf-help-touch {
    display: inline-flex; align-items: center; gap: 4px; padding: 3px 9px; border-radius: 8px;
    font-size: 12px; font-weight: 600; letter-spacing: 0.02em; color: ${UI.text};
    background: rgba(103,232,255,0.10); border: 1px solid rgba(103,232,255,0.26); white-space: nowrap;
  }
  .bmf-help-or { font-size: 11px; color: rgba(255,255,255,0.4); }
  .bmf-help-key {
    display: inline-flex; align-items: center; justify-content: center; min-width: 26px; height: 26px;
    padding: 0 8px; border-radius: 7px; font-size: 12px; font-weight: 700; color: ${UI.text};
    background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.2);
    box-shadow: 0 2px 0 rgba(0,0,0,0.35); margin-left: 5px;
  }
  .bmf-help-key:first-of-type { margin-left: 0; }

  .bmf-help-note {
    display: flex; gap: 10px; align-items: flex-start; margin-top: 14px; padding: 11px 13px;
    border-radius: 12px; background: rgba(86,196,238,0.08); border: 1px solid rgba(86,196,238,0.22);
    font-size: 12.5px; line-height: 1.5; color: rgba(231,247,255,0.8);
  }
  .bmf-help-note b { color: ${UI.water}; }

  .bmf-help-cta {
    width: 100%; margin-top: 20px; padding: 15px 20px; border-radius: 14px; border: none;
    font-family: inherit; font-size: 15px; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase;
    cursor: pointer; color: #04181d;
    background: linear-gradient(180deg, #8df0ff, ${UI.accent});
    box-shadow: 0 10px 28px rgba(103,232,255,0.26); transition: transform 0.12s, box-shadow 0.2s;
  }
  .bmf-help-cta:hover { transform: translateY(-2px); box-shadow: 0 14px 34px rgba(103,232,255,0.36); }
  .bmf-help-cta:active { transform: translateY(0); }
  .bmf-help-foot { margin: 11px 0 0; text-align: center; font-size: 11.5px; color: rgba(255,255,255,0.4); }

  @media (max-width: 380px) {
    .bmf-help-card { padding: 18px 16px 16px; }
    .bmf-help-step { grid-template-columns: 40px 1fr; gap: 11px; }
    .bmf-help-glyph { width: 40px; height: 40px; font-size: 20px; }
  }
  `;
  const tag = document.createElement('style');
  tag.textContent = css;
  document.head.appendChild(tag);
}

// --- tiny DOM helper --------------------------------------------------------
function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & { className?: string } = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  Object.assign(node, props);
  for (const c of children) node.append(c);
  return node;
}

export class HelpModal {
  private readonly scrim: HTMLDivElement;
  private readonly onKey: (e: KeyboardEvent) => void;
  private open_ = false;

  constructor() {
    injectStyles();
    this.scrim = this.build();
    document.body.appendChild(this.scrim);
    this.onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && this.open_) {
        e.preventDefault();
        this.close();
      }
    };
  }

  get isOpen(): boolean {
    return this.open_;
  }

  open(): void {
    if (this.open_) return;
    this.open_ = true;
    this.scrim.classList.add('is-open');
    this.scrim.scrollTop = 0;
    window.addEventListener('keydown', this.onKey);
  }

  close(): void {
    if (!this.open_) return;
    this.open_ = false;
    this.scrim.classList.remove('is-open');
    window.removeEventListener('keydown', this.onKey);
  }

  toggle(): void {
    this.open_ ? this.close() : this.open();
  }

  // --- builder --------------------------------------------------------------

  private build(): HTMLDivElement {
    const card = h('div', { className: 'bmf-help-card' });
    // Clicks inside the card must not bubble to the scrim (which closes on tap).
    card.addEventListener('pointerdown', (e) => e.stopPropagation());

    const close = h('button', { className: 'bmf-help-x', type: 'button', textContent: '✕', title: 'Close' });
    close.setAttribute('aria-label', 'Close help');
    close.addEventListener('click', () => this.close());

    const header = h('div', {}, [
      h('p', { className: 'bmf-help-kicker', textContent: 'Quick start' }),
      ((): HTMLElement => {
        const t = h('h2', { className: 'bmf-help-title' });
        t.innerHTML = 'How to fly the <span class="em">water-bomber</span>';
        return t;
      })(),
    ]);

    // THE JOB — the core loop.
    const steps = h('div', { className: 'bmf-help-steps' });
    for (const s of STEPS) {
      const glyph = h('div', { className: `bmf-help-glyph${s.tone === 'cyan' ? '' : ` t-${s.tone}`}`, textContent: s.glyph });
      const text = h('div', {}, [
        h('p', { className: 'bmf-help-steptitle', textContent: s.title }),
        h('p', { className: 'bmf-help-stepbody', textContent: s.body }),
      ]);
      steps.append(h('div', { className: 'bmf-help-step' }, [glyph, text]));
    }

    // CONTROLS — touch + keyboard.
    const rows = CONTROLS.map((c) => {
      const ctrls = h('div', { className: 'bmf-help-ctrls' }, [h('span', { className: 'bmf-help-touch', textContent: c.touch })]);
      if (c.keys.length) {
        ctrls.append(h('span', { className: 'bmf-help-or', textContent: 'or' }));
        for (const k of c.keys) ctrls.append(h('span', { className: 'bmf-help-key', textContent: k }));
      }
      return h('div', { className: 'bmf-help-row' }, [h('span', { className: 'bmf-help-act', textContent: c.action }), ctrls]);
    });

    const note = h('div', { className: 'bmf-help-note' }, [
      h('span', { textContent: '💧' }),
      ((): HTMLElement => {
        const n = h('span');
        n.innerHTML = '<b>No scoop button.</b> Just fly low over any lake and descend until the bucket dips in — it fills automatically.';
        return n;
      })(),
    ]);

    const cta = h('button', { className: 'bmf-help-cta', type: 'button', textContent: 'Got it — let’s fly' });
    cta.addEventListener('click', () => this.close());
    const foot = h('p', { className: 'bmf-help-foot', textContent: 'Reopen anytime with “?” · Esc or tap outside to close' });

    card.append(
      close,
      header,
      h('p', { className: 'bmf-help-sec', textContent: 'The job' }),
      steps,
      h('p', { className: 'bmf-help-sec', textContent: 'Controls' }),
      ...rows,
      note,
      cta,
      foot,
    );

    const scrim = h('div', { className: 'bmf-help-scrim' }, [card]);
    scrim.addEventListener('pointerdown', () => this.close()); // tap outside the card closes
    return scrim;
  }
}
