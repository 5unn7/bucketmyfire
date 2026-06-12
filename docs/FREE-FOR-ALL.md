# Open Skies — the free-for-all (supersedes the heavy co-op plan)

> **Decision (2026-06-07):** the multiplayer mode pivots from the host-authoritative **co-op**
> plan to a lightweight **free-for-all**. People fly the **same map**, fires **keep happening**,
> and each pilot builds a **personal score from the fires they douse**. The hard, fragile parts
> of the co-op plan (deterministic cross-ISA fire re-step, host-loss migration, drop-arbiter,
> shared win/lose) are **dropped**. (The retired co-op plan lives in git history as
> `docs/COOP-PLAN.md`.)

## Why this is the right call

- **Matches the project identity.** $0 infra, no game server, 100% client-side, mobile-60fps.
- **Kills the riskiest engineering.** The co-op plan's crux was perfect deterministic fire sync
  because everyone shared one win/lose + structure-damage lose state. A free-for-all has **no
  shared win/lose**, so a little fire divergence between players is cosmetic, not fatal.
- **No griefing.** Each pilot races a score; nobody can "steal your fire" or end your run.
- **Reuses what's already shipped:** the seeded `World`, `FireSystem`, the mission framework
  (an FFA round is just a runtime-built `MissionDef`, exactly like the Daily Burn), and the
  plain-`fetch` Supabase leaderboard.

## The model

A **shared-seed presence race**, like a racing game's ghosts: everyone on the same UTC day grows
the **identical** Saskatchewan (deterministic from one seed), the fires never stop, and you
compete on a **live score**. Each player runs their own local sim — the map and starting fires
are identical, but douses are local. You're racing the same conditions and the same board, not
fighting over the exact same flame.

## Slice plan

- **Slice 1 — endless mode + live score (SHIPPED in this change, 100% client-side, no infra).**
  - `missions/freeforall.ts` `buildFreeForAll(date)` → an `endless` `MissionDef`, id `ffa-YYYYMMDD`
    (auto per-day board key, like daily). Never-met `survive` objective + no `fails` = never ends.
  - `Game.stepEndless()` tops fires up toward `FFA.targetActive` and tallies a live cumulative
    score (`FFA.pointsPerFire` × fires doused + `FFA.pointsPerHit` × accurate drops). Live "fires
    out / score" readout via the objective checklist. All pacing in `config.ts` `FFA`.
  - Routes: `?ffa`; reachable from the home rail's **Open Skies** tab (was the Co-op stub).
  - `fuel:false` (fly free); a crash → RETRY restarts a fresh round.
- **Slice 2 — shared live board (SHIPPED).** `Game` posts the running score to the per-day
  `ffa-YYYYMMDD` board every `FFA.boardEverySec` + on exit, reusing the leaderboard `fetch` client —
  **no schema change** (the `mission_best` view takes each pilot's max, and the score only grows, so
  the latest push IS the live standing). The Open Skies home panel has a "Today's board" button.
- **Slice 3 — see other pilots (SHIPPED).** Decision: **`@supabase/realtime-js`, code-split**
  (confirmed ~17 KB gz in its own `openSkies` chunk; a solo player never downloads it). Pure cosmetic
  presence: `net/openSkies.ts` (number-only transport) broadcasts your pose at `FFA.netSendHz` over a
  `os:<session>` broadcast channel; `net/RemotePilots.ts` (the one Three-touching net file) renders
  each peer as a smoothed ghost heli flying their own airframe. No host, no fire sync, no
  reconciliation. Degrades to solo when Supabase is unconfigured.

- **Slice 3b — PvP collisions + in-flight respawn + heli choice (SHIPPED).**
  - **Collisions:** flying within `FFA.collideRadius` of another pilot's ghost (and `agl ≥ collideMinAgl`)
    detonates your heli. Detected locally per-client, so both ships explode — no host. `RemotePilots.collides()`
    tests the rendered (smoothed) ghost positions.
  - **Respawn:** a crash in an endless round never ends the game — after `FFA.respawnSec` it respawns you
    airborne over home, engine running (no cold-start), pristine airframe, **score kept**. `FFA.respawnInvulnSec`
    of collision immunity stops a camped pad from insta-killing you. Applies to *every* death (collision,
    tree strike, hard landing). Open Skies also always boots in-flight.
  - **Heli choice:** the Open Skies panel picks any of the 3 airframes (all free in the sandbox) → `?ffa&heli=<id>`.

## Built but not yet polished (Slice 3+)

- **Nameplates** over ghost helis (a projected label or sprite) — would really sell "people."
- **Ghost bucket + rope** (currently the ghost is the airframe only).
- **Live ladder HUD** from the broadcast `score` field (no DB read needed) — "you're #2 of 5 up here."
- **A proper upsert RPC** for the board to replace periodic-insert row churn.

## Open decisions

- **Board reset granularity** — per-UTC-day (current, matches daily) vs a rolling live window.
- **Crash policy** — Slice 1 ends the round on a crash (RETRY restarts). A soft respawn/hover-reset
  would be friendlier for a sandbox; revisit if dogfooding finds crashes annoying.
- **Realtime free-tier limits** — broadcast at 12 Hz × N peers is fine for casual play; watch the
  Supabase concurrent-connection / message quotas if it gets popular.

## Dogfood multiplayer

Needs `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` set (else solo, no ghosts). `npm run dev`, open
`?ffa` in **two** browser tabs/devices on the same UTC day → each should see the other's heli flying.

## Dogfood

`npm run dev`, open `?ffa` (or Home → Open Skies). Tuning knobs: `config.ts` `FFA`
(`targetActive`, `spawnEverySec`, `pointsPerFire`, `pointsPerHit`).
