/*
 * Reusable headless-browser harness — the committed replacement for the long-lost `scripts/shot.mjs`.
 * GLSL shaders compile only at runtime, so `tsc`/`vite build`/`verify:campaign` all pass a broken
 * shader; the only way to catch it is to boot the real game in a real WebGL context and watch the
 * console. This wraps Playwright (devDependency) + software WebGL (swiftshader/ANGLE) so any script can
 * launch the game, collect console/page errors, and screenshot.
 *
 * `verify:render` (scripts/verify-render.mjs) is the boot/shader smoke gate built on this; reuse `boot`
 * + `screenshot` for one-off captures too. The game exposes `window.__game` only when `?qa` (or DEV)
 * is present (see src/three/main.ts), so QA/headless URLs must carry `?qa`.
 */
import { chromium } from 'playwright';

// Software-WebGL flags proven in .og-shot.cjs — swiftshader gives a real GL context with no GPU, so
// shaders genuinely compile (the whole point) on a headless CI box.
export const GL_ARGS = [
  '--no-sandbox',
  '--use-angle=swiftshader',
  '--use-gl=angle',
  '--ignore-gpu-blocklist',
  '--enable-unsafe-swiftshader',
];

export async function launchBrowser() {
  return chromium.launch({ headless: true, args: GL_ARGS });
}

// Shader/GL compile-link failures — ALWAYS fatal (this is the class verify:campaign can't see).
const SHADER_RE = /THREE\.WebGLProgram|Shader Error|shader.*(compile|link)|GL_INVALID|WebGL:? INVALID|VALIDATE_STATUS|gl\.getProgramInfoLog|program info log/i;
// Benign console noise in a local preview (no edge analytics, no Supabase env, favicons may 404).
const BENIGN_RE = /favicon|og-image|apple-touch|manifest\.json|site\.webmanifest|cloudflareinsights|supabase|leaderboard|robots\.txt/i;

/** Split collected console/page messages into fatal shader errors vs. other (non-benign) errors. */
export function classify(messages) {
  const shader = messages.filter((m) => SHADER_RE.test(m));
  const errors = messages.filter((m) => !SHADER_RE.test(m) && !BENIGN_RE.test(m));
  return { shader, errors };
}

/**
 * Open a page, wire up error capture, navigate, and wait for `ready` (a function evaluated in the page).
 * Returns the page + the live `messages` array (console errors + pageerrors + crash), which keeps
 * filling after this resolves — read it AFTER any settle/drive so late shader compiles are caught.
 */
export async function boot(browser, { url, viewport = { width: 1280, height: 720 }, ready, timeout = 60000 }) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const messages = [];
  page.on('console', (m) => {
    if (m.type() === 'error') messages.push(m.text().slice(0, 300));
  });
  page.on('pageerror', (e) => messages.push('PAGEERROR ' + String((e && e.stack) || e).slice(0, 300)));
  page.on('crash', () => messages.push('PAGE CRASH'));
  try {
    await page.goto(url, { waitUntil: 'load', timeout });
    if (ready) await page.waitForFunction(ready, { timeout });
  } catch (e) {
    messages.push('BOOT TIMEOUT/ERROR: ' + String(e).slice(0, 200));
  }
  return { ctx, page, messages };
}

/** Capture a JPEG (resurrects the shot.mjs convenience). */
export async function screenshot(page, path, opts = {}) {
  await page.screenshot({ path, type: 'jpeg', quality: 84, ...opts });
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
