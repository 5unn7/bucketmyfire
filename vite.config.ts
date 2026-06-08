import { defineConfig, type Plugin } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SPLASH_CSS, SPINNER_MARKUP, SPLASH_ATTRS } from './src/three/ui/spinner';

// Project root (where index.html + shop.html live) — resolved for the multi-page build input.
const ROOT = path.dirname(fileURLToPath(import.meta.url));

/**
 * Dev-only: cache the (large, never-changing) model packs so reloads don't re-download
 * them. Vite serves everything in `public/` with `Cache-Control: no-cache`, and the big
 * `scene.bin` ships without an ETag/Last-Modified — so with no validator the browser
 * re-fetches the full 3 MB on every reload. We intercept `/animals` + `/models` first and
 * serve them ourselves with a real max-age, so the browser keeps them across reloads.
 * (Production is unaffected — this only runs under `vite` dev, not `vite build`.)
 */
function cacheModelsInDev(): Plugin {
  const CT: Record<string, string> = {
    '.gltf': 'model/gltf+json',
    '.glb': 'model/gltf-binary',
    '.bin': 'application/octet-stream',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.ktx2': 'image/ktx2',
  };
  return {
    name: 'cache-models-in-dev',
    apply: 'serve',
    configureServer(server) {
      const handle = (req: any, res: any, next: () => void): void => {
        const url = (req.url || '').split('?')[0];
        if (!url.startsWith('/animals/') && !url.startsWith('/models/')) return next();
        const fp = path.join(process.cwd(), 'public', decodeURIComponent(url));
        let st: fs.Stats;
        try {
          st = fs.statSync(fp);
        } catch {
          return next();
        }
        if (!st.isFile()) return next();
        res.setHeader('Cache-Control', 'public, max-age=86400'); // model assets never change in a session
        res.setHeader('Last-Modified', st.mtime.toUTCString()); // give the browser a validator too
        res.setHeader('Content-Length', String(st.size));
        res.setHeader('Content-Type', CT[path.extname(fp).toLowerCase()] ?? 'application/octet-stream');
        fs.createReadStream(fp).pipe(res);
      };
      // Run before Vite's public-dir middleware (which would set no-cache).
      const stack = (server.middlewares as unknown as { stack?: { route: string; handle: typeof handle }[] }).stack;
      if (stack) stack.unshift({ route: '', handle });
      else server.middlewares.use(handle);
    },
  };
}

/**
 * SEO + AEO structured data. Injected as a STATIC <script type="application/ld+json"> via
 * transformIndexHtml (which runs AFTER Vite's HTML inline-proxy pass), so it lands verbatim in the
 * built index.html for search engines AND answer engines (ChatGPT/Perplexity/Google AI Overviews/
 * voice) — without an inline ld+json in index.html, which desyncs the inline-proxy and breaks the
 * build. Keep the description/FAQ answers in sync with the meta tags in index.html.
 */
const STRUCTURED_DATA = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': ['VideoGame', 'SoftwareApplication'],
      name: 'Bucket My Fire',
      alternateName: 'Bucket My Fire — Helicopter Wildfire Flight Sim',
      url: 'https://bucketmyfire.com/',
      image: 'https://bucketmyfire.com/og-image.jpg',
      description:
        'Fly a helicopter, fill from the lakes, and fight the fire before it reaches the town. A real-feel helicopter flight sim, free in your browser.',
      genre: ['Flight simulator', 'Helicopter game', 'Wildfire firefighting game'],
      gamePlatform: 'Web browser',
      applicationCategory: 'GameApplication',
      operatingSystem: 'Any modern web browser (iOS, Android, Windows, macOS)',
      playMode: 'SinglePlayer',
      inLanguage: 'en',
      author: { '@type': 'Organization', name: 'Bucket My Fire' },
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD', availability: 'https://schema.org/InStock' },
    },
    {
      '@type': 'FAQPage',
      mainEntity: [
        {
          '@type': 'Question',
          name: 'What is Bucket My Fire?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'Bucket My Fire is a free browser-based helicopter wildfire flight sim. You fly a helitanker, fill a slung bucket from lakes, and fight a spreading fire before it reaches the town.',
          },
        },
        {
          '@type': 'Question',
          name: 'Is Bucket My Fire free to play?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'Yes. It is completely free and runs in your web browser. No download, install, or sign-up required.',
          },
        },
        {
          '@type': 'Question',
          name: 'How do you play Bucket My Fire?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: "Fly the helicopter low over a lake to fill your bucket, then drop the water on the fire. Keep the fire off the cabins and complete each mission's objectives.",
          },
        },
        {
          '@type': 'Question',
          name: 'What devices does Bucket My Fire run on?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'Any modern web browser on phone, tablet, or desktop. It is built mobile-first with touch controls and keyboard support.',
          },
        },
        {
          '@type': 'Question',
          name: 'Is there multiplayer?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'Co-op multiplayer is in development. Today the game is a single-player campaign with a global leaderboard.',
          },
        },
      ],
    },
  ],
};

function injectStructuredData(): Plugin {
  return {
    name: 'bmf-structured-data',
    // In a multi-page build transformIndexHtml runs for EVERY entry — scope the game's
    // VideoGame/FAQ JSON-LD to index.html only (ctx.path is '/index.html' vs '/shop.html').
    transformIndexHtml(_html, ctx) {
      if (!ctx.path.endsWith('/index.html')) return;
      return [
        { tag: 'script', attrs: { type: 'application/ld+json' }, children: JSON.stringify(STRUCTURED_DATA), injectTo: 'head' },
      ];
    },
  };
}

/**
 * Cold-start splash. The branded ember loader (#bmf-splash) is injected — CSS into <head>, markup as
 * the first child of <body> — from the ONE shared source `src/three/ui/spinner.ts`, the SAME module
 * the in-app `LoadingOverlay` imports, so the two flame-mark loaders can't drift. Injected via
 * transformIndexHtml (runs in BOTH dev-serve and build), so the splash is baked into the served HTML
 * and paints on the first frame with zero runtime dependency. Tag-injection (not string-replace) keeps
 * the markup out of Vite's HTML inline-proxy, matching the structured-data plugin above.
 */
function injectColdStartSplash(): Plugin {
  return {
    name: 'bmf-splash',
    transformIndexHtml(_html, ctx) {
      if (!ctx.path.endsWith('/index.html')) return; // game page only (not shop.html)
      return [
        { tag: 'style', attrs: { id: 'bmf-splash-css' }, children: SPLASH_CSS, injectTo: 'head' },
        { tag: 'div', attrs: SPLASH_ATTRS, children: SPINNER_MARKUP, injectTo: 'body-prepend' },
      ];
    },
  };
}

// bucketmyfire is a pure client-side Three.js game. Vite serves src/ in dev and
// bundles a static site into dist/ for deployment to any static host.
export default defineConfig({
  base: './',
  plugins: [cacheModelsInDev(), injectStructuredData(), injectColdStartSplash()],
  server: {
    host: true, // expose on LAN so you can test on a real phone
    port: 5173,
  },
  build: {
    target: 'es2020',
    sourcemap: false, // don't ship 3.9 MB of source maps (or full source) to prod
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      // Multi-page: build ONLY these two. Vite does not auto-discover other root *.html, so the
      // dev-only heli-preview.html / icons-preview.html stay out of dist/. `shop` is now a static
      // redirect page (shop.html) that forwards to the standalone storefront at shop.bucketmyfire.com
      // — it shares no graph with the game (the old in-bundle waitlist + src/shop/ were retired).
      input: {
        main: path.resolve(ROOT, 'index.html'),
        shop: path.resolve(ROOT, 'shop.html'),
      },
    },
  },
});
