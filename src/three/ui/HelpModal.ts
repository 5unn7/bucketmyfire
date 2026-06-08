/**
 * Help / "Field manual" modal — the "?" button's panel, a swipeable 3-page reference
 * in the shared cockpit visual language. It is built on the component kit: the scrim,
 * card, close ✕, ESC / scrim-click close, focus-trap and entrance all come from
 * `openModal()`, and Back/Next are `makeButton()`s — so this module owns only the
 * page CONTENT + a small layout stylesheet (token-driven, no hard-coded colour/blur).
 *
 *   PAGE 1 — The job: the four-beat loop (fly → scoop → drop → protect) plus a
 *            scoop diagram that shows you must descend until the bucket dips in.
 *   PAGE 2 — Fire & wind: an extinguish diagram (water douses every fire in the
 *            splash) and a wind tip (fire runs downwind, your water drifts).
 *   PAGE 3 — Cockpit & controls: an annotated HUD diagram (gauges / radar / stick /
 *            DROP) + a "what to do" note, then the touch + keyboard reference.
 *
 * Pages are a horizontal scroll-snap track (swipe on touch), with dots + Back/Next
 * for desktop; the last page's button closes ("Let's fly"). The visuals are inline
 * SVG (vector, zero binary assets), matching the project's procedural-art ethos.
 *
 * Lifecycle: `Input` builds ONE controller and wires the "?" icon to `toggle()`. The
 * modal is created on `open()` (via `openModal`, which mounts its own scrim to
 * `document.body`) and destroyed on `close()`. An optional `onReplay` handler adds a
 * "Replay guided first flight" row that re-runs the interactive coach (wired by the
 * host). The first-run TEACHER is now the interactive coach, not this reference.
 */

import { UI, FS, FW, R } from './theme';
import { openModal, type ModalHandle } from './components/Modal';
import { makeButton, type ButtonHandle } from './components/Button';
import { resetTutorial } from './coach/coachStore';

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
  { glyph: '🚁', title: 'Fly the nose', body: 'Steer where the nose points and add throttle along it. She carries her weight, so ease off early to stop.', tone: 'cyan' },
  { glyph: '💧', title: 'Fill the bucket', body: 'Descend low over a lake until the slung bucket dips in. It fills on its own (see below).', tone: 'water' },
  { glyph: '🔥', title: 'Drop on the fire', body: 'Line up over the flames and hit DROP. Fly straight and level so the water lands true.', tone: 'fire' },
  { glyph: '🏠', title: 'Keep it off the cabins', body: 'Keep fires off the cabins. Dispatch calls in new fires as they break out; get there before they reach the towns. When a FUEL gauge shows, land at a base before it runs dry.', tone: 'cyan' },
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
  { action: 'Re-rig load (water ⇄ crew)', touch: 'SWAP', keys: ['G'] },
  { action: 'Release bucket', touch: 'DETACH', keys: ['B'] },
  { action: 'Look around', touch: 'Drag the view', keys: [] },
];

/** HUD legend rows — number badge → what that region of the screen is. */
interface Leg {
  n: string;
  tone: 'cyan' | 'water' | 'fire';
  label: string;
  desc: string;
}
const HUD_LEGEND: Leg[] = [
  { n: '1', tone: 'cyan', label: 'Gauges', desc: 'water · airframe · fires-left · wind · heading' },
  { n: '2', tone: 'water', label: 'Radar', desc: 'fires (red), lakes (blue), your base. Tap to zoom.' },
  { n: '3', tone: 'cyan', label: 'Fly stick', desc: 'steer the nose + throttle' },
  { n: '4', tone: 'fire', label: 'Cluster', desc: 'climb ▲ · descend ▼ · DROP' },
];

// --- inline-SVG visuals (vector, zero binary assets) ------------------------

/** Scoop: heli on a rope, bucket dipping below the lake surface, "descend" arrow. */
const SCOOP_SVG = `
<svg viewBox="0 0 240 150" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs><linearGradient id="bmfw" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#56c4ee" stop-opacity="0.5"/>
    <stop offset="1" stop-color="#15607f" stop-opacity="0.85"/></linearGradient></defs>
  <path d="M0,104 q20,-8 40,0 t40,0 t40,0 t40,0 t40,0 t40,0 L240,150 L0,150 Z" fill="url(#bmfw)"/>
  <g stroke="#cfe9f3" stroke-width="2.6" stroke-linecap="round"><line x1="72" y1="26" x2="136" y2="26"/><line x1="104" y1="26" x2="104" y2="33"/></g>
  <rect x="86" y="32" width="40" height="16" rx="7" fill="#9fb6c2"/><rect x="62" y="36" width="28" height="6" rx="3" fill="#9fb6c2"/>
  <line x1="106" y1="48" x2="106" y2="86" stroke="#8a98a0" stroke-width="1.6" stroke-dasharray="1.5 3"/>
  <path d="M98,86 L114,86 L111,114 L101,114 Z" fill="#39464f" stroke="#67e8ff" stroke-width="1.6"/>
  <g stroke="#bfeaff" stroke-width="1.5" opacity="0.85"><path d="M84,104 q22,7 44,0"/><path d="M74,111 q32,9 64,0"/></g>
  <g stroke="#67e8ff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><line x1="156" y1="50" x2="156" y2="86"/><path d="M150,79 L156,88 L162,79"/></g>
</svg>`;

/** Extinguish: bucket spraying a fan of water; flames inside the dashed splash go grey (doused), one outside stays lit. */
const DROP_SVG = `
<svg viewBox="0 0 240 150" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M104,14 L136,14 L130,38 L110,38 Z" fill="#39464f" stroke="#67e8ff" stroke-width="1.6"/>
  <g stroke="#7fd6f5" stroke-width="2" stroke-linecap="round" opacity="0.9"><line x1="120" y1="40" x2="92" y2="104"/><line x1="120" y1="40" x2="108" y2="108"/><line x1="120" y1="40" x2="120" y2="110"/><line x1="120" y1="40" x2="132" y2="108"/><line x1="120" y1="40" x2="148" y2="104"/></g>
  <g fill="#bfeaff"><circle cx="100" cy="94" r="2.2"/><circle cx="116" cy="101" r="2.2"/><circle cx="129" cy="99" r="2.2"/><circle cx="143" cy="92" r="2.2"/></g>
  <ellipse cx="120" cy="120" rx="66" ry="15" stroke="#67e8ff" stroke-width="1.6" stroke-dasharray="4 4" opacity="0.85"/>
  <path d="M110,120 q-6,-11 0,-19 q4,7 8,2 q4,9 -2,17 Z" fill="#8694a0"/>
  <path d="M130,120 q-5,-9 0,-15 q3,5 6,2 q3,7 -2,13 Z" fill="#8694a0"/>
  <g stroke="#d6e1e8" stroke-width="1.4" opacity="0.6"><path d="M112,99 q4,-4 0,-9"/><path d="M132,101 q3,-3 0,-7"/></g>
  <path d="M198,124 q-7,-13 0,-23 q5,8 11,3 q3,12 -4,20 Z" fill="#ff7a45"/>
  <path d="M200,124 q-3,-8 0,-13 q3,4 6,1 q1,7 -3,12 Z" fill="#ffd24a"/>
  <line x1="6" y1="132" x2="234" y2="132" stroke="#4a4a3a" stroke-width="2" opacity="0.5"/>
</svg>`;

/** Wind: streaks blowing right, a flame leaning downwind with spot-fires ahead of it. */
const WIND_SVG = `
<svg viewBox="0 0 220 84" fill="none" xmlns="http://www.w3.org/2000/svg">
  <g stroke="#9fe9f7" stroke-width="2.2" stroke-linecap="round" opacity="0.85"><path d="M10,22 h54 q10,0 10,-8"/><path d="M16,42 h66 q10,0 10,8"/><path d="M10,62 h48 q10,0 10,-8"/></g>
  <path d="M150,42 l-11,-5 v10 Z" fill="#9fe9f7"/>
  <path d="M150,74 C147,54 170,50 174,32 C183,46 188,42 188,58 C188,69 172,77 150,74 Z" fill="#ff7a45"/>
  <path d="M159,74 C157,60 172,57 175,46 C181,55 184,52 184,62 C184,69 172,77 159,74 Z" fill="#ffd24a"/>
  <circle cx="202" cy="70" r="3" fill="#ff7a45"/><circle cx="212" cy="64" r="2" fill="#ff9a45"/>
</svg>`;

/** HUD map: a phone-screen mockup with the gauge pill (1), radar (2), stick (3), cluster (4). */
const HUD_SVG = `
<svg viewBox="0 0 260 150" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect x="6" y="8" width="248" height="134" rx="14" fill="rgba(255,255,255,0.03)" stroke="rgba(255,255,255,0.18)"/>
  <rect x="76" y="16" width="106" height="18" rx="9" fill="rgba(103,232,255,0.13)" stroke="#67e8ff" stroke-opacity="0.5"/>
  <g fill="#9fe9f7"><circle cx="90" cy="25" r="2.4"/><rect x="98" y="22" width="13" height="6" rx="2"/><circle cx="125" cy="25" r="2.4"/><rect x="133" y="22" width="13" height="6" rx="2"/><circle cx="160" cy="25" r="2.4"/></g>
  <rect x="214" y="16" width="32" height="32" rx="6" fill="rgba(86,196,238,0.10)" stroke="#56c4ee" stroke-opacity="0.5"/>
  <circle cx="224" cy="28" r="2.4" fill="#56c4ee"/><circle cx="236" cy="38" r="2.4" fill="#ff5d4d"/><path d="M230,25 l3,6 -6,0 Z" fill="#cfe9f3"/>
  <circle cx="30" cy="116" r="16" fill="rgba(255,255,255,0.05)" stroke="rgba(255,255,255,0.26)"/><circle cx="30" cy="116" r="6" fill="#9fe9f7"/>
  <circle cx="206" cy="114" r="9" fill="rgba(255,255,255,0.06)" stroke="rgba(255,255,255,0.26)"/><circle cx="206" cy="132" r="9" fill="rgba(255,255,255,0.06)" stroke="rgba(255,255,255,0.26)"/>
  <rect x="220" y="106" width="28" height="28" rx="9" fill="rgba(255,122,69,0.16)" stroke="#ff7a45" stroke-opacity="0.6"/>
  <g font-family="ui-sans-serif,system-ui,sans-serif" font-size="11" font-weight="800" text-anchor="middle">
    <circle cx="129" cy="44" r="8" fill="#67e8ff"/><text x="129" y="47.6" fill="#04181d">1</text>
    <circle cx="230" cy="56" r="8" fill="#56c4ee"/><text x="230" y="59.6" fill="#04181d">2</text>
    <circle cx="30" cy="92" r="8" fill="#67e8ff"/><text x="30" y="95.6" fill="#04181d">3</text>
    <circle cx="240" cy="96" r="8" fill="#ff7a45"/><text x="240" y="99.6" fill="#04181d">4</text>
  </g>
</svg>`;

// --- styles (injected once) -------------------------------------------------

let stylesInjected = false;
/** Inject the page-CONTENT stylesheet once. The scrim / card / close / nav-button chrome lives in the
 *  component kit; this is layout-only, and every colour/blur reads from a `theme.ts` token (no raw
 *  literals — the `verify:ui` ratchet enforces it). Alpha variants use the `${UI.x}NN` hex-alpha
 *  suffix so the SOURCE carries no `#hex`/`rgba(` literal. */
function injectStyles(): void {
  if (stylesInjected) return;
  stylesInjected = true;
  const css = `
  /* Head: kicker + title (sits left of the kit's close ✕ in the modal head row) */
  .bmf-help-head { display: flex; flex-direction: column; gap: 2px; }
  .bmf-help-kicker { font-size: ${FS.meta}; letter-spacing: 0.26em; text-transform: uppercase; color: ${UI.accent}; opacity: 0.85; font-weight: ${FW.bold}; margin: 0; }
  .bmf-help-title { margin: 0; font-size: ${FS.display}; font-weight: ${FW.heavy}; letter-spacing: 0.02em; color: ${UI.text}; }

  /* Paged track (swipe / scroll-snap) */
  .bmf-help-track {
    flex: 1; min-height: 0; display: flex;
    overflow-x: auto; overflow-y: hidden; scroll-snap-type: x mandatory;
    overscroll-behavior: contain; -webkit-overflow-scrolling: touch;
    scrollbar-width: none;
  }
  .bmf-help-track::-webkit-scrollbar { display: none; }
  .bmf-help-page {
    flex: 0 0 100%; width: 100%; scroll-snap-align: start; scroll-snap-stop: always;
    overflow-y: auto; -webkit-overflow-scrolling: touch; padding: 4px 20px 8px;
  }
  .bmf-help-page::-webkit-scrollbar { width: 7px; }
  .bmf-help-page::-webkit-scrollbar-thumb { background: ${UI.stroke}; border-radius: ${R.pill}; }

  .bmf-help-sec { font-size: ${FS.meta}; letter-spacing: 0.2em; text-transform: uppercase; color: ${UI.accent}; opacity: 0.8; font-weight: ${FW.bold}; margin: 4px 0 12px; }
  .bmf-help-sec.t-fire { color: ${UI.fire}; }
  .bmf-help-sub { font-size: ${FS.meta}; letter-spacing: 0.16em; text-transform: uppercase; color: ${UI.dim}; font-weight: ${FW.bold}; margin: 20px 0 10px; }

  /* How-to-play steps */
  .bmf-help-steps { display: grid; gap: 11px; }
  .bmf-help-step { display: grid; grid-template-columns: 44px 1fr; gap: 13px; align-items: start; }
  .bmf-help-glyph {
    width: 44px; height: 44px; border-radius: ${R.md}; display: flex; align-items: center; justify-content: center;
    font-size: ${FS.hero}; background: ${UI.accentFill}; border: 1px solid ${UI.accent}4d;
    box-shadow: inset 0 0 16px ${UI.accentFill};
  }
  .bmf-help-glyph.t-water { background: ${UI.water}1f; border-color: ${UI.water}57; box-shadow: inset 0 0 16px ${UI.water}1f; }
  .bmf-help-glyph.t-fire { background: ${UI.fire}21; border-color: ${UI.fire}66; box-shadow: inset 0 0 16px ${UI.fire}24; }
  .bmf-help-steptitle { font-size: ${FS.lg}; font-weight: ${FW.bold}; margin: 2px 0 0; color: ${UI.text}; }
  .bmf-help-stepbody { font-size: ${FS.sm}; line-height: 1.45; color: ${UI.textCool}; margin: 3px 0 0; }

  /* Visuals */
  .bmf-help-viz { margin: 4px auto 0; max-width: 300px; }
  .bmf-help-viz svg { width: 100%; height: auto; display: block; }
  .bmf-help-cap { font-size: ${FS.sm}; line-height: 1.5; color: ${UI.textCool}; margin: 8px 2px 0; text-align: center; }
  .bmf-help-cap b { color: ${UI.water}; }

  .bmf-help-tip {
    display: flex; gap: 11px; align-items: center; margin-top: 16px; padding: 12px 14px;
    border-radius: ${R.md}; background: ${UI.fire}14; border: 1px solid ${UI.fire}3d;
  }
  .bmf-help-tip .bmf-help-viz { margin: 0; flex: none; width: 96px; }
  .bmf-help-tiptext { font-size: ${FS.sm}; line-height: 1.5; color: ${UI.textCool}; }
  .bmf-help-tiptext b { color: ${UI.fire}; }

  /* HUD legend */
  .bmf-help-legend { display: grid; gap: 9px; margin-top: 12px; }
  .bmf-help-leg { display: grid; grid-template-columns: 22px 1fr; gap: 11px; align-items: baseline; }
  .bmf-help-num {
    width: 22px; height: 22px; border-radius: ${R.round}; display: flex; align-items: center; justify-content: center;
    font-size: ${FS.sm}; font-weight: ${FW.heavy}; color: ${UI.ink}; background: ${UI.accent};
  }
  .bmf-help-num.t-water { background: ${UI.water}; }
  .bmf-help-num.t-fire { background: ${UI.fire}; }
  .bmf-help-leg b { font-size: ${FS.body}; color: ${UI.text}; } .bmf-help-leg span { font-size: ${FS.sm}; color: ${UI.textCool}; }

  .bmf-help-note {
    display: flex; gap: 10px; align-items: flex-start; margin-top: 14px; padding: 11px 13px;
    border-radius: ${R.md}; background: ${UI.accentFill}; border: 1px solid ${UI.accent}38;
    font-size: ${FS.sm}; line-height: 1.5; color: ${UI.textCool};
  }
  .bmf-help-note b { color: ${UI.accent}; }

  /* Controls rows */
  .bmf-help-row {
    display: flex; align-items: center; justify-content: space-between; gap: 14px; flex-wrap: wrap;
    padding: 8px 0; border-top: 1px solid ${UI.hair};
  }
  .bmf-help-row:first-of-type { border-top: none; }
  .bmf-help-act { font-size: ${FS.body}; color: ${UI.text}; }
  .bmf-help-ctrls { display: flex; align-items: center; gap: 7px; }
  .bmf-help-touch {
    display: inline-flex; align-items: center; gap: 4px; padding: 3px 9px; border-radius: ${R.sm};
    font-size: ${FS.sm}; font-weight: ${FW.semibold}; color: ${UI.text};
    background: ${UI.accentFill}; border: 1px solid ${UI.accent}42; white-space: nowrap;
  }
  .bmf-help-or { font-size: ${FS.meta}; color: ${UI.dim}; }
  .bmf-help-key {
    display: inline-flex; align-items: center; justify-content: center; min-width: 26px; height: 26px;
    padding: 0 8px; border-radius: ${R.sm}; font-size: ${FS.sm}; font-weight: ${FW.bold}; color: ${UI.text};
    background: ${UI.track}; border: 1px solid ${UI.strokeStrong}; margin-left: 4px;
  }
  .bmf-help-key:first-of-type { margin-left: 0; }

  /* Footer: dots + hint (Back/Next are kit buttons) */
  .bmf-help-nav { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  .bmf-help-dots { display: flex; gap: 8px; }
  .bmf-help-dot { width: 8px; height: 8px; border-radius: ${R.round}; background: ${UI.strokeStrong}; border: none; padding: 0; cursor: pointer; transition: background 0.18s, transform 0.18s; }
  .bmf-help-dot.is-on { background: ${UI.accent}; transform: scale(1.25); }
  .bmf-help-hint { margin: 0; text-align: center; font-size: ${FS.meta}; color: ${UI.faint}; }

  @media (max-width: 380px) {
    .bmf-help-page { padding-left: 16px; padding-right: 16px; }
    .bmf-help-title { font-size: ${FS.title}; }
    .bmf-help-step { grid-template-columns: 38px 1fr; gap: 10px; }
    .bmf-help-glyph { width: 38px; height: 38px; font-size: ${FS.title}; }
  }
  `;
  const tag = document.createElement('style');
  tag.textContent = css;
  document.head.appendChild(tag);
}

// --- tiny DOM helpers -------------------------------------------------------

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

/** Wrap an inline-SVG markup string in a sized container. */
function viz(markup: string, extraClass = ''): HTMLDivElement {
  const box = h('div', { className: `bmf-help-viz${extraClass ? ` ${extraClass}` : ''}` });
  box.innerHTML = markup;
  return box;
}

export class HelpModal {
  private modal: ModalHandle | null = null;
  private track: HTMLDivElement | null = null;
  private dots: HTMLButtonElement[] = [];
  private backBtn: ButtonHandle | null = null;
  private nextBtn: ButtonHandle | null = null;
  private readonly pageCount = 3;
  private page = 0;

  /** Arrow-key paging while open (the kit's `openModal` already owns Esc + the Tab focus-trap). */
  private readonly onKey = (e: KeyboardEvent): void => {
    if (!this.modal) return;
    if (e.key === 'ArrowRight') { e.preventDefault(); this.goTo(this.page + 1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); this.goTo(this.page - 1); }
  };

  constructor() {
    injectStyles();
  }

  get isOpen(): boolean {
    return this.modal !== null;
  }

  open(): void {
    if (this.modal) return;
    const m = openModal({ width: '540px', dismissable: true });
    this.modal = m;
    // A fixed-height panel so the three equal-height pages snap cleanly (kit cards otherwise hug content).
    m.card.style.height = 'min(640px, calc(100dvh - 24px))';

    // Head: swap the kit's (empty) title for our kicker + title; the kit's close ✕ stays on the right.
    const head = m.card.firstElementChild as HTMLElement;
    head.querySelector('h2')?.remove();
    head.insertBefore(
      h('div', { className: 'bmf-help-head' }, [
        h('p', { className: 'bmf-help-kicker', textContent: 'Field manual' }),
        h('h2', { className: 'bmf-help-title', textContent: 'How to fly' }),
      ]),
      head.firstChild,
    );

    // Body becomes a flex column holding the horizontal scroll-snap track (fresh pages each open).
    Object.assign(m.body.style, { padding: '0', display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: '0' });
    this.page = 0;
    this.dots = [];
    const track = h('div', { className: 'bmf-help-track' }, [this.pageJob(), this.pageFireWind(), this.pageCockpit()]);
    track.addEventListener('scroll', () => this.onScroll());
    this.track = track;
    m.body.appendChild(track);

    // Footer: Back · dots · Next, then a hint line (+ an optional Replay row).
    this.backBtn = makeButton({ label: 'Back', variant: 'ghost', register: 'cockpit', size: 'sm', onClick: () => this.goTo(this.page - 1) });
    this.nextBtn = makeButton({
      label: 'Next →',
      variant: 'primary',
      register: 'cockpit',
      size: 'sm',
      onClick: () => (this.page >= this.pageCount - 1 ? this.close() : this.goTo(this.page + 1)),
    });
    const dotsRow = h('div', { className: 'bmf-help-dots' });
    for (let i = 0; i < this.pageCount; i++) {
      const d = h('button', { className: 'bmf-help-dot', type: 'button' });
      d.setAttribute('aria-label', `Page ${i + 1}`);
      d.addEventListener('click', () => this.goTo(i));
      this.dots.push(d);
      dotsRow.append(d);
    }
    const nav = h('div', { className: 'bmf-help-nav' }, [this.backBtn.el, dotsRow, this.nextBtn.el]);
    const hint = h('p', { className: 'bmf-help-hint', textContent: 'Swipe or use the dots · reopen anytime with “?” · Esc to close' });
    Object.assign(m.footer.style, { flexDirection: 'column', alignItems: 'stretch', gap: '8px', justifyContent: 'flex-start' });
    m.footer.append(nav, hint);
    // Replay the interactive coach: clear its "done" flag and re-fly the guided first shift — the
    // Living Province ONBOARDING arc (the campaign retired, so the coach now teaches on the province).
    // `?onboard=1` forces the arc on regardless of career.onboarded. A plain navigation (not the
    // dev-gated in-place switch) so it works in prod too.
    const replay = makeButton({
      label: '↻ Replay guided first flight',
      variant: 'secondary',
      register: 'cockpit',
      size: 'sm',
      block: true,
      onClick: () => {
        resetTutorial();
        const url = new URL(window.location.href);
        url.searchParams.delete('m');
        url.searchParams.delete('daily');
        url.searchParams.delete('ffa');
        url.searchParams.set('province', '1');
        url.searchParams.set('onboard', '1');
        url.searchParams.delete('autostart');
        url.searchParams.delete('qa');
        window.location.assign(url.toString());
      },
    });
    m.footer.append(replay.el);

    this.syncNav();
    window.addEventListener('keydown', this.onKey);
    m.onClose(() => {
      window.removeEventListener('keydown', this.onKey);
      this.modal = null;
      this.track = null;
    });
  }

  close(): void {
    this.modal?.close(); // the onClose handler nulls modal/track and detaches the keydown listener
  }

  toggle(): void {
    if (this.modal) this.close();
    else this.open();
  }

  /** Teardown for an in-place mission switch: close (which removes the kit scrim + keydown). Idempotent. */
  dispose(): void {
    this.close();
  }

  // --- paging ---------------------------------------------------------------

  private goTo(i: number): void {
    if (!this.track) return;
    const n = Math.max(0, Math.min(this.pageCount - 1, i));
    this.track.scrollTo({ left: n * this.track.clientWidth, behavior: 'smooth' });
    this.page = n;
    this.syncNav();
  }

  private onScroll(): void {
    if (!this.track) return;
    const w = Math.max(1, this.track.clientWidth);
    const i = Math.round(this.track.scrollLeft / w);
    if (i !== this.page) {
      this.page = i;
      this.syncNav();
    }
  }

  private syncNav(): void {
    this.dots.forEach((d, i) => d.classList.toggle('is-on', i === this.page));
    if (this.backBtn) this.backBtn.el.style.visibility = this.page === 0 ? 'hidden' : 'visible';
    this.nextBtn?.setLabel(this.page >= this.pageCount - 1 ? 'Let’s fly ✓' : 'Next →');
  }

  // --- pages ----------------------------------------------------------------

  /** Page 1 — the core loop + the scoop diagram (descend to fill the bucket). */
  private pageJob(): HTMLDivElement {
    const steps = h('div', { className: 'bmf-help-steps' });
    for (const s of STEPS) {
      steps.append(
        h('div', { className: 'bmf-help-step' }, [
          h('div', { className: `bmf-help-glyph${s.tone === 'cyan' ? '' : ` t-${s.tone}`}`, textContent: s.glyph }),
          h('div', {}, [
            h('p', { className: 'bmf-help-steptitle', textContent: s.title }),
            h('p', { className: 'bmf-help-stepbody', textContent: s.body }),
          ]),
        ]),
      );
    }
    const cap = h('p', { className: 'bmf-help-cap' });
    cap.innerHTML = '<b>Lower the bucket enough to fill.</b> Fly low over any lake and keep descending until the slung bucket dips into the water. It fills automatically. There is no fill button.';
    return h('div', { className: 'bmf-help-page' }, [
      h('p', { className: 'bmf-help-sec', textContent: '1 · The job' }),
      steps,
      h('p', { className: 'bmf-help-sub', textContent: 'Filling the bucket' }),
      viz(SCOOP_SVG),
      cap,
    ]);
  }

  /** Page 2 — how water extinguishes fire, and how wind changes the fight. */
  private pageFireWind(): HTMLDivElement {
    const cap = h('p', { className: 'bmf-help-cap' });
    cap.innerHTML = 'Line up over the flames and hit <b>DROP</b>. Water knocks down every fire inside the splash. A big blaze re-flares, so give it a few passes until it is fully out.';
    const tip = h('div', { className: 'bmf-help-tip' }, [
      viz(WIND_SVG),
      ((): HTMLElement => {
        const t = h('div', { className: 'bmf-help-tiptext' });
        t.innerHTML = '<b>Mind the wind.</b> Fire runs <b>downwind</b> and climbs uphill, and your dropped water drifts with it. Check the WIND gauge, attack from upwind, and lead your drop.';
        return t;
      })(),
    ]);
    return h('div', { className: 'bmf-help-page' }, [
      h('p', { className: 'bmf-help-sec t-fire', textContent: '2 · Fire & wind' }),
      viz(DROP_SVG),
      cap,
      tip,
    ]);
  }

  /** Page 3 — annotated HUD diagram + what to do, then the controls reference. */
  private pageCockpit(): HTMLDivElement {
    const legend = h('div', { className: 'bmf-help-legend' });
    for (const l of HUD_LEGEND) {
      legend.append(
        h('div', { className: 'bmf-help-leg' }, [
          h('div', { className: `bmf-help-num${l.tone === 'cyan' ? '' : ` t-${l.tone}`}`, textContent: l.n }),
          h('div', {}, [h('b', { textContent: `${l.label}: ` }), h('span', { textContent: l.desc })]),
        ]),
      );
    }
    const note = h('div', { className: 'bmf-help-note' });
    note.innerHTML = 'Your <b>OBJECTIVES</b> (top-left) are the win condition. Finish them to clear the mission. Some missions add a <b>FUEL</b> gauge; land at a base before it runs dry.';

    const rows = CONTROLS.map((c) => {
      const ctrls = h('div', { className: 'bmf-help-ctrls' }, [h('span', { className: 'bmf-help-touch', textContent: c.touch })]);
      if (c.keys.length) {
        ctrls.append(h('span', { className: 'bmf-help-or', textContent: 'or' }));
        for (const k of c.keys) ctrls.append(h('span', { className: 'bmf-help-key', textContent: k }));
      }
      return h('div', { className: 'bmf-help-row' }, [h('span', { className: 'bmf-help-act', textContent: c.action }), ctrls]);
    });

    return h('div', { className: 'bmf-help-page' }, [
      h('p', { className: 'bmf-help-sec', textContent: '3 · Cockpit' }),
      viz(HUD_SVG),
      legend,
      note,
      h('p', { className: 'bmf-help-sub', textContent: 'Controls' }),
      ...rows,
    ]);
  }
}
