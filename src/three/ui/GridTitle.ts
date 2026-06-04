import { UI, R, div, setBlur, prefersReducedMotion } from './theme';

/**
 * Ember wordmark — a GitHub-contributions-style cell grid that spells a word in a
 * 5×7 pixel font, then ignites it left-to-right in the game's fiery palette. Used as
 * the home-screen hero ("BUCKET MY FIRE").
 *
 * The letterforms come from the well-known "commit grid" idiom: each glyph is a list
 * of lit positions in a `row*50 + col` virtual grid (cols 0-4, rows 0-6) and advances
 * 6 columns. Everything else is reworked onto this project's system: pure DOM via the
 * `div`/`setBlur` helpers, colours from the `UI` fire tokens (no hard-coded hex), and
 * a one-time set of keyframes injected the same way `Leaderboard.ts` does.
 *
 * Motion: lit cells fade+pop in on a left-to-right ignition sweep (delay derived from
 * column) and settle lit with a warm glow; a sparse scatter of empty cells flickers
 * like ambient embers. All of it is gated on `prefersReducedMotion()` — reduced-motion
 * users get the word rendered statically, no sweep, no flicker.
 *
 * Zero binary assets — geometry from data + CSS, matching the project ethos.
 */

// --- one-time keyframes (mirrors the Leaderboard.ts injectStyles pattern) ----
// The only literals here are easing/scale/alpha numbers; every colour is carried in
// via the `--ember` / `--unlit` CSS vars set from `UI` tokens, so the palette stays
// single-sourced in theme.ts. (Injected-CSS numeric stops are an accepted exception
// per DESIGN.md.)
let stylesInjected = false;
function injectGridStyles(): void {
  if (stylesInjected) return;
  stylesInjected = true;
  const tag = document.createElement('style');
  tag.textContent = `
  @keyframes bmf-ember-on {
    from { background: var(--unlit); box-shadow: none; transform: scale(0.45); opacity: 0.25; }
    60%  { transform: scale(1.12); opacity: 1; }
    to   { background: var(--ember); box-shadow: 0 0 7px var(--ember); transform: scale(1); opacity: 1; }
  }
  @keyframes bmf-ember-flicker {
    0%, 100% { box-shadow: none; }
    50%      { box-shadow: 0 0 5px var(--ember), inset 0 0 3px var(--ember); }
  }
  .bmf-grid-cell { animation-fill-mode: both; }
  `;
  document.head.appendChild(tag);
}

// --- 5×7 pixel font ----------------------------------------------------------
// Lit-cell positions per glyph in a row*50+col virtual grid. Full A–Z / 0–9 / space
// so the component is reusable for any short title (all looked up at runtime).
const GLYPHS: Record<string, number[]> = {
  A: [1, 2, 3, 50, 100, 150, 200, 250, 300, 54, 104, 154, 204, 254, 304, 151, 152, 153],
  B: [0, 1, 2, 3, 4, 50, 100, 150, 151, 200, 250, 300, 301, 302, 303, 304, 54, 104, 152, 153, 204, 254, 303],
  C: [0, 1, 2, 3, 4, 50, 100, 150, 200, 250, 300, 301, 302, 303, 304],
  D: [0, 1, 2, 3, 50, 100, 150, 200, 250, 300, 301, 302, 54, 104, 154, 204, 254, 303],
  E: [0, 1, 2, 3, 4, 50, 100, 150, 200, 250, 300, 301, 302, 303, 304, 151, 152],
  F: [0, 1, 2, 3, 4, 50, 100, 150, 200, 250, 300, 151, 152, 153],
  G: [0, 1, 2, 3, 4, 50, 100, 150, 200, 250, 300, 301, 302, 303, 153, 204, 154, 304, 254],
  H: [0, 50, 100, 150, 200, 250, 300, 151, 152, 153, 4, 54, 104, 154, 204, 254, 304],
  I: [0, 1, 2, 3, 4, 52, 102, 152, 202, 252, 300, 301, 302, 303, 304],
  J: [0, 1, 2, 3, 4, 52, 102, 152, 202, 250, 252, 302, 300, 301],
  K: [0, 4, 50, 100, 150, 200, 250, 300, 151, 152, 103, 54, 203, 254, 304],
  L: [0, 50, 100, 150, 200, 250, 300, 301, 302, 303, 304],
  M: [0, 50, 100, 150, 200, 250, 300, 51, 102, 53, 4, 54, 104, 154, 204, 254, 304],
  N: [0, 50, 100, 150, 200, 250, 300, 51, 102, 153, 204, 4, 54, 104, 154, 204, 254, 304],
  O: [1, 2, 3, 50, 100, 150, 200, 250, 301, 302, 303, 54, 104, 154, 204, 254],
  P: [0, 50, 100, 150, 200, 250, 300, 1, 2, 3, 54, 104, 151, 152, 153],
  Q: [1, 2, 3, 50, 100, 150, 200, 250, 301, 302, 54, 104, 154, 204, 202, 253, 304],
  R: [0, 50, 100, 150, 200, 250, 300, 1, 2, 3, 54, 104, 151, 152, 153, 204, 254, 304],
  S: [1, 2, 3, 4, 50, 100, 151, 152, 153, 204, 254, 300, 301, 302, 303],
  T: [0, 1, 2, 3, 4, 52, 102, 152, 202, 252, 302],
  U: [0, 50, 100, 150, 200, 250, 301, 302, 303, 4, 54, 104, 154, 204, 254],
  V: [0, 50, 100, 150, 200, 251, 302, 4, 54, 104, 154, 204, 253],
  W: [0, 50, 100, 150, 200, 250, 301, 152, 202, 252, 4, 54, 104, 154, 204, 254, 303],
  X: [0, 50, 203, 254, 304, 4, 54, 152, 101, 103, 201, 250, 300],
  Y: [0, 50, 101, 152, 202, 252, 302, 4, 54, 103],
  Z: [0, 1, 2, 3, 4, 54, 103, 152, 201, 250, 300, 301, 302, 303, 304],
  '0': [1, 2, 3, 50, 100, 150, 200, 250, 301, 302, 303, 54, 104, 154, 204, 254],
  '1': [1, 52, 102, 152, 202, 252, 302, 0, 2, 300, 301, 302, 303, 304],
  '2': [0, 1, 2, 3, 54, 104, 152, 153, 201, 250, 300, 301, 302, 303, 304],
  '3': [0, 1, 2, 3, 54, 104, 152, 153, 204, 254, 300, 301, 302, 303],
  '4': [0, 50, 100, 150, 4, 54, 104, 151, 152, 153, 154, 204, 254, 304],
  '5': [0, 1, 2, 3, 4, 50, 100, 151, 152, 153, 204, 254, 300, 301, 302, 303],
  '6': [1, 2, 3, 50, 100, 150, 151, 152, 153, 200, 250, 301, 302, 204, 254, 303],
  '7': [0, 1, 2, 3, 4, 54, 103, 152, 201, 250, 300],
  '8': [1, 2, 3, 50, 100, 151, 152, 153, 200, 250, 301, 302, 303, 54, 104, 204, 254],
  '9': [1, 2, 3, 50, 100, 151, 152, 153, 154, 204, 254, 304, 54, 104],
  ' ': [],
};

/** Uppercase, strip diacritics, drop anything we have no glyph for (keeps spaces). */
function sanitize(text: string): string {
  return text
    .toUpperCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip combining diacritical marks
    .split('')
    .filter((ch) => ch in GLYPHS)
    .join('');
}

/** Resolve the lit cell indices for `text` plus the grid dimensions (height is the
 *  glyph's 7 rows + a top and bottom border row). */
function layout(text: string): { cells: number[]; width: number; height: number } {
  const clean = sanitize(text);
  const width = Math.max(clean.length * 6, 6) + 1;
  let pos = 1; // start at 1 → one column of left/top border
  const cells: number[] = [];
  for (const ch of clean) {
    for (const p of GLYPHS[ch]) {
      const row = Math.floor(p / 50);
      const col = p % 50;
      cells.push((row + 1) * width + col + pos);
    }
    pos += 6;
  }
  return { cells, width, height: 9 };
}

/**
 * Build the ember wordmark for `text` as a frosted card. Returns a ready-to-mount
 * element; the caller centres it (it fills its column up to `maxWidth`).
 */
export function createGridTitle(text: string, maxWidth = '720px'): HTMLDivElement {
  injectGridStyles();
  const reduce = prefersReducedMotion();
  const { cells, width, height } = layout(text);
  const lit = new Set(cells);
  // Fire palette, single-sourced from theme: orange → amber-red → vivid red embers.
  const EMBERS = [UI.fire, UI.warn, UI.fireMarker];

  const card = div({
    width: '100%',
    maxWidth,
    margin: '0 auto',
    boxSizing: 'border-box',
    display: 'grid',
    gridTemplateColumns: `repeat(${width}, minmax(0, 1fr))`,
    gridTemplateRows: `repeat(${height}, minmax(0, 1fr))`,
    gap: '3px',
    padding: '16px',
    background: UI.cardGlass,
    border: `1px solid ${UI.stroke}`,
    borderRadius: R.lg,
    boxShadow: UI.shadowCard,
  });
  card.style.setProperty('--unlit', UI.track);
  setBlur(card);
  card.setAttribute('role', 'img');
  card.setAttribute('aria-label', sanitize(text).trim() || text);

  const total = width * height;
  for (let i = 0; i < total; i++) {
    const on = lit.has(i);
    const col = i % width;
    const cell = div({
      width: '100%',
      height: '100%',
      aspectRatio: '1 / 1',
      borderRadius: R.xs,
      background: UI.track,
    });
    cell.className = 'bmf-grid-cell';

    if (on) {
      const ember = EMBERS[(Math.random() * EMBERS.length) | 0];
      cell.style.setProperty('--ember', ember);
      if (reduce) {
        cell.style.background = ember;
        cell.style.boxShadow = `0 0 7px ${ember}`;
      } else {
        // Ignition sweeps left→right (delay grows with the column) with a touch of jitter.
        const delay = (col / width) * 0.5 + Math.random() * 0.16;
        cell.style.animation = `bmf-ember-on 0.5s ease ${delay.toFixed(2)}s both`;
      }
    } else if (!reduce && Math.random() < 0.16) {
      // Sparse ambient embers glowing in the empty grid — keep the recessed base visible.
      const ember = EMBERS[(Math.random() * EMBERS.length) | 0];
      cell.style.setProperty('--ember', ember);
      const dur = (2.2 + Math.random() * 2.2).toFixed(2);
      const delay = (Math.random() * 2.4).toFixed(2);
      cell.style.animation = `bmf-ember-flicker ${dur}s ease-in-out ${delay}s infinite`;
    }
    card.appendChild(cell);
  }
  return card;
}
