import { defineConfig, type Plugin } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Project root (where index.html lives) — resolved for the build input.
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
      '@type': 'Organization',
      '@id': 'https://bucketmyfire.com/#org',
      name: 'Bucket My Fire',
      url: 'https://bucketmyfire.com/',
    },
    {
      '@type': 'WebSite',
      '@id': 'https://bucketmyfire.com/#website',
      name: 'Bucket My Fire',
      url: 'https://bucketmyfire.com/',
      description:
        'A live window onto real wildfire across Saskatchewan and Canada — agency-reported fires, area burned, and fire weather from CIFFC and CWFIS — plus a helicopter you can fly into the fight.',
      inLanguage: 'en',
      publisher: { '@id': 'https://bucketmyfire.com/#org' },
    },
    {
      '@type': ['VideoGame', 'SoftwareApplication'],
      '@id': 'https://bucketmyfire.com/#videogame',
      isPartOf: { '@id': 'https://bucketmyfire.com/#website' },
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
      author: { '@id': 'https://bucketmyfire.com/#org' },
      publisher: { '@id': 'https://bucketmyfire.com/#org' },
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD', availability: 'https://schema.org/InStock' },
    },
    {
      '@type': 'FAQPage',
      '@id': 'https://bucketmyfire.com/#faq',
      isPartOf: { '@id': 'https://bucketmyfire.com/#website' },
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
            text: 'Fly the helicopter low over a lake to fill your slung bucket, then drop the water on the fire. Keep the fire off the towns — it is an open-world fight where the fires keep coming, not a fixed set of levels.',
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
            text: 'You can fly the same live map alongside other pilots in Open Skies, or fly solo. Full co-op is in development. A global leaderboard tracks every pilot.',
          },
        },
        {
          '@type': 'Question',
          name: 'Does Bucket My Fire show real wildfire data?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'Yes. The front page is a live window onto real wildfire across Saskatchewan and Canada — agency-reported active fires, area burned this year, and fire weather, sourced from CIFFC and CWFIS (Natural Resources Canada). It is an honest view, not an emergency tool; always follow official sources.',
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

// The cold-start ember splash is no longer injected statically into index.html. The front door
// (index.html → src/hub.ts) is content-first and must paint its editorial hero INSTANTLY, with no
// full-screen loader over it. The splash now belongs to the game transition: `src/hub.ts` shows it
// (from the same shared `src/three/ui/spinner.ts` source) only when "Fight the fire" is tapped and the
// ~1 MB game bundle starts downloading, tearing it down on the game's `bmf:ready` first-frame signal.

// bucketmyfire is a pure client-side app. Vite serves src/ in dev and bundles a static site into dist/
// for deployment to any static host. index.html is now the content-first front door; the 3D game is a
// lazy module the front door imports on demand (so the heavy bundle never blocks first paint).
export default defineConfig({
  base: './',
  plugins: [cacheModelsInDev(), injectStructuredData()],
  server: {
    host: true, // expose on LAN so you can test on a real phone
    port: 5173,
  },
  build: {
    target: 'es2020',
    sourcemap: false, // don't ship 3.9 MB of source maps (or full source) to prod
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      // Multi-page front door (clean URLs): the home (index.html → src/hub.ts), Open Skies — the shared
      // live shift (open-skies/index.html → src/openskies/main.ts), the Campaign/Solo picker
      // (campaign/index.html → src/campaign/main.ts), and the Hall of Fame tribute
      // (hall-of-fame/index.html → src/halloffame/main.ts).
      // Each is a light, crawlable static page that lazy-loads the ~1 MB game only on a play link. The
      // merch store is a standalone site at shop.bucketmyfire.com; the dev-only heli/icons previews are not
      // root-discovered, so they stay out of dist/.
      input: {
        main: path.resolve(ROOT, 'index.html'),
        'open-skies': path.resolve(ROOT, 'open-skies/index.html'),
        campaign: path.resolve(ROOT, 'campaign/index.html'),
        'hall-of-fame': path.resolve(ROOT, 'hall-of-fame/index.html'),
      },
    },
  },
});
