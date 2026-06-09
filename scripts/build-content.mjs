/**
 * Standalone content build — `npm run build:content`. Renders content/*.md into dist/blog/ for a
 * fast local loop (no full `vite build`). The same buildContent() runs automatically inside
 * `vite build` via the bmf-content plugin in vite.config.ts, so prod is covered either way.
 * Preview with: npm run build:content && npm run preview  (then open /blog/).
 */
import { buildContent } from './content/render.mjs';

const res = await buildContent({ log: (m) => console.log(m) });
console.log(`\n[bmf-content] built ${res.count} article(s) into dist/blog/ + sitemap.xml`);
