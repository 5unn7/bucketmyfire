/**
 * Render the legal pages into committed `public/privacy.html` + `public/terms.html`.
 *
 * Same generated-and-committed pattern as `mockups/tokens.css` (gen:tokens): the prose lives in
 * `scripts/content/legal.mjs`, the chrome comes from the SHARED `src/site/siteNav.mjs` (appbar + tab
 * bar + breadcrumb), and the look reads the canonical `mockups/tokens.css` tokens. Re-run after a
 * nav/token change:  npm run build:legal
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { navCss } from '../src/site/siteNav.mjs';
import { legalPages, LEGAL_CSS } from './content/legal.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const tokens = fs.readFileSync(path.join(ROOT, 'mockups', 'tokens.css'), 'utf8');
const css = `${tokens}\n${navCss}\n${LEGAL_CSS}`;

for (const { file, html } of legalPages(css)) {
  fs.writeFileSync(path.join(ROOT, 'public', file), html);
  console.log(`[build-legal] wrote public/${file}`);
}
