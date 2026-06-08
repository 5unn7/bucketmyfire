/**
 * Self-hosted brand type — Saira Variable (display / UI) + JetBrains Mono Variable (the cockpit
 * instrument face). Latin `wght`-axis woff2 ONLY (the lean subset), imported as Vite assets so the
 * hashed, cache-busted files ride the build with no CDN call — matching the offline-capable,
 * no-tracker ethos. One injector for the game shell (`main.ts`), so the whole product speaks one
 * type system. (The standalone merch site now lives at shop.bucketmyfire.com, off this bundle.)
 *
 * The @font-face declarations mirror @fontsource's own (weight range + woff2-variations format +
 * latin unicode-range) but point at the bundled URLs. The family names match the `--font` / `--mono`
 * tokens emitted by `tokens.ts` from `theme.ts` (UI.font / UI.fontMono). See DESIGN.md → Typography.
 */
import sairaWght from '@fontsource-variable/saira/files/saira-latin-wght-normal.woff2';
import jbmWght from '@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2';

// The latin subset @fontsource ships for these faces (kept verbatim so we cover the same glyphs).
const LATIN =
  'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,' +
  'U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD';

let injected = false;

/** Inject the two brand @font-faces once, then warm the canvas HUD so its numerals upgrade off the
 *  system fallback — canvas text only adopts a webfont once it has loaded, and the HUD redraws every
 *  frame, so kicking the load makes the instrument numerals snap to JetBrains Mono within a frame or
 *  two of readiness. Idempotent; a no-op outside the browser. */
export function injectFonts(): void {
  if (injected || typeof document === 'undefined') return;
  injected = true;
  const s = document.createElement('style');
  s.id = 'bmf-fonts';
  s.textContent =
    `@font-face{font-family:'Saira Variable';font-style:normal;font-display:swap;font-weight:100 900;` +
    `src:url(${sairaWght}) format('woff2-variations');unicode-range:${LATIN};}` +
    `@font-face{font-family:'JetBrains Mono Variable';font-style:normal;font-display:swap;font-weight:100 800;` +
    `src:url(${jbmWght}) format('woff2-variations');unicode-range:${LATIN};}`;
  document.head.appendChild(s);
  try {
    const fonts = (document as unknown as { fonts?: { load(font: string): Promise<unknown> } }).fonts;
    void fonts?.load("800 24px 'Saira Variable'");
    void fonts?.load("700 16px 'JetBrains Mono Variable'");
  } catch {
    /* FontFaceSet unsupported — font-display:swap covers the upgrade for DOM text */
  }
}
