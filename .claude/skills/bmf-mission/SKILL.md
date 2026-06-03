---
name: bmf-mission
description: >-
  Author or edit a bucketmyfire campaign mission/level. Use whenever the task is to add a new
  mission, tweak an existing one, add an objective or fail/lose condition, place fires (spot /
  cluster / head-fire line / near a community), set up a crew-insertion or evacuation
  (slung-basket) mission, enable fuel/range pressure, add reactive radio-comms "beats", or change
  the difficulty ramp. Missions are DATA: a `MissionDef` in `src/three/missions/catalog.ts` (pure
  scenario — seed, placements, win/lose), with mechanic VALUES living separately in `config.ts`
  (`MISSIONS`). This skill covers the placement vocabulary, the objective/fail kinds, the
  scripted-beat system, the linear-unlock/page-reload model, and the mandatory completability
  check (`npm run verify:campaign`). Reach for it any time you hear "add a level", "new mission",
  "make a scenario", "defend the town", "evacuate", "ferry crews", or "make it harder".
---

# Authoring a bucketmyfire mission

A mission is **authored data**, not code. The campaign is the `CAMPAIGN: MissionDef[]` array in
[src/three/missions/catalog.ts](../../../src/three/missions/catalog.ts). `Game` resolves a def's
placement specs against the seeded `World`, then feeds a per-frame `MissionSignals` snapshot to
the pure `MissionRuntime`, which decides win/lose. You almost never touch the runtime — you write
a `MissionDef`.

## The one rule that keeps the layers clean

- **`MissionDef` (catalog.ts) = SCENARIO only**: which seeded world, where the fires/crews/
  structures sit, and the win/lose rules. No physics or visual numbers.
- **`config.ts` `MISSIONS` = MECHANIC VALUES only**: LZ radius, crew dwell seconds, fuel burn
  rates, refuel radius. Shared by every mission.

If you're tempted to put a tuning number in the catalog, it belongs in `config.ts`. If you're
tempted to hard-code a mission's fire position in a sim, it belongs in the catalog. Keep the seam.

The full type contract is [src/three/missions/types.ts](../../../src/three/missions/types.ts) —
read it; it's well-commented. Summary below.

## The MissionDef shape

```ts
{
  id: string;            // stable, kebab-case (used by ?m=<id>, progress, headless asserts)
  index: number;         // campaign order → drives LINEAR unlock; next mission = index+1
  name: string;
  brief: string;         // 1–2 lines, menu + start card
  intel?: string;        // optional longer briefing paragraph
  difficulty: 1|2|3|4|5;
  seed: number;          // world seed — each mission grows its OWN boreal map (the "future maps" seam)
  wind?: { angle?, strengthScale? };
  bucket?: 'bambi' | 'valve';     // bambi = one-tap full dump; valve = hold-to-pour, splittable
  payload?: 'water' | 'crew';     // crew → bucket hidden, a crew basket slings on the SAME pendulum
  fuel?: boolean;                 // construct a FuelSim (range pressure); else fuel is ignored
  fires: FirePlacement[];
  structures?: StructureSpec;
  zones?: ZonePlacement[];        // crew load/unload endpoints
  objectives: Objective[];        // ALL must complete → win
  fails?: FailCondition[];        // ANY triggers → lose
  script?: MissionBeat[];         // reactive radio comms + world reactions (optional)
}
```

### Placement is RELATIVE to named world features (stay seed-robust)

Don't hand-place raw `(x,z)` unless you have a reason — pin placements to features the seeded
`World` grows, so the mission stays valid whatever the seed produces:

- **Fires** (`FirePlacement`):
  - `{ at:'nearCommunity', community: 0|'base', offset, size, count? }` — fires `offset` units
    out from a hamlet (or the base). The bread-and-butter "defend the town" setup.
  - `{ at:'cluster', anchor:'origin'|'lake'|{community}, bearing?, distance?, spread?, count?, size }`
    — one coherent multi-head fire complex bunched around an anchor. `anchor:'lake'` puts a scoop
    source on hand (good for tutorials); `anchor:'origin'` with a big `distance` makes a remote
    backcountry haul.
  - `{ at:'line', size, length?, angle?, community?, offset? }` — a continuous head-fire FRONT;
    centered on a `community` and placed `offset` units **upwind**, it runs onto the settlement
    (omit `angle` and it faces downwind). The "wind-shift / hold the head" setup.
  - `{ at:'point', x, z, size }` / `{ at:'random', count, size, minFromOrigin? }` — explicit /
    scattered, used rarely.
  - `size`: `'spot' | 'small' | 'medium' | 'large' | 'mega'` (NWCG-ish class → ignition disc +
    starting heat).
- **Structures** (`StructureSpec`): `{ depot?: true, groups?: [{community, cabins}], extraCabins? }`.
  The depot is the refuel + crew base; `groups` populate hamlets with defendable cabins.
- **Crew zones** (`ZonePlacement`, only for `payload:'crew'`): `{ role:'load'|'unload', single,
  at:'point'|'nearCommunity'|'depot', community?, label? }`. `single:true` endpoints count toward
  `crewsTotal`; the reusable base is `single:false`.

### Objectives (ALL → win) and fails (ANY → lose)

- `Objective.kind`: `extinguishAll` | `extinguishCount(n)` | `deliver(n)` | `evacuate(n)` |
  `survive(seconds)`.
- `FailCondition.kind`: `protect({min}|{all})` (lose if too few structures survive) | `timeout
  (seconds)` | `fuelOut` (requires `fuel:true`).

### Reactive script (optional flavor + escalation)

`script?: MissionBeat[]` — each beat has a `trigger` (e.g. `{at:'time',seconds}`,
`{at:'firesDoused',n}`, `{at:'threat',min}`, `{at:'fuelBelow',frac}`) and fires its `actions`
ONCE the first frame the trigger holds. Actions: `comms` (a radio line — DISPATCH/CREW/WARNING),
`ignite` (a flare-up, reusing the FirePlacement vocab), or `wind` (ease the heading/strength —
the "wind-shift" beat). Evaluated by the pure `MissionDirector`; only `Game` turns actions into
DOM/audio/world.

## The recipe

1. **Append a `MissionDef`** to `CAMPAIGN` in `catalog.ts`. Set `index` = the next integer
   (linear unlock depends on it) and pick a **fresh `seed`** so the map feels distinct.
2. **Place** fires/structures/zones relative to named features (above). Match `objectives` to the
   fantasy in `brief`, and add `fails` for stakes. Crew mission → `payload:'crew'` + `zones`;
   range pressure → `fuel:true` + a `fuelOut` fail.
3. **Verify completability** — this is the gate:
   ```bash
   npm run verify:campaign
   ```
   It runs a deterministic "perfect player" through your mission and asserts it reaches
   `won`/`verified` with every goal latched, **and** that a no-op/starve run does not win, **and**
   (if you set `fails`) that tripping a constraint latches `lost`. If your objective can't be
   reached by the automaton (e.g. an `extinguishAll` on a fire it can't physically get water to,
   or a `survive` longer than the 400s cap), it fails here. Keep it green.
4. **Optional live look** — boot `?m=<your-id>&qa=1` and fly it / teleport around to eyeball
   framing and difficulty. See the **bmf-verify** skill for the headless harness.
5. `npm run build` stays green.

## Gotchas

- **The "perfect player" is simple.** It accurately douses every active fire (fire missions) or
  ferries to the active zone (crew missions) and tops up fuel when low. If a mission needs some
  trick the automaton doesn't do, `verify:campaign` will fail — simplify the scenario or extend
  the player model in `scripts/verify-campaign.ts`, don't ship an unverifiable mission.
- **Mission switching is a full page reload** (`main.ts` end-banner hooks persist the choice to
  localStorage and `location.reload()`), so there's no Three.js teardown to worry about — but
  per-mission state must come from the def + seed, not leak across runs.
- **Unlock + best score** persist via `missions/progress.ts` (localStorage); `index` is the unlock
  order.
- A **crew** mission hides the bucket and slings a basket on the same `BucketSim` pendulum — don't
  also give it water objectives.
