# bucketmyfire — From Hobby to Business: Unified Roadmap

> The single sequenced plan that merges the **code audit** (`docs/AUDIT.md`) and the
> **business plan** (`docs/BUSINESS-PLAN.md`) into one ordered execution list. Each item is
> tagged `[FIX]` (audit finding) or `[BIZ]` (business move), with effort and *why it's here now*.
> Profile: **solo, lifestyle, bootstrapped (~$25/yr run cost), free game + POD merch.**

## The one-paragraph strategy

You have an **8/10 game engine wrapped in a 3/10 business.** The engine is the moat — real-3D
physics on a real Canadian place that the Flappy-Bird-grade clone farms can't copy. The plan is
*not* "build more game"; it's: **(1) stop leaking the players you already get** (splash, instant-fly,
share loop), **(2) give them a reason to come back** (Daily Burn endless mode — the keystone), then
**(3) put a merch funnel on the win screen** and **(4) get distribution from CrazyGames + short-form
video.** Ads are a rounding error (~$1-2 per 1,000 plays); **merch is the real pillar** (one ~$21-net
hoodie beats thousands of impressions), and the in-game store button is worth more than all external
marketing combined. Realistic Year-1: break-even to ~$1k base, ~$8-11k CAD with a viral moment.

## How the two halves connect

The audit and the business plan point at the **same handful of changes** from two directions:

| Business goal | Audit finding it depends on |
|---|---|
| Run ads / merch / payments at all | `[FIX #2]` no privacy policy → hard blocker for AdSense/POD/stores |
| Daily-return players (the merch audience) | `[FIX #1]` no retention loop → build Daily Burn + `[FIX #8]` daily leaderboard |
| Virality / free acquisition | `[FIX #9]` share is text-only → image score-card; `[FIX #9 UX]` no splash; no PWA manifest |
| Convert link-shared clicks | `[FIX #9]` black-void cold load + `[FIX #10]` callsign wall both kill first-tap conversion |
| Protect paying/invested players | `[FIX #3]` cloud-save takeover vector |
| Not break the live shop on deploy | `[FIX #5]` no smoke gate / no rollback |
| Sell merch without a lawsuit | `[BIZ]` rename "Bambi bucket" (SEI trademark) off all sellable/SEO copy |

So the sequencing below is dependency-ordered, not just priority-ordered.

---

## Phase 0 — Unblock & stop the bleeding (Week 1, all quick)

*Everything here is small/trivial and removes a blocker or a conversion leak. Do it first.*

- `[FIX #2] [BIZ]` **Privacy policy + Terms + consent line.** Static `/privacy.html` + `/terms.html` (free generator tuned for PIPEDA + COPPA clause), linked from the identity gate, cloud-save modal, and CREDITS footer; one-line consent affirmation by the email field. **Hard prerequisite for ads/merch/payments.** — *small*
- `[FIX #9] ` **Inline loading splash + `<noscript>`.** Branded wordmark (inline SVG, ships in the 1.5KB HTML) on the `#0e160f` background, removed when `TitleScreen` mounts. Kills the black-void bounce. — *small*
- `[BIZ] [FIX legal]` **Sweep "Bambi bucket" → "water bucket"/"fire bucket"/"slung bucket"** across mission copy, OG/SEO meta, README, `package.json`, and anything store-bound. Also fix "water bomber" → helitanker/bucket-helicopter. **Never put "Bambi Bucket" on merch.** — *small*
- `[FIX] ` **Quick-win cluster (≤1hr each, ship together):** low-tier `dprCap:1` (kills 2.5s startup jank), declare `esbuild` in devDependencies, add redirecting `public/404.html`, add `manifest.webmanifest` + icons (cheapest return hook), pin `three` exactly + `npm ci`. — *trivial*
- `[FIX #6]` **Configure ESLint + Prettier** (flat config, type-checked rules); baseline the first run so the advertised quality gate is real. — *small*
- `[BIZ]` **Free CIPO trademark clearance search** on "bucketmyfire" (defer the ~$330 registration until revenue justifies it). — *trivial*

**Exit check:** privacy/terms live & linked, game paints instantly on cold tap, no "Bambi" on any sellable surface, lint runs.

---

## Phase 1 — Fix the conversion funnel (Weeks 1-2)

*Make every shared link convert, and make wins shareable. This is what makes Phases 3-4 pay off.*

- `[FIX #10]` **Quick Fly / auto-callsign.** Let first-timers fly immediately with a generated handle (e.g. "Pilot-7C2"); defer naming + uniqueness check to the score-submit moment; collapse the single-choice Map/Aircraft wizard steps. — *medium*
- `[FIX #9 growth] [BIZ]` **Image score-card share loop.** Render a canvas card ("Saved Candle Lake · 48,210 · 3★ · bucketmyfire.com") → `navigator.share({files})`, desktop clipboard fallback, plus a "Beat my score" leaderboard-challenge link. Your `HUD.ts` share is text-only today; this is the single biggest virality upgrade and you already own the plumbing. — *medium*
- `[FIX #5]` **Harden the deploy pipeline.** Add `verify:campaign` + a headless `?qa`/`__game` smoke check as required CI gates; stop force-wiping `gh-pages` (keep history → one-revert rollback); move to a PR + branch-protection flow. *Do this before the shop is live so a bad push can't take down a revenue surface.* — *medium*

**Exit check:** a brand-new player is flying within ~3s of first tap; a win produces a shareable image; a bad commit can't silently break prod.

---

## Phase 2 — The retention keystone (Weeks 2-4)

*The #1 commercial risk and the foundation everything downstream sits on. Reuses ~100% of shipped sims.*

- `[FIX #1] [FIX #8]` **Daily Burn / Endless mode + date-seeded daily leaderboard.** Today's date → `WORLD3D.seed`, reuse `FireSystem.spawnInitial` seeded placement + the pure scorer + a Supabase view filtered by a date-seed column on the existing `scores` table. Gives an instant daily-return hook and a fresh global ladder anyone can top. **This is the engine that turns one-session players into the returning audience merch revenue depends on.** — *large (but data + routing on shipped sims, not new engine code)*
- `[FIX #9 test] [FIX #6]` **Stand up `vitest` + thin headless smoke suite** *(do this alongside Phase 2 because you'll be touching sims).* Pin flight/bucket/fire/fuel/scoring invariants + a boot/fly/scoop/drop check that catches shader breaks the build gate misses. — *medium*
- `[FIX #7]` **Make stars & helis matter.** Gate an expert campaign variant or cosmetic livery behind a star total; add 1-2 handling-distinct airframes (twitchy scout vs. heavy tanker). Restores the completionist replay driver. — *medium*

**Exit check:** there's a reason to open the game tomorrow, and you can change a sim without fear.

---

## Phase 3 — Stand up revenue (Weeks 4-6)

*Now that players return and wins are shareable, attach the money surfaces.*

- `[BIZ]` **Fourthwall shop at `shop.bucketmyfire.com`** (Cloudflare CNAME). $0/mo, you keep 100% markup, and it's **Merchant-of-Record** (handles US sales tax/VAT for you). Exactly **3 SKUs**: Bucket Pilot dad hat $29.99, hoodie $44.99, tee $24.99. Order one sample of each (~$60-90, your only real spend), photograph on a real person, use those photos. — *small-medium*
- `[BIZ] [FIX #10]` **"Bucket Pilot Store" button on the win/debrief screen** (peak emotion), reusing `ui/theme.ts` tokens, opening the shop in a new tab + a tiny optional email capture. *Alto's Adventure made 60% of annual merch revenue in 30 days doing exactly this — the in-game store is the whole funnel.* — *small*
- `[BIZ]` **CrazyGames SDK + submit** (rewarded + interstitial); **opt into the 2-month +50% launch-exclusivity bonus** (free when you're on no other portal). First budget the initial download + run Lighthouse so load time clears their bar. **Decline Poki's 5-yr web-exclusive** (it would sever the merch-on-your-domain funnel and fight your Three.js build's 8MB limit). — *medium*
- `[BIZ]` **File a W-8BEN** in the ad-network dashboard (Canada-US treaty → ~0% withholding instead of 24-30%). — *trivial*
- `[FIX #3]` **Fix the cloud-save takeover vector** before asking people to invest hours: move email hashing server-side (HMAC + Supabase Vault secret), add a magic-link verify on the save path, rate-limit per client/day. — *medium*

**Exit check:** a player can buy a hoodie from the win screen; the game is live on CrazyGames earning ad share; invested progress is protected.

---

## Phase 4 — Growth & let-it-ride (Weeks 6-12+)

*Near-$0 acquisition, ranked by ROI. The binding constraint is your solo time — do the top two well.*

- `[BIZ]` **Weekly short-form video engine** (over-invest here). TikTok + YouTube Shorts + Reels "fail / near-miss compilation" cadence — the slung bucket missing a swing, a town saved at the last second, golden-hour god-rays. Repurpose one 30-60s clip across all three; the clips double as merch-design source. — *ongoing*
- `[BIZ]` **Coordinated launch posts:** r/WebGames, r/flightsim, r/Saskatchewan (where rules allow), and a **"Show HN: I built a 3D helicopter wildfire game that runs in your browser"** (the 100%-client-side Three.js story is a genuine hook). Lead with a GIF. — *small*
- `[BIZ]` **Ethical seasonal newsjacking + charity pledge.** Lean into the Saskatchewan/Candle Lake + June-Sept fire-season angle; pledge a visible % of merch profit to a Canadian wildfire-relief/firefighters' fund (the *This War of Mine* playbook — durable free PR + lifts merch conversion). Pause promo around acute named tragedies. — *small*
- `[BIZ]` **Google Play TWA wrap** via Bubblewrap ($25 one-time) once the PWA manifest (Phase 0) hits Lighthouse PWA ≥80. **Skip iOS** (Apple 4.2.2 rejects web-wrapper games; iPhone players already get the web build). — *small*
- `[BIZ]` **Non-exclusive volume portals + goodwill homes:** one GameDistribution/GameMonetize upload, itch.io "name your price", Newgrounds, a Ko-fi tip button. *Never alongside a Poki exclusive.* — *small*
- `[FIX #12]` **Asset caching/CDN for the ~8MB models** — content-hash filenames at build, or move binaries to Cloudflare R2/Pages with `Cache-Control: immutable` (DNS is already on Cloudflare). Cuts returning-user re-downloads. — *medium*
- `[FIX #11]` **`Game.ts` / `HUD.ts` de-god-objecting** — opportunistic, ongoing. Extract per-frame phases into focused updater objects mirroring the `sim/` boundary, starting with the lowest-coupling VFX/HUD blocks. Lowers bus-factor (your top architectural business risk). — *large*

---

## 30/60/90-day decision gates (from the business plan)

- **DOUBLE DOWN if by ~Day 90:** CrazyGames sends ≥50k plays/mo, **AND** ≥10-15 merch units sold off the win-screen funnel (proves the funnel, not just the store), **AND** ≥1 short-form clip cleared ~50k views. → Expand to 5-7 SKUs, add a 2nd portal non-exclusively, ramp video, push the Play wrap.
- **LET IT RIDE if:** traffic <20k plays/mo and merch trickles. → Keep the $0 store live, post seasonally, let SEO + the daily leaderboard compound. Don't burn scarce hours — median POD seller takes ~165 days to first $1,000.
- **HARD STOPS:** never sign Poki's 5-yr web-exclusive; never model ads on in-app/$16-rewarded numbers (real web RPM ≈ $1-2); never chase iOS; never let merch effort exceed 3 SKUs + the win-screen funnel until buy-through is proven.

## What to measure (instrument in Phase 0)

plays · sessions · mission-completion % · share-button uses · **win-screen → store CTR** · store
conversion · player→buyer conversion · D1/D7 return · daily-leaderboard participation. All published
benchmarks are platform-wide — only *your* funnel numbers tell you which gate you're hitting.

---

### Effort legend
`trivial` ≤1h · `small` ≤1 day · `medium` a few days · `large` 1-3 weeks part-time.

### Source docs
- `docs/AUDIT.md` — full findings, file:line evidence, per-dimension scores.
- `docs/BUSINESS-PLAN.md` — sourced market/competitor/monetization/merch research + Year-1 model.
