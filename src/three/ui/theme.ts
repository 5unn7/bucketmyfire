/**
 * Shared cockpit theme — THE single source of the glass-cockpit visual language and
 * the DOM helpers that build it. The whole DOM UI layer reads from here: the in-flight
 * `HUD.ts`, the touch `Input.ts`, and the full-screen overlays (the home-hub menus,
 * `Leaderboard.ts`, `CloudSave.ts`) — which used to each carry their own near-duplicate
 * `UI` token object that had quietly drifted (different text alpha, blur, shadow, and
 * three separate "success greens"). Those copies were folded in here so there is now
 * one palette of record. See `DESIGN.md` at the repo root for the prose system this
 * encodes (roles, state colours, type scale, motion).
 *
 * It also exports `anchor()` — the placement primitive that makes the HUD/controls
 * responsive and notch-safe for free. An anchor is a fixed, safe-area-aware corner
 * container that reads its inset/gap from the CSS vars `layout.ts` maintains, so a
 * new HUD widget is one line: `anchor('top-left').appendChild(widget)`.
 *
 * Zero binary assets — pure DOM + inline styles, matching the project ethos.
 */

// --- Design tokens ----------------------------------------------------------
// One palette for every DOM surface. Where two surfaces genuinely need a different
// treatment for the same idea, that is a distinct ROLE and gets its own key (the
// in-world HUD chip `panel` vs the full-screen overlay `cardGlass`; the subtle HUD
// `shadow` vs the lift-off-a-busy-background `shadowCard`). Where copies had only
// drifted by accident (text 0.94 vs 0.96, blur 12 vs 14, two menu greens), they were
// converged to the HUD's values so the in-flight HUD is byte-identical and only the
// overlays shift sub-perceptually onto the shared token.
export const UI = {
  // Accents — cyan is the one interactive/live colour; it marks only what can be
  // acted on or what is happening right now (selection, primary action, fill bars).
  accent: '#67e8ff',
  accentSoft: 'rgba(103,232,255,0.55)',
  accentFill: 'rgba(103,232,255,0.10)', // wash behind a selected card / "NEXT" pill
  accentHi: '#9af1ff', // brighter cyan for an accent's hover / active / peak state (still "interactive")
  // State / semantic
  warn: '#ff5d4d', // amber-red — RTB cue, threatened structure, critical gauge
  fire: '#ff7a45', // orange — fire / the DROP action
  fireMarker: '#ff2a2a', // RADAR fire blip — a vivid RED so a fire MARKER never reads as the orange
  // burning-front shade of the burn overlay (the two were both orange and bled together). Distinct from
  // `warn` (the amber-red RTB / burning-structure highlight) so a fire dot ≠ a threatened building.
  warm: '#ff7a45', // Input's name for the DROP / fire accent (== fire)
  // Ember — the BRAND HERO colour on the warm "fight" register (title / briefing / share card /
  // merch). The cockpit's interactive accent stays cyan; fire is what the eye goes to on a brand
  // surface (see DESIGN.md → Brand Platform / Two registers). NOT for in-flight instruments.
  ember: '#ff6a2c', // deeper brand ember — warm CTA gradient base + brand accents
  emberHi: '#ffc24a', // bright top stop for a warm CTA gradient / ember highlight
  water: '#56c4ee', // scoop water
  waterBody: 'rgba(86,196,238,0.34)', // translucent water FILL inside the DROP "bucket" button — rises as you scoop, drains as you drop
  waterCrest: 'rgba(120,224,255,0.9)', // the bright crest line atop that fill — reads as the water surface
  ok: '#63d68a', // success / "cleared" green (unified the menus' two greens; the in-world AIRFRAME gauge
  // keeps a deeper #46d17a tuned to read against bright terrain — a documented exception, see DESIGN.md)
  caution: '#ffc861', // amber "heads up" — the middle state between ok (green) and warn (red): low fuel, a
  // gauge dipping, a soft advisory. Distinct from `warn` so a caution never reads as a hard alarm.
  friendly: '#74d0bf', // calm teal for welcoming / informational copy (tips, onboarding, neutral hints) —
  // a non-alarming "we've got you" tone that is NOT the interactive cyan accent.
  // Podium medals (leaderboard top three)
  gold: '#ffd66b',
  silver: '#cfe0ee',
  bronze: '#e6a268',
  // Menu / "fight" register — the warm GOLD accent for the home wizard + the map / aircraft / mission
  // pickers (brand law: menu surfaces are warm, the cockpit stays cyan — see DESIGN.md → Two registers).
  // The selection ring, the progress + carousel dots, the NEXT pill and the FLY cue use this on the menu;
  // the in-flight HUD never does. `cta`/`ctaHi` are the gold gradient + its hover; `ctaInk` is the dark
  // text that rides ON the gold; `ctaGlow` its drop shadow.
  menu: '#ffc24a',
  menuSoft: 'rgba(255,194,74,0.55)',
  menuFill: 'rgba(255,194,74,0.12)',
  cta: 'linear-gradient(180deg, #ffd45e 0%, #efaa2b 100%)',
  ctaHi: 'linear-gradient(180deg, #ffdd76 0%, #f4b441 100%)',
  ctaInk: '#3a2406',
  ctaGlow: 'rgba(239,170,43,0.42)',
  // Text hierarchy
  text: 'rgba(255,255,255,0.94)',
  textCool: 'rgba(198,224,236,0.82)', // body text that wants a COOL cast without claiming "interactive" —
  // the correct home for the cyan-tinted prose that was wrongly using the `accent` (cyan = actionable only).
  ink: '#0c1410', // near-black text for drawing ON a bright fill (a gold medal chip, an accent pill).
  dim: 'rgba(255,255,255,0.45)',
  faint: 'rgba(255,255,255,0.34)', // smallest labels, captions, separators
  // Surfaces
  panel: 'rgba(14,20,27,0.38)', // HUD frosted chip fill
  glass: 'rgba(12,18,25,0.42)', // touch-button fill (a touch more opaque, holds up over bright terrain)
  warmGlass: 'rgba(44,17,13,0.46)', // DROP hero fill
  cardGlass: 'rgba(16,24,32,0.60)', // overlay card fill (menus / leaderboard / cloud-save)
  cardSoft: 'rgba(16,24,32,0.42)', // a quieter card — leaderboard list rows
  rowMine: 'rgba(103,232,255,0.14)', // accent-tinted row: "this one is you"
  field: 'rgba(8,13,18,0.60)', // recessed input / text-field fill
  track: 'rgba(255,255,255,0.10)', // recessed track / subtle white fill (progress bars, avatar bg)
  bezel: 'rgba(0,0,0,0.18)', // a recessed instrument-CHAMBER well inside the HUD strip — groups gauge pods into bezelled clusters
  recess: 'rgba(5,9,13,0.55)', // a DEEPER inset well than `field` — score-tally rows, stat readouts, any
  // sunken panel that should read as carved into the card rather than floating on it.
  // Strokes
  warmStroke: 'rgba(255,138,110,0.85)',
  stroke: 'rgba(255,255,255,0.12)', // default hairline (HUD panels, overlay cards)
  strokeStrong: 'rgba(255,255,255,0.18)', // touch-button border
  hair: 'rgba(255,255,255,0.07)', // faintest divider between list rows
  // Effects
  blur: 'blur(12px) saturate(120%)',
  shadow: '0 6px 28px rgba(0,0,0,0.32)', // HUD panels (subtle, in-world)
  shadowBtn: '0 6px 22px rgba(0,0,0,0.40)', // touch buttons
  shadowCard: '0 8px 30px rgba(0,0,0,0.45)', // overlay cards — stronger, lifts off a busy backdrop
  glow: '0 0 10px rgba(103,232,255,0.45)', // ambient cyan accent glow (cockpit register)
  emberGlow: '0 0 16px rgba(255,106,44,0.5)', // warm brand glow — the fight-register analog of `glow`
  font: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
};

// Home-hub (.bmf-app) WARM "fight"-register ramp — fixed-alpha stops of the brand ember (#ff6a2c),
// fire (#ff7a45 / the 255,122,69 secondary), warm glow (255,140,50/60), gold (#ffc24a), the shared
// success-green (UI.ok #63d68a) and danger-red (UI.warn #ff5d4d), plus the card backplate + rank ember.
// These live HERE (the single token source) so home/styles.ts references them via CSS vars instead of
// re-hard-coding the same oranges/greens/reds in its injected stylesheet (DESIGN.md → one design
// system; Two registers → the hub is WARM, never cockpit cyan). Alpha-suffixed so each stop has exactly
// ONE home. Excluded from the verify:ui ratchet (theme.ts is not scanned), so this is the legal sink for
// the values styles.ts used to hard-code. NOT a second `UI` object — keeps the structural check green.
export const HOME = {
  ember05: 'rgba(255,106,44,0.05)',
  ember10: 'rgba(255,106,44,0.10)',
  ember12: 'rgba(255,106,44,0.12)',
  ember14: 'rgba(255,106,44,0.14)',
  ember18: 'rgba(255,106,44,0.18)',
  ember20: 'rgba(255,106,44,0.20)',
  ember22: 'rgba(255,106,44,0.22)',
  ember30: 'rgba(255,106,44,0.30)',
  ember32: 'rgba(255,106,44,0.32)',
  ember35: 'rgba(255,106,44,0.35)',
  ember40: 'rgba(255,106,44,0.40)',
  ember42: 'rgba(255,106,44,0.42)',
  ember50: 'rgba(255,106,44,0.50)',
  fire06: 'rgba(255,122,69,0.06)',
  fire12: 'rgba(255,122,69,0.12)',
  fire16: 'rgba(255,122,69,0.16)',
  fire28: 'rgba(255,122,69,0.28)',
  fire55: 'rgba(255,122,69,0.55)',
  glow50: 'rgba(255,140,50,0.5)',
  glow60: 'rgba(255,140,50,0.6)',
  glow80: 'rgba(255,140,50,0.8)',
  glow90: 'rgba(255,140,50,0.9)',
  warm26: 'rgba(255,140,60,0.26)', // the .brand/.glyph radial-highlight warm
  warm38: 'rgba(255,140,60,0.38)',
  gold32: 'rgba(255,194,74,0.32)', // section-rule gradient + star glow (UI.menu channels)
  gold70: 'rgba(255,194,74,0.7)',
  ok12: 'rgba(99,214,138,0.12)', // UI.ok wash
  ok50: 'rgba(99,214,138,0.5)', // UI.ok edge
  warn10: 'rgba(255,93,77,0.1)', // UI.warn wash (danger button)
  warn16: 'rgba(255,93,77,0.16)', // danger modal glow
  warn18: 'rgba(255,93,77,0.18)',
  warn22: 'rgba(255,93,77,0.22)', // danger glyph fill
  warn50: 'rgba(255,93,77,0.5)', // UI.warn edge
  rank: '#ffa033', // the `--rk` rank-chip default ember
  cardBg: '#0a0e12', // the mission/art card backplate
};

// Leaderboard "timing-tower" surfaces — the warm (fight-register) fills the global board paints, kept
// here so the board reads on tokens, not inline literals (DESIGN.md → one design system). `team` is the
// F1-style grid palette: each callsign hashes to one stable hue, so a board reads as a field of distinct
// entrants. Vivid but ember/gold-led so the whole surface still belongs to "the fight".
export const BOARD = {
  bgTop: 'rgba(34,20,14,0.97)', // overlay backdrop — warm-dark radial (top)
  bgBot: 'rgba(8,5,4,0.992)', // overlay backdrop — near-black (bottom)
  table: 'rgba(20,13,9,0.55)', // the tower's body fill
  colHead: 'rgba(0,0,0,0.18)', // the column-label strip
  rowLeader: 'rgba(255,170,70,0.07)', // P1 row — a faint gold wash
  rowAlt: 'rgba(255,255,255,0.012)', // zebra tint on alternating rows
  card: 'rgba(28,16,11,0.6)', // the daily strip + "your device" panel
  youRow: 'rgba(22,12,8,0.92)', // the sticky "YOU" row, lifted off the scroll
  skeleton: 'rgba(20,13,9,0.5)', // loading shimmer frame
  mine: 'rgba(255,128,52,0.15)', // warm "this one is you" row wash (the ember analogue of UI.rowMine)
  avatarInk: '#1a0f08', // dark initials drawn ON a bright team-colour avatar
  team: ['#ff6a2c', '#ffc24a', '#ff8f5c', '#ffd66b', '#63d68a', '#56c4ee', '#74d0bf', '#9a8cff', '#ff7aa8', '#f4a13b'],
};

// Score-grade → colour, keyed by `ScoreGrade` ('S' | 'A' | 'B' | 'C' | 'D'). One map so the debrief
// grade letter, a badge, and any grade chip all paint the same colour per rank instead of each module
// re-deciding "what colour is an A". Typed loosely (Record<string,string>) to avoid a UI→missions
// import; the five keys mirror `missions/types.ts` ScoreGrade. (DS-5)
export const GRADE: Record<string, string> = {
  S: UI.gold, // flawless — the podium gold
  A: UI.ok, // great — success green
  B: UI.accent, // solid — the live cyan
  C: UI.water, // passable — cool water blue
  D: UI.dim, // rough — dimmed
};

// --- Type / weight / radius scales ------------------------------------------
// One scale each, role-named, so a type or shape change happens in one place. Values
// were extracted from the inline px the UI used; a few odd steps were normalised onto
// the scale (12.5/11.5 → 12px, 19 → 18px; radii 7→8, 10/11→12, 16/20→18). The flight
// tapes and the radar draw their own numerals on canvas and keep their own px.
export const FS = {
  micro: '8px', // comms speaker tag
  tag: '9px', // micro tags, nav-group labels
  label: '10px', // uppercase labels
  meta: '11px', // sub-labels, metadata, comms text
  sm: '12px', // secondary body, mission brief
  body: '13px', // chips, tabs, card titles, intro
  md: '14px', // body copy, button labels
  lg: '15px', // leaderboard row name
  xl: '16px', // callsign input
  title: '18px', // mission name, score, big values
  hero: '20px', // section header
  display: '24px', // overlay title
  banner: '32px', // end-banner headline
  mega: '42px', // score-grade letter on the debrief
};

export const FW = {
  medium: '500',
  semibold: '600',
  bold: '700',
  heavy: '800',
  black: '900',
};

export const R = {
  xs: '2px', // ticks, tiny chips
  sm: '8px', // small chips
  md: '12px', // cards, chips (the default)
  lg: '10px', // buttons + panels — a tighter, more technical/rugged radius (was 14px; the soft
  // pill-ish buttons read off-brand for a firefighting/aviation product)
  xl: '18px', // modals, hero cards
  pill: '99px', // pills, fill tracks, badges
  round: '50%', // LEDs, avatars, round buttons
};

// --- DOM helpers ------------------------------------------------------------

/** Create an element with inline styles (+ optional text). Generic over tag so
 *  future HUD bits can make spans/buttons; `div()` is the common shorthand. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  style: Partial<CSSStyleDeclaration>,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  Object.assign(node.style, style);
  if (text !== undefined) node.textContent = text;
  return node;
}

export function div(style: Partial<CSSStyleDeclaration>, text?: string): HTMLDivElement {
  return el('div', style, text);
}

/** Add backdrop-blur (with the -webkit- prefix iOS/Safari still needs). */
export function setBlur(node: HTMLElement): void {
  node.style.backdropFilter = UI.blur;
  node.style.setProperty('-webkit-backdrop-filter', UI.blur);
}

/** Modal-backdrop blur — heavier than the in-world HUD blur (`UI.blur`) so a full-screen
 *  overlay reads as a focused layer that visibly pushes the frozen game behind it out of focus. */
export const SCRIM_BLUR = 'blur(9px) saturate(108%)';

/**
 * A full-screen blurred backdrop that lifts a modal off the (frozen) game behind it — the shared
 * "dim + blur the world so the dialog is the focus" primitive overlays use (the end-of-mission
 * banner, the pre-flight briefing). Centers its content and CAPTURES pointer events so taps don't
 * leak through to the game underneath. Mount the card inside it.
 */
export function scrim(extra?: Partial<CSSStyleDeclaration>): HTMLDivElement {
  const node = div({
    position: 'absolute',
    inset: '0',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '20px',
    boxSizing: 'border-box',
    background: 'radial-gradient(120% 90% at 50% 42%, rgba(6,12,18,0.46), rgba(3,6,10,0.74))',
    backdropFilter: SCRIM_BLUR,
    pointerEvents: 'auto',
    zIndex: '40',
    ...extra,
  });
  node.style.setProperty('-webkit-backdrop-filter', SCRIM_BLUR);
  return node;
}

/** Respect the OS "reduce motion" setting — gate non-essential entrance animations on this so
 *  motion-sensitive players skip rise/scale transitions. Defaults to false where unsupported. */
export function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/** A frosted-glass panel: translucent fill, hairline border, backdrop blur. */
export function frosted(extra: Partial<CSSStyleDeclaration>): HTMLDivElement {
  const node = div({
    background: UI.panel,
    border: `1px solid ${UI.stroke}`,
    borderRadius: R.md,
    boxShadow: UI.shadow,
    backdropFilter: UI.blur,
    ...extra,
  });
  node.style.setProperty('-webkit-backdrop-filter', UI.blur);
  return node;
}

/** A round frosted touch button (the stick cluster / DROP / eye / help share this). */
export function button(label: string, style: Partial<CSSStyleDeclaration>): HTMLDivElement {
  const node = div({
    position: 'fixed',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: R.round,
    background: UI.glass,
    border: `1px solid ${UI.strokeStrong}`,
    color: UI.text,
    fontFamily: UI.font,
    fontSize: FS.display,
    fontWeight: FW.semibold,
    boxShadow: UI.shadowBtn,
    userSelect: 'none',
    pointerEvents: 'auto',
    touchAction: 'none',
    ...style,
  });
  setBlur(node);
  node.textContent = label;
  return node;
}

/** Create a DPR-crisp 2D canvas positioned via inline styles. Mirrors any
 *  `backdropFilter` into the -webkit- prefix for Safari/iOS. */
export function makeCanvas(
  w: number,
  h: number,
  style: Partial<CSSStyleDeclaration>,
): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  Object.assign(canvas.style, { width: `${w}px`, height: `${h}px`, pointerEvents: 'none' }, style);
  if (style.backdropFilter) canvas.style.setProperty('-webkit-backdrop-filter', style.backdropFilter);
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  ctx.scale(dpr, dpr);
  return { canvas, ctx };
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

// --- Anchors (responsive, safe-area-aware placement) ------------------------

export type AnchorPlace =
  | 'top-left'
  | 'top-center'
  | 'top-right'
  | 'left-center'
  | 'right-center'
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right';

/**
 * A fixed, full-safe-area-aware container pinned to one screen region. It reads
 * its edge inset and stack gap from the CSS custom properties `layout.ts` keeps
 * current (`--bmf-edge`, `--bmf-gap`) plus the static `--bmf-safe-*` insets, so
 * everything mounted inside it stays clear of notches/indicators and reflows when
 * the breakpoint changes — with no per-element JS.
 *
 * Top anchors stack downward; bottom anchors stack upward (first child nearest its
 * edge). The container itself is click-through (`pointerEvents:none`); interactive
 * children opt back in. Children align to the anchor's edge so corners read tidy.
 */
export function anchor(place: AnchorPlace): HTMLDivElement {
  const t = 'calc(var(--bmf-safe-t) + var(--bmf-edge))';
  const r = 'calc(var(--bmf-safe-r) + var(--bmf-edge))';
  const b = 'calc(var(--bmf-safe-b) + var(--bmf-edge))';
  const l = 'calc(var(--bmf-safe-l) + var(--bmf-edge))';

  const node = div({
    position: 'fixed',
    display: 'flex',
    gap: 'var(--bmf-gap)',
    pointerEvents: 'none',
    zIndex: '10',
  });

  switch (place) {
    case 'top-left':
      Object.assign(node.style, { top: t, left: l, flexDirection: 'column', alignItems: 'flex-start' });
      break;
    case 'top-center':
      Object.assign(node.style, {
        top: t,
        left: '50%',
        transform: 'translateX(-50%)',
        flexDirection: 'column',
        alignItems: 'center',
      });
      break;
    case 'top-right':
      Object.assign(node.style, { top: t, right: r, flexDirection: 'column', alignItems: 'flex-end' });
      break;
    case 'left-center':
      Object.assign(node.style, {
        left: l,
        top: '50%',
        transform: 'translateY(-50%)',
        flexDirection: 'column',
        alignItems: 'flex-start',
      });
      break;
    case 'right-center':
      Object.assign(node.style, {
        right: r,
        top: '50%',
        transform: 'translateY(-50%)',
        flexDirection: 'column',
        alignItems: 'flex-end',
      });
      break;
    case 'bottom-left':
      Object.assign(node.style, { bottom: b, left: l, flexDirection: 'column-reverse', alignItems: 'flex-start' });
      break;
    case 'bottom-center':
      Object.assign(node.style, {
        bottom: b,
        left: '50%',
        transform: 'translateX(-50%)',
        flexDirection: 'column-reverse',
        alignItems: 'center',
      });
      break;
    case 'bottom-right':
      Object.assign(node.style, { bottom: b, right: r, flexDirection: 'column-reverse', alignItems: 'flex-end' });
      break;
  }
  return node;
}
