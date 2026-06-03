import { defineConfig, type Plugin } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

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

// bucketmyfire is a pure client-side Three.js game. Vite serves src/ in dev and
// bundles a static site into dist/ for deployment to any static host.
export default defineConfig({
  base: './',
  plugins: [cacheModelsInDev()],
  server: {
    host: true, // expose on LAN so you can test on a real phone
    port: 5173,
  },
  build: {
    target: 'es2020',
    sourcemap: false, // don't ship 3.9 MB of source maps (or full source) to prod
    chunkSizeWarningLimit: 1500,
  },
});
