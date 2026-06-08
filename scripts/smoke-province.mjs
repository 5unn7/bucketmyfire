/*
 * One-off live smoke for the Living Province (?province). The pure-Node gate (verify:province) proves the
 * dispatch logic; this confirms the LIVE wiring: that booting ?province in a real WebGL context runs the
 * DispatchDirector → Game's action switch (igniteFromPlacement / pushComms) without throwing, past the
 * first dispatch call. Spawns its own vite preview (needs a `dist/` build). Run: node scripts/smoke-province.mjs
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { launchBrowser, boot, classify, sleep, screenshot } from './headless.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = 4318;
const BASE = `http://localhost:${PORT}`;

if (!existsSync(join(ROOT, 'dist', 'index.html'))) {
  console.error('smoke-province — no dist/ build. Run `npm run build` first.');
  process.exit(1);
}

function startPreview() {
  const viteBin = join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
  return spawn(process.execPath, [viteBin, 'preview', '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: 'ignore' });
}
async function waitForServer(url, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      const r = await fetch(url);
      if (r.ok) return true;
    } catch {
      /* not up */
    }
    await sleep(300);
  }
  return false;
}

const server = startPreview();
let browser;
let fail = 0;
try {
  if (!(await waitForServer(`${BASE}/`, 30000))) {
    console.error('smoke-province — vite preview did not come up');
    process.exit(1);
  }
  browser = await launchBrowser();
  const { ctx, page, messages } = await boot(browser, { url: `${BASE}/?province&autostart&qa`, ready: () => window.__game && window.__game.debug });

  // Belt-and-suspenders thaw: dismiss the pre-flight slip + call begin() so the shift clock advances.
  await page.evaluate(() => {
    const fly = [...document.querySelectorAll('button,[role=button]')].find((b) => /begin|fly/i.test(b.innerText || ''));
    if (fly) fly.click();
    if (window.__game && window.__game.begin) window.__game.begin();
  });
  await sleep(2000);

  // Headless tabs throttle requestAnimationFrame, so the per-frame-dt-clamped shift clock crawls and
  // never reaches the dispatch thresholds in a reasonable settle. Poke the clock deep into the shift so
  // the NEXT frame's stepProvince catches the director up — emitting many calls (incl. town-threats at
  // higher fire-weather) through Game's REAL action switch (igniteFromPlacement + pushComms). Exercises
  // the live wiring + populates a threatened town for the radar ring + shift panel.
  await page.evaluate(() => {
    if (window.__game) window.__game.missionElapsed = 220; // mid/high FWI → town-threat calls likely, lighter spike
  });
  await sleep(7000); // a few throttled frames → stepProvince runs the catch-up at the poked clock

  const r = await page.evaluate(() => {
    const g = window.__game;
    const d = g && g.debug;
    const p = g && g.province;
    const pins = p && p.townPins ? p.townPins([]) : [];
    const text = (document.body.innerText || '').replace(/\s+/g, ' ');
    return {
      hasGame: !!g,
      hasCanvas: !!document.querySelector('canvas'),
      firesArray: !!d && Array.isArray(d.fires),
      living: !!p,
      activeCalls: p && p.activeCalls ? p.activeCalls.length : -1,
      reputation: p ? p.reputation : -1,
      elapsed: g ? g.missionElapsed : -1,
      townPins: pins.length,
      threatened: pins.filter((q) => q.status === 'threatened').length,
      shiftPanel: /Province/.test(text) && /Reputation/.test(text), // the SHIFT readout replaced the objective checklist
    };
  });
  let shot = false;
  try {
    await screenshot(page, join(ROOT, 'scripts', '.province-shot.jpg'), { timeout: 8000, animations: 'disabled' });
    shot = true;
  } catch {
    /* best-effort capture; the DOM/state checks are the real verification */
  }
  const { shader, errors } = classify(messages);
  await ctx.close();

  console.log('Living Province live smoke (?province&qa)\n');
  const checks = [
    ['game + canvas booted', r.hasGame && r.hasCanvas],
    ['ProvinceMode wired (mission.living)', r.living],
    ['debug.fires is an array', r.firesArray],
    ['dispatch fired ≥1 call through the action switch', r.activeCalls >= 1],
    ['town-status pins fed to the radar', r.townPins >= 1],
    ['a town reads threatened (town-threat call landed)', r.threatened >= 1],
    ['SHIFT panel rendered (replaces the objective checklist)', r.shiftPanel],
    ['no shader errors', shader.length === 0],
    ['no page/console errors', errors.length === 0],
  ];
  for (const [name, ok] of checks) {
    console.log(`  ${ok ? '✓' : '✗'} ${name}`);
    if (!ok) fail++;
  }
  console.log(`\n  activeCalls=${r.activeCalls} reputation=${r.reputation} townPins=${r.townPins} threatened=${r.threatened} elapsed=${r.elapsed}`);
  console.log(shot ? '  screenshot → scripts/.province-shot.jpg' : '  (screenshot skipped — capture timed out under the catch-up load spike; not a failure)');
  if (shader.length) for (const s of shader.slice(0, 5)) console.log('  SHADER: ' + s);
  if (errors.length) for (const e of errors.slice(0, 8)) console.log('  ERROR: ' + e);
} finally {
  if (browser) await browser.close().catch(() => {});
  server.kill();
}
process.exit(fail ? 1 : 0);
