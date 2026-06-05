# bucketmyfire — Remaining Phases (execution tracker)

> Living checklist of what's **left** to turn the game into a business. Tick items as they land.
> Full strategy: `docs/MASTER-PLAN.md` · audit findings: `docs/AUDIT.md` · plan: `docs/BUSINESS-PLAN.md`.
> Effort: `trivial` ≤1h · `small` ≤1 day · `medium` a few days · `large` 1–3 weeks part-time.
> Owner: **C** = code/Claude-doable · **U** = you (manual/external account) · **C+U** = both.

## Done so far (recap)
- ✅ **Phase 0 — launch-readiness:** privacy/terms + consent + policy links · cold-load splash + `<noscript>` · PWA manifest + icon + 404 · real ESLint+Prettier · low-tier `dprCap:1` · pinned `three`/`esbuild` · "Bambi bucket" trademark swept.
- ✅ **Phase 1 — funnel + safety:** deploy hardened (verify gate + rollback + smoke) · image score-card wired into `HUD.shareRun` · Quick-Fly + auto-callsign.
- ✅ **Phase 2 — Daily Burn engine:** date-seeded daily challenge, progress-isolated, 30-seed completability gate, `?daily` route + 🔥 entry button. **Playable, not yet dogfooded.**

All committed on `main` (not pushed). `lint 0 · build ✓ · verify:campaign 102 passed`.

---

## Phase 2 — Daily Burn: finish it `(retention keystone)`
- [ ] **Dogfood the daily feel** — `npm run dev` → `/?daily`; judge fire load / spread / session length. Tune `buildDailyMission` counts + `spreadScale` in `missions/daily.ts`. `small` · **U+C**
- [ ] **Elevate entries to the title screen** — surface Daily Burn + Quick-Fly on the redesigned `ui/title/TitleScreen` (currently only in the `MenuFlow` header). `small` · **C**
- [ ] **Menu leaderboard daily tab** — add today's board to the menu Leaderboard (end-screen already shows it via `[...CAMPAIGN, daily]`). `small` · **C**
- [ ] **Come-back hook** — a "Daily streak" counter + "new burn in HH:MM" timer on the menu. `medium` · **C**
- [ ] **Make stars + helis matter** (AUDIT #7) — spend stars on an expert variant / livery; add 1–2 handling-distinct airframes so progression doesn't run dry by mission 5. `medium` · **C**

## Phase 3 — Stand up revenue `(the actual business)`
- [ ] **Win-screen "Bucket Pilot Store" CTA** — a store button on the end banner (peak emotion → the merch funnel). Reuse `ui/theme.ts`; opens `shop.bucketmyfire.com`. `small` · **C**
- [ ] **Fourthwall shop** at `shop.bucketmyfire.com` (Cloudflare CNAME) — 3 SKUs: dad hat $29.99, hoodie $44.99, tee $24.99. $0/mo, merchant-of-record. `small` · **U**
- [ ] **One strong brand identity first** — "Bucket Pilot" wordmark/badge + slogan ("Scoop. Drop. Repeat."), SK boreal aesthetic. The identity *is* the product. `medium` · **U(+C for art)**
- [ ] **Order + photograph samples** (~$60–90, the only upfront spend); list with real photos, verify CA/US checkout totals. `small` · **U**
- [ ] **CrazyGames SDK + submit** — rewarded + interstitial; opt into the 2-month +50% launch-exclusivity. First budget initial download + Lighthouse. **Decline Poki's 5-yr exclusive.** `medium` · **C+U**
- [ ] **File W-8BEN** in the ad dashboard (Canada–US treaty → ~0% withholding). `trivial` · **U**
- [ ] **Fix cloud-save account-takeover** (AUDIT #4) before driving traffic — move email hash server-side (HMAC + Vault), magic-link verify, rate-limit the save RPC. `medium` · **C+U**
- [ ] **Ko-fi tip button + itch.io "name your price"** page (the low-maintenance "IAP"). `small` · **U(+C button)**
- [ ] **Tighten leaderboard score CHECK** (AUDIT, medium) — clamp DB CHECK to ~1500 (real max 1400) + rate-limited insert RPC, so the board isn't trivially spoofable. `small` · **C+U**

## Phase 4 — Growth & scale `(near-$0 acquisition)`
- [ ] **Weekly short-form video** — TikTok/Shorts/Reels fail/near-miss compilations (over-invest here). `ongoing` · **U**
- [ ] **Launch posts** — r/WebGames, r/flightsim, r/Saskatchewan, "Show HN". `small` · **U**
- [ ] **Charity pledge + ethical seasonal content** — % of merch to a wildfire-relief fund; lean into fire-season + Candle Lake. `small` · **U**
- [ ] **Google Play TWA wrap** — Bubblewrap, Lighthouse PWA ≥80, $25 one-time. **Skip iOS.** `small` · **C+U**
- [ ] **Non-exclusive portals** — GameDistribution/GameMonetize + Newgrounds (never alongside a Poki exclusive). `small` · **U**
- [ ] **Asset caching / CDN** (AUDIT #12) — content-hash the ~8MB model filenames or move to Cloudflare R2 with `immutable` headers. `medium` · **C**

## Cross-cutting engineering (do opportunistically)
- [ ] **vitest + headless smoke suite** (AUDIT #9) — pin flight/bucket/fire/fuel/scoring invariants + a boot/fly/scoop/drop check (catches shader breaks the build misses). Do alongside any sim change. `medium` · **C**
- [ ] **De-god-object `Game.ts` / `HUD.ts`** (AUDIT #11) — extract per-frame phases into focused controllers mirroring the `sim/` boundary. Lowers bus-factor. `large` · **C**
- [ ] **Accessibility polish** — colorblind glyphs on radar/gauges, a settings panel (volume + motion + colorblind toggle). `medium` · **C**
- [ ] **Rendering** — run the cheap color-grade on low tier; tier-scaled transparent-VFX budget; gate the first presented frame (black-frame init). `medium` · **C**

---

## Definition of "it's a business"
A returning player can: land on a branded splash → tap Quick Fly or Daily Burn → fly within ~3s → share an image score-card → and buy a hoodie from the win screen — with privacy/terms in place and the deploy pipeline guarded. **Phase 0–2 cover the first four; Phase 3 closes the loop.**

## Immediate next 3 (when you resume)
1. Dogfood `/?daily`, tune the feel, then commit the home-screen redesign (folds in the loose HUD/main.ts wiring) and **push** → first hardened deploy.
2. Build the **win-screen store CTA** + stand up the **Fourthwall shop** (the revenue surface).
3. Submit to **CrazyGames** + **fix the cloud-save vector** before the traffic arrives.
