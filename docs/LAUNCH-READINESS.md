# Launch-Readiness Spec — bucketmyfire at scale

> Audit date: 2026-06-03. Status: **deferred / not yet implemented.**
> Goal: be able to serve thousands → millions of users on launch.

## The reframe (read this first)

bucketmyfire is a **100% static, client-side game**: no backend, no database, no API,
no auth, no sessions, no per-user server compute. The whole deployable is
`index.html` + one hashed JS bundle + one mp3 + one GLB.

So **"handle millions of users" is not a server-scaling problem here.** There is
nothing stateful to overload, shard, or rate-limit. Scaling reduces to:

1. **Static file delivery** — a CDN problem, trivially horizontal.
2. **Per-device runtime performance** — already engineered (O(1) frames, pooling,
   adaptive `QualityTier`, no post-load shader recompiles). Not a concern.
3. **Cost + operational visibility** — where the real gaps are.

**Verdict:** architecture is already correct for mass scale. The work below is
*launch-readiness*, not capacity. We can serve a million users; today we can't *see*
them or fail gracefully on the long tail of weird devices.

## Measured payload (from `vite build`, 2026-06-03)

| Asset | Size | Hot path? |
|---|---|---|
| `index.html` | 1.48 kB | yes |
| `index-*.js` (Three.js) | 753 kB raw / **203 kB gzip** | yes |
| `helicopter-loop-*.mp3` | 136 kB | after first gesture |
| `public/models/uh1/huey-opt.glb` | **1.9 MB** | yes (async, non-blocking) |
| `index-*.js.map` | **3.68 MB** | only if devtools open |

Cold first-load ≈ **2.2 MB/new user**; returning users ≈ 0 (hashed immutable assets +
browser cache). 1M cold loads ≈ 2.2 TB egress → ~$0 on Cloudflare, ~$110–190 metered.
**Cost is a non-issue.**

---

## P0 — Operational blindness (the real risk at a million users)

### P0.1 — Add field telemetry (analytics + error/crash beacon)
- **Problem:** zero field telemetry. Only `window.__game` debug hook
  (`src/three/main.ts:32`) exists and it reports nothing. We won't know crash rate,
  WebGL-context-lost rate, % of users on the low quality tier, FPS distribution,
  device/browser mix, or GLB load-failure rate.
- **Do:** lightweight, privacy-light analytics + an error/crash beacon. Minimum fields
  to report once per session: chosen `tier`, `webgl ok?`, `glb loaded? (real vs
  procedural fallback)`, fatal/uncaught errors, rough device class.
- **Why it's P0:** without this we launch blind — can't tell a 2% crash rate from a 40%
  one.

### P0.2 — WebGL capability check + context-loss handling
- **Problem:** `src/three/main.ts:14` constructs `WebGLRenderer` unconditionally. Devices
  with WebGL disabled/blocked, or that hit `webglcontextlost` under mobile memory
  pressure, currently get a **silent blank screen**. Across millions of devices this is a
  non-trivial fraction.
- **Do:**
  - Pre-flight WebGL availability check → friendly "device not supported" message instead
    of a blank canvas.
  - `canvas.addEventListener('webglcontextlost', …)` / `'webglcontextrestored'` to
    pause + recover (or show a "tap to resume" prompt) instead of dying.

---

## P1 — Delivery config (currently absent from the repo)

### P1.1 — Commit a CDN cache-header strategy
- **Problem:** no `_headers` / `vercel.json` / equivalent. `base: './'`
  (`vite.config.ts:6`) makes paths host-independent (good), but caching is unconfigured.
- **Do (host-specific file):**
  - Hashed assets (`index-*.js`, `*-*.mp3`): `Cache-Control: public, max-age=31536000, immutable`
  - `index.html`: `no-cache` (so new deploys propagate instantly)
  - Verify the host actually serves **brotli/gzip** on the JS (203 kB gzip vs 753 kB raw).
- **Blocked on:** which host? (Cloudflare Pages / Netlify / Vercel / other) — pick before
  writing the config file.

### P1.2 — Handle the unhashed 1.9 MB GLB
- **Problem:** `src/three/meshes/hueyModel.ts:25` loads a fixed-name
  `models/uh1/huey-opt.glb`, bypassing Vite content-hashing. It's the dominant per-user
  byte cost.
- **Do:**
  - Set long-lived cache headers on it explicitly (it won't get the immutable treatment
    automatically).
  - On model update, bump a version in the path/filename or users get a stale cache.
  - Consider **Draco or meshopt** compression to shave it further.
- **Note:** loading is already async with a procedural fallback shown immediately
  (`hueyModel.ts:34-119`), so it never blocks first paint. Good as-is on that axis.

### P1.3 — Stop shipping the source map to prod
- **Problem:** `sourcemap: true` (`vite.config.ts:13`) emits a **3.68 MB** map — larger
  than the rest of the app — and publishes full source. Only fetched with devtools open,
  so not in the user hot path, but wasted storage + source exposure for a public launch.
- **Do:** `sourcemap: false`, or `'hidden'` + upload to the error tracker from P0.1.

---

## P2 — Minor / cleanup

- **P2.1** — Debug hook always on in prod: gate `window.__game` (`src/three/main.ts:32`)
  behind `import.meta.env.DEV`.
- **P2.2** — ✅ RESOLVED (2026-06-03). Render DPR is now an adaptive, recoverable lever in
  `QualityTier` (scales within `[QUALITY.dpr.floor .. 2]`, down under load / up under headroom),
  and MSAA is tied to the tier — the composer target carries `samples` on high
  (`QUALITY.presets.high.msaa`), while low (no composer) AAs via the renderer's own `antialias`.
  Lowest-end devices no longer eat MSAA cost.
- **P2.3** — ✅ RESOLVED. The legacy Phaser tree (`src/main.ts`, `src/scenes/`, `src/objects/`,
  `src/controls/`, `src/constants.ts`) and two orphaned early-3D files (`src/three/Fire.ts`,
  `src/three/meshes/hueyModel.ts`) were deleted, and the `phaser` dependency dropped — so tsc
  no longer type-checks ~1.3k dead lines. (`@dimforge/rapier3d-compat` is NOT stray — it's a
  transitive dependency of `@types/three`, so it correctly stays.)
- **P2.4** — ✅ RESOLVED. `vite.config.ts` no longer mentions Phaser.

---

## Suggested first PR (small, high-leverage)

1. WebGL availability + context-loss guard in `src/three/main.ts` (P0.2)
2. `sourcemap: false` + DEV-gate the `window.__game` hook (P1.3, P2.1)
3. Host cache-headers file (P1.1) — **needs host decision first**

Telemetry (P0.1) is the highest-value item but a larger decision (which provider,
privacy posture) — scope it as its own PR.
