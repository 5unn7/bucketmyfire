# bucketmyfire — Production-Readiness Code Audit

> Multi-agent audit across 8 dimensions (architecture, performance, security, gameplay,
> rendering, build/CI/test, UX/onboarding, legal/IP). Every high/critical finding was
> adversarially re-verified against the source; a completeness critic swept for gaps.
> Severities reflect the verifier's adjudication. Judged against a **commercial** bar.

## Executive summary

**Overall health: 6.5 / 10** (against a *commercial* bar, not a hobby one).

This is genuinely impressive solo engineering. The architecture holds invariants most teams only aspire to — the `sim/` engine-agnostic boundary is real and enforced across all 9 modules, the `World` heightfield keystone is a clean pure-math single source of truth, dead-code hygiene is near-perfect, and the flight/bucket/fire physics actually *feel* the way the design promises because they're architecturally correct, not faked. The security posture (RLS-locked tables, client-side email hashing, no XSS surface, anon-key-only) is more disciplined than most funded startups ship with. If the bar were "is this good code," the answer is an emphatic yes.

But the brief is **"turn this into a business,"** and against that bar the gaps are structural, not cosmetic:

**The 3-5 things that are genuinely excellent**
1. **The sim/visual boundary is real.** All 9 `sim/` modules import only Three's math + `config.ts` — no `Scene`, no DOM. This makes the physics Node-testable and swappable, and it's the single most valuable asset in the codebase.
2. **Physics feel is correct, not faked.** A real momentum integrator (`HelicopterSim.ts:169-247`) with payload coupling, plus a spring-damped slung-bucket pendulum that misses when swung — this is the differentiated, screenshot-worthy hook.
3. **Fire is an honest skill test.** The cellular fire field never self-extinguishes (`FireSystem.ts:265-273`); every win is earned with player water. Strong core loop.
4. **Security/privacy *engineering* is careful.** RLS-locked `cloud_saves`/`client_errors`, SECURITY DEFINER RPCs, client-side email hashing, PII-free telemetry, anon-key-only in the bundle.
5. **Asset licensing for the game is clean.** All four downloaded 3D models are commercial-OK and credited both on disk and in an in-game CREDITS footer.

**The 3-5 things that most threaten making this a business**
1. **There is no retention loop.** 6 finite missions, strictly linear unlock, no endless/daily/freeplay/sandbox mode anywhere in the code (`catalog.ts`, `progress.ts:111`, `main.ts:59`). The game is fully exhausted in ~30-90 minutes with zero reason to return tomorrow — fatal for a free-to-play funnel and the merch revenue downstream of it.
2. **There is no business.** Zero commerce infrastructure exists — no merch link-out, no store, no payment/POD/ad code anywhere (grep-confirmed). The named revenue model is entirely unbuilt.
3. **Legal/privacy blocks monetization today.** No privacy policy or terms exist anywhere, despite collecting email + user-agent + a public handle. Ad networks, app stores, and payment processors all *require* a linked privacy policy before onboarding.
4. **A cloud-save account-takeover/grief vector** is wide open: saves are an UPSERT keyed only on (public callsign + email), no password, no rate-limit — anyone with a player's email can overwrite their progress.
5. **No safety net for a live product.** Lint is a phantom command (never configured), CI auto-deploys `main` straight to prod with no smoke gate and a force-pushed gh-pages branch with **no rollback target**, and the only automated test covers ~8 sim files — flight, shaders, UI, leaderboard, and cloud-save have zero coverage.

The verdict: the *game engine* is ~8/10. The *business* is ~3/10 because the retention, monetization, legal, and operational layers that turn a great toy into a company are missing or unguarded.

---

## Severity scoreboard

| Dimension | Score | #Critical | #High | One-line verdict |
|---|---|---|---|---|
| Gameplay & Design | 5.5 | 1 | 2 | Excellent core loop, but no retention engine — the #1 commercial risk. |
| Build / CI / Test | 5.5 | 0 | 3 | Solid build gate; phantom lint, unguarded auto-deploy, no rollback, sim-only tests. |
| Performance | 6.5 | 0 | 0 | Strong invariants; per-frame glue allocates and smoke pool over-subscribes. |
| UX & Onboarding | 6.5 | 0 | 2 | Great in-flight UX; cold-load is a blank void and a callsign wall gates first-fun. |
| Legal / IP / Business | 6.5 | 0 | 2 | Clean game assets; no privacy policy, unprovable audio license, no business layer. |
| Rendering & Art | 7.0 | 0 | 0 | Good pipeline; low-tier silently drops the cinematic look; transparent overdraw risk. |
| Security & Privacy | 7.5 | 0 | 1 | Disciplined; missing privacy policy + a cloud-save takeover vector + spoofable board. |
| Architecture | 7.0 | 0 | 1 | Unusually disciplined; concentration risk in `Game.ts`/`HUD.ts`/`config.ts` + bus-factor. |

---

## Critical & high findings

Ranked by business impact. Severities reflect the verifier's adjudication (adjusted where noted).

### 1. No retention loop — 6 finite missions, then the game is over `[CRITICAL]`
**Dimension:** Gameplay · **Verified real, severity confirmed critical**
**Evidence:** `missions/catalog.ts` defines exactly 6 `MissionDef`s (lines 27-298). `progress.ts:111` `isUnlocked()` is strictly linear (finish *k* → unlock *k+1*) with no loop-back, prestige, or repeatable content. `main.ts:59` `routeMission()` only ever boots a fixed `?m=<id>` campaign mission. A repo-wide grep for `endless|sandbox|freeplay|daily|survival|ghost|procedural mode` finds only incidental matches — no endless mode, no daily challenge, no freeplay. The UH-60 unlocks at sortie 4 (`profile.ts:144`), *before* the campaign ends, so every unlock is exhausted within the run.
**Impact:** A free-to-play game lives or dies on D1/D7 return rate. This game has no mechanical reason to launch a second day, and merch/POD revenue is entirely downstream of an engaged returning audience. The excellent physics and fire sim are wasted as retention assets because nothing re-exposes them after the campaign.
**Fix:** Ship an **Endless/Freeplay** mode that reuses 100% of existing systems — nearly free given the architecture. The `World` is deterministic from `WORLD3D.seed`, `FireSystem.spawnInitial` already does seeded placement (`FireSystem.ts:193`), and the scorer is pure. A **"Daily Burn"** = today's date as the seed + a fixed objective + the existing leaderboard scoped to that seed gives an instant daily-return hook and a shareable global ranking. **Effort: large** (but data + routing on shipped sims, not new engine code).

### 2. No privacy policy or terms of service — blocks monetization `[HIGH]`
**Dimension:** Legal + Security (flagged by both) · **Verified real, severity confirmed high**
**Evidence:** Glob for `**/{PRIVACY,TERMS,EULA}*` returns nothing; grep for `privacy|gdpr|consent` across `.ts/.html/.md` finds only code comments + `docs/LAUNCH-READINESS.md`. Meanwhile `ScreenIdentity.ts:96-115` collects an optional email and `:111` makes a privacy *claim* ("email is hashed… never shared"), `schema.sql:201` stores `navigator.userAgent` in `client_errors`, and the callsign is published worldwide on the board. No policy document and no menu link to one exists anywhere.
**Impact:** Email + UA are personal data under PIPEDA (the game's own setting), GDPR (EU players via a public `.com`), and CCPA. AdSense, app stores, and payment/POD processors *require* a linked privacy policy URL before onboarding — so the moment money is involved, this is a hard blocker. The data practices are already good; they just need disclosure.
**Fix:** Add static `/privacy.html` + `/terms.html` (linked from the identity gate, cloud-save modal, and CREDITS footer) stating what's collected (hashed email, callsign — public, anonymized UA/error data), why, retention, a deletion contact, and lawful basis. Add a one-line consent affirmation near the email field. **Effort: small.**

### 3. Cloud-save account takeover / grief vector `[HIGH]`
**Dimension:** Security (surfaced by completeness critic — missed by the security pass) · **High**
**Evidence:** `supabase/schema.sql:155-163` `save_cloud_progress` is an UPSERT keyed only on `(email_hash, lower(pilot))`; `cloudSave.ts:135` `saveToCloud` drives it. Pilot callsigns are **public** on the leaderboard (`leaderboard/client.ts`), so the email is the *only* secret protecting an account — with no password, no rate-limit, and no audit trail. The schema comment (lines 110-112) acknowledges this but treats it as accepted.
**Impact:** Anyone who learns a player's email + sees their public callsign can silently **overwrite their entire cloud save** (or read it via `load_cloud_progress`). Once players invest hours and the product monetizes, this is a real takeover/grief surface with no recovery path.
**Fix:** Move the email hash server-side behind the existing RPC using a server-only HMAC secret (Supabase Vault), so the email hash can't be reconstructed client-side; add a magic-link verify step for the save path; rate-limit per client_id/day. **Effort: medium.**

### 4. `npm run lint` is completely broken — ESLint config never committed `[HIGH]`
**Dimension:** Build/CI/Test · **Verified real, high**
**Evidence:** `package.json:13` advertises `"lint": "eslint \"src/**/*.ts\""`; running it errors with *"ESLint couldn't find a configuration file"* (ESLint 8.57.1). No `.eslintrc*`/`eslint.config.*` exists at repo root, none is tracked, and `git log --all` for those paths returns nothing — the config never existed. `@typescript-eslint/*` are installed but unusable. *(Correction to the original finding: `npm run format`/prettier does **not** hard-error — it runs on built-in defaults; the lint breakage is the real issue.)*
**Impact:** The advertised quality gate is a phantom. ~24,300 LOC of TS has never been linted — no floating-promise, unsafe-any, or stray-`console.log` detection — and a future maintainer trusts a command that's a hard error.
**Fix:** Add a flat `eslint.config.js` wiring `@typescript-eslint` recommended + recommended-type-checked, plus a `.prettierrc`. Triage the first run and baseline. **Effort: small.**

### 5. CI auto-deploys `main` straight to prod with no smoke gate and no rollback `[HIGH]`
**Dimension:** Build/CI/Test (+ completeness critic on the rollback mechanism) · **Verified real, high**
**Evidence:** `.github/workflows/deploy.yml` is the only workflow. It triggers on push to `main`, runs only `npm run build` (line 43 — tsc + vite, no `verify:campaign`, no lint), then does a fresh `git init` in `dist/` and `git push -f` to `gh-pages` (lines 56-63). Because each deploy force-pushes a single-commit branch, **gh-pages has no history** — there is no prior build to check out or revert to. A broken GLSL shader passes `tsc`/`vite build` (per CLAUDE.md's own note) and ships live unguarded.
**Impact:** One bad merge silently breaks the live game (white screen, dead mission, broken leaderboard) with no gate, and the only recovery is fix-forward + wait for a fresh build. For a solo operator, any live breakage becomes prolonged downtime with no instant rollback lever. The existing completability proof sits unused in CI.
**Fix:** Add `npm run verify:campaign` as a required pre-deploy step; add a post-deploy headless smoke check (`?qa` + `window.__game` asserting init with no console errors); stop force-wiping `gh-pages` (deploy via an action that keeps history) so rollback is one revert; move to a PR flow with branch protection. **Effort: medium.**

### 6. Test coverage is sim-only — flight, shaders, UI, leaderboard, cloud-save untested `[HIGH]`
**Dimension:** Build/CI/Test · **Verified real, high (if anything understated)**
**Evidence:** No test runner (no `test` script, no vitest/jest). The sole automated check `scripts/verify-campaign.ts` builds only the engine-agnostic scenario sims; its imports do **not** include `HelicopterSim`, `BucketSim`, any GLSL/`onBeforeCompile` shader, the DOM UI, or `leaderboard/`/`cloudSave.ts`. So the two core flight/payload integrators (the documented "feel"), all shaders (the documented white-water bug class that *passes the build*), the entire UI, and the Supabase networking + passwordless cloud-save have zero automated coverage.
**Impact:** The highest-business-risk paths are exactly the untested ones: cloud-save (user data loss → reputation), leaderboard submit (silent failure looks like a dead feature), and shaders (a broken shader is an unplayable white screen that ships through the build gate).
**Fix:** Stand up `vitest` and pin the FUN-critical invariants — flight integrator, bucket fill/drain, fire spread/burn-out, fuel range, scoring grades (all already engine-agnostic). Add a thin live-headless smoke suite (boot, assert no console/shader errors, fly/scoop/drop) using the project's `?qa`/`__game` hook. Mock-test the leaderboard/cloud-save fetch payload shape. **Effort: medium.**

### 7. Progression rewards run dry — 3 helis, all unlocked by mission 5, one shared physics model `[HIGH]`
**Dimension:** Gameplay · **Verified real, high**
**Evidence:** `profile.ts` HELIS = 3 airframes gated `unlockAfter` 0/2/4 — the final one unlocks *before* the 6-mission campaign ends. Per-heli differences are pure scalar multipliers on the shared integrator (`enginePower*cls.powerMul`, `maxSpeed*cls.speedMul`, `climbSpeed*cls.climbMul` at `HelicopterSim.ts:145-147`) — same integrator, no unique handling. Stars (`score.ts:139`, `progress.ts:128`) are tracked but their *only* consumer is display (`ScreenMission.ts:93`) — they unlock nothing.
**Impact:** The extrinsic progression spine is consumed in ~45 minutes, the 3 helis read as the same aircraft with dials turned, and 3-star runs reward nothing — removing the classic completionist replay driver.
**Fix:** Make stars *spend*: gate a hard/expert campaign variant (higher `spreadScale`, fuel on, fewer passes) or a cosmetic livery behind a star total — cheap since missions are pure data. Add 1-2 handling-distinct airframes (twitchy scout vs. heavy slow tanker) so the roster feels like real choices. **Effort: medium.**

### 8. Leaderboard is a static high-score table with no seasons/resets `[HIGH]`
**Dimension:** Gameplay/Competitive · **Verified real, high**
**Evidence:** `leaderboard/client.ts` exposes only per-mission best-run boards and `career_totals` (sum of best-per-mission). A grep for `season|weekly|daily|window|reset|epoch` across `leaderboard/` returns nothing — no time window, no reset. Scores clamp to `SCORE.maxScore=1400` (`config.ts:779`, enforced `score.ts:108`). *(One embellishment dropped: the verifier could not confirm the parenthetical "Three Towns hits exactly 1400" — the mechanism stands regardless.)*
**Impact:** Capped + never-resetting scores calcify the board: a flawless early player sits at the cap permanently and newcomers can at best *tie*. There's no recurring competition to return for, so the leaderboard does almost no retention work despite the Supabase/RLS/cloud-save infra cost already being paid.
**Fix:** Add a seeded daily/weekly board (one Supabase view filtered by a date-derived seed column on the existing `scores` table) so there's a fresh ladder every day anyone can top. Pairs with the Daily Burn mode — the seed is the join key. **Effort: medium.**

### 9. No loading splash — cold mobile load is a blank dark void `[HIGH]`
**Dimension:** UX/Onboarding · **Verified real, high**
**Evidence:** `index.html` body is only `<div id="game"></div>` + the module script (lines 92-94); the sole pre-JS paint is `background:#0e160f` (line 59). No spinner, skeleton, or `<noscript>`. Nothing appears until ~1MB of JS (`dist/assets/index-*.js`, confirmed 1,047,235 bytes raw / ~203KB gzip) parses and `TitleScreen` mounts. *(Correction: the ~1.9MB heli GLB is **not** a cold-load blocker — the title `AttractScene` is pure procedural geometry and loads no GLB; the model only fetches, async, when a mission boots. The real blocker is the JS bundle alone.)*
**Impact:** For a link-shared free game the first few seconds decide bounce rate. A silent black screen reads as "broken/slow" — the single biggest unforced conversion leak. Users who clicked through the OG card land on nothing.
**Fix:** Add an inline (un-bundled) splash in the `<body>`: wordmark as inline SVG + a subtle pulse on the `#0e160f` background, removed by `main.ts` once `TitleScreen` mounts. It ships in the 1.5KB HTML so it paints instantly. Add a tiny `<noscript>` fallback. **Effort: small.**

### 10. Required, network-validated unique callsign hard-gates every first-run player `[HIGH]`
**Dimension:** UX/Onboarding · **Verified real, high**
**Evidence:** A new player must complete the 4-screen `MenuFlow` (Identity→Aircraft→Map→Mission) before flying (`MenuFlow.ts:169-176`). Screen 1's Continue stays disabled until callsign ≥ 2 chars (`ScreenIdentity.ts:121`) and on submit runs an async `isNameTaken` round-trip that can reject with *"taken — pick another"* (`:140-145`). "Skip to missions" only renders once a named profile exists. *(Nuance: `isNameTaken` is fail-open — it returns false when the board is unconfigured or on network error — so it only hard-blocks when Supabase is healthy AND there's a real collision. The friction wall still exists for every first-timer.)*
**Impact:** Time-to-fun on a cold mobile load is gated behind an identity wall + uniqueness check — high abandonment for a casual game where the expectation is "tap, fly." Collisions worsen as the player base grows.
**Fix:** Let players fly immediately with an auto-generated callsign (e.g. "Pilot-7C2"); defer/optionalize naming to the leaderboard-submit moment. Make uniqueness a soft warning enforced only at score submission. Add a "Quick Fly" that drops a first-timer straight into mission 1. **Effort: medium.**

### 11. Game.ts is a 2,046-line god-object with a single 594-line `update()` `[HIGH]`
**Dimension:** Architecture · **Verified real, severity confirmed high**
**Evidence:** `src/three/Game.ts` is 2,046 lines with 61 imports; `update(dt)` spans lines 744-1337 (594 lines) and inlines cold-start spool, flight step, fuel, slung-bucket, crew, fire dynamics + mission director, structure damage, hero lights, heat-haze, smoke/embers, ripples, spray, fire-head chevrons, a ~40-field HUD sync object literal, and audio. The constructor spans 230-666 (~437 lines).
**Impact:** This is the central onboarding bottleneck and the highest-risk file for a solo author or future buyer. Any per-frame change requires reasoning about ~600 lines of interleaved concerns, with no test runner to catch a break — the practical ceiling on how fast the game can evolve.
**Fix:** Extract cohesive per-frame phases into focused updater objects (`BucketController`, `FireVfxController`, `CrewController`, `MissionStepper`, `HudPresenter`) mirroring the `sim/` boundary that already works. Start with the lowest-coupling self-contained blocks (smoke/embers/haze VFX emission, fire-head chevrons, HUD payload assembly). Move scene-assembly into a `SceneBuilder`. **Effort: large.**

### 12. Unhashed ~8MB model files on GitHub Pages with no cache strategy `[HIGH]`
**Dimension:** Performance/Infra (surfaced by completeness critic — missed by perf pass) · **High**
**Evidence:** The ~8MB of binary models ship at **fixed, unhashed** paths (`huey-opt.glb`, `scene.bin`, `animals-opt.glb`, blackhawk textures). The only caching logic in the repo (`vite.config.ts:13-51 cacheModelsInDev`) is `apply:'serve'` — dev-only, explicitly "Production is unaffected." Deploy target is GitHub Pages, which doesn't permit `Cache-Control` headers; no `_headers`/`netlify.toml`/`vercel.json` exists (glob-confirmed). `docs/LAUNCH-READINESS.md` P1.1/P1.2 flag this as unaddressed.
**Impact:** Returning users may re-download megabytes per visit (a direct funnel + bandwidth cost), and an unhashed model can't be cache-busted by filename — a stale model can stick in browser caches after a swap.
**Fix:** Either (a) move binary assets onto a CDN/host that sets `Cache-Control: immutable` (Cloudflare R2/Pages — DNS is already on Cloudflare), or (b) content-hash the model filenames at build (a Vite asset step) so each version is uniquely cacheable. **Effort: medium.**

---

## Per-dimension notes

**Architecture (7/10).** Strengths: the `sim/` boundary is enforced across all 9 modules; `World.ts` is a textbook keystone with a respected locked API; zero orphan modules across 98 files; zero TODO/FIXME/HACK markers. Medium/low: the documented "no per-frame allocation" invariant is *violated* in `update()` (`activeFires.map`, HUD `.map`s at `Game.ts:1281/1282/1285/1295`) — fix the code or soften the doc; `config.ts` is a 1,307-line / 38-block god-config (docs say "~30" — drift) that should be split by domain behind a barrel re-export; **bus-factor** is the dominant business risk (24.7k LOC, single author, no test runner, tribal knowledge in CLAUDE.md not the type system); `HUD.ts` (2,109 lines) is an undocumented second god-object the architecture map under-sells.

**Performance (6.5/10).** Strengths: fixed-size typed-array sim grids, ring-buffered VFX pools, instanced+chunk-culled trees, a fixed pool of fire point-lights (no recompiles), a recompile-free adaptive-DPR watchdog with a sane anti-thrash dead zone, full-page-reload mission switch (frees all GPU memory). Findings: per-frame array/object allocations in the *orchestration* layer (verifier **downgraded high→medium** — N is small and bounded ≤14, real churn but within young-gen GC; the impact magnitude was asserted, not measured); the **SMOKE pool** is ~15× too small for a multi-fire firestorm and recycles still-visible puffs (the known teleport-pop) — cap emission with a per-frame budget + skip-live-slot in `emit()`; **low-tier devices start at 2× DPR** and jank ~2.5s before the slow-EMA watchdog steps down (one-line fix: low preset `dprCap:1`); the single 1MB JS chunk with no code-splitting inflates cold-start; the fire-field DataTexture re-walks 16,384 cells every frame even when nothing is burning (add a live-cell early-out).

**Security & Privacy (7.5/10).** Strengths: `.env` gitignored and never committed; the key is verifiably the **anon** role; no XSS surface (user strings via `textContent`, every `innerHTML` is a hardcoded literal); `cloud_saves`/`client_errors` RLS-locked with zero policies + REVOKE ALL, reachable only via SECURITY DEFINER RPCs; defense-in-depth input clamping. Findings beyond the high-sev policy gap: **leaderboard score-spoofing** (medium) — anon can POST any score up to 1,000,000 vs. a real max of 1,400, permanent with no UPDATE/DELETE; tighten the CHECK to ~1500 and move INSERT behind a rate-limited RPC; the **email-hash pepper** is a hardcoded shipped constant (low) — soften the in-product copy or move hashing server-side via HMAC; the **crash-telemetry edge function** is unauthenticated with `*` CORS (low) — add an Origin allowlist + rate limit + retention prune; **three** is on a caret range (low) — pin + `npm ci`.

**Gameplay & Design (5.5/10).** Strengths: real momentum flight, skill-expressive slung bucket, honest never-self-extinguishing fire, difficulty-normalized scoring, mobile-perfect 2-4 minute sessions, a well-authored teaching curve. Medium/low beyond the criticals/highs above: a **difficulty cliff at mission 3** (three new pressures — real fire advance + first valve bucket + first survive objective + max wind — land at once with no scaffolding; introduce them earlier via `config.ts` tuning); **crew-ferry missions risk feeling like dead time** vs. the bucket fantasy that sells the game; **fuel pressure is real on only one mission** so the deepest resource mechanic is barely experienced — turn it on a mission or two earlier without the hard fail.

**Rendering & Art (7/10).** *(Dimension not independently re-verified — treat as unverified medium/low.)* The low quality tier silently nulls the entire composer (`Composer.ts:111-115`, low preset bloom 0) so mid-range Androids get no bloom/grade/god-rays/haze — run the cheap grade even on low, gate only bloom/MSAA, and reconsider the coarse 8-core cutoff. Heavy transparent overdraw (5 alpha body sheets + 2 additive + coal bed per fire, all `depthWrite false`/`frustumCulled false`) is the dominant mobile fill-rate risk — add a tier-scaled VFX budget. Several early-capture screenshots render near-black, suggesting a black-frame init window — gate the first presented frame. God-rays/haze/grade run as full-res fullscreen passes when the sun is in frame — render god-rays/bloom at half-res and composite up.

**UX & Onboarding (6.5/10).** Strengths: tokenized glass-cockpit HUD, a deadzoned fixed-joystick + cluster touch layout that reflows across 4 breakpoints with safe-area awareness, real reduced-motion support (CSS *and* JS-gated), an excellent 3-page Help modal, WebGL preflight + context-loss recovery, a polished share/leaderboard end-screen. Medium/low beyond the two highs: the 4-screen wizard runs every visit but **Map and Aircraft steps offer one real choice each** (only Saskatchewan unlocked; others "Coming soon") — collapse single-choice steps; **no PWA manifest** despite `index.html` advertising installability — the cheapest return hook is missing; **colorblind gap** — radar/gauge state encodes meaning by color alone (no shape/glyph redundancy); **no settings panel / volume control** — only a binary mute, no home for a colorblind or motion toggle; the **DROP hero and free-look eye share the bottom-right thumb zone**, risking misfires under pressure.

**Build / CI / Test (5.5/10).** Strengths: real build gate (strict `tsc --noEmit` before `vite build`, exit 0 in 4.55s); `verify-campaign.ts` is a *genuinely good* completability gate (builds the same seeded World the game does, runs real sims, 42 assertions incl. negative cases); clean `dist/` with no scratch leaks; secrets correctly out of git; lockfile committed. Medium/low beyond the three highs: **`verify:campaign` depends on `esbuild`, which is undeclared** (resolves only transitively via vite — a future vite major silently breaks the one real test); **no versioning discipline** (stuck at 0.1.0, no tags, no CHANGELOG, no node pin); the single 1MB chunk warns only past 1500KB; minor doc drift (CLAUDE.md references a non-existent `scripts/shot.mjs`).

**Legal / IP / Business (6.5/10).** Strengths: all four 3D models commercial-OK and credited on disk *and* in-product; careful privacy data flow; one tiny clean runtime dep (`three`, MIT); privacy-forward disclosed analytics. Findings beyond the two highs: **"Bambi bucket"** — a registered SEI Industries trademark — is used as a generic term in mission copy, OG alt text, README, and `package.json` description (medium); risk rises sharply on merch — use generic "bucket" on sellable/SEO surfaces. The game **depicts real, named, predominantly-Indigenous SK communities** (Stanley Mission, Sucker River, Île-à-la-Crosse, La Ronge) overrun by wildfire with "families cut off" — communities genuinely evacuated in 2024-2025 (medium) — a reputational consideration, but handled respectfully (a wildfire-relief/firefighter-charity tie) it's a **goodwill/partnership upside**. The UH-60 ships its US-Army livery (low — recolor to civilian for sale); the smoke sprite has informal "public/educational use" provenance (low — record a license or regenerate procedurally); the rotor audio's Mixkit license is asserted but has **no license.txt on disk** to prove it (record it).

---

## What the completeness critic flagged

Gaps the eight dimension passes missed, now folded into the report above where high-severity:

- **Cloud-save account-takeover/grief vector (high)** — promoted to finding #3.
- **Unhashed ~8MB models on GitHub Pages, no cache strategy (high)** — promoted to finding #12.
- **Force-pushed gh-pages destroys deploy history (medium)** — folded into finding #5 as the rollback *mechanism*: each deploy `git init`s a fresh single-commit branch, so there is no prior build to revert to.
- **No LICENSE file on a fully-public, source-exposed repo (medium)** — with no LICENSE the code is "all rights reserved" by default, yet 100% of the source (including the email-hash pepper and the cloud-save trust model) is openly readable. Decide: private the repo, or add an explicit proprietary/source-available license.
- **No consent/DNT mechanism, distinct from the missing policy doc (medium)** — no consent gate, no Do-Not-Track honoring, no opt-out anywhere, while the product auto-injects a Cloudflare beacon, sends full UA via the error beacon, and collects email. A *process* gap on top of "write a privacy page."
- **No commerce infrastructure at all (medium)** — grep for `stripe/gumroad/printful/printify/shopify/paypal/checkout/cart/adsense` returns nothing. The named business model (free game + POD merch) is entirely unbuilt.
- **No `404.html` SPA fallback on GitHub Pages (low)** — any deep/mistyped URL serves GitHub's generic 404, not the game. A trivial redirecting `public/404.html` closes it.
- **Context-loss reload discards in-progress mission (low)** — the `webglcontextlost` handler's only recovery is `location.reload()`, and progress persists only on WIN, so a GPU eviction mid-mission silently throws away the run on exactly the low-memory devices targeted.

---

## Top 10 things to fix before this is a business

Ordered for impact-per-effort, mixing quick wins with structural must-dos.

1. **Write a privacy policy + terms** (`/privacy.html`, `/terms.html`, linked from the identity gate + footer) and add a one-line consent affirmation by the email field. *Hard prerequisite for any ads/merch/payments.* **— small.**
2. **Add an inline loading splash + `<noscript>`** in `index.html` so the cold tap paints a branded wordmark instantly instead of a black void. *Directly recovers bounce on shared links.* **— small.**
3. **Let players fly instantly** with an auto-generated callsign; defer naming + uniqueness to score-submission. *Removes the first-run identity wall.* **— medium.**
4. **Fix the cloud-save takeover vector** — move email hashing server-side (HMAC with a Vault secret) + add a verify step + rate-limit the save RPC. *Protects user progress before you ask people to invest in it.* **— medium.**
5. **Harden the deploy pipeline** — add `verify:campaign` + a headless smoke check as required CI gates, stop force-wiping `gh-pages` (keep history for rollback), move to a PR + branch-protection flow. *One bad push currently breaks prod with no lever.* **— medium.**
6. **Configure ESLint + Prettier** (flat config, type-checked rules) so the advertised quality gate actually runs; baseline the first pass. *Turns a phantom command into a real safety net.* **— small.**
7. **Ship an Endless / Daily Burn mode** reusing the deterministic World + seeded fire spawn + the scorer, with a date-seeded daily leaderboard. *The single biggest retention lever — and the foundation the merch funnel sits on.* **— large.**
8. **Make stars and helis matter** — gate a star-spend reward (expert campaign variant or cosmetic livery) and add 1-2 handling-distinct airframes so progression doesn't run dry by mission 5. *Restores the mastery/completionist loop.* **— medium.**
9. **Stand up `vitest` + a thin headless smoke suite** pinning flight/bucket/fire/fuel/scoring invariants and a boot/fly/scoop/drop check that catches shader breaks the build gate misses. *The only way a solo author safely changes physics or ships shaders.* **— medium.**
10. **Build the actual revenue surface** — a merch link-out from the menu, a Fourthwall/Printful store, and an analytics funnel into it (using generic "bucket" copy, not the SEI trademark, on sellable items). *Until this exists, it is a hobby, not a business.* **— medium** (link-out) **to large** (full POD integration).

**Quick-win cluster (each ≤1 hour, ship together):** low-tier `dprCap:1` (one-line, kills the 2.5s startup jank), declare `esbuild` in devDependencies (un-breaks the one real test from a future vite bump), add a redirecting `public/404.html`, add a `manifest.webmanifest` + icons (cheapest return hook), and pin `three` exactly + commit to `npm ci`.
