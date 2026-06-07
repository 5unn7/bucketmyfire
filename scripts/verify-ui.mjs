/*
 * UI design-token guard — catches REGRESSIONS away from the one design system, which neither tsc nor
 * verify:campaign can see. DESIGN.md + CLAUDE.md make `src/three/ui/theme.ts` the single source of the
 * visual language: one `UI` token object, and modules read tokens (UI.accent, UI.blur, setBlur(), …)
 * instead of hard-coding colours/blur. Two checks:
 *
 *   A) STRUCTURAL (zero-noise): exactly ONE `export const UI = {` in the tree — no second, drifting
 *      token object (the exact failure that spawned the UI component-kit epic).
 *   B) RATCHET: the COUNT of hard-coded `#hex` / `rgba()` / `blur()` literals in src/three/ui/** (minus
 *      theme.ts and a small allowlist of pure canvas/SVG ART surfaces) must not INCREASE vs. the
 *      committed baseline. ~225 already exist (HelpModal, the menu screens, …) — this is NOT a demand to
 *      clean them up, it's a fence so NEW drift (a fresh `color:'#abc'` that should be `UI.x`) fails the
 *      gate. New hard-coded blur is caught here too (blur() is counted).
 *
 * Why a ratchet, not zero-tolerance: a hard rule would fail on 225 pre-existing literals forever. The
 * ratchet fails only on a net increase; an intentional change/cleanup re-baselines:
 *
 *   node scripts/verify-ui.mjs --update     (or: npm run verify:ui -- --update)
 *
 * Plain Node (no esbuild, no browser) — it only scans files. Run: npm run verify:ui
 */
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url)); // project root (scripts/..)
const UI_DIR = join(ROOT, 'src', 'three', 'ui');
const SRC_DIR = join(ROOT, 'src', 'three');
const BASELINE = fileURLToPath(new URL('./ui-baseline.json', import.meta.url));

// Pure ART surfaces — colours here are pixels drawn to <canvas>/SVG, not DOM styling the token system
// governs. Excluded from the ratchet so legit drawing colour isn't counted as token drift.
const ART_ALLOWLIST = new Set(['icons.ts', 'shareCard.ts', 'GridTitle.ts']);

// Same pattern verify uses to size this manually: a hex colour, an rgb/rgba(, or a blur(.
const COLOR_RE = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bblur\(/g;
const UI_OBJ_RE = /export const UI\s*=\s*\{/g;

/** All `.ts` and `.css` files under `dir`, recursively (so styling MOVED into a .css file still
 *  counts — otherwise migrating a screen from inline styles to a stylesheet would silently drop
 *  literals out of the ratchet's view and hide drift). */
function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (name.endsWith('.ts') || name.endsWith('.css')) out.push(p);
  }
  return out;
}

const rel = (p) => relative(ROOT, p).split('\\').join('/'); // posix-stable relative path

let pass = 0;
let fail = 0;
const failures = [];
const ok = (name, cond, detail = '') => {
  if (cond) pass++;
  else {
    fail++;
    failures.push(`${name}${detail ? ' — ' + detail : ''}`);
  }
};

console.log('UI design-token guard\n');

// --- (A) exactly one UI token object across the whole engine tree ---
let uiObjects = 0;
const uiObjectFiles = [];
for (const f of walk(SRC_DIR)) {
  const m = readFileSync(f, 'utf8').match(UI_OBJ_RE);
  if (m) {
    uiObjects += m.length;
    uiObjectFiles.push(rel(f));
  }
}
ok('ui: exactly one `export const UI` token object', uiObjects === 1, `${uiObjects} found: ${uiObjectFiles.join(', ')}`);

// --- (B) ratchet: count hard-coded colour/blur literals in DOM modules ---
const perFile = {};
let total = 0;
for (const f of walk(UI_DIR)) {
  const base = f.split(/[\\/]/).pop();
  if (base === 'theme.ts' || ART_ALLOWLIST.has(base)) continue;
  const matches = readFileSync(f, 'utf8').match(COLOR_RE);
  const c = matches ? matches.length : 0;
  if (c > 0) perFile[rel(f)] = c;
  total += c;
}

const current = { uiTokenObjects: uiObjects, totalHardcoded: total, perFile };

// --update: rewrite the committed baseline and exit.
if (process.argv.includes('--update')) {
  writeFileSync(BASELINE, JSON.stringify(current, null, 2) + '\n');
  console.log(`ui: baseline UPDATED → ${BASELINE} (total ${total} hard-coded literals across ${Object.keys(perFile).length} DOM modules)`);
  process.exit(0);
}

let golden = null;
try {
  golden = JSON.parse(readFileSync(BASELINE, 'utf8'));
} catch {
  console.error(`ui: no baseline at ${BASELINE} — generate it once with:  npm run verify:ui -- --update`);
  process.exit(1);
}

// Fail on a NET increase; list the files that grew (the new drift).
const grew = [];
for (const [file, count] of Object.entries(perFile)) {
  const was = golden.perFile?.[file] ?? 0;
  if (count > was) grew.push(`${file}: ${was} → ${count} (+${count - was})`);
}
const increased = total > golden.totalHardcoded;
ok(
  'ui: no new hard-coded colour/blur literals (ratchet)',
  !increased,
  `total ${golden.totalHardcoded} → ${total}${grew.length ? ' | ' + grew.join(', ') : ''}`,
);

console.log(`  token objects: ${uiObjects}   hard-coded literals: ${total} (baseline ${golden.totalHardcoded})`);
if (increased) {
  console.log('\n  New token drift — move these to a `theme.ts` token (UI.x / FS / R / setBlur):');
  for (const g of grew) console.log('  ~ ' + g);
  console.log('  If the new literal is genuinely canvas/SVG art, add the file to ART_ALLOWLIST or re-baseline:');
  console.log('    npm run verify:ui -- --update');
} else if (total < golden.totalHardcoded) {
  console.log(`  ↓ ${golden.totalHardcoded - total} literal(s) removed since the baseline — tighten the ratchet with:  npm run verify:ui -- --update`);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (failures.length) {
  console.log('\nFailures:');
  for (const f of failures) console.log('  ✗ ' + f);
  process.exit(1);
}
