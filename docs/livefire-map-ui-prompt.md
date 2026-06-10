# Redesign Brief — bucketmyfire Live Wildfire Map

> **For:** a top-tier frontend / product designer (or an AI design / codegen tool).
> **Target surface:** the live wildfire map on the bucketmyfire home screen — a mobile-browser tracker that opens as an overlay over the warm "fight" home hub (`.bmf-app`, `zIndex 60`).
> **Mandate:** produce a markedly better map UI. Invent nothing. Every field, layer, colour, and token below is real and verified. If it is not in this brief, it does not exist — do not add it.

---

## 1. Intent and Philosophy

This map is the **honest window**: a credible public view of real Canadian wildfire data, sitting inside a helicopter game. It earns trust by being accurate, plainly labelled, and sourced, not by looking official.

Three principles override every other instinct:

1. **It is a window, not an emergency tool.** Never imply dispatch, guidance, or life-safety authority. Frame everything as "what is burning, who says so, when they said it." A standing caveat must remain reachable. The verbatim line (`NOT_FOR_EMERGENCY`) is: *"A window onto real data, not an emergency tool. Follow official sources."*
2. **Empty is not down is not off.** A live feed returning zero results means "none in view." It is good news, not a failure. Stale cache, unreachable source, and the kill-switch are each distinct states with distinct copy. Never show a blank map that could mean any of them.
3. **Freshness comes from the SOURCE's publish time, never from when we fetched.** Use `publishedAt` for all user-facing "as of" / "updated" copy. `fetchedAt` is cache math only, never shown. Smoke is a forecast and has no publish time: it reads "Forecast · Mon 6 PM," never "updated X ago."

**Brand register:** this surface lives on the home hub, which is the **warm "fight" register**. Paint it ember / gold / fire. Never cockpit cyan (that register belongs to the in-flight HUD only).

**Copy voice:** dry, direct, calm. Eight words or fewer. Primal and declarative. No hype, no preach, no em-dash-glued one-liners, no "simulator," no "save the forest." The fire is the enemy. Let the stakes carry the gravity.

---

## 2. Data You Can Show (the only fields and layers that exist)

Flags: 🇨🇦 Canada-only · 📍 province/state-specific (Saskatchewan) · 🌐 continent-wide.

### 2.1 Per-fire records (two distinct shapes — the panel picks by which dot was tapped)

**(A) CIFFC reported fire** — `ReportedFire`, drawn as an area-accurate disc coloured by stage.
- Top-level: `lat`, `lon`, `sizeHa` (hectares; **`< 0` = unknown**), `stage` (`OC`/`BH`/`UC`/`OUT`/`UNK`), `agency` (lowercase prov code), `country` (`CA`/`US`/`MX`/`OT`), `at` (sitrep epoch), `fireId`, optional `source` (set only for provincial-feed fires), optional `name` (provincial only — **CIFFC fires are id-only, no name**).
- Detail groups (verbatim props keys → labels):
  - **Status:** `field_stage_of_control_status` → Stage of control · `field_fire_size` → Size (ha) · `field_percent_contained` → Contained (**`< 0` renders "—"**) · `field_response_type` → Response (FUL/MOD/MON/NDR).
  - **Fire:** `field_system_fire_id` → Fire ID · `field_agency_fire_id` → Agency fire # · `field_system_fire_cause` → Cause (H/L/U) · `field_fire_was_prescribed` → Prescribed burn.
  - **Reported:** `field_situation_report_date` → Situation report · `field_status_date` → Status updated · `field_agency_data_timezone` → Agency timezone.

**(B) CWFIS satellite hotspot** 🌐 — `Hotspot`, ~35-field record, drawn as a heat dot sized/coloured by severity (`hfi` band: <500 low / ≥500 moderate / ≥4000 high / ≥10000 extreme).
- Top-level: `lat`, `lon`, `hfi`, `severity`, `at`, `agency`, `country`, `props`.
- Detail groups: **Detection** (`rep_date`, `agency`, `satellite`, `sensor`, `source`, `frp` MW) · **Fire behaviour** (`hfi` kW/m, `ros` m/min, `fuel`, `sfc`, `tfc`, `cfb` % **[0–100, never ×100]**, `estarea` ha, `pconif` %) · **Fire Weather Index System** (`ffmc`, `dmc`, `dc`, `isi`, `bui`, `fwi`) · **Weather** (`temp` °C, `rh` %, `ws` km/h, `wd` compass, `pcp` mm) · **Site** (`elev` m, `ecozone`, `pcuring` %, `greenup`). Missing keys render "—".

### 2.2 Provincial richness (adapters today: only `bc-wildfire`)

Provincial fires carry `name`, raw `status`, and cause/response/district inside verbatim `props`. The richer link is the **per-fire official viewer**, resolved by `officialFor(agency)`:

| Agency | Label | | Agency | Label |
|---|---|---|---|---|
| BC | BC Wildfire Service map | | MB | Manitoba wildfire |
| AB | Alberta Wildfire status | | ON | Ontario forest fire map |
| SK | Saskatchewan (SPSA) fire map | | QC | SOPFEU (Québec) |

**Fallback** (NB, NS, PE, NL, YT, NT, NU, PC): CIFFC national wildfire map. There is **no per-fire incident-URL type field** — only the agency→viewer map plus whatever lives in `props`. `nl-ffa` is untrusted and never preempts CIFFC.

### 2.3 Per-fire history 🇨🇦 (CIFFC-keyed only — backend)

`FireHistoryPoint[]`: `stage`, `sizeHa` (**`-1` = unknown**), `reportedAt`, `observedAt`. Powers a size-over-time + stage-path timeline. Hotspots and provincial fires have **no history**. Returns `[]` when unavailable → panel simply omits the chart.

### 2.4 National summary 🇨🇦 (CIFFC)

`firesToday`, `activeFires`, `ytdTotal`, `ytdOut` (derived = total − active, floored 0), `areaBurnedHa`, `prepLevel` (1–5; 0 = unknown → "—"), plus `publishedAt` from `sitrep.date` (the "as of" day). Canada-only — hide entirely for US/MX.

### 2.5 Map layers (eight — the only ones)

| Layer | Geometry | Scope | Freshness source |
|---|---|---|---|
| **Active fires** (`reported`) | area-accurate disc, stage colour | 🌐 (national roll CIFFC 🇨🇦) | latest `field_situation_report_date` |
| **Out fires** (`out`) | faint disc, OUT stage | as above | same |
| **Hotspots** (`hotspots`) | heat dot, severity ramp | 🌐 last 24h | freshest `rep_date` |
| **Burn area** (`perimeters`) | scorch polygon (non-interactive) | 🇨🇦 M3 | freshest `lastdate` |
| **Fire weather** (`fwi`) | WMS raster underlay | 🇨🇦 | WMS title date, ≤ every 6h |
| **Smoke** (`smoke`) | animated WMS raster, hourly frames | 🇨🇦 ECCC FireWork | **forecast — no publish time** |
| **Alerts** (`alerts`) | bold ringed pins | 📍 SK only (SaskAlert) | feed `updated` else `sent` |
| **Fire bans** (`bans`) | dashed tinted polygon | 📍 SK only (SPSA) | freshest `Start_Date` |

Alert fields (verbatim issuer words, never reclassified): `level` (critical/advisory/info/unknown), `event`, `summary`, `coverage`, `sentAt`, `lifecycle`, `author`, `url`. Ban fields: `type` (Ban/Restriction/Advisory/Other), `startAt`, `comment`.

**`reported` is normalized to active fires** (OC/BH/UC) before drawing; OUT rolls into the separate `out` layer. The reported set can run to ~1700 features — disc density, not just hotspots, is a real load concern (see §11).

**Country filter** (`CA`/`US`/`MX`/`all`): default `CA`. Canada-only layers (summary, perimeters, FWI, smoke) and SK-only layers (alerts, bans) are **hidden when the filter is not CA / not viewing SK** — they hold no US/MX data, and that gating must be explained, not silent.

**Prefer-provincial merge:** when a province has a trusted provincial adapter, its rows win over national CIFFC (richer: name, cause, response, official URL). Provinces without an adapter fall back to id-only national CIFFC. Surface this honestly in provenance ("Source: BC Wildfire" vs "Source: CIFFC national").

> **There is NO:** per-fire incident-URL type field · perimeter tied to a reported fire · history for hotspots/provincial fires · US/MX summary · weather/FWI codes on reported fires (hotspot-only). Do not draw what does not exist.

---

## 3. The Data Strip (national summary)

**Current problem:** six cells (`Reported today / Active / Out / Total / Area burned / Prep level`) crammed into one strip; ambiguous labels; the whole strip silently vanishes for US/MX, jumping the header height.

**Redesign:**

- **Lead with three headline numbers, each with its own unit, readable in one glance:** **Active fires** · **Reported today** · **Area burned (this year)**. These answer "how bad, right now." Move `Out`, `Total`, and `Prep level` to a secondary tier (a tap-to-expand "Season totals" line, or the second responsive row on wider screens). Do not stack six equal cells.
- **Relabel for the public.** "Active" stays. "Reported today" stays. "Area burned" gets the time qualifier "this year." If `Out`/`Total` survive in the secondary tier, label them "Out this year" / "Total this season" — never bare "Out"/"Total."
- **The strip owns one explicit "as of" stamp** from `publishedAt` (`publishedWhen` → "updated 2h ago" / "as of 8 Jun" / "publish time unknown"). This stamp doubles as the feed heartbeat: a status dot beside it reads live / cached / unavailable.
- **Format:** numbers `.toLocaleString()`; area via the compacting `fireSize` (e.g. `1.2M ha`); prep via `Level N` or "—".
- **Responsive collapse:** three cells fixed; on a narrow phone the strip may scroll horizontally (`overflow-x:auto`) rather than wrap to a second band — the map must not lose height. The header must hold a **stable height across states** (never jump 1↔2 rows when the summary appears/disappears).
- **State handling:**
  - Live with data → three numbers + "Active fires · Canada" headline.
  - Live, zero active → "No active fires reported · Canada" (an explicit all-clear, not a blank).
  - US/MX or non-CA filter → strip **replaced by a one-line note**, same height: "Season totals are Canada only." Never silently collapse.
  - Cached → numbers shown with a "Cached · as of 8 Jun" stamp and the cache dot.
  - Unavailable → "Live totals unavailable" in the strip's place, same height.

---

## 4. Layers, Legend, and Filter

**Current problem:** up to eight toggle chips plus a three-swatch legend crammed in one no-scroll row; per-chip status dots that are near-invisible and duplicate the ledger; a legend that keys only OC/BH/UC and omits everything else drawn on the map.

### 4.1 Group the eight layers into three tiers

Adopt the Watch Duty / BC Wildfire grouping so a novice is not buried in pro data. Caption each tier by its scope so geography is never confused:

- **Fires** (default visible, 🌐): **Active fires**, **Hotspots**, **Burn area**, plus **Out fires** (national, opt-in — it is national CIFFC data, not SK-scoped).
- **Weather** (opt-in, 🇨🇦): **Fire weather (FWI)**, **Smoke**.
- **Local** (opt-in, 📍 SK only): **Alerts**, **Fire bans**.

Default-on set stays tiny: `reported`, `hotspots`, `perimeters` (matches today's FireMap `visible` mirror). Everything else is opt-in. **Out fires belongs to Fires, not Local** — it is national CIFFC, and grouping it with the SK-only tier would wrongly gate it to Saskatchewan.

### 4.2 Toggle UX

- Keep the **`.lchip`** rounded-rect toggle (`--r-md`, never a pill; `.on` = ember-lit). Group them under small section captions, or behind a single **Layers** button that opens a layers sheet (so the permanent control row stays short and the map — the hero — keeps its height). A summoned sheet beats a crammed permanent row.
- **Collapse the two redundant status systems into one.** The ledger (Section 7) is the canonical freshness home. On the chip, keep at most a single quiet `.ldotc` state dot, and only surface it meaningfully for the **off / unavailable** cases (a layer you can't currently get). Do not make the user decode eight tiny dots.
- **Empty-but-live is not off.** When Alerts or Bans return zero rows while the feed is live, keep the chip **enabled** and let it carry the honest all-clear from `alertFreshness` / `banFreshness` ("No wildfire alerts · …" / "No provincial ban in effect"). Never quietly disable a working SK layer just because it is currently empty — empty is the good news, down is the failure.
- **Country-aware availability:** when the filter is not CA, the Weather tier and the SK Local tier are visibly **disabled with a reason** ("Canada only" / "Saskatchewan only"), not hidden without explanation.
- Each chip must remain ≥38px (target 44px) and carry an accurate `aria-pressed` + `title` hint (reuse the existing `layerHint` strings verbatim).

### 4.3 Legend — key everything that is drawn, on demand

The current legend keys only OC/BH/UC. The redesigned legend must cover **every coloured mark on the map** and live in a **summonable legend tab/sheet**, not floating permanently over the map:

- **Stage of control:** OC = `--warn` (out of control) · BH = `--caution` (being held) · UC = `--ok` (under control) · OUT/UNK = neutral.
- **Hotspot severity ramp:** low → extreme using `--ember-hi` → `--ember` → `--warn` (the existing `SEV_STYLE` tones), with size cue.
- **Alert level:** critical = `--warn` · advisory = `--caution` · info/unknown = neutral.
- **Ban type:** Ban = `--warn` · Restriction = `--caution` · other = neutral (dashed outline cue).
- **Raster ramps:** FWI (danger field) and Smoke (PM2.5) each get a compact colour-ramp key shown only while that raster is on.
- Short inline definitions for jargon ("Being held = not expected to grow under current conditions").

### 4.4 Rasters

FWI and smoke sit **below** point/polygon layers in z-order (FWI in tilePane; smoke in dedicated panes). Hold the existing opacity (`fwiOpacity`; smoke double-buffered crossfade). When a raster is on, show its ramp key; when off, hide it.

---

## 5. User Flows (numbered, end to end)

### Flow A — Land and scan the national picture
1. User opens the map from the home banner. Overlay mounts; header shows a calm loading line ("Reading the live fire map").
2. Leaflet builds on the next frame. **Seven feeds load via `allSettled`** — reported (out rides this same fetch, no separate call), hotspots, perimeters, fwi, smoke, alerts, bans; the **national summary is a separate eighth fetch**, so eight layers are served by seven feed calls plus the summary.
3. Header resolves to the honest headline: live → "47 active fires · Canada"; live-empty → "No active fires reported · Canada"; both authoritative feeds down → the offline title.
4. Data strip paints three headline numbers + "as of" stamp + heartbeat dot.
5. Default layers (active fires, hotspots, burn area) draw; map frames to the data once (`fitTo`, maxZoom 7).

### Flow B — Filter country / region
1. User changes the country select (CA / US / MX / All North America).
2. Persist the choice; close any open sheet.
3. Re-gate the strip (Canada-only → note for US/MX) and re-gate layer availability (Weather + SK Local disabled with reason off-CA).
4. Repaint and reframe. **Do not yank the user out of a zoom they set manually unless the country actually changed** — only reframe on a real filter change or first load, not on every silent refresh (current `fitTo`-on-every-paint is a regression to fix).

### Flow C — Tap a fire → detail → official source → history
1. User taps a disc (reported fire) or heat dot (hotspot). Marker ring-highlights; map stays visible behind.
2. A bottom sheet slides up, leading with the answer fields (Section 6).
3. For a reported fire, the official-source button resolves by `officialFor(agency)` or the provincial per-fire link; for a hotspot, no official link (none exists).
4. For a CIFFC-keyed fire, history loads async and injects a size-over-time sparkline + stage path; if `[]`, the chart is silently omitted.
5. User taps the official link (opens authoritative origin in a new tab) or closes the sheet (map state preserved).

### Flow D — Smoke forecast: turn on and scrub
1. User enables Smoke (Weather tier; CA only). The bottom-anchored scrubber appears.
2. Scrubber owns the visible timestamp ("Forecast · Mon 6 PM") and the lead label ("Now" / "+6 h" / "+1 d 2 h").
3. One labelled play control steps hourly frames left→right (wraps); the rail marks Now → +N h.
4. Dragging the range pauses playback and scrubs; a buffering pulse shows while frame tiles load.
5. The scrubber stays above the safe-area and is **never clipped below the fold** — it tops other controls on small screens.

### Flow E — Check the source ledger / trust
1. User taps the clearly-labelled **Sources** affordance (a text label, not a bare shield icon).
2. The ledger sheet lists every source: status dot · name · what it is · freshness · link to origin.
3. SK-scoped and Canada-only sources are flagged as such inline.
4. The standing caveat sits at the foot: window onto real data, not an emergency tool.

### Flow F — Offline / stale / empty
1. Both authoritative feeds down → offline headline; map shows the honest "data unavailable" state, never a blank that reads as "all clear."
2. A single live feed returns zero → explicit "No active fires reported · Canada" (all-clear), distinct from down. The SK layers honour the same rule: zero alerts/bans while live stays enabled with the all-clear line.
3. Kill-switch on (`disabled`) → "Turned off," and the FWI + smoke chips are removed entirely.
4. Stale cache → data shown with "Cached · as of 8 Jun" and the cache dot; `publishedAt` reveals true age.

---

## 6. Detail Panel Spec (the bottom sheet)

Keep the **`.firesheet`** slide-up: bounded inner scroll (`max-height ~64%`), `--r-xl` top corners, `--warm-stroke` top edge. The map stays visible behind it. **Lead with the answer fields in a fixed order** — what people actually want is above the fold.

**(a) CIFFC reported fire**
- Above the fold: title (`name || fireId || coords`) → stage badge → size (ha) → contained % (or "—") → situation-report time (relative).
- Header sub: `AGENCY · size · relTime`.
- Provenance line: "Source: CIFFC national" (id-only) or "Source: BC Wildfire" (provincial).
- Body groups: `REPORTED_FIELD_GROUPS` (Status / Fire / Reported), empties dropped.
- `[data-lf-hist]` slot for the async history block.
- One **official-source** `.btn.primary.block` with a clear label ("BC Wildfire Service map ↗" or the jurisdiction fallback).

**(b) Provincial fire** — same shell as (a); body is the curated "Fire details" group (Source / Fire ID / Cause / Response / Type / Contained / District via multi-key prop pick). Official link is the per-fire / per-agency viewer.

**(c) CWFIS hotspot**
- Above the fold: coords title → severity badge (Low/Moderate/High/Extreme) → head-fire intensity → reported time.
- Header sub: "Satellite hotspot · agency · relTime."
- Body groups: the five `FIELD_GROUPS` (Detection / Fire behaviour / FWI / Weather / Site), empties dropped. **No official link** (none exists for a raw detection).

**(d) History sparkline** (CIFFC-keyed only) — inline SVG: filled area (`var(--ember-12)`) + polyline (`var(--ember)`) + end dot coloured by stage var. Below it a "Tracked history" group: Change ("▲ grew / ▼ shrank / • held over N days"), Stage path ("Out of control → Being held"), First tracked (relTime). Omit the block when there are fewer than two sized points and no stage change.

**(e) Alert** — title `titleCase(event)`; sub `author · coverage · relTime`; level badge; summary paragraph; official-notice `.btn` (if `url` valid); foot caveat.

**(f) Fire ban** — title (ban type; "Fire restriction" for Other); sub "In effect since {date}"; type badge; comment paragraph; "Saskatchewan fire bans ↗" `.btn`; foot caveat.

**Consolidate the caveat.** Today the disclaimer is duplicated on alert + ban sheets and the ledger, yet absent on fire/hotspot sheets. Make it consistent: one standing caveat in the ledger (the trust home) plus the SK-specific caveat only where an official notice is actionable (alerts/bans). Do not duplicate it on every panel.

**Security:** never `innerHTML` remote/user data — there is no `escapeHtml` helper. Build all place names, agency text, and CWFIS fields with `textContent` / DOM nodes.

---

## 7. Trust / Source Ledger

The ledger is the **trust hero** — give it a clearly-labelled entry ("Sources," not a generic shield icon). Reuse `.ledger` / `.lrow` (`.sdot` status dot + `.lname` + `.lwhat` + `.lfresh` mono timestamp) + `.lnote` caveat.

- One row per source (eight): reported, hotspots, perimeters, fwi, smoke, alerts, bans, summary. Each row is a link to its authoritative origin (new tab). Reuse the verbatim `label` / `what` strings.
- **Per-row freshness from the right helper:** smoke → `smokeFreshness` ("Forecast · Mon 6 PM"); alerts → `alertFreshness` ("N active · updated 2h ago" / "No wildfire alerts · …"); bans → `banFreshness` ("N in effect · …" / "No provincial ban in effect"); all others → `freshnessLine` ("Live · updated 2h ago" / "Cached · as of 8 Jun" / "Unavailable — couldn't reach the source" / "Turned off").
- Flag scope inline: mark SK-only (alerts, bans) and Canada-only (summary, perimeters, FWI, smoke) rows so the geography gating is explicit, not implicit.
- Keep the special bottom row linking the SPSA official viewer ("Saskatchewan (SPSA) active fire map · opens in a new tab").
- Foot: the standing caveat (`NOT_FOR_EMERGENCY`, the verbatim line from §1).

This is where provenance, latency, and the "not an emergency tool" line live — front-loading institutional honesty buys credibility cheaply for a non-official app.

---

## 8. Responsive / Mobile

- **No-scroll, single-viewport law (hard).** The page never scrolls. `.bmf-app` is `position:fixed; inset:0; height:100dvh; overflow:hidden`. The map overlay keeps `overflow:hidden`; **Leaflet owns pan/zoom.** Bounded inner-scroll is allowed only for: the `.firesheet` field list, and the horizontally-scrolling `.firestats` / `.firetools` strips. Never give a primary surface a scrollbar.
- **Reclaim map height.** Today six fixed bands (firebar / stats / tools+legend / map / scrub / sheet) stack above the bottom rail and squeeze the hero. Collapse to a **lean header** (headline + as-of + Sources + Layers + country) and a **summoned** layers/legend sheet, so the map fills the rest. The scrubber only appears with Smoke and stays bottom-anchored above the safe area.
- **Bottom-sheet detail** is mandatory — never a full-screen navigation. Map context is never lost.
- **Touch targets ≥44px** (do not regress `.firesel`/`.lchip` below ~38px; bring new controls to ≥44px). Bottom-anchored primary controls for one-hand reach.
- **Landscape:** keep the map dominant; the detail sheet may dock as a right-hand panel rather than a bottom sheet, but still over the map, never replacing it. The docked panel keeps everything the bottom sheet has, **including the official-source `.btn.primary.block`**, and uses inner-scroll for the field list.
- **No account, instant value:** the map works on open with the default CA filter — no login, no setup.

---

## 9. Visual / Brand

- **Register:** warm "fight" only. Hero colour ember/gold. Active chip = ember-lit; sheet top edge = `--warm-stroke`. **Never cockpit cyan.**
- **Stage / severity → tokens (use the CSS var, never a hex):**
  - OC `--warn` `#ff5d4d` · BH `--caution` `#ffc861` · UC `--ok` `#63d68a` · OUT/UNK neutral.
  - Hotspot ramp: `--ember-hi` → `--ember` → `--warn`.
  - Alert: critical `--warn` · advisory `--caution` · info/unknown neutral.
  - Ban: Ban `--warn` · Restriction `--caution` · other neutral.
  - Brand hero accents: `--ember` `#ff6a2c`, `--ember-hi` `#ffc24a`, `--fire` `#ff7a45`, `--menu` `#ffc24a`. (`fireMarker` `#ff2a2a` is canvas-only — there is **no** `--fire-marker` var.)
- **Surfaces / text:** backplates `--card-bg` `#0a0e12` / `--card-glass` / `--warm-glass`; recessed inputs `--field` / `--recess`; text `--text` / `--text-subtle` / `--dim` / `--faint` / `--ink`; strokes `--stroke` / `--warm-stroke` / `--hair`. One frosted blur only: `--blur = blur(12px) saturate(120%)` (mirror `-webkit-`; never stack).
- **Type:** sizes `--fs-micro 8` … `--fs-mega 42` (token only, never inline px). Two faces: `--font` Saira for labels/copy; `--mono` JetBrains Mono for numerals, group headers, stat values, sheet keys/values. Uppercase + wide tracking for labels; bold + tight for values.
- **Radii:** `--r-md 12` chips/cards · `--r-lg 10` the one `.btn` + panels · `--r-xl 18` the sheet · `--r-pill 99` chips/badges/fill-tracks **only** (never buttons) · `--r-round 50%` LEDs/avatars only.
- **Buttons:** the **one `.btn`** of record (`primary`/`secondary`/`ghost`/`danger`/`ember`; `sm`/`md`/`lg`/`block`). No round pills, no hand-rolled `<button>` with inline styles. Status pills = `.badge` (squared `--r-sm`, fixed 26px; tones accent/ok/warn/caution/neutral/locked/fire).
- **Dark Leaflet:** keep `.leaflet-container` / `.leaflet-bar` / `.leaflet-control-attribution` themed via tokens — a dark basemap so fire colours pop.
- **Motion:** quiet. Sheet slide-up, marker ring-highlight, smoke crossfade, buffering pulse, heartbeat dot. Glow is a backlight, not a spotlight — do not over-glow.

---

## 10. Honesty & State Matrix

| State | Strip / header | Map | Layer chips | Copy |
|---|---|---|---|---|
| **Live, data** | numbers + "Live · updated 2h ago" + live dot | dots/discs drawn | normal | "47 active fires · Canada" |
| **Live, empty (fires)** | strip shows "No active fires" + live dot | clean map, no dots | normal | "No active fires reported · Canada" (all-clear) |
| **Live, empty (SK alerts/bans)** | strip unchanged | no SK pins/polygons | Alerts/Bans chip stays **enabled**, carries the all-clear | "No wildfire alerts · …" / "No provincial ban in effect" |
| **Cached / stale** | numbers + "Cached · as of 8 Jun" + cache dot | last-good data | normal | publishedAt reveals true age |
| **Unavailable** | "Live totals unavailable" (same height) | honest "data unavailable" state, never blank | down dot on affected chips | "Live data unavailable" |
| **Disabled (kill-switch)** | strip hidden / "Turned off" | base map only | FWI + smoke chips removed entirely | "Turned off" |
| **US / MX filter** | "Season totals are Canada only" (same height) | hotspots + any reported only | Weather + SK Local disabled with reason | gating explained, not silent |

The "as of" stamp is the live heartbeat: fresh = live dot, aging = cache dot, failed = explicit "unavailable." Never present a frozen `publishedAt` as broken — a stable fire simply has a stable timestamp. Never silently disable a live-but-empty SK layer.

---

## 11. Accessibility, Performance, Motion budgets

- **Accessibility:** every control labelled (`aria-label` / `aria-pressed` on chips, country select, play/scrub, refresh, Sources). Colour is never the only carrier — pair stage/severity colour with a text label or shape. Legend defines every symbol. The Leaflet map is focusable and the markers are reachable; if direct keyboard marker focus is impractical, provide a **non-map data path** (the source ledger plus a tappable list / count-by-stage roll-up) so a keyboard or screen-reader user can reach every fire without panning a canvas. Sheet is keyboard-reachable with a sane focus order; Esc closes the overlay and returns focus to the opener. Honour `prefers-reduced-motion` (drop the slide/pulse/crossfade to instant). Contrast: keep values on `--text`, metadata on `--dim`, smallest on `--faint`.
- **Performance:** Leaflet stays lazy (`import('../../livefire/FireMap')` on the next frame). **Both layers are dense:** hotspots can be thousands of canvas markers, and the `reported` roll can run to ~1700 area-accurate discs (~965KB raw). Keep both on a canvas renderer; draw hottest last, biggest discs first. **Require a low-zoom count-by-stage roll-up** (cluster or aggregate) for both reported discs and hotspots so overlapping marks stay tappable and the draw stays bounded — do not ship thousands of individually-hit-tested markers at national zoom. Repaint is O(layers), `invalidate()` once. Smoke uses double-buffered panes — no per-frame DOM churn. Do not reframe (`fitTo`) on every silent refresh — only on first load and real filter change.
- **Motion budgets:** sheet slide ≤ 250 ms; marker highlight instant + restore; smoke crossfade per the existing frame interval; buffering pulse subtle and capped. No layout thrash on state changes — the header height is fixed across all states in the matrix.

---

## 12. Wireframes (ASCII — layout intent, not pixel spec)

### 12.1 Mobile portrait — default

```
┌─────────────────────────────────────┐
│ 47 active fires · Canada        [CA▾]│  ← lean header: headline + country
│ Live · updated 2h ago  ●   Sources   │     as-of + heartbeat dot + text ledger label
├─────────────────────────────────────┤
│ ‹ Active 47 │ Today 6 │ Burned 1.2M › │  ← 3 headline stats (h-scroll if tight)
├─────────────────────────────────────┤
│ [ Layers ▾ ]              [ Legend ] │  ← summoned sheets, short row
├─────────────────────────────────────┤
│                                       │
│              M  A  P                  │
│         (Leaflet owns this)           │  ← the hero; fills remaining height
│      ◍ discs · • hotspots · ▨ scar    │
│                                       │
│                                       │
├─────────────────────────────────────┤
│        ( home bottom rail )           │  ← persistent, rides under overlay
└─────────────────────────────────────┘
```

### 12.2 Mobile portrait — detail bottom sheet (reported fire)

```
┌─────────────────────────────────────┐
│              M  A  P   (dimmed)       │  ← map stays visible behind
│                                       │
├─────────────────────────────────────┤ ← --warm-stroke top edge, --r-xl
│ McBride Lake fire        [OUT OF CTL]│  ← title + stage badge
│ SK · 12,400 ha · 2h ago               │
│ Source: CIFFC national                │  ← provenance honest
│                                       │
│ ░░▁▂▃▅▆ size over time ▆▅▃   ●        │  ← history sparkline (CIFFC-keyed)
│ ▲ grew · 8,200→12,400 ha over 4 days  │
│                                       │
│ STATUS                                │
│  Stage of control   Out of control    │
│  Size               12,400 ha         │
│  Contained          —                 │
│ FIRE                                  │
│  Cause              Lightning         │
│ ─────────────────────────────────────│
│ [  Saskatchewan (SPSA) fire map ↗  ] │  ← one .btn.primary.block
└─────────────────────────────────────┘
   (inner-scroll only within this sheet)
```

### 12.3 Smoke scrubber (revealed only with Smoke on)

```
├─────────────────────────────────────┤
│              M  A  P                  │
├─────────────────────────────────────┤
│ ▶  │●──────────────────────│  Forecast│  ← one labelled play + range
│ Now            Mon 6 PM        +48 h   │  ← timestamp owned here, above safe-area
└─────────────────────────────────────┘
```

### 12.4 Landscape / tablet — detail as side panel

```
┌──────────────────────────────┬──────────────────┐
│ 47 active fires · Canada [CA▾]│ McBride Lake fire│
│ Live · 2h ago ●     Sources   │ [OUT OF CONTROL] │
│ ‹Active 47│Today 6│Burned 1.2M›│ SK·12,400ha·2h   │
│  [Layers▾]          [Legend]  │ ░▂▃▅▆ size ▆▅▃ ● │
│                                │ STATUS           │
│           M  A  P              │  Stage  Out…     │
│      (fills, stays dominant)   │  Size   12,400ha │
│                                │ ─────────────────│
│                                │ [ SPSA map ↗ ]   │  ← official .btn.primary.block kept
└──────────────────────────────┴──────────────────┘
   (docked panel inner-scrolls its field list)
```

---

## 13. DO / DON'T Checklist

**DO**
- Lead the strip with three headline numbers + one "as of" stamp from `publishedAt`.
- Group the eight layers into Fires / Weather / Local; default-on = active fires + hotspots + burn area only. Keep Out fires under Fires (national), not Local.
- Key every drawn symbol in a summonable legend (stage, hotspot ramp, alert, ban, raster ramps).
- State the all-clear ("No active fires reported · Canada"; "No wildfire alerts," "No provincial ban in effect") — never a silent blank or a silently-off live layer.
- Resolve official links by `officialFor(agency)` / provincial per-fire link; surface provenance ("Source: CIFFC national" vs "Source: BC Wildfire").
- Keep the detail in a bottom sheet over a visible map; lead with stage → size → contained → time; keep the official-source button in the docked landscape panel too.
- Make Sources a labelled, discoverable text entry; keep it the freshness home; consolidate the caveat to its verbatim line.
- Roll up reported discs and hotspots by stage at low zoom so dense areas stay tappable and bounded.
- Hold ≥44px targets, the one `.btn`, token-only colour, one frosted blur, the non-scrolling viewport; provide a non-map keyboard/reader data path.
- Build remote-data nodes with `textContent` / DOM (no `innerHTML`).

**DON'T**
- Don't invent fields, layers, colours, links, or stats beyond this brief.
- Don't show US/MX/raw summary stats (Canada-only) or imply SK alerts/bans are national, and don't gate Out fires to SK.
- Don't present `fetchedAt` as freshness, or smoke as "updated X ago" (it's a forecast).
- Don't reframe (`fitTo`) on every refresh and yank the user out of their zoom.
- Don't cram eight chips + legend into one no-scroll row, or rely on near-invisible duplicate status dots.
- Don't disable a live-but-empty Alerts/Bans layer — empty is the all-clear, not off.
- Don't ship thousands of individually-hit-tested markers at national zoom.
- Don't paint anything cockpit cyan, add a second `UI` token object, hard-code a hex/blur/shadow, or use round pills / hand-rolled buttons.
- Don't let the scrubber clip below the fold, or let any primary surface scroll.
- Don't imply the map is an emergency, dispatch, or life-safety tool.

---

## 14. Acceptance Criteria

1. On open with the default CA filter, the header shows the live headline + three stats + an "as of" stamp sourced from `publishedAt`, with a stable height across every state in §10.
2. Default-visible layers are exactly active fires, hotspots, burn area; the other five are opt-in and grouped Fires (incl. Out fires, national) / Weather (Canada) / Local (SK).
3. The legend, when summoned, defines every coloured mark drawn (stage OC/BH/UC/OUT/UNK, hotspot ramp, alert level, ban type, plus any active raster ramp).
4. Tapping a fire opens a bottom sheet over a visible map, leading with stage → size → contained → time, with correct provenance and the right official link (or none for a hotspot); the landscape side panel keeps that official-source button.
5. CIFFC-keyed fires show the history sparkline + stage path; hotspots and provincial fires show none, with no error.
6. The smoke scrubber appears only with Smoke on, owns its "Forecast · Mon 6 PM" timestamp, stays above the safe area, and never clips.
7. Empty, cached, unavailable, disabled, and US/MX states each render distinct, honest copy; a live-but-empty Alerts/Bans layer stays enabled with its all-clear line; no blank map reads as "all clear."
8. The page never scrolls; only the sheet and the two strips may inner-scroll; all targets ≥38px (new controls ≥44px); a keyboard/screen-reader user can reach every fire via the non-map data path.
9. Every colour is a `var(--token)` from `theme.ts`; no hex/blur/shadow literal; warm register throughout; the one `.btn`; no round pills.
10. Reported discs and hotspots are roll-up-clustered at low zoom; no thousands of hit-tested markers at national zoom.
11. All example microcopy is ≤8 words, dry and declarative, with no em-dash-glued AI tells.

> After any token touch, run `npm run gen:tokens`, then `npm run verify:tokens` and `npm run verify:ui`.
