#!/usr/bin/env node
// Meshy.ai image → 3D asset pipeline (local tooling, zero-dep Node 18+).
//
//   node scripts/meshy.mjs balance                         # check remaining credits (free)
//   node scripts/meshy.mjs gen <image> [more images...]    # image(s) → GLB (spends credits)
//        --name <slug>          output folder name (default: image filename)
//        --no-texture           geometry only (cheaper)
//        --pbr                  also generate PBR maps (metallic/roughness/normal)
//        --topology quad        quad remesh (default: triangle)
//        --polycount <n>        target polycount (default: 30000)
//        --symmetry on|off|auto (default: auto)
//   node scripts/meshy.mjs status <task-id>                # re-check / re-download a task
//
// Output lands in model-src/meshy/<name>/ (gitignored raw masters — same policy as the
// other downloaded model sources). To SHIP one, optimize it and place it under
// public/models/ with an ATTRIBUTION.txt, behind a procedural fallback (see bmf-asset).
//
// Reads MESHY_API_KEY from the environment or from .env at the repo root.
// The key must never reach the client bundle — no VITE_ prefix, no imports from src/.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, basename, extname, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const API = 'https://api.meshy.ai/openapi/v1';
const OUT_ROOT = join(ROOT, 'model-src', 'meshy');
const POLL_MS = 10_000;
const TIMEOUT_MS = 20 * 60_000;

const MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

function apiKey() {
  if (process.env.MESHY_API_KEY) return process.env.MESHY_API_KEY;
  const envFile = join(ROOT, '.env');
  if (existsSync(envFile)) {
    const m = readFileSync(envFile, 'utf8').match(/^MESHY_API_KEY=(.+)$/m);
    if (m) return m[1].trim();
  }
  fail('MESHY_API_KEY not set (env var or .env at the repo root).');
}

function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

async function meshy(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Meshy ${method} ${path} → HTTP ${res.status}: ${text.slice(0, 400)}`);
  return JSON.parse(text);
}

function imageToDataUri(file) {
  const path = resolve(file);
  if (!existsSync(path)) fail(`image not found: ${file}`);
  const mime = MIME[extname(path).toLowerCase()];
  if (!mime) fail(`unsupported image type "${extname(path)}" (png/jpg/jpeg/webp)`);
  return `data:${mime};base64,${readFileSync(path).toString('base64')}`;
}

async function download(url, dest) {
  const res = await fetch(url);
  if (!res.ok) fail(`download failed (${res.status}): ${url}`);
  writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
  console.log(`  ↓ ${dest.replace(ROOT, '').replace(/\\/g, '/')}`);
}

async function pollTask(endpoint, id) {
  const start = Date.now();
  let lastProgress = -1;
  for (;;) {
    const task = await meshy('GET', `${endpoint}/${id}`);
    if (task.status === 'SUCCEEDED') return task;
    if (task.status === 'FAILED' || task.status === 'CANCELED') {
      fail(`task ${id} ${task.status}: ${task.task_error?.message ?? 'no error message'}`);
    }
    if (task.progress !== lastProgress) {
      console.log(`  … ${task.status} ${task.progress ?? 0}%`);
      lastProgress = task.progress;
    }
    if (Date.now() - start > TIMEOUT_MS) {
      fail(`timed out after ${TIMEOUT_MS / 60000} min — resume later with: node scripts/meshy.mjs status ${id}`);
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

async function saveResult(task, name) {
  const dir = join(OUT_ROOT, name);
  mkdirSync(dir, { recursive: true });
  if (task.model_urls?.glb) await download(task.model_urls.glb, join(dir, `${name}.glb`));
  if (task.thumbnail_url) await download(task.thumbnail_url, join(dir, 'thumbnail.png'));
  for (const [i, tex] of (task.texture_urls ?? []).entries()) {
    for (const [kind, url] of Object.entries(tex)) {
      if (url) await download(url, join(dir, `tex${i}-${kind}.png`));
    }
  }
  writeFileSync(join(dir, 'task.json'), JSON.stringify(task, null, 2));
  console.log(`✓ ${name} → ${dir.replace(ROOT, '').replace(/\\/g, '/')}`);
  console.log('  (raw master — to ship it, optimize + credit it under public/models/, see bmf-asset)');
}

function arg(flags, name, fallback) {
  const i = flags.indexOf(`--${name}`);
  return i >= 0 ? flags[i + 1] : fallback;
}

const [cmd, ...rest] = process.argv.slice(2);

try {
if (cmd === 'balance') {
  const { balance } = await meshy('GET', '/balance');
  console.log(`✓ Meshy key OK — ${balance} credits remaining`);
} else if (cmd === 'gen') {
  const images = rest.filter((a, i) => !a.startsWith('--') && !rest[i - 1]?.startsWith('--'));
  if (!images.length) fail('usage: node scripts/meshy.mjs gen <image.png> [--name slug] [--pbr] [--no-texture]');
  const name = (arg(rest, 'name') ?? basename(images[0], extname(images[0])))
    .toLowerCase().replace(/[^a-z0-9-]+/g, '-');
  const multi = images.length > 1;
  const payload = {
    ...(multi
      ? { image_urls: images.map(imageToDataUri) }
      : { image_url: imageToDataUri(images[0]) }),
    ai_model: 'meshy-5',
    topology: arg(rest, 'topology', 'triangle'),
    target_polycount: Number(arg(rest, 'polycount', '30000')),
    should_remesh: true,
    should_texture: !rest.includes('--no-texture'),
    enable_pbr: rest.includes('--pbr'),
    symmetry_mode: arg(rest, 'symmetry', 'auto'),
  };
  const endpoint = multi ? '/multi-image-to-3d' : '/image-to-3d';
  const { result: id } = await meshy('POST', endpoint, payload);
  console.log(`task ${id} created (${multi ? images.length + ' images' : basename(images[0])}) — polling…`);
  const task = await pollTask(endpoint, id);
  await saveResult(task, name);
} else if (cmd === 'status') {
  const id = rest[0];
  if (!id) fail('usage: node scripts/meshy.mjs status <task-id>');
  // task ids are unique across endpoints; try single-image first, then multi.
  let task;
  try {
    task = await meshy('GET', `/image-to-3d/${id}`);
  } catch {
    task = await meshy('GET', `/multi-image-to-3d/${id}`);
  }
  console.log(`task ${id}: ${task.status} ${task.progress ?? 0}%`);
  if (task.status === 'SUCCEEDED') await saveResult(task, arg(rest, 'name', id));
} else {
  fail('usage: node scripts/meshy.mjs <balance | gen <image…> | status <task-id>>');
}
} catch (err) {
  fail(err instanceof Error ? err.message : String(err));
}
