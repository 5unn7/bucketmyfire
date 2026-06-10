/**
 * verify:contrast — the WCAG-AA gate for the DOM UI's colour tokens.
 *
 * "AA contrast worthy" made durable: this asserts that the real `theme.ts` text tokens, composited over
 * the real surface tokens they sit on, clear WCAG 2.1 contrast minimums — and, because this is a phone
 * game played OUTDOORS, it holds the most-read text to a tougher floor than the bare 4.5:1 so there is
 * headroom left when direct sun washes the screen out (sunlight raises the panel's effective black level,
 * compressing every ratio — the only defence is more contrast to begin with).
 *
 * It reads the tokens straight from `theme.ts` (esbuild-bundled like the other sims) so it can never drift
 * from what ships. Backdrops are modelled honestly: overlay cards sit over the scrim-dimmed world (near
 * black); the in-flight HUD chips + touch buttons sit over BRIGHT sunlit terrain (the adversarial case for
 * white-on-glass). A translucent surface is alpha-composited over its backdrop first, then the text over
 * that composite — so a too-thin panel that lets bright terrain bleed through and kill the text is caught.
 *
 * Tiers (target ratio):
 *   body   7.0  — primary readout text; AAA, for outdoor headroom
 *   strong 4.5  — secondary body / semantic-colour text (AA normal)
 *   large  3.0  — captions/labels rendered ≥18px or ≥14px-bold, and graphical objects (AA large/non-text)
 */
import { UI } from '../src/three/ui/theme';

type RGB = { r: number; g: number; b: number };
type RGBA = RGB & { a: number };

// ── colour parsing ─────────────────────────────────────────────────────────
function parse(c: string): RGBA {
  const s = c.trim();
  if (s.startsWith('#')) {
    const h = s.slice(1);
    const n = h.length === 3 ? h.split('').map((x) => x + x).join('') : h;
    return { r: parseInt(n.slice(0, 2), 16), g: parseInt(n.slice(2, 4), 16), b: parseInt(n.slice(4, 6), 16), a: 1 };
  }
  const m = s.match(/rgba?\(([^)]+)\)/i);
  if (!m) throw new Error(`unparseable colour: ${c}`);
  const p = m[1].split(',').map((x) => parseFloat(x.trim()));
  return { r: p[0], g: p[1], b: p[2], a: p[3] === undefined ? 1 : p[3] };
}

/** Alpha-composite `fg` (possibly translucent) over an opaque `bg`. */
function over(fg: RGBA, bg: RGB): RGB {
  return {
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
  };
}

function relLum({ r, g, b }: RGB): number {
  const lin = (v: number): number => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function ratio(a: RGB, b: RGB): number {
  const la = relLum(a), lb = relLum(b);
  const hi = Math.max(la, lb), lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

/** Contrast of a (possibly translucent) text colour on a (possibly translucent) surface over `backdrop`. */
function contrast(text: string, surface: string | null, backdrop: RGB): number {
  const bg = surface ? over(parse(surface), backdrop) : backdrop;
  const fg = over(parse(text), bg);
  return ratio(fg, bg);
}

// ── backdrops ────────────────────────────────────────────────────────────────
// Overlay/menu cards sit over the scrim-dimmed, blurred world → effectively near-black.
const WORLD_DIM: RGB = { r: 8, g: 12, b: 16 };
// In-flight HUD chips + touch buttons float over the live world; the adversarial case is BRIGHT sunlit
// boreal terrain (a high-luminance pixel bleeding through the thin glass). If white text survives this it
// survives anything darker.
const WORLD_BRIGHT: RGB = { r: 168, g: 178, b: 162 };
// Map chrome (front-door legend, detail sheet) sits on a near-opaque dark overlay, not glass.
const MAP_OVERLAY: RGB = { r: 5, g: 8, b: 11 };
// CARTO dark basemap tile — the backdrop for the map's own marker dots (graphical, 3:1).
const MAP_TILE: RGB = { r: 22, g: 24, b: 28 };

const BODY = 7.0, STRONG = 4.5, LARGE = 3.0;

type Check = { what: string; text: string; surface: string | null; bg: RGB; min: number };
const checks: Check[] = [
  // ── Overlay cards (menus / leaderboard / debrief / cloud-save), over the dimmed world ──
  { what: 'text on cardGlass', text: UI.text, surface: UI.cardGlass, bg: WORLD_DIM, min: BODY },
  { what: 'textSubtle on cardGlass', text: UI.textSubtle, surface: UI.cardGlass, bg: WORLD_DIM, min: STRONG },
  { what: 'textCool on cardGlass', text: UI.textCool, surface: UI.cardGlass, bg: WORLD_DIM, min: STRONG },
  { what: 'dim on cardGlass', text: UI.dim, surface: UI.cardGlass, bg: WORLD_DIM, min: LARGE },
  { what: 'faint on cardGlass', text: UI.faint, surface: UI.cardGlass, bg: WORLD_DIM, min: LARGE },
  { what: 'text on cardSoft (list rows)', text: UI.text, surface: UI.cardSoft, bg: WORLD_DIM, min: BODY },
  { what: 'dim on cardSoft', text: UI.dim, surface: UI.cardSoft, bg: WORLD_DIM, min: LARGE },
  { what: 'text on field (input)', text: UI.text, surface: UI.field, bg: WORLD_DIM, min: BODY },
  { what: 'textSubtle on recess', text: UI.textSubtle, surface: UI.recess, bg: WORLD_DIM, min: STRONG },

  // ── In-flight HUD + touch controls, over BRIGHT sunlit terrain (the sun case) ──
  { what: 'text on panel (HUD chip) · sun', text: UI.text, surface: UI.panel, bg: WORLD_BRIGHT, min: STRONG },
  { what: 'instrument on panel · sun', text: UI.instrument, surface: UI.panel, bg: WORLD_BRIGHT, min: STRONG },
  // `dim` on the HUD is letter-spaced gauge-LABEL nomenclature + de-emphasised "nothing-left" states (the
  // DATA it labels is the high-contrast row above) → the 3:1 large/non-text floor, not 4.5. `faint` is never
  // HUD text — only decorative ladder minor-ticks + standing-town rings (intentionally quiet "so threats
  // pop"), which WCAG 1.4.11 exempts — so it is checked only where it IS text: the dark overlays below.
  { what: 'dim on panel (gauge label) · sun', text: UI.dim, surface: UI.panel, bg: WORLD_BRIGHT, min: LARGE },
  { what: 'text on glass (touch btn) · sun', text: UI.text, surface: UI.glass, bg: WORLD_BRIGHT, min: STRONG },
  { what: 'warmText on warmGlass (DROP) · sun', text: UI.warmText, surface: UI.warmGlass, bg: WORLD_BRIGHT, min: STRONG },

  // ── Semantic / accent text on the dark overlay surface (gauges, comms, badges) ──
  { what: 'accent on cardGlass', text: UI.accent, surface: UI.cardGlass, bg: WORLD_DIM, min: STRONG },
  { what: 'ok on cardGlass', text: UI.ok, surface: UI.cardGlass, bg: WORLD_DIM, min: STRONG },
  { what: 'caution on cardGlass', text: UI.caution, surface: UI.cardGlass, bg: WORLD_DIM, min: STRONG },
  { what: 'warn on cardGlass', text: UI.warn, surface: UI.cardGlass, bg: WORLD_DIM, min: LARGE },
  { what: 'commsAmber on panel · sun', text: UI.commsAmber, surface: UI.panel, bg: WORLD_BRIGHT, min: LARGE },
  { what: 'emberHi on cardGlass', text: UI.emberHi, surface: UI.cardGlass, bg: WORLD_DIM, min: STRONG },
  { what: 'friendly on cardGlass', text: UI.friendly, surface: UI.cardGlass, bg: WORLD_DIM, min: STRONG },

  // ── Dark ink on the bright "fight" fills (gold medals / warm CTA) ──
  { what: 'ctaInk on cta gradient (top stop)', text: UI.ctaInk, surface: '#ffd45e', bg: WORLD_DIM, min: STRONG },
  { what: 'ctaInk on cta gradient (bottom stop)', text: UI.ctaInk, surface: '#efaa2b', bg: WORLD_DIM, min: STRONG },
  { what: 'ink on gold medal chip', text: UI.ink, surface: UI.gold, bg: WORLD_DIM, min: STRONG },

  // ── Map chrome (front-door legend + detail rows) on the near-opaque dark overlay ──
  { what: 'dim legend on map overlay', text: UI.dim, surface: null, bg: MAP_OVERLAY, min: LARGE },
  { what: 'faint skeleton on map overlay', text: UI.faint, surface: null, bg: MAP_OVERLAY, min: LARGE },
  { what: 'text detail-value on map overlay', text: UI.text, surface: null, bg: MAP_OVERLAY, min: BODY },

  // ── Map marker dots over the dark basemap (graphical → 3:1) ──
  { what: 'reported OC dot vs tile', text: UI.warn, surface: null, bg: MAP_TILE, min: LARGE },
  { what: 'reported UC dot vs tile', text: UI.ok, surface: null, bg: MAP_TILE, min: LARGE },
];

let failed = 0;
const rows = checks.map((c) => {
  const r = contrast(c.text, c.surface, c.bg);
  const pass = r >= c.min - 1e-3;
  if (!pass) failed++;
  return { ...c, r, pass };
});

const pad = (s: string, n: number): string => (s.length >= n ? s : s + ' '.repeat(n - s.length));
console.log('\n  WCAG contrast — text × surface (composited over backdrop)\n');
for (const r of rows) {
  const tag = r.pass ? '  ok ' : ' FAIL';
  console.log(`  ${tag}  ${pad(r.what, 40)} ${r.r.toFixed(2).padStart(6)} : 1   (min ${r.min.toFixed(1)})`);
}
const total = rows.length;
console.log(`\n  ${total - failed}/${total} pairs clear their target.\n`);
if (failed > 0) {
  console.error(`  verify:contrast FAILED — ${failed} pair(s) below the WCAG floor.\n`);
  process.exit(1);
}
console.log('  verify:contrast OK — every token pair is AA-worthy (body text AAA for sun headroom).\n');
