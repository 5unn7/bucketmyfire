# bucketmyfire — App Overview

> **One sentence:** The real-3D wildfire helicopter game — feel what it's like to scoop from a
> mountain lake, carry a swinging load through smoke, and drop it on a spreading fire.

---

## Vision

**bucketmyfire** wants to own the experience nobody has built: what it actually *feels* like to
fight a wildfire from the air. Not a top-down arcade puzzle. Not a cockpit sim with a 200-page
manual. A momentum-physics helicopter with a slung water bucket, a living fire that spreads and
re-flares, and a world that looks and behaves like the real landscape it represents.

Wildfires are the defining environmental story of our era. Tens of millions of people live near
fire-prone land. The summer news cycle is smoke and evacuation orders. Yet the pilots and crews
fighting those fires from the air are almost invisible — their work happens in remote country,
behind a wall of smoke, far from cameras.

**bucketmyfire** exists to close that gap. It puts players in the seat of the helicopter and asks
them to *feel* what bucket pilots actually do: the weight of the water, the lag of the bucket
swing, the pressure of a community burning at the treeline. Embodied understanding is the most
durable form of wildfire awareness we can create.

That is the category **bucketmyfire** is building. The launch region is northern Saskatchewan.
The platform is built for any fire-country in the world.

---

## What it is

**bucketmyfire** is a mobile-browser helicopter firefighting simulator. You fly over a
procedurally-generated wildfire landscape, lower a slung water bucket into a lake, carry the load
to a creeping fire front, and drop it before it reaches the community. It runs in any modern
browser — no install, no login required — and holds 60 fps on a mid-range phone.

The game is **live at [bucketmyfire.com](https://bucketmyfire.com)**.

---

## The experience

- **Fly** a helicopter with real momentum physics — the aircraft carries inertia, banks into turns,
  pitches with throttle. It feels like flying, not driving.
- **Scoop** by descending over a lake until the slung bucket dips below the surface. No button — just
  patient, deliberate flying.
- **Drop** on a fire's leading edge. A swinging bucket that wasn't steady on approach will miss.
- **Manage** fuel, crew rescues, structural protection, and a growing fire that spreads with wind and
  topography.
- **Progress** through an 8-mission linear campaign across different scenarios — from a first training
  scoop to a night siege on a burning community.

The aesthetic is a **Forza/GTA chase-cam sensibility** with procedural boreal visuals:
conifer forests, lake systems, cabin communities, god-ray sunsets, ember columns, and a dynamic
wildfire that chars the land as it burns.

---

## Mission beyond the game — wildfire awareness

Wildfires are not an abstract environmental statistic. They displace communities, destroy
ecosystems, and kill people. The pilots and ground crews fighting them are largely invisible
to the public — their work happens in remote country, behind a wall of smoke, far from cameras.

**bucketmyfire exists to change that perception.**

When a player descends over a lake at 40 knots, holds hover while the bucket fills, and then
has to thread between two tree lines to hit the flank of a running fire — they understand
something a news clip cannot convey. The weight of the water. The margin for error. The way a
fire can cut off your exit in seconds. That embodied understanding is the most durable form of
awareness we can create.

**How the game serves the mission:**

- **The simulation is honest.** Fire spreads with wind and topography. A small mistake lets it
  flank you. The game doesn't let you win by spraying water randomly — it asks you to think
  like a pilot.
- **Real places carry real memory.** Every named location on the map is a place where real
  fires have burned and real people have evacuated. Candle Lake, La Ronge, Prince Albert — these
  are not invented towns. Players from those communities recognise them.
- **The cause tie-in is structural, not decorative.** A portion of merch proceeds will be
  pledged to a Canadian wildfire relief or aerial-firefighting fund. The store button on the
  win screen is the game saying: *what you just did matters, and so does this.*
- **The news cycle amplifies the message.** Every major fire season drives search traffic and
  emotional engagement. The game is designed to be re-surfaced in that moment — not as
  exploitation of tragedy, but as a way to turn attention into understanding.

**The long-term platform play:** as the game expands to new regions (BC, California, Australia),
each map is an opportunity to partner with local firefighting agencies, conservation groups, or
Indigenous land stewards who know that land best. The game becomes a canvas for real stories
told through real geography.

---

## Positioning

**Nobody owns this category.** Web helicopter games are proven but shallow — the flagship
competitors (Poki's *Hero Rescue*, CrazyGames' *Fire Helicopter*) are Flappy-Bird-grade clones
with no momentum physics, no slung bucket, no geography. The only true 3D web flight sim (GeoFS)
is a generic airliner experience with no fire mission. No game combines **casual accessibility
+ realistic physics + a real fire scenario + a real place.**

**The wedge is the experience, grounded in reality.** bucketmyfire isn't trying to beat flight
sims on depth or arcade clones on polish. It owns the middle: the game that makes you feel what
bucket pilots actually do, set in a landscape that is actually burning.

**The map is the proof, not the ceiling.** Saskatchewan launches the game and gives it a
distinctive identity that clone farms can't replicate. But the engine is purpose-built to support
any fire-country in the world — British Columbia's mountain valleys, California's chaparral,
Australia's eucalyptus coast, the Mediterranean scrub. Each new region is a new map, a new
campaign, and a new audience with an emotional stake in the story.

---

## The launch setting — northern Saskatchewan

The first map is a faithful mini-Saskatchewan. Fifteen real northern-SK locations are pinned to
their actual latitude/longitude positions: **Candle Lake, Prince Albert, Missinipe, La Ronge,
Reindeer Lake**, and more — each labelled correctly on the in-game radar. The lakes are scaled
from real surface areas. Rivers are carved from real mapped courses.

Saskatchewan gives the launch its civic identity and its PR hook: Canada's recent fire seasons
(2025 = 2nd-worst ever; the largest fire near Candle Lake — *a named location on your own map*)
make the setting newsworthy on a recurring annual cycle. The "Bucket Pilot" brand, boreal
aesthetic, and "Scoop. Drop. Repeat." slogan are native to this map and expandable to every one
that follows.

---

## Platform

| | Detail |
|---|---|
| **Runtime** | Browser — no install |
| **Device** | Mobile-first; desktop supported |
| **Backend** | None (100% client-side) |
| **Optional cloud** | Supabase global leaderboard + cloud save (env-gated; game works without it) |
| **Deploy** | GitHub Pages, auto-deploys on push to `main` |
| **URL** | [bucketmyfire.com](https://bucketmyfire.com) (Cloudflare-proxied) |

---

## Technology approach (non-technical summary)

The entire game — terrain, water, fire, trees, buildings, sky, weather — is **generated
mathematically at load time**. There are no pre-painted textures, no tile maps, no level files.
A single random seed produces the same world every run; changing the seed produces a different
one. This means the game has **no large asset downloads** and can be fully rebuilt from source.

A handful of licensed assets (helicopter 3D models, a smoke sprite, an audio clip) are swapped in
as credited fallbacks where procedural generation couldn't match the required quality. Everything
else is geometry + shaders.

The physics — flight momentum, the swinging bucket pendulum, fire spread, fuel consumption, crew
transport — are **engine-agnostic pure math modules**. They can be tested in Node without a
browser, which is how correctness is verified (there is no unit-test runner; the build and a
pure-sim campaign verifier are the CI gates).

---

## Business model

**Solo, bootstrapped, lifestyle.** Fixed annual cost is ~CAD $20-30 (domain only; hosting,
CDN, and database are free at current scale).

Three revenue pillars:

| Pillar | Mechanism | Notes |
|---|---|---|
| **Merch** | Print-on-demand via Fourthwall at `shop.bucketmyfire.com` | Highest margin/player (~$15-21/unit); win-screen CTA is the funnel |
| **Portals** | CrazyGames (launch), GameDistribution, GameMonetize | Web ad RPM ~$1-2/1k sessions; volume play |
| **Tips/itch** | Ko-fi + itch.io name-your-price | Zero overhead, zero expectation |

The **merch pillar beats ads** at any realistic traffic level: one hoodie sale (~$21 net) equals
thousands of banner impressions. The wedge is emotional — players who feel something want a
physical artefact from the world they just saved.

Seasonality is a structural advantage: wildfire search volume spikes **June–September** every year
in North America and **November–March** in Australia and the Mediterranean — giving the platform
a near-year-round news hook as it expands to new regions. Each new map is also a new merch
identity and a new culturally-rooted audience.

---

## Current status (as of 2026-06-05)

**Codebase health: 7.4 / 10** (second multi-agent audit).

The engine is production-quality (8.5/10 architecture, airtight sim boundary, zero `as any`
casts, zero lint errors, 102/102 campaign scenarios passing). The gap is operational:

| Gap | Status |
|---|---|
| 17 commits not pushed to prod | Working tree only — live site is missing Daily Burn, share card, Quick Fly, privacy policy |
| Merch store | Built in plan; no in-game CTA yet |
| Retention loop | Daily Burn mode exists; no streak or comeback mechanic |
| Crash feature | Implemented, uncommitted, not dogfooded |

**The game is one push and a few wired buttons away from being a real business.**

---

## Campaign structure

| Mission | Scenario | New mechanic |
|---|---|---|
| 1 · First Scoop | Tutorial lake run near home base | Scooping, basic flight |
| 2 · Hover Training | Precision delivery at marked zones | Hover accuracy, payload control |
| 3 · Cabin at Risk | Protect a lone structure from advancing fire | Multi-objective prioritisation |
| 4 · Crew Rescue | Evacuate workers from a burning forestry site | Crew transport loadout |
| 5 · Night Siege | Community under fire at dusk | Reduced visibility, multiple structures |
| 6 · The Burn | All-out campaign finale | Everything at once |

*(Co-op mode is teased but not yet built.)*

---

## Art direction

**Glass-cockpit realism meets procedural landscape.** The UI uses a single token-based design
system (`ui/theme.ts`) — a frosted-glass HUD, warm amber highlights, sharp monospace instruments.
No colour or shadow is hard-coded anywhere in the UI layer; all visual decisions flow from the
token palette and the `DESIGN.md` prose system.

The world palette adapts to the region. Saskatchewan launch: dark spruce, grey rock outcrops,
deep lake blue, smoke orange against a golden-hour sky. Future maps carry their own biome
palettes — the engine supports per-region terrain profiles and vegetation bands (an alpine BC
profile already exists in the codebase). The fire is always dramatic: burning communities show
real flame geometry, HDR beacon glow, and progressive structural collapse, regardless of region.

---

## Team & credits

**Solo indie project** by a single developer (Marakana Corp). All code, world generation, mission
design, and business strategy are the work of one person. The handful of licensed assets
(helicopter models, smoke sprite, rotor audio) are credited in `ATTRIBUTION.txt` files beside
each asset under `public/`.

---

## Quick links

| Resource | Path |
|---|---|
| Architecture detail | `CLAUDE.md` (root) |
| Approved roadmap | `docs/ROADMAP.md` |
| Business plan | `docs/BUSINESS-PLAN.md` |
| Design system prose | `DESIGN.md` (root) |
| Mission authoring | `.claude/skills/bmf-mission/` |
| Tuning reference | `.claude/skills/bmf-tune/` |
| Verification guide | `.claude/skills/bmf-verify/` |
| Audit (latest) | `docs/AUDIT-2026-06-05.md` |
| Launch plan | `docs/MASTER-PLAN.md` |
