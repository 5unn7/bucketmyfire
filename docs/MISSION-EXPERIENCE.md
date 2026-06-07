# Mission Experience — reactive, talking, full-arc missions

**Status:** design + build in progress. **Decided** (user): comms are *radio text + procedural
squelch* (no TTS / no voice-over); the world *reacts via scripted beats* (wind shifts, flare-ups,
cabins catching) — objectives themselves stay fixed (no mid-mission branching).

## The problem

Today a mission is static: a one-line `brief` shown only in the menu, an objective checklist, and a
win/lose banner. Nothing speaks, nothing reacts. We want each mission to deliver a **full arc**:

> **Briefing** (who/what/where + intel) → **escalating beats** that react to your drops and the
> fire's progress, narrated by **radio comms** → **climax** → **performance-reactive debrief**.

## Architecture — three tiers (mirrors the sim boundary)

The reactive layer is **engine-agnostic** (numbers/POJOs, like `MissionRuntime`); only `Game`
touches Three/DOM/audio.

```
MissionDef.script: MissionBeat[]            ← authored data (catalog.ts)
        │
   MissionDirector (pure, latched)          ← new: missions/MissionDirector.ts
        │  update(signals, runtime) → DirectorAction[]   (each beat fires ONCE)
        ▼
   Game executor (thin)                      ← Game.ts, after runtime.update()
        ├─ 'comms'  → HUD.pushComms + HeliAudio.playSquelch
        ├─ 'ignite' → scenario.igniteFromPlacement(fireSystem, …)   (flare-ups, spot fires)
        └─ 'wind'   → Wind.shiftTo(angle, strengthScale, ease)
```

- **`MissionBeat = { id, trigger, actions[] }`** — a beat fires its actions the first frame its
  trigger becomes true, then latches (deterministic, headless-testable in `verify-campaign`).
- **Triggers** read the same `MissionSignals` the runtime sees, plus the ledger:
  `start` · `time{seconds}` · `firesDoused{n}` · `firesLeft{n}` · `threat{min}` ·
  `structureLost{n?}` · `crewDelivered{n}` · `fuelBelow{frac}` · `objectiveDone{id?}` · `won` · `lost`.
- **Actions:** `comms{speaker,text,urgency}` · `ignite{place: FirePlacement}` (reuses the existing
  placement vocabulary + `seedFires` resolution) · `wind{angle?,strengthScale?,ease?}`.

`MissionSignals` gains `threat` (0..1) and `windAngle` so triggers can read them.

## Comms ("talks")

A glass-cockpit **radio log** (HUD): a pooled stack of ≤3 frosted lines, speaker-tagged and
color-coded, sliding in and auto-expiring (~5 s). Speakers:

- **DISPATCH** (cyan `UI.accent`) — mission control: briefing, milestones, intel.
- **CREW** (amber) — ground/air crew: pickups, "good drop", local colour.
- **WARNING** (red `UI.fire`) — danger: a structure burning, fuel low, the front turning.

Each posted line plays a **procedural radio squelch** (a short FM blip + filtered-noise burst added
to `HeliAudio`, unlocked on the same first gesture as the rotor). No TTS, no assets.

## Briefing & debrief (the "full experience" bookends)

- **Pre-flight briefing card** (HUD, shown at mission start, sim paused until *Begin*): mission name,
  `intel` paragraph, the objective list, wind + payload at a glance, and the `start` DISPATCH line.
- **Reactive debrief** (extends the end banner): a summary built from the latched ledger + final
  signals — *fires out X/Y, structures saved A/B, crews C/D, time m:ss* — and a **rating line** that
  reacts to outcome (flawless / solid / costly / the kinds of loss).

## Per-mission beat sheets (authored in `catalog.ts`)

Every mission gets `intel`, a `start` briefing line, ≥1 reactive beat, and outcome lines. Highlights:

| # | Mission | Signature beats |
|---|---------|-----------------|
| 0 | First Light | DISPATCH welcome + scoop tip; CREW "nice drop" on first douse; calm. |
| 1 | Cabin Country | "fire's creeping the treeline" → at `threat≥.5` WARNING "cabins in the path"; `structureLost` red. |
| 2 | Crew Insertion | brief the 3 LZs; CREW banter per `crewDelivered`; wind builds (flavour). |
| 3 | Wind Shift | **namesake:** at ~`time{70}` a hard **`wind` shift** + WARNING "she's backing east, turning on the town" + a flank `ignite`. |
| 4 | The Long Haul | "depot's a long way back"; `fuelBelow{.4}` WARNING; a backcountry `ignite` flare-up. |
| 5 | Hold the Line | "ground crews 3:00 out"; escalating `ignite` flare-ups at `time{60}/120`; "crews inbound — 30 seconds" near the end. |
| 6 | Evacuation | urgency intro; CREW relief per pickup; deadline `ignite` nearing a cabin → WARNING. |
| 7 | Mega-Fire | "one tank won't do it"; **re-flare** `ignite` beats at `firesLeft{≤2}` → WARNING "she's flaring back up"; depot threat. |
| 8 | Multi-Front | "two fronts, one helicopter"; if one side ignored (`time` + low `firesDoused`) a flare-up on the *other* community. |
| 9 | Firestorm | everything: wind gusts (`wind`), downwind spot-fire `ignite`s, structure `threat` WARNINGs, fuel pressure — a relentless climax. |

## Verification

- `npm run build` type-gate (the new unions must be handled exhaustively in the director).
- `npm run verify:campaign` — extended to run the `MissionDirector` and **execute its ignite/wind
  actions** against the real sims, asserting the "perfect player" still completes every mission (beats
  may add fire, but a competent player douses it) and the beats fire deterministically.
- Headless screenshots of the comms log + briefing + debrief via the `window.__game` hook.
