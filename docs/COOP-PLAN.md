# Co-op Development Plan

> **⚠️ SUPERSEDED (2026-06-07) by `docs/FREE-FOR-ALL.md`.** The multiplayer mode pivoted from this
> host-authoritative co-op to a lightweight **free-for-all** (same map, endless fires, personal
> score). This document is retained as the reference for the road not taken — the deterministic
> fire-sync / host-migration / drop-arbiter machinery here is NOT being built. Read `FREE-FOR-ALL.md`
> for the live plan.

> **Status:** approved plan, **paused — sequenced AFTER the world-foundation pivot.** Do not
> start the build until the rectangular-playfield / map-foundation / mission-factory work has
> landed. **Dependency:** that pivot rebases the **fire grid from square 160² to rectangular
> constant-`cellSize`** — so §4.4/§4.8/§8 references to "`FIRE3D.fireCells²` / 160² cells" and
> the bandwidth/CPU math must be **refreshed against the new grid** before Phase 0 starts.
> Phase 0's determinism hardening (dedicated `fireRng`, placement off `world.rng`,
> tier-independent collider/fuel build) should be folded into the foundation work, not bolted
> on after. This is the canonical document a solo dev executes from; it folds in every fixable
> issue raised by the adversarial review (deferred items called out in §11).
>
> **All 6 product decisions are LOCKED (2026-06-05) — see §13.** Headlines: host-loss is
> *graceful* (migration deferred); TURN ships *$0* (STUN+relay, hook unset); the deterministic
> fire path *auto-falls-back* to active-band delta if the Phase-0 gate fails; player cap is
> *4 with auto-degrade*; v1 content is *one dedicated big-fire co-op scenario in the Daily
> Burn style*; the co-op chunk uses the *official `@supabase/realtime-js`, code-split*.

## 1. Vision, scope, non-goals

### Vision

The in-game teaser already promises it:

> *"One fire too big to fly alone — more towns, crews and rescues than a single pilot can hold. Bring friends."*

Co-op is a **real-time shared world** for **2–4 pilots**. One host creates a room, gets a
short code, and reads it to friends; friends type the code, land in a lobby, and then fly
the **same Saskatchewan** against the **same firestorm** — twice the towns, twice the
crews, more rescues than one pilot can hold. It is **host-authoritative**, **mobile-first**,
and preserves the project's two identities: **100% client-side, no game server** and **~$0
infra** (Supabase carries only lobby + signaling + an optional relay; the host *browser* is
the authority).

### Scope (v1)

- Join-by-code lobby: host → 5-char code → friend types code → lobby roster → shared world → shared debrief.
- 2–4 players, one shared seeded world, host-authoritative simulation.
- Two transports behind one interface: **WebRTC P2P (upgrade)** and **Supabase-Realtime relay (floor)** — relay is the must-work path, P2P is a latency optimization.
- **One dedicated big-fire co-op scenario** in the **Daily Burn style** (date-seeded, deterministic, scaled by player count) — a `buildCoopMission` analog of `missions/daily.ts`, *not* the linear campaign.
- Per-pilot scoring computed locally from a host-broadcast canonical tally.
- Reconnect, late-join, and graceful host-loss with honest player-facing UX.

### Non-goals (v1 — explicitly out)

- **No dedicated game server / authoritative cloud sim.** The host browser is the authority. (Identity-level: never breaks the "no backend game logic" rule.)
- **No TURN by default** (it costs money). Symmetric-NAT pairs ride the relay. An *unset* `VITE_TURN_URL` hook exists for a future operator (§3.5).
- **No seamless, invisible host migration** promised to users. v1 ships **honest, graceful** host-loss (persist outcome, return to lobby with the same code). An optional best-effort migration is gated behind §11 risks and the RLS fix.
- **No procedurally-generated co-op terrain.** The co-op scenario reuses the existing seeded `World`; only the fire/structure/crew *placement* is generated (Daily-Burn-style), scaled by `coopScale`.
- **Solo Daily Burn stays solo.** The co-op big-fire scenario *borrows* the date-seeded generator from `missions/daily.ts`, but the solo daily challenge itself is not co-op. No spectator mode, no replay, no voice chat.
- **No cross-version play.** A build-hash / data-epoch mismatch is rejected at the lobby door (§3.4).
- **No rollback netcode.** Own-heli prediction uses soft reconciliation only (§4.3).

---

## 2. Player experience — join-by-code, end to end

Mobile-first, dead simple. All co-op screens live in `src/three/ui/coop/` and are styled
**only** from `ui/theme.ts` tokens per `DESIGN.md` — no second `UI` object, no hard-coded
colour/blur/shadow.

### 2.1 The happy path

1. **Host taps CREATE** on a co-op-eligible mission card. Their device generates a 5-char code locally (`crypto.getRandomValues`), collision-checks it once, inserts a `rooms` row, opens the room's Realtime channel, and shows the code big: **`BR4VO`**.
   - The CREATE screen **echoes the code phonetically** ("BR4VO — say: bee-arr-four-vee-oh") because over-the-phone relay is the real channel.
   - A **"best on a strong connection"** hint appears at CREATE: the host is the egress-heavy, sim-heavy role (§8, §11.2).
2. **Friend taps JOIN**, types the code. Input is **normalised**: uppercased, and human-confusables mapped (`O→0`, `I/L→1`, `S→5`) so "oh / ell / eye / ess" read aloud still resolve. The display alphabet excludes ambiguous glyphs; the *input* normaliser tolerates the human ones.
3. The friend sees the lobby card: **`Sparrow's room · Today's Big Burn · 2/4`**, then taps **READY**. Presence on `room:<CODE>` is the live roster + heartbeat.
4. In parallel, the host attempts a WebRTC connection to each joiner (signaling over Realtime Broadcast). The **relay transport is already live** the instant they join, so the lobby and the mission can start regardless of whether P2P ever connects (§3.5).
5. **Host taps LAUNCH.** A `control:start` event boots every peer into the same `MissionDef` against the locked `world_seed`. No page reload (the long-lived `SceneRouter`, §7, owns the renderer).
6. **Shared world.** Everyone flies the same Saskatchewan. Remote pilots appear as interpolated helis with their own slung bucket and rope (§6). Fires, towns, crews, wind, objectives are one shared host-authoritative world.
7. **Shared debrief.** When the host's `MissionRuntime` latches won/lost, it broadcasts the **canonical world tally + per-pilot attribution**; each client computes its **own** grade locally (§9) and shows a personal end card. The host taps **NEXT** → `control:advance` routes everyone to the next mission via `SceneRouter`, **transport surviving** (no reload, no dropped channel).

### 2.2 Late-join (the common case — you tap LAUNCH while a friend is still typing)

The room stays **joinable during `playing`** up to `max_players`. A late friend's JOIN screen
shows **`In progress · Today's Big Burn · 3/4 · JOIN NOW`**; one tap and the host's
`control:fullState` (fire keyframe + sim snapshot, §4.4) hydrates them live. Scoring is
gated to **post-join** per the attribution model (§9). If a session is genuinely full or
ended, the JOIN screen says exactly which (§2.4).

### 2.3 Reconnect (mobile background-suspend reality)

Mobile browsers **suspend JS timers and the websocket the instant the tab backgrounds** — a
screen-lock, a phone call, a notification, a wifi→cellular handover. The reconnect design is
built for this, not against it:

- **Grace window ~30–45s**, keyed off Presence-leave **and** a `visibilitychange` "backgrounded" hint — **not** an 8s host-clock timer. A friend who locks their phone for 20s is **not** ejected.
- On return, the client does **not** try to step forward through the gap (the no-fast-forward invariant, §4). It drops straight into the **§4.4 keyframe resync** and snaps its tick to the host's current `T`.
- The player sees a real **"Reconnecting to Sparrow's room…"** overlay with a **manual rejoin** button (silent freezes are what make non-technical users force-quit).
- Their own (frozen) heli **snaps to a safe hover** at its last known position with a brief "resyncing" fade — never a mid-firestorm teleport.
- **Failure branch:** after grace expiry they get a **"Session continued without you — Rejoin?"** screen that re-enters via the **same code** (not a dead end).

### 2.4 Four distinct join outcomes (each with a recovery action)

Never one generic "room not found." The JOIN flow distinguishes:

| Outcome | Message | Recovery |
|---|---|---|
| not found | "Check the code — letters and numbers only" | re-type |
| expired | "That room closed — ask your friend to make a new one" | back to menu |
| full | "Room's full (4/4)" | back to menu |
| already started + full / not-joinable | "They've already taken off — wait for the next mission" | back to menu |
| version mismatch | "Host is on a different version — update and retry" (§3.4) | back to menu |

---

## 3. Architecture decision

**Host-authoritative shared world. Room-code lobby + WebRTC signaling over Supabase
Realtime. WebRTC P2P data-channel transport, with a Supabase-Realtime-broadcast relay
*fallback* behind ONE `Transport` interface.** Networking lives entirely in a new
`src/three/net/` layer; the sims stay engine-agnostic.

### 3.1 Why host-authoritative, not dedicated server

A dedicated authoritative server would mean a backend, an ops cost, and a deploy target —
all three forbidden by the project identity. The host *browser* already runs the full
deterministic sim every frame; making it the single arbiter of shared world state costs **no
new infra**. The trade is host-loss handling (§7, §11.2), which we address with persisted
outcome + graceful lobby-return rather than a server.

### 3.2 Why relay-first, P2P-as-upgrade (not the reverse)

If the relay is an emergency parachute, it is rarely exercised and therefore buggy precisely
when needed. Inverting it makes **the must-work path the path everyone runs every session**.
The relay (`RelayTransport`) is live the instant a peer joins the lobby; WebRTC
(`RtcTransport`) is attempted in parallel and **promotes** a peer to P2P only after its
DataChannel opens and a ping round-trips within a 6s budget (§3.5). The game layer never
knows which transport a given peer is on.

### 3.3 The transport substrate (the realtime client — a real, sized dependency)

> **This is the load-bearing decision the first draft hand-waved.** The project has **zero
> websocket/realtime dependencies** today — `package.json` lists only `three`; the
> leaderboard and cloud-save deliberately use plain `fetch` over PostgREST. Supabase
> Realtime is a Phoenix-channels **websocket** protocol; you **cannot** reach Broadcast or
> Presence with `fetch`. The relay floor, signaling, and presence therefore have **no
> implementation substrate** until we add one.

**Decision:** add **`@supabase/realtime-js`** (pulls `phoenix`) as the realtime client, **but
fully code-split it** so the solo bundle is byte-identical:

- The entire `src/three/net/` tree (and `@supabase/realtime-js`) is loaded via a **dynamic `import()`** that only fires when a co-op code is present (`?room=<CODE>` or a lobby tap) **and** `isCoopConfigured()` is true.
- A solo player **never downloads** the realtime client; `isCoopConfigured()` returning false means `createCoopSession()` returns `null` and `Game` runs byte-for-byte as solo.
- **Pin the dependency + record the gzipped bundle delta** (expected ~40–50 KB gz) in this plan's delta log when Phase -1 lands. Env-gating *execution* is not the same as gating *bundle weight* — code-splitting is what makes the solo bundle unchanged.

> Alternative considered and rejected for v1: hand-rolling a thin Phoenix-channels client
> (the team already hand-rolls over SDKs for PostgREST). Rejected because the Phoenix
> heartbeat/rejoin/ack state machine is fiddly and a connectivity bug there strands the
> must-work relay floor. Revisit only if the bundle delta proves unacceptable.

### 3.4 The join contract (kills the whole determinism-mismatch risk class at the door)

`world_seed` + `data_epoch` + `build_hash` (short git hash baked at build) form the **join
contract**. A joiner whose `build_hash` or `data_epoch` differs is **rejected at the lobby**
— *"Host is on a different version"* — **before any sim is constructed**. This is one string
comparison that eliminates the entire "different fuel map / different config const / wild
divergence" class. **Critically, the contract is delivered by the host over the transport
handshake, not trusted from the mutable `rooms` row** (see §10 — a leaked code must not let
an anon repoint the world).

### 3.5 TURN reality, and how it's handled

WebRTC needs TURN to connect symmetric-NAT / carrier-grade-NAT pairs — which is a
**meaningful fraction of the exact population join-by-code targets** (mobile friends on
cellular). We ship **no TURN by default** (TURN costs money and breaks $0). The handling:

- **The relay IS the floor and the true default.** WebRTC is allowed to *never* succeed for a given pair; that pair simply plays on relay. So the connectivity story does **not** depend on hole-punching.
- **STUN-only** (Google public STUN) for the P2P upgrade; if ICE fails or never opens within 6s, the peer stays on relay. A small `P2P`/`RELAY` HUD glyph per peer; nothing ever blocks.
- **Optional TURN hook** `VITE_TURN_URL` / `VITE_TURN_CRED` exists but is unset; a future operator can fund a $5 coturn or Cloudflare Calls TURN and slot it in with **no code change** — the difference between "mostly connects" and "connects."
- **The full bandwidth budget is validated over relay** (§8), because relay — possibly at the degraded 6 Hz rate (§4, §11.5) — is the real shipping floor.

### 3.6 Cost story (~$0)

Supabase is already in the project (leaderboard + cloud-save). Co-op adds **one `rooms`
table** + the Realtime websocket (same project, same bill). P2P sessions cost Supabase only
signaling. Fully-relayed sessions count gameplay bytes against the 5 GB/mo egress (§8 sizes
the ceiling). **Net new infra spend: $0** (unless an operator opts into TURN).

---

## 4. Netcode model

### 4.1 Authority — host-authoritative world, locally-owned pilots

Pure host-authority over a remote pilot's *own* aircraft would make their *own* helicopter
feel laggy — unacceptable for a game whose identity is "flight that feels real." So authority
is split:

| State | Authority | Why |
|---|---|---|
| **Your own heli + bucket** | **You** (owning client), simulated locally from your `Input` | Zero input latency on the craft you fly. Non-negotiable. |
| **Remote pilots' helis/buckets** | their owning client → relayed by host; you **render** via interpolation | You only watch them; interpolated 100–300ms lag is invisible. |
| **Fire field, Structures, Wind, CrewTransport, MissionRuntime/Director** | **Host** (single authoritative copy) | The shared world. Clients re-step deterministically (§4.2) and accept host correction. |
| **Drops** (the gameplay verb) | **Host resolves; client predicts VFX** | One `douse()` arbiter → peers never disagree how much fire died (§9). |

A "client" is **not a dumb terminal**: it is a peer running the same deterministic sim, whose
only network-fed world inputs are (a) **wind state**, (b) the **spotting-RNG-call counter +
heat rolling-hash**, and (c) the **reliable drop/ignite event log**. The host is the arbiter
of event ordering and the tiebreaker on divergence — not a video server. This is closer to
deterministic lockstep than client-server, but with **per-pilot input locality** so flight
feels instant, and a **host snapshot fallback** when a peer drifts.

### 4.2 Tick / snapshot / input model

**Two clocks, deliberately decoupled:**

- **Deterministic world tick: fixed 30 Hz** (`FIXED_DT = 1/30`), accumulator-driven, for `FireSystem`, `Wind` consumption, `Structures`, `CrewTransport`, `MissionRuntime`. The fixed step is the linchpin of determinism: every peer feeds byte-identical `dt` into the cellular step → no `charTime += dt` rounding divergence, no frame-rate-jitter spotting-branch divergence. It's free at runtime — the fire field already updates sub-60Hz visually; the render layer interpolates the char/ember field for the shader.
- **Your own flight sim: per-frame variable dt** (unchanged). It is *not* in the deterministic set — it's locally owned and streamed as state, so nobody re-steps it; its float drift is irrelevant.
- The host stamps every world packet with a **logic tick `T`**. Clients apply wind/events at the matching `T` via a small ordered queue → "tick T on host" == "tick T on client." This resolves out-of-order wind/drop arrival: events carry their tick; clients apply in tick order.

**Input is NOT streamed.** Each pilot simulates their own aircraft and streams the *resulting
quantized state* (heli pose + vel + fill). The host needs the resolved pose to fan out and to
validate drops — not the raw stick. This halves uplink and removes a reconciliation
round-trip for the common case.

**The catch-up time bomb — handled explicitly.** `main.ts` clamps `dt` to 1/20 and
**skips stepping entirely while the tab is hidden** (`if (hidden) { prevTime = 0; return }`).
A wall-clock-rebased fixed tick would otherwise accrue seconds of un-stepped fire ticks on
every backgrounding — and the no-fast-forward rule forbids replaying them. **Resolution:** a
tab-hidden or long-stall event is an **explicit resync trigger, never an accumulator
catch-up.** When hidden-time or accumulated tick-debt exceeds **0.5s**, the client does **not**
step forward — it drops into the §4.4 keyframe resync and snaps its tick to the host's
current `T`. This makes "the most normal thing a phone does" a bounded resync, not a silent
desync.

### 4.3 Own-heli prediction + remote-heli interpolation

- **Own heli:** predicted from local input every frame. On each pilot snapshot it sends, the host echoes the authoritative pose it validated; the client compares. Error `< ~0.5u` → **smooth-lerp over ~100ms** (no visible pop on a stable link). Large error (a host-side crash/collision the client didn't predict) → **hard-snap**. **No rollback / server-rewind** — soft correction suffices for a trailing-camera flight sim and keeps the code small.
- **Remote helis:** rendered at `now − interpDelay` via **cubic Hermite** using the streamed `velX/velZ` as tangents — smooth through a dropped packet.
  - **`interpDelay` is sized for 15Hz-quantized, jittery cellular RTT, not just RTT.** Remote poses arrive at one snapshot per **66ms (P2P 15Hz) / 100ms (relay 10Hz)**. Hermite needs ≥2 buffered snapshots, so `interpDelay = max(2 × snapshotInterval, smoothedRTT + rttJitterEMA)` with a **floor of ~150ms** (≈200ms P2P, ≈300ms+ relay).
  - **Extrapolation is clamped.** Never Hermite-extrapolate beyond ~1 snapshot interval past the last sample; past that, **freeze the remote at its last pose (decay velocity → 0)** rather than fly it off on a stale tangent. A banking heli's velocity changes fast, so unclamped extrapolation overshoots and lurches.
  - A **"remote stale" visual** (fade/ghost) reads a frozen remote as connection-lag, not a physics bug.
  - **Phase-5 exit criterion validates this on injected 150ms+jitter latency specifically on BANKING turns** (straight-line flight hides tangent-extrapolation error).

### 4.4 The fire-field sync decision (the crux)

**Decision: deterministic re-step + thin event sync (primary), with active-band-delta and
full-keyframe resync as the bounded fallback** — *contingent on the Phase 0 cross-ISA gate
passing*; if it fails, the active-band delta becomes the steady state (§4.5, §11.1).

The fire field is **`FIRE3D.fireCells²` cells** of Float32 `heat`. Every other model puts a
version of that on the wire; deterministic re-step puts almost nothing:

| Model | Steady-state cost (4p, fire raging) | When expensive | Verdict |
|---|---|---|---|
| A. Stream full quantized field | u8 × N² per keyframe + deltas | keyframe bursts stall a phone uplink | rejected as steady state |
| B. Active-band delta | ~200–1500 changed cells × 3 B/sync | **peaks when the firestorm peaks** | fallback, not steady state |
| **C. Deterministic re-step + event sync** | wind 12 B + RNG counter/hash + ~0–2 events × 16 B | flat ~**0.15–0.18 KB/s** | **CHOSEN (primary), pending §4.6 gate** |

**Why C cascades:** every downstream consumer — terrain char shader, ember glow, radar scar,
`Structures.update()` damage, `CrewTransport` casualty checks, smoke/ember emission, HUD
`firesActive` — reads from a **locally-stepped `FireSystem`**. If every peer's
`FireSystem.update(FIXED_DT, wind)` is byte-identical, **none of those subsystems need syncing
either — they fall out for free.** Models A/B must separately reconcile structures/crew/radar
because their fire is a passive received buffer.

**What the host sends for fire (steady state):** wind state (10 Hz), `fireRngCalls` counter +
a periodic `heat[]` rolling-hash (§4.6), logic tick `T`, and drop/ignite events on the
**reliable** channel applied in tick order. The fire field **never crosses the wire in steady
state.**

**The escape hatch (recovery, not steady state):**
- **Active-band delta** (`[idx:u16, heat8:u8]` for dirty cells, typically <1 KB) patches a *small* transient divergence (one dropped event before the next checksum).
- **Full keyframe** (`serializeFull()`: u8-quantized `heat` + bit-packed `scorch` + `wet` + `preheat` + `charTime` + `fireRngCalls`, RLE-compressed) is the heavyweight resync for hard divergence, late-join, and post-background resync.
- **Keyframe cost is sized for cellular at the *worst* compressibility** — a raging firestorm where few cells are 0/stable is exactly when the field is least RLE-compressible **and** when a player is most likely to background to read a notification. Phase 4 **measures** the RLE'd worst-case keyframe and documents the expected resync frequency on a real phone. If resyncs land every 30–60s, the "flat 180 B/s" headline is amended and the relay-headroom math (§8) is recomputed by the keyframe multiple. **This is a measured number, not an assumed one.**

### 4.5 Killing the two true nondeterminism sources (verified in code)

1. **Wind** — `Wind.ts:32` and `:54` both call `Math.random()`. Clients **never call `wind.update()`** (it becomes a no-op on clients). The host sends authoritative wind **state**; clients `applyState()`. **Wind sync is tick-stamped per fire tick, not a bare 10 Hz state push** (see §4.7 — the 10 Hz-wind / 30 Hz-fire mismatch is itself a latent desync), and `Wind.serialize()` carries the **full mutable set including `_dynScale`/`dynScaleTarget`/`dynScaleEase`** (omitting them desyncs gust-beat spread, because `get strength()` multiplies by `_dynScale`).
2. **Spotting RNG** — `FireSystem.ts:336–338` makes **three** `this.deps.rng()` calls per spot. `FireSystem` gets its **own dedicated counter-based stream** `fireRng = mulberry32(missionSeed ^ 0xF14E)`, **seeded from the mission seed alone, never threaded from `world.rng`** (see §4.6 — `world.rng`'s absolute position is device-dependent today). Because every peer steps the same cells in the same order with the same `dt` and the same wind, every peer makes the same `fireRng` draws → identical spots, **zero bytes**.

### 4.6 The determinism prerequisites the first draft under-weighted (HARD blockers)

> The codebase does **not** "already 90% pay off" determinism. Two verified facts make fire
> placement **cross-device divergent today**, and they are hard prerequisites — they must
> land and be **proven cross-device/cross-tier in Phase 0 before any wire code**.

1. **`world.rng` stream position is per-device.** The main conifer forest (`Game.ts` ~480–491) consumes `world.rng` with a candidate count gated on the per-device **QualityTier** (`tier.current.name === 'low' ? 1 : FOREST.densityMul`). A low-end phone and a high-end laptop advance `world.rng` to **different stream positions** before `FireSystem` is even built — and `FireSystem` is constructed with `rng: this.world.rng`. So initial fire spawn (`spawnInitial`/`pickSite`, which also draw from `world.rng` via `scenario.ts`) **and** every spotting draw already diverge cross-device. **Fix (mandatory, not "hardening"):**
   - Seed `fireRng` from the mission seed **alone**; never thread `world.rng` into `FireDeps.rng` or `pickSite`.
   - Make **all gameplay-deterministic placement** (fire spawn, spotting, structure/crew placement) draw from **dedicated mission-seeded streams**, never from `world.rng`'s post-construction position. Give the **main forest its own `speciesRng` stream** too (groves/snags already use their own per §verified `World.ts`), so nothing tier-gated can shift a gameplay stream.
2. **Tier-gated forest density also changes the collider set.** Forest candidates feed `Obstacles` (the bucket/heli collision surface) **and** `FireSystem.fuelAt` sampling. A different candidate count = different burnable-tree fuel **and** different bucket canopy-snag colliders across tiers — a remote bucket follower (§6) can collide differently even after the RNG fix. **Fix:** lock the **collision-and-fuel-relevant world build to be tier-INDEPENDENT.** Tier may scale LOD/visuals, but must **not** change the number or placement of burnable trees, colliders, or bridge valleys. Add a **Phase-4 cross-tier assertion** that `Obstacles.colliders.length` and the fuel map match across peers, not just `world_seed`/`build_hash`.

### 4.7 Wind cadence — tick-stamped, not 10 Hz state

Sending wind **state** at 10 Hz while the fire steps at 30 Hz **guarantees** host and client
feed *different* wind into the two intervening fire ticks (the client holds a stale vector),
breaking the "byte-identical dt AND wind" premise. **Resolution (pick one, decide in Phase
0):**
- **(a) tick-stamped wind:** host sends the exact wind vector **per fire tick `T`** (batched, ~12 B × 30 Hz ≈ small), clients apply the host wind at the matching `T`; **or**
- **(b) replicated deterministic wind:** host sends only beat events; clients run `wind.update()` with the same `FIXED_DT` and a **seeded** wander stream replacing the two `Math.random()` calls — making wind itself a deterministic stream that needs no per-tick sync.

Default to **(b)** if Phase 0 proves the seeded wander is cross-ISA stable (cheapest on the
wire); fall back to **(a)** otherwise. Either way the 10 Hz-state push is **not** the steady
state.

### 4.8 The riskiest determinism assumption (cross-ISA `heat[]` identity)

The per-cell `heat` integration is order-stable (a fixed traversal, not a reduction). The one
non-associative sum the survey flags (`bX[b] += wx*h`, cluster centroids) feeds the **flame
*mesh* view**, not the gameplay `heat[]`/`scorch[]` grid — cosmetic and self-limited. **But**
the spotting gate (`wlen > 0.5 && h > 0.75`) and the Pass-B ignite-threshold crossing are
**discrete branches on float paths that also touch `Math.atan2/cos/sin`.** A 1-ULP drift
across ARM vs x86 near `h > 0.75` flips a branch, changes the `fireRng` draw count, and
desyncs `fireRngCalls` — which would make "rare bounded resync" **continuous**. Mitigations,
decided **empirically in Phase 0 on real ARM + x86 before committing to the deterministic
path**:
- **Quantize the comparison inputs** (round `heat`/`preheat` to a fixed decimal) right before the `h > 0.75` and Pass-B threshold branches so sub-ULP drift can't flip them; **and/or**
- accept that `fireRngCalls` will diverge cross-ISA and make the **active-band delta the steady-state fire sync at a low rate** (the budget then absorbs Model B's cost — recompute §8).

**A `fireRngCalls` counter alone is insufficient as a desync detector** (it misses a drift
that doesn't change draw counts). Belt-and-suspenders: a cheap **`heat[]` rolling-hash**
(xor-fold, computed off the fixed tick, sent at ~1 Hz, ~4 B/s) closes the gap and is the
detector of record.

---

## 5. The sim-boundary plan

The boundary stays sacred: each method is **numbers-only on the sim class** — no `Scene`, no
DOM, no `net/` import. The `net/` layer **calls** these; the sims never call `net/`. These
are the **only** additions to `sim/*.ts`, and they are **headless-unit-testable** via the
existing pure-sim Node path (`verify:campaign` must stay green — proof the boundary held).

| Sim | `serialize()` (host reads) | `applyState()` / apply* (client writes) | Notes |
|---|---|---|---|
| **HelicopterSim** | `{x,y,z, yaw,bank,pitch, vx,vz, agl, altVel}` | same; **also reset `prev*`/`sm*Acc`** to avoid a reconciliation transient | owner serializes; remotes apply into a ghost sim used only for interp |
| **BucketSim** | `{x,y,z, tip, fill}` | same; zero `vel` for remotes | **not** streamed steady-state (derived, §6); serialized only for late-join snapshot |
| **FireSystem** | `serializeFull(): {heat:Uint8Array, scorch:Uint8Array(bitpacked), wet:Uint8Array, preheat:Uint8Array, charTime:Uint8Array, fireRngCalls}`; `readonly fireRngCalls`; `heatHash()` | `applyFull()`, `applyHeatDelta(idx[],heat8[])`, `applyDrop(e)`, `applyIgnite(e)` | clients step it deterministically from synced wind+events; field never streamed steady-state. Dedicated `fireRng` stream (§4.5). **Checkpoint/keyframe carries the FULL mutable set** (`preheat`+`charTime` included — §11.3) |
| **Wind** | **full mutable set**: `{angle, strength, angVel, elapsed, targetAngle, angleEase, _dynScale, dynScaleTarget, dynScaleEase}` | `applyState()`; **client `update()` → no-op**; or seeded-wander replica (§4.7) | omitting `_dynScale` desyncs gust-beat spread |
| **Structures** | changed-only `[{idx, health8, flags}]` | `applyHealth(...)`; clients derive locally, host corrects on mismatch | placement seeded → identical list across peers (given §4.6) |
| **CrewTransport** | `{carrying, delivered, done[], lost[], active, dwell, exposure[]}` | `applyState()` | host-authoritative; clients display-only |
| **FuelSim** | `{fuel, starved}` | `applyState()` | **per-pilot** — host runs N copies |
| **HealthSim** | `{health, dead, fatalImpact}` | `applyState()`; **send `dead` directly, never derive from `health<ε`** | **per-pilot** (survey risk: float-round death) |
| **MissionRuntime** | latched sub-task ledger + state | apply latches **monotonically** | client never un-latches (irreversible-latch invariant) |
| **RotorWash** | — | **nothing — derived locally** from synced agl+collective | pure VFX, never synced |

**Per-pilot vs singleton:** `HelicopterSim`, `BucketSim`, `FuelSim`, `HealthSim` are
**per-player** (host runs N authoritative copies). `FireSystem`, `Structures`, `Wind`,
`CrewTransport`, `MissionRuntime` are **singletons** (the one shared world).

---

## 6. The `src/three/net/` module shape

### 6.1 Module tree

```
src/three/net/
  index.ts                 // isCoopConfigured(); createCoopSession(missionDef, role) — env-gated, dynamic-imported, returns null when unconfigured
  CoopSession.ts           // top orchestrator: owns Transport + Host|Client + RemotePlayer map + role
  ConnectionManager.ts     // per-peer relay→webrtc promotion, RTT, watchdogs, migration trigger
  CoopGameHooks.ts         // the ONLY interface Game.ts imports (beforeWorldSims / afterUpdate / poseRemotes)

  lobby/
    Lobby.ts               // rooms REST (plain fetch + withTimeout, mirrors leaderboard/client.ts)
    Presence.ts            // Realtime presence channel wrapper (roster + heartbeat + visibility hint)
    roomCode.ts            // generate/validate/normalise 5-char codes (confusable map; phonetic echo)
  transport/
    Transport.ts           // the interface (§6.2)
    RtcTransport.ts        // WebRTC star, STUN-only, 2 DataChannels/peer
    RelayTransport.ts      // Supabase Realtime Broadcast impl (the FLOOR)
    Signaling.ts           // SDP/ICE over Realtime Broadcast (no DB)
  host/
    Host.ts                // after game.update(): drain sims → serialize → fan out; ingest pilot snapshots
    DropArbiter.ts         // SOLE caller of fireSystem.douse(); applies same-tick drops in a TOTAL ORDER; tags attribution
    Snapshotter.ts         // pack sim numbers → reused ArrayBuffer
    Checkpoint.ts          // ~1 Hz (active-fire) rooms.checkpoint upsert (migration spine, §7)
  client/
    Client.ts              // apply host wind/events/signals into LOCAL deterministic sims; send own snapshot
    Predictor.ts           // local own-heli prediction + soft reconciliation
    Interpolator.ts        // per-remote Hermite snapshot buffer (jitter-sized interpDelay + clamped extrapolation)
    Resync.ts              // fireRngCalls + heatHash watch → request delta-patch or full keyframe; tab-hidden/stall trigger
  RemotePlayer.ts          // THE ONE new Three-touching net file: remote heli+bucket+rope meshes
  wire.ts                  // DataView pack/unpack into REUSED buffers; q16/q24/angle8/angle16 quantizers
  protocol.ts              // message-type enums, tick-stamping, checksum/hash, channel policy
```

**Boundary rule (hard):** everything in `net/` **except** `RemotePlayer.ts` and
`CoopGameHooks.ts` is **number-only and Three-free** — it reads/writes the public sim fields
exactly as `Game.ts` does. `RemotePlayer.ts` is the **single** new Three-touching net file and
it **reuses** Game's pose math. `net/` never imports `Game` internals; `Game` imports only the
`CoopGameHooks` interface. The dependency arrow points one way.

### 6.2 The `Transport` interface (the load-bearing seam)

```ts
// src/three/net/transport/Transport.ts
export type PeerId = string;
export type Channel = 'state' | 'input' | 'event' | 'control';
// state   = unreliable/unordered (pilot poses, wind/RNG)
// input   = unreliable (rarely used — input is not streamed steady-state, §4.2)
// event   = reliable/ordered (drops, ignites, beats, outcome)
// control = reliable (lobby / late-join / migration)
export interface Transport {
  peerMode(id: PeerId): 'webrtc' | 'relay';
  send(to: PeerId | 'all', ch: Channel, bytes: ArrayBuffer): void;   // NEVER throws (leaderboard ethos)
  onMessage(cb: (from: PeerId, ch: Channel, bytes: ArrayBuffer) => void): void;
  onPeerJoin(cb: (id: PeerId) => void): void;
  onPeerDrop(cb: (id: PeerId, reason: 'left' | 'timeout' | 'ice') => void): void;
  rttMs(id: PeerId): number;                                          // smoothed; sizes interp buffer
  close(): void;
}
```

- **`RtcTransport`**: one `RTCPeerConnection` host↔each client (**star, never mesh** — the hub matches the authority). Two DataChannels per peer: `unreliable` (`{ordered:false, maxRetransmits:0}`) for `state`/`input`; `reliable` (`{ordered:true}`) for `event`/`control`. ICE = Google public STUN, **no TURN** (§3.5).
- **`RelayTransport`**: wraps Realtime Broadcast (`channel.send({type:'broadcast', event, payload})`). Same interface. ~150–250ms slower; runs at the relay rate. Gameplay bytes over relay count against egress; P2P costs only signaling.
- **Coalesce per-tick streams into ONE datagram** (pilot poses + wind + RNG + signals) per `send`, to cut **packet count** — battery and cellular-radio cost scale with packet count and radio-wake events, not just bytes (§8, §11).

### 6.3 The single Game.ts seam (minimal-edit, survey-validated)

`Game` gains **one optional field**, **one map**, and **three call-sites**, all routed through
`CoopGameHooks` so solo `Game` is byte-identical when `hooks` is undefined.

```ts
// Constructor: accept hooks?: CoopGameHooks; remotes = new Map<PeerId, RemotePlayer>()

// Call-site 1 — start of update(dt), CLIENT: ingest before local world sims step
const skipWorld = this.coop?.beforeWorldSims();
// client: applies wind/events/signals/remote-snaps; steps fire deterministically from synced wind+events;
//         returns true → Game SKIPS fireSystem/structures/crew/wind .update() in the host-authoritative block
// host:  no-op, returns false (host runs everything)

if (!skipWorld) { /* existing wind/fire/structures/crew steps */ }
// (your OWN heliSim/bucketSim.update() ALWAYS run — local prediction)

// Call-site 2 — end of update(dt), HOST drains & broadcasts; CLIENT reconciles own heli
this.coop?.afterUpdate(dt);

// Call-site 3 — right after the local heli/bucket pose block, BOTH roles:
for (const r of this.remotes.values()) r.pose(dt);   // interpolated; reuses shared pose fn
```

**Shared pose code, not duplicated:** extract the existing local heli+bucket+rope math
(`Game.ts` ~928–936, ~1907–1950) into a free function
`poseHeliBucketRope(meshes, pos, yaw, bank, pitch, bucketPos, tip, fill)` that both the local
player and every `RemotePlayer` call → remotes can never look different from locals.

### 6.4 `RemotePlayer` (the one new Three-touching net file)

Owns `createHelicopter(heliId)` + bucket + `THREE.Line` rope (reusing existing builders, so
remote pilots fly **their own unlocked heli** — `heliId` rides the join handshake), a private
**kinematic `BucketSim` follower**, and an `Interpolator`. `pose(dt)` renders at
`now − interpDelay` (§4.3) with clamped Hermite.

- **Mesh pool is fixed at lobby start** (max 3 remote rigs allocated up front when the room locks to N players); a leaver hides their rig, a late-joiner reuses a hidden slot → honors "no per-frame add/remove, no recompiles."
- **Bucket follower discipline (the uncounted-CPU fix):**
  - Drive the follower `BucketSim` from the **smoothed post-Hermite** remote pose, **never** the raw snapshot, and **clamp its input velocity** so an extrapolation overshoot can't kick the pendulum into rope spasms.
  - **LOD the rope:** for distant remotes, skip the per-segment catenary BufferAttribute rewrite and draw a **2-point straight line**; run the full follower-BucketSim + catenary rebuild **only** when a remote is within camera-near distance. (Per-frame rope geometry rewrite × (1+remotes) is real GPU-upload churn the budget must respect — see §8, §11.)

### 6.5 The wire format (quantized hard, reused buffers)

```
PilotSnapshot (per pilot, per tick):
  peerId        1 B   (room-local index 0..3)
  seq           1 B   (wrap counter for interpolation ordering)
  pos.x, pos.z  2×3 B (24-bit fixed-point over world bound)
  pos.y (alt)   2 B   (16-bit over 0..1024u)
  yaw           2 B   (16-bit angle)
  bank, pitch   2×1 B (8-bit angle)
  velX, velZ    2×2 B (16-bit, Hermite tangents)
  bucketFill    1 B   (8-bit 0..1)
  flags         1 B   (bucketAttached, dropping, crewAboard, crashing — bitfield)
  = 21 bytes/pilot/snapshot
```

**Bucket position is NOT sent** — derived on every peer by the follower `BucketSim` (§6.4),
saving 8+ B/pilot and making the rope *swing* instead of teleporting. All packing uses **one
preallocated `ArrayBuffer` per channel, reused every tick** via `DataView` — **no JSON in the
hot path** (JSON allocates and is 3–4× larger). This holds the mobile-60fps "reuse buffers, no
per-frame alloc" invariant by construction.

> **No-alloc audit (mandatory before N-peer ship):** `FireSystem.rebuildReps()` (~579–585)
> currently allocates `const picked:number[]=[]` + `.push` + two `.sort` **every step** — a
> per-frame allocation that violates the no-alloc invariant and now runs on **every client**.
> **Preallocate the `picked` buffer** (and any other per-step allocations on the now-mandatory
> client fire path) before this ships to N peers. **Gate `FireFieldTexture.pack()` +
> `needsUpdate` to fire only on the 30 Hz tick the field advanced, not every render frame** —
> halving a full-grid texture upload on every device for free (§11 minor).

---

## 7. The page-reload problem → `SceneRouter`

Today a mission switch is `location.assign()` (`main.ts:135`) → full page reload, and the
renderer is **constructed per-mission in `bootMission`** (`main.ts` ~164). A reload would
**kill the WebRTC DataChannel and the Realtime websocket.** Co-op cannot reload mid-session,
and **any** transition (NEXT, retry, return-to-lobby) currently reloads — so without this,
Phases 3–5 ship a "co-op" that **disconnects everyone at its own end screen.**

**`src/three/SceneRouter.ts`** owns the **long-lived** `WebGLRenderer` + `Composer` +
`CoopSession`, and swaps `Game` instances **without reloading**:

```
router.enter('mission', missionDef)  // game?.dispose(); game = new Game(...); renderer.setAnimationLoop(...)
```

- `Game.dispose()` (new): remove its objects from a scene the **router** owns, drop listeners, free GPU buffers. Renderer/composer/transport **persist**.
- **Solo keeps the old reload path** (zero risk, zero regression). **Only co-op uses `SceneRouter`** — gated, additive.
- Scene changes happen **only from paused/ended states** (lobby, debrief), **never mid-flight**. Mid-mission "NEXT" is a host-only control broadcasting `control:advance`; all clients route together, transport surviving into the next mission. This is what makes late-join and mission-chaining possible at all.
- **Pulled EARLY, not last.** Because it gates whether a session survives a single transition, a **minimal no-reload lobby↔mission path is a Phase-3 exit criterion** (returning from a mission to the lobby must NOT drop the transport). The full `Game.dispose()` + GPU-leak gate (heap **and** `renderer.info.memory` stable across N swaps) is its **own milestone** before mission-chaining ships, because inverting the per-boot renderer construction must be done carefully.

---

## 8. Bandwidth + CPU + battery budget (4 players, worst case, fire raging)

> **The byte budget is necessary but not sufficient.** The deterministic model buys ~180 B/s
> for fire by making **every client run the full fire sim locally** — a **CPU** cost the byte
> table never sees. Both budgets are first-class exit criteria.

### 8.1 Byte budget

**Down, per client (from host):**
- 3 other pilots × 21 B × 15 Hz = 945 B/s
- Wind + RNG counter/hash + tick: ~20 B × 10 Hz = 200 B/s
- Mission signals: ~64 B × 4 Hz = 256 B/s
- Drop/ignite events (3 Hz peak): 48 B/s
- Datagram/framing overhead (~8 B × ~30/s, **coalesced to one datagram/tick** per §6.2): ~240 B/s
- **≈ 1.69 KB/s; ×1.6 DTLS/SCTP ≈ 2.7 KB/s ≈ 21 kbps down**

**Up, per client:** own snapshot 21 B × 15 Hz + own drops + overhead **≈ 0.6 KB/s ≈ 5 kbps up.**

**Host (heaviest peer):** fan-out ≈ 3× client down **≈ 8 KB/s ≈ 64 kbps egress.**

A client on congested 3G (~384 kbps usable) spends ~6%; the host ~17%. **The fire subsystem
costs ~180 B/s** — *provided* the deterministic path holds (§4.6/§4.8); if it falls back to
the active-band delta, recompute with Model B's 0.6–4.5 KB/sync.

**Relay headroom (fully-relayed worst case):** 4 peers × 2.7 KB/s × 3600 s ≈ 39 MB/session →
5 GB/mo ÷ 39 MB ≈ **~128 fully-relayed room-hours/month** before paid tier; Realtime
concurrent-connection ceiling (1000 free) → ~250 rooms. **Both are amended by the measured
keyframe-resync frequency (§4.4)** — if backgrounding forces a ~50KB keyframe every 30–60s,
the headline B/s and the room-hour ceiling shrink by that multiple. These are **measured**
launch ceilings.

### 8.2 CPU budget (the axis the model actually bets on)

Every client now runs the full fire step: **three full sweeps over `FIRE3D.fireCells²` cells**
(`FireSystem.ts` ~261, ~351, ~561) **plus** a `FireFieldTexture.pack()` full-grid sweep +
DataTexture upload — where before a pure client-server design let the client skip fire
entirely. **Phase 0 exit criterion adds a real-device CPU pass:** profile
`FireSystem.update() + pack()` on a real **mid-tier Android (≈2021 Snapdragon 7-class)** and
assert the fixed-30Hz fire tick fits in **<4ms**, leaving frame budget for the local flight
sim + 3-remote interpolation + WebRTC/DTLS crypto + render inside 16.6ms. **If it doesn't fit,
the deterministic model is not free on the client → fall back to the host-streamed
active-band delta (`applyHeatDelta`) so clients don't run the fire sim at all.** The fallback
is pre-built precisely so this is a config flip, not a rewrite.

### 8.3 Battery / radio budget

A 10–15 Hz cadence keeps the cellular **modem pinned in RRC-connected** — constant small
packets are worse for battery than occasional bursts, and the host pays it 3× (star). The
mitigations: **coalesce to one datagram/tick** (§6.2) to cut packet count; and a **host
thermal/framerate guard** — if the host's adaptive-DPR watchdog is pinned at the floor or
frame-time stays >20ms for N seconds, surface a **"host struggling"** state and either drop
the world tick to **20 Hz** or trigger host-migration to a cooler/better-uplink peer. **Cap
co-op at the tested player count on cellular and say so in the lobby.**

**Lobby host preference:** Presence reports `rttMs`/downlink hints; the lobby prefers the
best-uplink (and ideally plugged-in/desktop) peer as host — the host is the egress-heavy,
sim-heavy, battery-heavy role.

---

## 9. Co-op game design

- **Scenario — ONE dedicated big-fire scenario, Daily-Burn-style (LOCKED §13.5).** v1 co-op is **not** the linear campaign and **not** the finale — it's a single **`buildCoopMission(seed, playerCount)`** generator, the co-op analog of `missions/daily.ts buildDailyMission`. It is **date-seeded** (a shared "today's big burn" — every room on a given day plays the same world, a natural retention + come-back hook reusing the Daily Burn date→seed path) and **deterministic**; `scenario.ts` resolves placements against the **locked `world_seed`** (all peers agree with zero transmission), scaling fire/structure/crew counts by **`coopScale = playerCount`** → "more towns, crews, and rescues than one pilot can hold," exactly the teaser. Add optional `minPlayers`/`maxPlayers`/`coopScale` to `MissionDef` so the one co-op scenario is a normal catalog entry the lobby filters to. The **solo** Daily Burn is untouched; the two share only the date→seed + count-scaling helpers.
- **Objectives — shared world, shared win.** `extinguishAll`/`protect`/`deliver`/`evacuate` already read *world* counters, not per-pilot. With **one host `FireSystem`/`Structures`/`CrewTransport`**, "any pilot douses the last fire → everyone wins" and "any pilot can ferry a crew leg" fall out for free. `extinguishCount` becomes summed across pilots. `MissionRuntime` runs **host-only**; its latched sub-tasks ride the signals stream to clients (read-only HUD mirror). The irreversible-latch invariant holds because **only the host latches**.
- **Scoring — per-pilot, from a host-canonical tally.** Never ship one pilot's score to another. At mission end the host's reliable `outcome` event carries the **canonical world tally** (`firesDoused, structuresLost, crewsDelivered, elapsed`) **plus per-pilot attribution** the `DropArbiter` accumulated (each pilot's `dousesThatKilledFire`, `litresDelivered`, `crewLegsFlown`, `hardLandings`, `wastedDrops`). Each client runs the **existing pure `computeScore()`** on its own attribution + shared hardship multipliers → consistent grades, personal cards, scorer untouched. The existing `coordination` term (`multi-front`, `flawless`) finally has real meaning. Each pilot submits their own score to the existing per-mission board (stable co-op mission id).
- **Drops are host-arbitrated events (and same-tick ordering is determinate).** A DROP sends a reliable `event:drop{peerId, bucketX, bucketZ, litres, fill, tick}`; the client fires `WaterSpray` VFX + predicted douse instantly (feel). **`DropArbiter` is the SOLE caller of `fireSystem.douse()`.** Because `douse()` is **order-dependent and self-interfering** (it sets `scorch[i]=1` past `extinguishLock`, zeroes `preheat[i]`, and bumps the `extinguishedCells` scoring counter), two same-tick drops on overlapping cells must apply in a **defined total order** — the arbiter **sorts same-tick events by `peerId` then `seq`** before applying, and that sequence is the canonical one. **Clients do NOT re-run `douse()` for scoring**; they consume the host's authoritative per-event `heatRemoved`/`cellsExtinguished` from `DouseResult` (already returned via the reused `_douseResult`) — re-deriving locally would split scores on same-frame overlap. The host echoes `event:dropResult{tick, heatRemoved, killed}` so a pilot gets honest hit feedback even on relay.
- **Scoop** is positional, predicted locally, confirmed by the host's authoritative `fill` byte.
- **Unchanged in v1:** Daily Burn stays solo; helicopter unlocks are per-pilot (each flies what *they've* unlocked; `heliId` rides the handshake); solo campaign progression is untouched (a co-op clear grants each client a local "completed" credit).

**Page-reload-on-mission-switch is resolved by §7's `SceneRouter`** — co-op NEXT/retry/return
route through the long-lived renderer, never `location.assign()`.

---

## 10. Security & privacy

- **No PII anywhere in co-op.** Room codes, `host_id` (the existing anon `getClientId()`), pilot callsign, `heliId`. No email, no auth — consistent with the leaderboard's anon posture. PII-free error telemetry continues via the existing beacon.
- **Room codes as the password.** 5 chars from a 31-symbol unambiguous alphabet (`ABCDEFGHJKLMNPQRSTUVWXYZ23456789`) → ~28.6M codes; 1h TTL; enumeration pointless without auth (acceptable for a casual arcade game).
- **The `rooms` row is discovery-only and locked down** (the first-draft blanket `update using(true)` is a room-takeover hole — a leaked code could flip `state`, repoint `world_seed`/`mission_id`, or fill `players`):
  - **Drop the blanket UPDATE policy.** `world_seed` / `mission_id` / `build_hash` / `data_epoch` are **INSERT-only** (no UPDATE) — a leaked code can't repoint the world.
  - Mutable fields (`players`, `state`, `outcome`, `expires_at`) change **only via a `SECURITY DEFINER` RPC** that checks the caller carries the host's `host_id` token — mirroring the existing `cloudSave` "RPC-as-the-only-door" pattern. Host election (§7/§11) goes through an **atomic compare-and-swap RPC on `host_id`** so the DB is the single arbiter (no split-brain).
  - **The join contract is truth only from the host's transport handshake**, never from the mutable row — the row is a join *hint*.

```sql
-- Discovery-only rooms table. Mutations go through SECURITY DEFINER RPCs (host-token gated).
create table if not exists public.rooms (
  id            text primary key,                 -- 5-char room code
  host_id       text not null,                    -- getClientId()
  mission_id    text not null,                    -- INSERT-only
  world_seed    bigint not null,                  -- INSERT-only (join contract)
  data_epoch    int    not null,                  -- INSERT-only (join contract)
  build_hash    text   not null,                  -- INSERT-only (join contract)
  max_players   int    default 4,
  players       int    default 1,                 -- RPC-only
  state         text   default 'lobby',           -- RPC-only: lobby|playing|ended
  outcome       jsonb,                             -- RPC-only; written the instant win/loss latches
  checkpoint    jsonb,                             -- RPC-only; ~1 Hz migration spine (active fire)
  created_at    timestamptz default now(),
  expires_at    timestamptz default now() + interval '1 hour',  -- refreshed on heartbeat while playing
  constraint rooms_code_len check (char_length(id) between 4 and 8)
);
alter table public.rooms enable row level security;
create policy "rooms read"   on public.rooms for select using (true);
create policy "rooms insert" on public.rooms for insert with check (true);
-- NO blanket UPDATE policy. All mutation via SECURITY DEFINER RPCs:
--   room_join(code, client_id)        -> bumps players, returns row IF joinable (full/started/expired checks)
--   room_set_state(code, host_id, st) -> host-gated state transition
--   room_set_outcome(code, host_id, j)-> host-gated outcome persist
--   room_checkpoint(code, host_id, j) -> host-gated checkpoint upsert + expires_at refresh
--   room_migrate(code, new_host_id)   -> atomic CAS on host_id (single arbiter, no split-brain)
```

- **Signaling over Realtime Broadcast, never a DB table.** SDP/ICE are ~10–20 small one-time messages per host↔client pair, sent as Broadcast events (`event:'sig'`, addressed `to`) on `room:<CODE>`. **Zero DB rows, zero cleanup job, zero enumeration surface.** **Presence** on the same channel is the live roster + heartbeat.
- **Realtime channel auth.** The Realtime anon key has no per-row RLS; the **room code is the channel secret**. Gameplay never touches the DB (only lobby discovery + the RPCs do), so the per-frame attack surface is the transport, not Postgres.
- **Rate-limiting + griefing guard.** The host **validates every inbound event**: `from` is a known peer, `tick` is plausible (drops stale/replayed frames), and pilot positions are within world bounds / movement plausibility. A misbehaving peer is dropped via `onPeerDrop`. TTL cleanup via Supabase cron `delete where expires_at < now()`; **`expires_at` is refreshed on every Presence heartbeat while `state='playing'`** so a long mission never deletes its own room (an idle lobby still expires).

---

## 11. Risks & mitigations

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| 1 | **Cross-ISA `heat[]`/`scorch[]` divergence** under fixed dt — discrete spotting/ignite branches (`h>0.75`, Pass-B threshold) on transcendental float paths flip cross-ISA, desync `fireRngCalls`, turn "rare resync" continuous. **(highest)** | blocker | Quantize comparison inputs before the branches (§4.8). **Validate on real ARM+x86 in Phase 0 BEFORE wire code.** If it fails, switch fire to the pre-built active-band delta as **steady state** (§4.4) and recompute the budget (§8). |
| 2 | **`world.rng` position is per-device** (tier-gated forest) → fire spawn + spotting diverge today | blocker | Dedicated mission-seeded `fireRng`; move all gameplay placement off `world.rng`; give the main forest its own `speciesRng` (§4.6). Prove cross-tier in Phase 0. |
| 3 | **Tier-gated forest changes the collider + fuel set** → remote-bucket collision & fuel differ across tiers | major | Lock collision/fuel-relevant world build tier-INDEPENDENT; Phase-4 cross-tier `Obstacles.colliders` + fuel-map assertion (§4.6). |
| 4 | **Phase-0 strawman gate** — two bare `FireSystem`s always agree; misses the real Game-constructor desync | blocker | Phase-0 gate constructs the **full World+forest+Fauna+FireSystem** chain at forced `tier='low'` vs `'high'` and asserts byte-identical `heat[]`; asserts no gameplay sim draws `world.rng` post-construction (§12 Phase 0). |
| 5 | **CPU/battery, not bytes** — every client runs full fire sim; no proof it fits 16.6ms; host runs 3× DTLS + full sim + render | blocker | Real-device CPU pass (<4ms fire tick) + battery/radio guard as Phase-0/5 exit criteria (§8.2/§8.3); host thermal guard → 20Hz or migrate; active-band-delta fallback if it doesn't fit. |
| 6 | **Tab-background catch-up bomb** — wall-clock fixed tick + no-fast-forward = ~50KB keyframe on every screen-lock | blocker | Tab-hidden/stall (>0.5s) is an **explicit keyframe-resync trigger**, not catch-up; snap tick to host `T` (§4.2). Measure resync frequency + RLE'd keyframe worst-case (§4.4); amend headroom math. |
| 7 | **Transport substrate doesn't exist** — relay/signaling/presence need a websocket client the project lacks | blocker | Add `@supabase/realtime-js`, **code-split** so solo bundle is byte-identical; pin dep + record bundle delta (§3.3). Phase -1. |
| 8 | **No TURN** — STUN-only fails for the cellular/CGNAT population join-by-code targets | blocker | Relay is the **real default floor**; P2P may never succeed and that's fine. Validate full budget over relay on **two physical phones** (Phase 3). Optional `VITE_TURN_URL` hook for a future operator (§3.5). |
| 9 | **`rooms` RLS room-takeover** — leaked code lets any anon flip state / repoint seed / lock full | major | INSERT-only contract fields; SECURITY-DEFINER host-gated RPCs; join contract from transport, not row (§10). |
| 10 | **Reconnect ejects a friend who locks their phone**; silent ~50KB keyframe over a flaky link | major | 30–45s grace keyed off Presence-leave + visibility hint; "Reconnecting…" overlay + manual rejoin; own-heli snap-to-safe-hover; "rejoin?" failure screen; Phase-7 real-phone background-suspend test (§2.3). |
| 11 | **Host on a phone backgrounds** → authoritative sim + fan-out stop; migration risks split-brain | major | **v1 = graceful failure (LOCKED §13.1):** persist outcome, return to lobby w/ same code. **Migration is a deferred fast-follow** — built on the same Phase-7 ~1 Hz checkpoint (full mutable set incl. `preheat`/`charTime`) via atomic-CAS RPC (§10), biasing a strong/plugged-in host (§8.3, §11.3). |
| 12 | **`interpDelay` undersized** for 15Hz-quantized jittery RTT → banking remotes lurch on stale-tangent extrapolation | major | `interpDelay = max(2×interval, RTT+jitterEMA)`, floor ~150ms; clamp extrapolation ≤1 interval then freeze; "stale" ghost; Phase-5 banking-turn jitter test (§4.3). |
| 13 | **Same-tick drop ordering** — `douse()` is order-dependent (scorch-lock, scoring counter) | major | Total order: arbiter sorts same-tick events by `peerId` then `seq`; clients consume host's per-event attribution, never re-run `douse()` (§9). |
| 14 | **Wind serialize incomplete / cadence mismatch** — omitting `_dynScale` + 10Hz-wind/30Hz-fire desyncs spread | major | Full mutable set in `Wind.serialize`; tick-stamped or seeded-replicated wind, never bare 10Hz state (§4.7). |
| 15 | **Per-frame alloc on the now-mandatory client fire path** (`rebuildReps()` push/sort) | major | Preallocate `picked`; audit the client fire path for any per-step alloc before N-peer ship; gate `FireFieldTexture.pack()` to the 30Hz tick (§6.5). |
| 16 | **`SceneRouter` scheduled late** → Phases 3–5 "co-op" disconnects everyone at its end screen | major | Pull early: minimal no-reload lobby↔mission is a **Phase-3 exit**; full `dispose()` + GPU-leak gate is its own milestone (§7). |
| 17 | **Late-join contradicts "closed lobby at LAUNCH"** | minor | Room stays joinable during `playing` up to `max_players`; JOIN shows "In progress · JOIN NOW"; `control:fullState` hydrate; post-join scoring (§2.2, §9). |
| 18 | **Room-code lifecycle dead-ends** (TTL during play, confusables, ambiguous failures) | major | Refresh `expires_at` on heartbeat while playing; normalise input (uppercase + confusable map); four distinct failure messages; phonetic echo on CREATE (§2.3, §2.4, §10). |
| 19 | **`fireRngCalls` is a weak desync detector** (misses non-draw-count drift) | minor | Add a `heat[]` rolling-hash (xor-fold, ~1 Hz, ~4 B/s) as the detector of record (§4.8). |
| 20 | **Realtime Broadcast soft rate-limit** at 10 Hz/room | minor | If throttled, relay drops to 6 Hz (interpolation hides it) — a pre-planned degradation; the budget is validated at the degraded rate (§8.1). |

---

## 12. Phased milestones (each gated by `npm run build` + `npm run verify:campaign` staying green, plus its own check)

Every phase ships to `main` **dark** behind `isCoopConfigured()` (dynamic-imported, code-split
— solo bundle byte-identical). `build` is the type+boundary gate; `verify:campaign` proves
solo is provably unchanged (**must stay green every phase**). The cheap multiplayer rig is a
**two-tab loopback** (host tab + client tab on relay) per `bmf-verify`; the **load-bearing
gates run on real devices**.

**Phase -1 — Transport substrate.** Add `@supabase/realtime-js`, code-split the entire `net/`
tree behind a dynamic `import()`; baked `build_hash`; `COOP` config block scaffolding.
*Exit:* solo production bundle is **byte-identical** (no realtime client downloaded); a throwaway page opens a Realtime channel and round-trips a Broadcast message between two tabs; **recorded gzipped bundle delta** for the co-op chunk.

**Phase 0 — Determinism hardening (NO networking). The riskiest assumptions' gate, ships first.**
Fixed 30 Hz logic tick for fire/structures/crew/wind-consumption; dedicated mission-seeded `fireRng`; move all gameplay placement off `world.rng` (incl. main forest → own `speciesRng`); tier-INDEPENDENT collider/fuel build; `Wind.serialize/applyState` (full mutable set; client `update()`→no-op or seeded replica); `fireRngCalls` + `heat[]` rolling-hash; quantize the spotting/ignite branch inputs; preallocate `rebuildReps()` `picked`; gate `FireFieldTexture.pack()` to the 30 Hz tick.
*Exit:* (1) `verify:campaign` 102/102. (2) New `scripts/verify-determinism.ts` (esbuild→Node): construct the **full World+forest+Fauna+FireSystem** chain at forced `tier='low'` vs `tier='high'`, step **3000 ticks** with an identical drop/wind/ignite log, assert **byte-identical `heat[]`/`scorch[]`** + equal `fireRngCalls`; assert no gameplay sim draws `world.rng` post-construction; assert `Obstacles.colliders.length` + fuel map match across tiers. (3) **Run that bundle under Node on both x86 and ARM** (x64 vs arm64 runners) and assert cross-ISA byte-identity of `heat[]`/`scorch[]` — **the §4.8 gate; if it diverges, switch fire to active-band delta at 5 Hz.** (4) **Real-device CPU pass:** `FireSystem.update()+pack()` <4ms on a ≈2021 Snapdragon-7 phone, else adopt the delta fallback.

**Phase 1 — Sim serialize/applyState + `wire.ts` quantizers.**
*Exit:* `applyState(serialize())` is identity within quantization tolerance for every sim (Node round-trip). `build` green — sims import nothing new (boundary held).

**Phase 2 — Lobby + Presence (no gameplay).** `rooms` table + locked RLS + RPCs; code create/join/normalise; presence roster + visibility hint; `ui/coop/` screens; join contract from handshake; phonetic echo; four failure messages.
*Exit:* two browsers create→join→see `2/2 · ready`; mismatched `build_hash`/`data_epoch` rejected before any sim builds; a leaked-code UPDATE attempt is **rejected** (RLS); room TTL-expires when idle but is refreshed while playing; each of the four join-failure messages reachable.

**Phase 3 — `RelayTransport` end-to-end + minimal no-reload router (the FLOOR first).** Supabase-Broadcast `Transport`; host streams pilot poses only (no fire yet); `RemotePlayer` renders interpolated remote heli+bucket+rope; pilot snapshot client→host; minimal `SceneRouter` lobby↔mission path.
*Exit:* **two physical phones on cellular, relay-only**: client sees host's heli fly smoothly (Hermite); RTT + `RELAY` glyph; killing one tab fires `onPeerDrop`; measured ≤0.6 KB/s up / ≤3 KB/s down per peer (and at the degraded 6 Hz rate); **returning from a mission to the lobby does NOT drop the transport.**

**Phase 4 — Shared world: fire + wind + structures + drops.** `DropArbiter` (sole `douse()` caller, same-tick total order); tick-stamped/seeded wind; client skips local world-sim `update()` and steps fire deterministically; `fireRngCalls`+`heatHash` checksum + delta-patch/keyframe resync; tab-hidden resync trigger.
*Exit:* host ignites via `__game.fireSystem.igniteAt`; **both** peers' `__game.debug.fires[]`, `firesActive`, radar scar match on **ARM phone vs x86 laptop**; a client drop knocks down fire on **both** screens in tick order; `fireRngCalls`/`heatHash` never diverge over a 5-min mutual-dropping session; **cross-tier `Obstacles.colliders` + fuel map asserted equal**; late-join `serializeFull` snaps a 3rd peer into the in-progress fire; **measured RLE'd keyframe worst-case + resync frequency documented**; `verify:campaign` 102/102.

**Phase 5 — WebRTC promotion + prediction/reconciliation.** `RtcTransport` (STUN); relay→P2P promotion; `ConnectionManager`; own-heli prediction + soft reconciliation; clamped remote Hermite; coalesced one-datagram/tick.
*Exit:* P2P pair = zero-latency own stick; **injected 150ms+jitter** shows no rubber-band on own heli and **smooth remotes specifically through BANKING turns**; pulling the DataChannel reverts to relay **with no session loss**; `RELAY↔P2P` glyph flips live; battery/radio note recorded from a real-phone session.

**Phase 6 — `SceneRouter` (full) + the co-op big-fire scenario + scoring.** Long-lived renderer; `Game.dispose()`; no-reload scene advance (lobby↔scenario↔debrief↔replay); `buildCoopMission` (date-seeded, `coopScale = playerCount`) + `minPlayers`/`maxPlayers` on `MissionDef`; host-authoritative `MissionRuntime`; per-pilot attribution + local `computeScore`; co-op debrief.
*Exit:* a 2-player big-fire scenario: shared objectives latch **once** on the host, both HUDs agree; each pilot gets a distinct correct grade and submits to the stable-id board; **replay/return-to-lobby advances without dropping the channel**; **no GPU leak across 5 swaps** (heap + `renderer.info.memory` stable); a mid-scenario drop-out stays winnable; `verify:campaign` 102/102.

**Phase 7 — Resilience.** 90s Presence-timeout ejection; 30–45s reconnect-grace → keyframe resync with overlay/rejoin UX; late-join `control:fullState` + post-join scoring; **~1 Hz host checkpoint** (active fire, full mutable set) + **atomic-CAS host election RPC**; outcome persisted the instant it latches; griefing guard (validate `from`/`tick`/plausible position).
*Exit, on a **real phone**: (1) background a client 20s then return → **not ejected**, resyncs off keyframe with overlay, score intact. (2) drop a client 40s → "rejoin?" screen → re-enters via same code. (3) late-joiner enters mid-mission → flies, scores only post-join. (4) **v1 (LOCKED §13.1): kill the host tab → "Host left — saving result…" returns everyone to the lobby with the persisted `outcome` and the same code** (the ~1 Hz checkpoint is still written every tick so the fast-follow migration has its spine). *Fast-follow exit (not v1): atomic-CAS election picks the heir, it loads the ≤1 s-stale checkpoint, resumes, mission completes, clients rubber-band once.* (5) force-block UDP → session continues on relay.

---

## 13. Locked decisions (2026-06-05)

All six are decided; the plan above reflects them. Recorded here with rationale.

1. **Host-loss → graceful, migration deferred.** When the host drops, persist `outcome` and return everyone to the lobby with the **same code** (§7, §11.11). Best-effort atomic-CAS host migration is a **fast-follow**, not v1 — built only after the Phase-7 ~1 Hz checkpoint is proven. *Why: lowest risk, no split-brain, honest UX; the checkpoint spine ships in Phase 7 either way so migration is a small later add.*
2. **TURN → ship $0, hook stays unset.** STUN + relay only at launch. NAT-blocked pairs ride the relay floor (they always play; ~150–250ms slower, which this game tolerates because own-heli is local, remotes are interpolated, and there's no PvP). `VITE_TURN_URL`/`VITE_TURN_CRED` remain unset; a future operator can add ~$5/mo coturn / Cloudflare Calls TURN with **no code change** if device testing shows the relay experience is poor for too many pairs. *Why: truly $0, fully reversible, no playability gate.*
3. **Fire-sync → deterministic primary, AUTO-fallback accepted.** If the Phase-0 cross-ISA byte-identity gate **and** the <4 ms real-device CPU gate both pass → deterministic re-step (~180 B/s). If **either** fails → the pre-built **active-band-delta** path becomes the steady state (host streams fire; ~0.6–4.5 KB/sync; §8 budget recomputed). This is a **config flip, taken automatically** on gate result — the user has pre-accepted the delta fallback's higher relay cost. *Why: co-op ships regardless; the fallback exists precisely so a gate failure isn't a blocker.*
4. **Player cap → target 4, auto-degrade.** Design for 4. If a real-phone host can't sustain 4 on cellular, the **host thermal/framerate guard drops the world tick to 20 Hz** (§8.3) rather than hard-capping. Hard-cap to 3 **only** if Phase-3/5 device testing proves 4 unviable, and say so in the lobby. *Why: honors the teaser's "2–4" while staying honest about device limits.*
5. **Content → ONE dedicated big-fire scenario, Daily-Burn-style.** v1 = a single **`buildCoopMission`** scenario (date-seeded, deterministic, `coopScale = playerCount`), the co-op analog of `missions/daily.ts` — **not** the campaign finale, **not** 2–3 bespoke missions (§1, §9). Solo Daily Burn stays solo. *Why: smallest scope that delivers the teaser; the date-seed doubles as a come-back hook.*
6. **Bundle → official client, code-split, ~50 KB gz is fine.** Use `@supabase/realtime-js`; do **not** hand-roll a Phoenix client. The entire `net/` tree + the realtime client are behind a dynamic `import()` so the **solo bundle is byte-identical** and only co-op players download the chunk (§3.3). *Why: ~50 KB gz is trivial for someone opting into multiplayer; hand-rolling risks the must-work relay floor.*

> Two **measurement-gated** items remain (not user decisions — resolved by Phase-0 data, both with a pre-accepted default): the fire-sync path (§13.3) and the exact player cap (§13.4). Anything that lands as a v1 limitation is surfaced in the lobby (e.g. "best on a strong connection"), never as a silent failure.

---

## 14. Definition of done

Co-op v1 is **done** when **all** hold:

- **Connectivity:** two **non-technical friends on two real phones on cellular** complete a 2-player mission end-to-end via join-by-code, on **relay-only** (P2P never required), with the four join-failure messages all reachable and a working reconnect after a real screen-lock.
- **Determinism:** Phase-0 `verify-determinism` passes on **x86 and ARM** (full World chain, cross-tier, cross-ISA byte-identical `heat[]`/`scorch[]`); in a live 2-device session, `__game.debug.fires[]`, `firesActive`, radar scar, and structure health **agree** over a 5-minute mutual-dropping mission; `fireRngCalls`+`heatHash` never silently diverge.
- **Performance:** the fire tick fits **<4ms** on a mid-tier Android; both devices hold **~60fps** with 1 remote (host with 3 remotes); no GPU leak across 5 `SceneRouter` swaps; **no per-frame allocation** on the client fire/net hot path.
- **Boundary intact:** `sim/*.ts` import nothing new (no `Scene`/DOM/`net`); `RemotePlayer.ts` is the **only** new Three-touching net file; `build` + `verify:campaign` (102/102) green; the render path is unchanged.
- **Game design:** shared objectives latch once (host-authoritative, monotonic); each pilot gets a **distinct, correct** grade from the host-canonical tally and submits to a **stable-id** board; same-tick overlapping drops produce a **determinate** result and attribution; mission NEXT/retry survive without dropping the transport.
- **Identity preserved:** solo bundle byte-identical and 100% client-side; co-op fully **env-gated** (degrades to solo when unconfigured); **net new infra spend $0** (TURN excepted, and opt-in); no PII; `rooms` RLS hardened (no room-takeover via a leaked code).
- **Honesty:** host-loss is communicated and never silently corrupts a finished mission (persisted `outcome`); reconnect, late-join, and host-loss each have an **explicit player-facing UX**; the budget headline (B/s, relay room-hours) is stated as **measured** and amended by the real keyframe-resync frequency.

> Anything in §13 unresolved at ship is a **documented v1 limitation**, surfaced in the lobby
> (e.g. "best on a strong connection", a player cap), not a silent failure.
