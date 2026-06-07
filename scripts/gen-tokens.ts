/**
 * Generate `mockups/tokens.css` from the ONE token source (`src/three/ui/tokens.ts`), so the static
 * mockups read the same design tokens as the live UI instead of a hand-typed mirror that drifts
 * (see `mockups/README.md`). Run: `npm run gen:tokens`.  CI check: `npm run verify:tokens` (--check).
 *
 * Bundled to `.mjs` via esbuild (same pattern as the verify:* scripts) so it can import the TS token
 * source under Node. The generated CSS is COMMITTED, so a build/deploy NEVER depends on this generator
 * running — `verify:tokens` only flags when the committed file has drifted from theme.ts.
 */
import { writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tokenBlock } from '../src/three/ui/tokens';

const OUT = fileURLToPath(new URL('../mockups/tokens.css', import.meta.url));
const HEADER =
  '/* GENERATED from src/three/ui/theme.ts via src/three/ui/tokens.ts — DO NOT EDIT BY HAND.\n' +
  '   Regenerate: npm run gen:tokens    Check (CI): npm run verify:tokens */\n';
const css = HEADER + tokenBlock(':root') + '\n';

if (process.argv.includes('--check')) {
  let existing = '';
  try {
    existing = readFileSync(OUT, 'utf8');
  } catch {
    /* missing → treat as stale */
  }
  if (existing !== css) {
    console.error('tokens: mockups/tokens.css is STALE vs theme.ts — run:  npm run gen:tokens');
    process.exit(1);
  }
  console.log('tokens: mockups/tokens.css in sync with theme.ts ✓');
} else {
  writeFileSync(OUT, css);
  console.log(`tokens: wrote ${OUT}`);
}
