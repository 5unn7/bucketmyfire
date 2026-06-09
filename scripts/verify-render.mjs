/*
 * Live render / boot / shader smoke gate — the ONLY level that catches GLSL-compile errors, which pass
 * tsc + vite build + verify:campaign and only fail in a real WebGL context. Boots the production build
 * (vite preview, no HMR) in headless swiftshader Chromium across three routes and fails on any shader
 * error, page error, or console error (minus a benign allowlist), plus a couple of "did it actually
 * render" DOM checks:
 *
 *   1. Front door (/)              — the content-first hub (src/hub.ts); boots clean + renders interactive
 *                                     content (the "Fight the fire" control + copy). Best-effort live-data
 *                                     fetches are allowlisted (headless.mjs BENIGN_RE) so a third-party
 *                                     outage can't false-fail the deploy. No shaders here (game is lazy).
 *   2. Mission (/?autostart&qa)    — boots the Living Province; wait for __game.debug + first frame, ignite a
 *                                     blaze, settle a few seconds so fire/smoke/ember/heat-haze/bloom/
 *                                     god-ray shaders compile + run; canvas + readable debug state.
 *   3. Component kit (/?kit)       — the shared UI kit gallery; cheap DOM-present + no-error check.
 *
 * Requires a build first (needs dist/). Run:  npm run build && npm run verify:render
 * It spawns + tears down its own `vite preview`. Built on scripts/headless.mjs (reuse it for captures).
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { launchBrowser, boot, classify, sleep } from './headless.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = 4317;
const BASE = `http://localhost:${PORT}`;

if (!existsSync(join(ROOT, 'dist', 'index.html'))) {
  console.error('verify:render — no dist/ build found. Run `npm run build` first (the render smoke needs a production build).');
  process.exit(1);
}

/** Start `vite preview` as a single killable node process (not via npx, so cleanup is clean). */
function startPreview() {
  const viteBin = join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
  const child = spawn(process.execPath, [viteBin, 'preview', '--port', String(PORT), '--strictPort'], {
    cwd: ROOT,
    stdio: 'ignore',
  });
  return child;
}

async function waitForServer(url, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      const r = await fetch(url);
      if (r.ok) return true;
    } catch {
      /* not up yet */
    }
    await sleep(300);
  }
  return false;
}

const ROUTES = [
  {
    // The bare '/' now renders the content-first FRONT DOOR (src/hub.ts), not the game. This route
    // asserts the durable thing: it BOOTS CLEAN and renders interactive content (the "Fight the fire"
    // button + hero copy). A broken import / JS error (caught by classify) or a blank/crashed page (no
    // controls, no text) fails it — without pinning copy that changes. Live-data fetch failures are
    // allowlisted in headless.mjs so the gate doesn't depend on CIFFC/CWFIS/CARTO being reachable.
    name: 'front door',
    url: `${BASE}/`,
    ready: () => document.querySelectorAll('button,[role=button]').length > 0,
    settle: 1200,
    check: async (page) => {
      const r = await page.evaluate(() => ({
        buttons: document.querySelectorAll('button,[role=button]').length,
        text: (document.body.innerText || '').replace(/\s+/g, ' ').trim().length,
      }));
      const errs = [];
      if (r.buttons === 0) errs.push('home rendered no interactive controls');
      if (r.text < 20) errs.push('home rendered no text content');
      return errs;
    },
  },
  {
    name: 'mission (autostart + scoop→drop)',
    url: `${BASE}/?autostart&qa`,
    ready: () => window.__game && window.__game.debug,
    settle: 2500, // fire keeps burning; any late program compile surfaces
    drive: async (page) => {
      // (0) Make sure the sim is THAWED. The pre-flight DISPATCH briefing now paints BEFORE the Game is
      // built (instant UI; see main.ts bootMission), and under ?qa/?autostart the boot auto-calls
      // game.begin() the instant the Game exists — so `inBriefing` is already false here and the sim
      // (fire spread, scoop/drop, spray) is running. This click is a belt-and-suspenders fallback: if the
      // auto-begin ever regresses, tapping the Fly button still dismisses the slip and thaws the sim.
      await page.evaluate(() => {
        const fly = [...document.querySelectorAll('button,[role=button]')].find((b) => /begin|fly/i.test(b.innerText || ''));
        if (fly) fly.click();
      });
      await sleep(300);

      // (a) Ignite a wall of fire ahead of the nose so the fire/smoke/ember/light/heat-haze/bloom/
      // god-ray paths actually run (not just the empty-terrain shaders) — the staging .og-shot.cjs used.
      await page.evaluate(() => {
        const g = window.__game;
        if (!g || !g.fireSystem || !g.heliSim) return;
        const p = g.heliSim.position;
        const yaw = g.heliSim.yaw || 0;
        const fx = Math.cos(yaw);
        const fz = -Math.sin(yaw);
        for (let i = -2; i <= 2; i++) g.fireSystem.igniteAt(p.x + fx * 40 + i * 14, p.z + fz * 40 + i * 4, 4);
      });
      await sleep(2500);

      // (b) SCOOP -> DROP. The WaterSpray Points sets `visible = anyAlive`, so Three never COMPILES its
      // ShaderMaterial until a real drop emits a particle — a broken spray shader would otherwise slip
      // straight past this gate. Park over the biggest lake, fill the bucket (the scoop result), then
      // commit a bambi full-dump (the same `dumping` flag a DROP tap latches) so the real updateDrop()
      // path pours spray from the bucket mouth.
      await page.evaluate(() => {
        const g = window.__game;
        if (!g) return;
        const lakes = (g.debug && g.debug.lakes) || [];
        const lake = lakes.slice().sort((a, b) => b.r - a.r)[0];
        if (lake && g.world && g.heliSim) {
          const wl = g.world.waterLevelAt(lake.x, lake.z);
          const base = wl == null ? g.world.groundHeightAt(lake.x, lake.z) : wl;
          const y = base + 7; // ~ropeLength above the surface so the slung bucket sits near the water
          g.heliSim.position.set(lake.x, y, lake.z);
          if ('altitude' in g.heliSim) g.heliSim.altitude = y; // update() rewrites position.y from altitude
          if (g.heliSim.vel && g.heliSim.vel.set) g.heliSim.vel.set(0, 0, 0);
        }
        if ('water' in g) g.water = 80; // SCOOP: bucket filled
        if ('dumping' in g) g.dumping = true; // DROP: bambi full-dump commit -> updateDrop -> spray.emit
        // Belt-and-suspenders: also emit a burst directly, so the spray shader compiles even if the drop
        // path is gated this mission (e.g. a non-water payload) — it's the same ShaderMaterial either way.
        if (g.spray && g.bucketSim) {
          const b = g.bucketSim.position;
          for (let k = 0; k < 24; k++) g.spray.emit(b.x, b.y, b.z, 0, 0);
        }
      });
      // Latch that the spray BECAME visible for at least one frame (its ShaderMaterial compiled). Under
      // slow headless swiftshader the now-running sim ages a one-shot burst out within a few frames, so
      // poll across short windows AND re-emit each tick — we only need a single visible frame, not a held
      // plume. (`visible = anyAlive` flips true the frame a live particle exists.)
      await page.evaluate(() => {
        window.__sprayShown = false;
      });
      for (let i = 0; i < 12 && !(await page.evaluate(() => window.__sprayShown)); i++) {
        await page.evaluate(() => {
          const g = window.__game;
          if (g && g.spray && g.bucketSim) {
            const b = g.bucketSim.position;
            for (let k = 0; k < 24; k++) g.spray.emit(b.x, b.y, b.z, 0, 0);
          }
          if (g && g.spray && g.spray.points.visible) window.__sprayShown = true;
        });
        await sleep(150);
      }
    },
    check: async (page) => {
      const r = await page.evaluate(() => {
        const d = window.__game && window.__game.debug;
        return {
          ok: !!d,
          fires: !!d && Array.isArray(d.fires),
          canvas: !!document.querySelector('canvas'),
          sprayShown: !!window.__sprayShown,
        };
      });
      const errs = [];
      if (!r.ok) errs.push('__game.debug unreadable');
      if (!r.canvas) errs.push('no canvas rendered');
      if (!r.fires) errs.push('__game.debug.fires is not an array');
      if (!r.sprayShown) errs.push('water-spray never rendered (scoop→drop produced no visible spray)');
      return errs;
    },
  },
  {
    name: 'component kit (?kit)',
    url: `${BASE}/?kit`,
    ready: () => document.body && document.body.children.length > 0,
    settle: 1000,
    check: async (page) => {
      const ok = await page.evaluate(
        () => document.querySelectorAll('button,[role=button]').length > 0 || (document.body.textContent || '').length > 40,
      );
      return ok ? [] : ['the kit gallery rendered no content'];
    },
  },
];

let pass = 0;
let fail = 0;
const failures = [];

const server = startPreview();
let browser;
try {
  const up = await waitForServer(`${BASE}/`, 30000);
  if (!up) {
    console.error('verify:render — vite preview did not come up on ' + BASE);
    process.exit(1);
  }
  browser = await launchBrowser();

  console.log('Live render / shader smoke\n');
  for (const route of ROUTES) {
    const { ctx, page, messages } = await boot(browser, { url: route.url, ready: route.ready });
    if (route.drive) await route.drive(page);
    await sleep(route.settle || 1500);
    const domErrs = route.check ? await route.check(page) : [];
    const { shader, errors } = classify(messages);
    await ctx.close();

    const routeFails = [...shader.map((s) => 'SHADER: ' + s), ...errors.map((e) => 'ERROR: ' + e), ...domErrs.map((d) => 'DOM: ' + d)];
    if (routeFails.length === 0) {
      pass++;
      console.log(`  ✓ ${route.name}`);
    } else {
      fail++;
      console.log(`  ✗ ${route.name}`);
      for (const f of routeFails.slice(0, 8)) {
        failures.push(`${route.name} — ${f}`);
        console.log('      ' + f);
      }
    }
  }
} finally {
  if (browser) await browser.close().catch(() => {});
  server.kill();
}

console.log(`\n${pass} route(s) clean, ${fail} with errors`);
if (fail > 0) {
  console.log('\nA shader/boot/UI regression would ship to prod on the next push. Failures:');
  for (const f of failures) console.log('  ✗ ' + f);
  process.exit(1);
}
