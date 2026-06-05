/**
 * Help / quick-start modal — the "?" button's panel, a swipeable 3-page tutorial
 * in the shared cockpit visual language (same dark-glass gradient + cyan/fire/water
 * accents as the onboarding screen). It owns no Three.js and injects its own
 * stylesheet once so hover/scroll/keyframes/snap stay crisp.
 *
 *   PAGE 1 — The job: the four-beat loop (fly → scoop → drop → protect) plus a
 *            scoop diagram that shows you must descend until the bucket dips in.
 *   PAGE 2 — Fire & wind: an extinguish diagram (water douses every fire in the
 *            splash) and a wind tip — fire runs downwind, your water drifts.
 *   PAGE 3 — Cockpit & controls: an annotated HUD diagram (gauges / radar / stick /
 *            DROP) + a "what to do" note, then the touch + keyboard reference.
 *
 * Pages are a horizontal scroll-snap track (swipe on touch), with dots + Back/Next
 * for desktop; the last page's button closes ("Let's fly"). The visuals are inline
 * SVG (vector, zero binary assets), matching the project's procedural-art ethos.
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
  { glyph: '🚁', title: 'Fly the nose', body: 'Steer where the nose points and add throttle along it. She carries real momentum — ease off early to stop.', tone: 'cyan' },
  { glyph: '💧', title: 'Scoop water', body: 'Descend low over a lake until the slung bucket dips in. It fills on its own (see below).', tone: 'water' },
  { glyph: '🔥', title: 'Drop on the fire', body: 'Line up over the flames and hit DROP. Fly straight and level so the water lands true.', tone: 'fire' },
  { glyph: '🏠', title: 'Protect & win', body: 'Keep fires off the cabins and finish each mission’s objectives (top-left). When a FUEL gauge shows, land at a base before it runs dry.', tone: 'cyan' },
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

/** HUD legend rows — number badge → what that region of the screen is. */
interface Leg {
  n: string;
  tone: 'cyan' | 'water' | 'fire';
  label: string;
  desc: string;
}
const HUD_LEGEND: Leg[] = [
  { n: '1', tone: 'cyan', label: 'Gauges', desc: 'water · airframe · fires-left · wind · heading' },
  { n: '2', tone: 'water', label: 'Radar', desc: 'fires (red), lakes (blue), your base — tap to zoom' },
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
function injectStyles(): void {
  if (stylesInjected) return;
  stylesInjected = true;
  const css = `
  .bmf-help-scrim {
    position: fixed; inset: 0; z-index: 60;
    display: none; align-items: center; justify-content: center;
    padding: 12px; box-sizing: border-box;
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
    position: relative; display: flex; flex-direction: column;
    width: 100%; max-width: 540px; height: min(640px, calc(100dvh - 24px));
    padding: 20px 0 14px; border-radius: 20px;
    border: 1px solid rgba(255,255,255,0.14);
    background:
      radial-gradient(130% 70% at 50% -8%, rgba(103,232,255,0.12), transparent 60%),
      radial-gradient(120% 80% at 85% 112%, rgba(255,122,69,0.10), transparent 55%),
      linear-gradient(180deg, #0c1a15 0%, #0a1410 62%, #0e160f 100%);
    box-shadow: 0 24px 70px rgba(0,0,0,0.6);
    animation: bmf-help-rise 0.28s ease both;
  }

  .bmf-help-head { padding: 0 24px; flex: none; }
  .bmf-help-kicker { font-size: 11px; letter-spacing: 0.26em; text-transform: uppercase; color: ${UI.accent}; opacity: 0.85; font-weight: 700; margin: 0; }
  .bmf-help-title { margin: 4px 0 0; font-size: 23px; font-weight: 800; letter-spacing: 0.02em; }
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

  /* Paged track (swipe / scroll-snap) */
  .bmf-help-track {
    flex: 1; min-height: 0; display: flex; margin-top: 12px;
    overflow-x: auto; overflow-y: hidden; scroll-snap-type: x mandatory;
    overscroll-behavior: contain; -webkit-overflow-scrolling: touch;
    scrollbar-width: none;
  }
  .bmf-help-track::-webkit-scrollbar { display: none; }
  .bmf-help-page {
    flex: 0 0 100%; width: 100%; scroll-snap-align: start; scroll-snap-stop: always;
    overflow-y: auto; -webkit-overflow-scrolling: touch; padding: 4px 24px 6px;
  }
  .bmf-help-page::-webkit-scrollbar { width: 7px; }
  .bmf-help-page::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.16); border-radius: 99px; }

  .bmf-help-sec { font-size: 11px; letter-spacing: 0.2em; text-transform: uppercase; color: ${UI.accent}; opacity: 0.8; font-weight: 700; margin: 4px 0 12px; }
  .bmf-help-sec.t-fire { color: ${UI.fire}; }
  .bmf-help-sub { font-size: 11px; letter-spacing: 0.16em; text-transform: uppercase; color: rgba(255,255,255,0.45); font-weight: 700; margin: 20px 0 10px; }

  /* How-to-play steps */
  .bmf-help-steps { display: grid; gap: 11px; }
  .bmf-help-step { display: grid; grid-template-columns: 44px 1fr; gap: 13px; align-items: start; }
  .bmf-help-glyph {
    width: 44px; height: 44px; border-radius: 13px; display: flex; align-items: center; justify-content: center;
    font-size: 22px; background: rgba(103,232,255,0.10); border: 1px solid rgba(103,232,255,0.30);
    box-shadow: inset 0 0 16px rgba(103,232,255,0.10);
  }
  .bmf-help-glyph.t-water { background: rgba(86,196,238,0.12); border-color: rgba(86,196,238,0.34); box-shadow: inset 0 0 16px rgba(86,196,238,0.12); }
  .bmf-help-glyph.t-fire { background: rgba(255,122,69,0.13); border-color: rgba(255,122,69,0.40); box-shadow: inset 0 0 16px rgba(255,122,69,0.14); }
  .bmf-help-steptitle { font-size: 15px; font-weight: 700; margin: 2px 0 0; }
  .bmf-help-stepbody { font-size: 12.5px; line-height: 1.45; color: rgba(231,247,255,0.72); margin: 3px 0 0; }

  /* Visuals */
  .bmf-help-viz { margin: 4px auto 0; max-width: 300px; }
  .bmf-help-viz svg { width: 100%; height: auto; display: block; }
  .bmf-help-cap { font-size: 12.5px; line-height: 1.5; color: rgba(231,247,255,0.78); margin: 8px 2px 0; text-align: center; }
  .bmf-help-cap b { color: ${UI.water}; }

  .bmf-help-tip {
    display: flex; gap: 11px; align-items: center; margin-top: 16px; padding: 12px 14px;
    border-radius: 13px; background: rgba(255,122,69,0.08); border: 1px solid rgba(255,122,69,0.24);
  }
  .bmf-help-tip .bmf-help-viz { margin: 0; flex: none; width: 96px; }
  .bmf-help-tiptext { font-size: 12.5px; line-height: 1.5; color: rgba(231,247,255,0.82); }
  .bmf-help-tiptext b { color: ${UI.fire}; }

  /* HUD legend */
  .bmf-help-legend { display: grid; gap: 9px; margin-top: 12px; }
  .bmf-help-leg { display: grid; grid-template-columns: 22px 1fr; gap: 11px; align-items: baseline; }
  .bmf-help-num {
    width: 22px; height: 22px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
    font-size: 12px; font-weight: 800; color: #04181d; background: ${UI.accent};
  }
  .bmf-help-num.t-water { background: ${UI.water}; }
  .bmf-help-num.t-fire { background: ${UI.fire}; }
  .bmf-help-leg b { font-size: 13.5px; } .bmf-help-leg span { font-size: 12.5px; color: rgba(231,247,255,0.7); }

  .bmf-help-note {
    display: flex; gap: 10px; align-items: flex-start; margin-top: 14px; padding: 11px 13px;
    border-radius: 12px; background: rgba(103,232,255,0.08); border: 1px solid rgba(103,232,255,0.22);
    font-size: 12.5px; line-height: 1.5; color: rgba(231,247,255,0.82);
  }
  .bmf-help-note b { color: ${UI.accent}; }

  /* Controls rows */
  .bmf-help-row {
    display: flex; align-items: center; justify-content: space-between; gap: 14px; flex-wrap: wrap;
    padding: 8px 0; border-top: 1px solid rgba(255,255,255,0.07);
  }
  .bmf-help-row:first-of-type { border-top: none; }
  .bmf-help-act { font-size: 13.5px; color: rgba(255,255,255,0.82); }
  .bmf-help-ctrls { display: flex; align-items: center; gap: 7px; }
  .bmf-help-touch {
    display: inline-flex; align-items: center; gap: 4px; padding: 3px 9px; border-radius: 8px;
    font-size: 12px; font-weight: 600; color: ${UI.text};
    background: rgba(103,232,255,0.10); border: 1px solid rgba(103,232,255,0.26); white-space: nowrap;
  }
  .bmf-help-or { font-size: 11px; color: rgba(255,255,255,0.4); }
  .bmf-help-key {
    display: inline-flex; align-items: center; justify-content: center; min-width: 26px; height: 26px;
    padding: 0 8px; border-radius: 7px; font-size: 12px; font-weight: 700; color: ${UI.text};
    background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.2);
    box-shadow: 0 2px 0 rgba(0,0,0,0.35); margin-left: 4px;
  }
  .bmf-help-key:first-of-type { margin-left: 0; }

  /* Footer: dots + nav */
  .bmf-help-foot { flex: none; padding: 12px 24px 0; margin-top: 4px; border-top: 1px solid rgba(255,255,255,0.08); }
  .bmf-help-nav { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  .bmf-help-dots { display: flex; gap: 8px; }
  .bmf-help-dot { width: 8px; height: 8px; border-radius: 50%; background: rgba(255,255,255,0.22); border: none; padding: 0; cursor: pointer; transition: background 0.18s, transform 0.18s; }
  .bmf-help-dot.is-on { background: ${UI.accent}; transform: scale(1.25); }
  .bmf-help-back {
    background: none; border: none; color: rgba(255,255,255,0.55); font-family: inherit; font-size: 13px;
    cursor: pointer; padding: 8px 4px; min-width: 56px; text-align: left;
  }
  .bmf-help-back:hover { color: ${UI.text}; }
  .bmf-help-next {
    border: none; font-family: inherit; font-size: 14px; font-weight: 800; letter-spacing: 0.04em;
    cursor: pointer; color: #04181d; padding: 11px 20px; border-radius: 12px; min-width: 120px;
    background: linear-gradient(180deg, #8df0ff, ${UI.accent});
    box-shadow: 0 8px 22px rgba(103,232,255,0.26); transition: transform 0.12s, box-shadow 0.2s;
  }
  .bmf-help-next:hover { transform: translateY(-2px); box-shadow: 0 12px 28px rgba(103,232,255,0.36); }
  .bmf-help-next:active { transform: translateY(0); }
  .bmf-help-hint { margin: 9px 0 0; text-align: center; font-size: 11px; color: rgba(255,255,255,0.38); }

  @media (max-width: 380px) {
    .bmf-help-head, .bmf-help-page, .bmf-help-foot { padding-left: 16px; padding-right: 16px; }
    .bmf-help-title { font-size: 21px; }
    .bmf-help-step { grid-template-columns: 38px 1fr; gap: 10px; }
    .bmf-help-glyph { width: 38px; height: 38px; font-size: 19px; }
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
  private readonly scrim: HTMLDivElement;
  private readonly track: HTMLDivElement;
  private readonly dots: HTMLButtonElement[] = [];
  private readonly backBtn: HTMLButtonElement;
  private readonly nextBtn: HTMLButtonElement;
  private readonly onKey: (e: KeyboardEvent) => void;
  private readonly pageCount = 3;
  private page = 0;
  private open_ = false;

  constructor() {
    injectStyles();

    // Build the three pages, then the shell around them.
    this.track = h('div', { className: 'bmf-help-track' }, [this.pageJob(), this.pageFireWind(), this.pageCockpit()]);
    this.track.addEventListener('scroll', () => this.onScroll());

    this.backBtn = h('button', { className: 'bmf-help-back', type: 'button', textContent: 'Back' });
    this.nextBtn = h('button', { className: 'bmf-help-next', type: 'button', textContent: 'Next →' });
    this.backBtn.addEventListener('click', () => this.goTo(this.page - 1));
    this.nextBtn.addEventListener('click', () => (this.page >= this.pageCount - 1 ? this.close() : this.goTo(this.page + 1)));

    const dotsRow = h('div', { className: 'bmf-help-dots' });
    for (let i = 0; i < this.pageCount; i++) {
      const d = h('button', { className: 'bmf-help-dot', type: 'button' });
      d.setAttribute('aria-label', `Page ${i + 1}`);
      d.addEventListener('click', () => this.goTo(i));
      this.dots.push(d);
      dotsRow.append(d);
    }

    const footer = h('div', { className: 'bmf-help-foot' }, [
      h('div', { className: 'bmf-help-nav' }, [this.backBtn, dotsRow, this.nextBtn]),
      h('p', { className: 'bmf-help-hint', textContent: 'Swipe or use the dots · reopen anytime with “?” · Esc to close' }),
    ]);

    const close = h('button', { className: 'bmf-help-x', type: 'button', textContent: '✕', title: 'Close' });
    close.setAttribute('aria-label', 'Close help');
    close.addEventListener('click', () => this.close());

    const head = h('div', { className: 'bmf-help-head' }, [
      h('p', { className: 'bmf-help-kicker', textContent: 'Quick start' }),
      ((): HTMLElement => {
        const t = h('h2', { className: 'bmf-help-title' });
        t.innerHTML = 'How to fly the <span class="em">helicopter</span>';
        return t;
      })(),
    ]);

    const card = h('div', { className: 'bmf-help-card' }, [close, head, this.track, footer]);
    card.addEventListener('pointerdown', (e) => e.stopPropagation()); // taps inside don't close

    this.scrim = h('div', { className: 'bmf-help-scrim' }, [card]);
    this.scrim.addEventListener('pointerdown', () => this.close()); // tap outside closes
    document.body.appendChild(this.scrim);

    this.onKey = (e: KeyboardEvent): void => {
      if (!this.open_) return;
      if (e.key === 'Escape') { e.preventDefault(); this.close(); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); this.goTo(this.page + 1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); this.goTo(this.page - 1); }
    };
  }

  get isOpen(): boolean {
    return this.open_;
  }

  open(): void {
    if (this.open_) return;
    this.open_ = true;
    this.scrim.classList.add('is-open');
    this.track.scrollLeft = 0; // always greet on page 1
    this.page = 0;
    this.syncNav();
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

  /** Teardown for an in-place mission switch: drop the body-level scrim and detach the (open-only)
   *  keydown listener via close(). Idempotent; the modal is dead afterwards. */
  dispose(): void {
    this.close(); // removes the window 'keydown' if it was open
    this.scrim.remove();
  }

  // --- paging ---------------------------------------------------------------

  private goTo(i: number): void {
    const n = Math.max(0, Math.min(this.pageCount - 1, i));
    this.track.scrollTo({ left: n * this.track.clientWidth, behavior: 'smooth' });
    this.page = n;
    this.syncNav();
  }

  private onScroll(): void {
    const w = Math.max(1, this.track.clientWidth);
    const i = Math.round(this.track.scrollLeft / w);
    if (i !== this.page) {
      this.page = i;
      this.syncNav();
    }
  }

  private syncNav(): void {
    this.dots.forEach((d, i) => d.classList.toggle('is-on', i === this.page));
    this.backBtn.style.visibility = this.page === 0 ? 'hidden' : 'visible';
    this.nextBtn.textContent = this.page >= this.pageCount - 1 ? 'Let’s fly ✓' : 'Next →';
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
    cap.innerHTML = '<b>Lower the bucket enough to fill.</b> Fly low over any lake and keep descending until the slung bucket dips into the water — it fills automatically. There is no scoop button.';
    return h('div', { className: 'bmf-help-page' }, [
      h('p', { className: 'bmf-help-sec', textContent: '1 · The job' }),
      steps,
      h('p', { className: 'bmf-help-sub', textContent: 'Scooping' }),
      viz(SCOOP_SVG),
      cap,
    ]);
  }

  /** Page 2 — how water extinguishes fire, and how wind changes the fight. */
  private pageFireWind(): HTMLDivElement {
    const cap = h('p', { className: 'bmf-help-cap' });
    cap.innerHTML = 'Line up over the flames and hit <b>DROP</b>. Water knocks down every fire inside the splash — a big blaze re-flares, so give it a few passes until it is fully out.';
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
          h('div', {}, [h('b', { textContent: `${l.label} — ` }), h('span', { textContent: l.desc })]),
        ]),
      );
    }
    const note = h('div', { className: 'bmf-help-note' });
    note.innerHTML = 'Your <b>OBJECTIVES</b> (top-left) are the win condition — finish them to clear the sortie. Some missions add a <b>FUEL</b> gauge; land at a base before it runs dry.';

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
