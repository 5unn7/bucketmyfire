import { defineConfig } from 'vite';

// bucketmyfire is a pure client-side Phaser game. Vite serves src/ in dev and
// bundles a static site into dist/ for deployment to any static host.
export default defineConfig({
  base: './',
  server: {
    host: true, // expose on LAN so you can test on a real phone
    port: 5173,
  },
  build: {
    target: 'es2020',
    sourcemap: true,
    chunkSizeWarningLimit: 1500, // Phaser is large; this keeps the build quiet
  },
});
