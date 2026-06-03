// Temp screenshot driver for the continuous-burn work: boots the game headlessly, ignites a fire,
// lets it SPREAD + char the ground for a while, frames it, and screenshots (HUD radar included).
// Usage: node scripts/shot.mjs <out.png> [buildSeconds] [BX BY BZ via env]
import { chromium } from 'playwright-core';

const EXE = (process.env.HOME + '/AppData/Local/ms-playwright/chromium-1208/chrome-win64/chrome.exe').replace(/\//g, '\\');
const out = process.argv[2] || 'shot.png';
const E = process.env;
const BUILD = Number(E.BUILD || 18); // seconds to let the fire spread + char before framing
const CAM = { bx: Number(E.BX || -120), by: Number(E.BY || 60), bz: Number(E.BZ || 50) };
const YAW = E.YAW !== undefined ? Number(E.YAW) : null;
const WIND = Number(E.WIND || 1.4); // strength scale override via mission? use long-haul-ish

const browser = await chromium.launch({
  executablePath: EXE,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('[console.error]', m.text()); });

await page.goto('http://localhost:5173/?autostart&m=first-sortie', { waitUntil: 'load' });
await page.waitForFunction(() => window.__game && window.__game.debug.fires.length > 0, { timeout: 20000 });

const killOverlay = () =>
  page.evaluate(() => {
    for (const el of Array.from(document.querySelectorAll('div'))) {
      if (el.textContent && el.textContent.trim().startsWith('CONTROLS')) {
        let n = el;
        for (let i = 0; i < 6 && n; i++) {
          if (getComputedStyle(n).position === 'fixed') { n.style.display = 'none'; break; }
          n = n.parentElement;
        }
      }
    }
  });
await killOverlay();

// Crank the wind so the front RUNS, and light a hot line that will spread into a continuous burn.
const SCORCHTEST = E.SCORCHTEST === '1';
const fire = await page.evaluate((scorchTest) => {
  const g = window.__game;
  const f0 = g.debug.fires[0];
  if (scorchTest) {
    // Keep ONE fire alive far off-frame so the "extinguish all" objective doesn't instantly win.
    g.fireSystem.igniteAt(f0.x + 380, f0.z + 380, 3, 1.0);
    // Burn-out is slow in headless; paint a SCORCH scar disc directly into the field (heat 0) so
    // we can see the CHAR (charcoal ground) the shader renders, independent of live glow.
    const v = g.fireSystem.fieldView();
    const cx = Math.floor((f0.x + v.half) / v.cellSize);
    const cz = Math.floor((f0.z + v.half) / v.cellSize);
    for (let oz = -10; oz <= 10; oz++) for (let ox = -14; ox <= 14; ox++) {
      if (ox * ox * 0.5 + oz * oz > 110) continue;
      const i = (cz + oz) * v.n + (cx + ox);
      if (i >= 0 && i < v.scorch.length) { v.scorch[i] = 1; v.heat[i] = 0; }
    }
    return { x: f0.x, y: f0.y, z: f0.z };
  }
  for (const [dx, dz] of [[0, 0], [24, 0], [-24, 0], [12, 18], [-12, -18]]) {
    g.fireSystem.igniteAt(f0.x + dx, f0.z + dz, 4, 1.0);
  }
  return { x: f0.x, y: f0.y, z: f0.z };
}, SCORCHTEST);

await page.waitForTimeout(BUILD * 1000);

// Re-read the (now spread) fire centroid and frame high + back so the whole burn region + scar show.
const fc = SCORCHTEST
  ? fire // frame the painted scar (the off-frame keep-alive fire would skew a centroid)
  : await page.evaluate(() => {
      const g = window.__game;
      const fs = g.debug.fires;
      let x = 0, z = 0;
      for (const f of fs) { x += f.x; z += f.z; }
      if (fs.length) { x /= fs.length; z /= fs.length; }
      return { x, z, y: g.debug.floor ?? 2 };
    }, fire);
await page.evaluate(({ f, cam, yaw }) => {
  const g = window.__game;
  const p = g.heliSim.position;
  p.x = f.x + cam.bx; p.y = (f.y || 2) + cam.by; p.z = f.z + cam.bz;
  if (g.heliSim.velocity) g.heliSim.velocity.set(0, 0, 0);
  if (yaw !== null && 'yaw' in g.heliSim) g.heliSim.yaw = yaw;
}, { f: fc, cam: CAM, yaw: YAW });
await killOverlay();
await page.waitForTimeout(Number(E.SETTLE || 2500));
await page.screenshot({ path: out });
// Also crop the radar (top-right) to verify the burnt-area shading reads.
await page.screenshot({ path: out.replace(/\.png$/, '-radar.png'), clip: { x: 1120, y: 0, width: 160, height: 160 } });
console.log('wrote', out, 'firesLeft=', await page.evaluate(() => window.__game.debug.firesLeft),
  'burnedOut=', await page.evaluate(() => window.__game.debug.burnedOut));
await browser.close();
