# Audit P1/P2 resolution — handoff (2026-06-05)

All P1 and P2 items from `docs/AUDIT-2026-06-05.md` are resolved in code, **except three pieces that
are yours to action** (a repo secret, a binary-asset command, and one deferred sweep). This file is
the turn-key list for those, plus the full record of what changed.

Everything below was done **additively, on `main`, uncommitted** — your crash/freeform-lake WIP and
the 17 unpushed commits are untouched. Stage these separately from your WIP when you're ready.

---

## 1. Set the error-beacon secret (VISION-4) — 1 command, ~30s

The beacon code is already wired (`src/three/telemetry/errorBeacon.ts`), `deploy.yml` already passes
the secret at build (line 57), and the Supabase **`report-error` edge function is deployed and ACTIVE**
(verified via MCP, `verify_jwt` off so the anonymous beacon can POST). The ONLY missing thing is the
GitHub repo secret. Set it and the next push bakes the endpoint into the bundle:

```bash
gh secret set VITE_ERROR_BEACON_URL \
  --body "https://wnorrtfkfqrgipmggfwh.supabase.co/functions/v1/report-error"
```

(Or GitHub → Settings → Secrets and variables → Actions → New repository secret, same name + value.)
After the next deploy, uncaught errors + unhandled rejections POST a small PII-free record. Confirm by
opening the live site, forcing an error, and checking the Supabase function logs.

## 2. Compress the heavy GLBs (PERF-3) — run locally, eyeball, then replace

The code now **tier-gates** the 4.5 MB animal GLB (low-end devices skip the download entirely and get
procedural fauna — `Fauna.ts` + `meshes/animalPack.ts`). To also shrink it for mid/high tiers, run
meshopt/Draco against the licensed binary **locally** (not auto-run — it's a licensed asset that wants
a visual check):

```bash
# meshopt (recommended — fast decode, good ratio). ~4.5 MB -> ~1.5-2.5 MB typical.
npx -y @gltf-transform/cli optimize public/animals/animals-opt.glb public/animals/animals-opt.glb \
  --compress meshopt --texture-compress webp
# do the same for the 1.95 MB Huey:
npx -y @gltf-transform/cli optimize public/models/uh1/huey-opt.glb public/models/uh1/huey-opt.glb \
  --compress meshopt --texture-compress webp
```

Then load the game and confirm the animals/heli still look right (node names must survive — `extract()`
in `animalPack.ts` looks them up by name). If meshopt decode ever misbehaves on a target device, drop
`--compress meshopt` and keep just the webp texture pass.

## 3. Two small wirings deferred to avoid colliding with your HUD WIP

Both touch `HUD.ts` / the home-screen redesign, which you're actively editing. The capability is in
place; these are one-liners to finish when that WIP settles (or let `/design-review` do the DS one):

- **GTM-3 share-card region.** `shareCard.ts` now accepts an optional `region` and defaults to
  `'northern Saskatchewan'` (correct for SK, wrong for AB/BC/ON). To drive it from the active map, pass
  `region` in `HUD.shareRun`'s `shareScoreCard({ ... })` call (HUD.ts ~line 1119) from the running
  mission's region/`map`. Until then the SK default holds.
- **DS-2..DS-6 token sweep.** The token **foundation is done** (`theme.ts` now has `accentHi`,
  `caution`, `friendly`, `textCool`, `ink`, `recess`, and a `GRADE` map). The remaining work is
  replacing the ~30 hard-coded cyan/gradient/off-scale-font literals with these tokens across 12 files
  (10 of them in your WIP'd `HUD.ts`, 21 in `HelpModal.ts`). Run **`/design-review`** once the HUD
  redesign settles — a full sweep in one pass beats a partial one that fragments the system. The new
  tokens to map onto: cyan **body text** → `textCool` (not `accent`, which is interactive-only); the
  5 duplicated CTA gradients → one shared definition; `HelpModal` off-scale px → the `FS` scale; radar
  blip types → a per-type **colorblind glyph/shape** in `HUD.ts` (DS-6, the accessibility one).

---

## What shipped in code (all verified)

Gates after the changes: **lint 0**, **`npm run verify:crash` 21/21**, **`npm run verify:campaign`
102/102 + 30/30 daily**. (`npm run build`/`tsc` is red **only** on your in-flight crash refactor —
`hullHitCd`→`airframeHitCd` rename + a new `'airframe'` `crashCause` — not on any audited fix.)

| Item | What changed | Files |
|---|---|---|
| CQ-1 | AudioContext construction guarded → silent no-op instead of a blank screen on long-tail WebViews | `audio/HeliAudio.ts` |
| CQ-2 | New pure-sim crash/explosion verifier (21 assertions) + `npm run verify:crash` | `scripts/verify-crash.ts`, `package.json`, `.gitignore` |
| VISION-3 | Local consecutive-UTC-day **streak** (idempotent per day), shown on the menu button + the share card + share text | `missions/streak.ts` (new), `Game.ts` (1-line hook), `ui/shareCard.ts`, `ui/flow/MenuFlow.ts`, `HUD.ts` |
| VISION-4 | Confirmed beacon wired + edge fn live; only the repo secret remains (§1) | (no code) |
| CICD-1 | All 3 GitHub Actions pinned to commit SHAs + Dependabot for actions | `.github/workflows/deploy.yml`, `.github/dependabot.yml` (new) |
| PERF-1 | Pooled fire-radar buffer + cached lake-radar → no per-frame HUD-payload alloc for the radar | `Game.ts` |
| PERF-2 | SMOKE emission budgeted to the pool → kills the mid-distance teleport pops | `vfx/SmokePlume.ts` |
| PERF-3 | 4.5 MB animal GLB tier-gated off low-end devices (procedural fallback) | `Fauna.ts`, `meshes/animalPack.ts`, `render/QualityTier.ts` |
| GTM-3 | Share card accepts an active-region label (capability; wiring in §3) | `ui/shareCard.ts` |
| DS-1 | Token foundation: `accentHi`/`caution`/`friendly`/`textCool`/`ink`/`recess` + `GRADE` map | `ui/theme.ts` |
