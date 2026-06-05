# Session handoff — 2026-06-04

Where things stand after the audit + business plan + MASTER-PLAN Phase 0–2 execution.
Pairs with `docs/AUDIT.md`, `docs/BUSINESS-PLAN.md`, `docs/MASTER-PLAN.md`.

## Status: green
`npm run typecheck` ✓ · `npm run build` ✓ · `npm run lint` → 0 · `npm run verify:campaign` → **102 passed, 0 failed** (incl. a 30-seed Daily Burn completability probe). **Nothing pushed** — no auto-deploy has fired.

## What shipped (committed on `main`)
- **Phase 0 (launch-readiness):** `public/privacy.html` + `public/terms.html` + consent line + footer/identity policy links · cold-load splash + `<noscript>` in `index.html` · `public/manifest.webmanifest` + `public/icon.svg` + `public/404.html` · real ESLint (`.eslintrc.cjs`) + Prettier (`.prettierrc`) · low-tier `dprCap:1` · pinned `three` + declared `esbuild` · "Bambi bucket" trademark swept off SEO/package/briefing copy.
- **Phase 1:** `deploy.yml` hardened (verify gate + history-preserving `gh-pages` publish for rollback + post-deploy smoke) · `src/three/ui/shareCard.ts` (image score-card via Web Share) · `randomCallsign()` + Quick-Fly in `MenuFlow`.
- **Phase 2 (Daily Burn — retention keystone):** `src/three/missions/daily.ts` (date→seed challenge; `daily-YYYYMMDD` id = per-day leaderboard key, no schema change) · `progress.recordWin` ignores daily ids (no false heli unlocks) · 30-seed completability probe in `verify-campaign.ts` · "🔥 Daily Burn" menu button.

## In this checkpoint commit (was uncommitted working-tree WIP)
- **The owner's in-progress visual work:** photoreal/home-screen redesign across `HUD.ts`, `World.ts`, `config.ts`, `regions.ts`, `minimap.ts`, meshes (`cabin/trees/helicopter/helipad/heliModels`), `HelicopterSim.ts`, `TimeOfDay.ts`, `profile.ts`, `main.ts`, + new `src/three/menu/` and `src/three/ui/title/`.
- **My Phase 1/2 wiring that rode on top of it:** `HUD.shareRun` → `shareScoreCard(...)`; `main.ts` `?daily` route + daily-aware `endHooks` + `gotoCampaign` drops `daily`.

## Pick up next session
1. **Dogfood Daily Burn**: `npm run dev` → open `/?daily` (or the 🔥 button). Sim proves it's winnable; judge the *feel*. Tune `buildDailyMission` (fire counts / `spreadScale`) if needed.
2. **Finish the home-screen redesign** in `ui/title/` + `menu/`; elevate the Daily Burn + Quick-Fly entries onto the title screen.
3. **Phase 3 (revenue):** win-screen "Bucket Pilot Store" CTA → Fourthwall shop at `shop.bucketmyfire.com`; submit to CrazyGames; file W-8BEN.
4. **Manual:** stand up `privacy@bucketmyfire.com` (Cloudflare Email Routing — it's referenced but dead); free CIPO search on "bucketmyfire".
5. **Push when ready** — that triggers the hardened deploy (now with a verify gate + rollback).
