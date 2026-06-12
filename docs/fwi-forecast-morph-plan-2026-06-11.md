# Smooth, server-backed Fire-Weather-Index forecast morph (flat map)

_Plan — 2026-06-11._

> **STATUS (2026-06-11): FULLY BUILT — ONLY THE DEPLOY REMAINS.** The globe was retired, so the
> `wmsUrl`/`BOX`/`GLOBE_BOX` helpers it would have been copied from are gone — they were **freshly written**
> in `client.ts` (`wmsUrl`, `FWI_BOX`, `FWI_GLOBE_BOX`, `DrapeBox`, `fwiFrameUrl`). Done: §1–§7 + the edge
> function. The FWI day-scrubber now **crossfades** (double-buffered image overlays) instead of strobing, all
> days **preload** when FWI takes the scrubber, and **Play is a continuous, video-like `linear` morph**
> (`fwiFadeMs 1150` ≈ `fwiFrameMs 1200` → no static hold between days; the easing is `linear`, not `ease`, so
> chained day-steps read as one flow, not slow-in/out pulses).
>
> The **edge function IS written**: `supabase/functions/fwi-frame/index.ts` (read-only public caching proxy
> — validates `src`/`day`/`w`, vendors the upstream WMS + brand SLD + bbox, fetches the GetMap PNG with an
> AbortController timeout, returns it with `Cache-Control public max-age=21600 s-maxage=86400` + CORS `*`,
> tiny in-isolate LRU; no table/cron/Storage/secret). Deploy note added to `supabase/schema.sql`.
>
> **DONE — DEPLOYED + LIVE (2026-06-11, commit `8fe7dda`).** `fwi-frame` is deployed to project
> `wnorrtfkfqrgipmggfwh` (`verify_jwt` off, ACTIVE v1) and `FWI_PROXY_DEPLOYED = true`, so frames now route
> through the cache (`<base>/functions/v1/fwi-frame`). Smoke-tested live: bad `src` → 400,
> `?src=cwfis&day=<tomorrow>&w=512` → 200 `image/png` (29.7 KB), `OPTIONS` → ACAO `*`. Deployed via the
> Supabase MCP `deploy_edge_function` tool (the `supabase` CLI isn't installed locally). Falls back to direct
> CWFIS/GWIS if Supabase is ever unconfigured. **Nothing left to do** — the whole plan has shipped (local
> commits on `main`, not pushed).

## Context

The live-fire tracker's **Fire Weather Index (FWI)** forecast can be animated: a bottom scrubber with a
play button steps through ~7 daily forecast frames. Today that playback **strobes and stalls**:

- On the flat Leaflet map (`FireMap.setFwiTime`), each step just calls `setParams({time})` on two tiled
  WMS layers (CWFIS Canada + GWIS global). Leaflet **drops the old tiles the instant the param changes**
  and shows nothing until the new tiles load — so every day-step blanks the danger field, then pops in.
- Frames are fetched **live from CWFIS/GWIS on every step**, per visitor, so the first play-through
  stutters as each day loads over the network, and there's no preload.

The user wants three things, all on the **flat map** (a parallel session is removing the 3D globe — do
**not** touch `FireGlobe.ts`/its globe path):

1. **Save the forecast frames on our server side** (so they're reliable, CORS-clean, and one fetch serves
   everyone instead of per-visitor upstream hits).
2. **Morph** the animation so the FWI field dissolves smoothly day-to-day instead of strobing.
3. **Preload** all frames up front so pressing Play animates buttery-smooth.

**Chosen approach (confirmed with the user):**
- Server = a **lightweight Supabase caching edge proxy** (no Storage bucket, no cron) that fetches each
  day's FWI GetMap PNG server-side and returns it with long cache headers.
- Morph = on the flat map, replace the two **tiled** FWI WMS layers with a **double-buffered pair of
  single-image overlays** that **crossfade** (the exact pattern the existing `SmokeForecastLayer` already
  proves), tuned so the dissolve spans the frame for a continuous morph. FWI is a danger index that rises/
  falls *in place* (it doesn't translate like a smoke plume), so a temporal cross-dissolve **is** the
  correct, honest morph — no optical-flow warping needed.
- Preload = warm all day images (one GET per source per day) when FWI turns on.
- Everything **degrades to direct CWFIS/GWIS** when Supabase is unconfigured, exactly like the rest of the
  live layer.

Single GetMap PNG per day (2 URLs/day: Canada + global) is the natural unit for all three asks — trivially
cacheable on the server, trivially preloadable, and trivially crossfadeable — whereas tiled WMS is awkward
for every one of them. Known trade-off: a single 2048px overlay is blurrier than tiles at max zoom, but FWI
is a low-opacity continental wash on a fallback view (the now-removed globe already accepted this exact
trade-off at 2048px and read fine).

## Files & changes

### 1. Relocate the single-GetMap WMS helper into a Three-free module — `src/three/livefire/client.ts`
`wmsUrl()`, the `BOX` (Canada) and `GLOBE_BOX` (world) constants, and `DrapeBox`/`boxSpan` currently live in
`FireGlobe.ts:55-101` and will die with the globe. **Add fresh copies to `client.ts`** (already Three-free;
already holds all WMS URL/layer/SLD constants). Do **not** edit `FireGlobe.ts` (avoid colliding with the
parallel deletion; ~12 lines of duplication is fine and temporary).
- Export `wmsUrl(base, layer, box, {time, sld, width})`, `FWI_BOX` (= the Canada `BOX`), `FWI_GLOBE_BOX`.

### 2. Client frame-URL builder — `src/three/livefire/client.ts`
Add `fwiFrameUrl(src: 'cwfis' | 'gwis', day: string, width: number): string`:
- When `import.meta.env.VITE_SUPABASE_URL` is set → return the edge-proxy URL
  `${URL_BASE}/functions/v1/fwi-frame?src=${src}&day=${day}&w=${width}` (read env the same way
  `leaderboard/client.ts:17` does).
- Else → return the **direct** upstream GetMap via `wmsUrl(...)`:
  - `cwfis` → `wmsUrl(FWI_WMS_URL, FWI_WMS_LAYER, FWI_BOX, {time: day, sld: FWI_WMS_SLD, width})`
  - `gwis`  → `wmsUrl(GWIS_FWI_WMS_URL, GWIS_FWI_LAYER, FWI_GLOBE_BOX, {time: day, sld: GWIS_FWI_SLD, width})`

### 3. Server: caching edge proxy — `supabase/functions/fwi-frame/index.ts` (new)
Model the file header + structure on `supabase/functions/ingest-fires/index.ts`, but **read-only & public**:
- `Deno.serve` GET handler; CORS preflight `OPTIONS` → `Access-Control-Allow-Origin: *`.
- Validate query: `src ∈ {cwfis, gwis}`, `day` matches `^\d{4}-\d{2}-\d{2}$` within a sane ±N-day window,
  `w` clamped to e.g. `[256, 4096]` (default 2048). Bad input → 400.
- **Vendor** the upstream base URL + layer + brand SLD + bbox (mirrors `client.ts`; `ingest-fires` already
  sets the precedent of vendoring small constants into the Deno function). Build the GetMap URL the same way
  `wmsUrl()` does.
- `fetch` the upstream PNG with an `AbortController` timeout; on `res.ok` stream it back with
  `Content-Type: image/png`, `Cache-Control: public, max-age=21600, s-maxage=86400`,
  `Access-Control-Allow-Origin: *`. Upstream failure/timeout → **502** (client then falls back to direct).
- Tiny in-isolate `Map` LRU (cap ~24 entries) for hot day+src so a warm isolate skips re-fetching. No DB,
  no Storage, no secret (it only proxies **public** government imagery and writes nothing).
- **No `verify_jwt`** (public). Deploy: `supabase functions deploy fwi-frame --no-verify-jwt --project-ref <ref>`.
- `supabase/schema.sql`: add a **commented** deploy note next to the existing ingest blocks (no table, no
  cron, no bucket — just document the function + its deploy command for the runbook).

### 4. Flat-map FWI morph — `src/three/livefire/FireMap.ts`
Add a `FwiForecastLayer` class **right beside `SmokeForecastLayer`** (same shape, but image overlays for the
two stacked FWI rasters instead of one tiled WMS):
- Two Leaflet panes `fwiA`/`fwiB`, each below the smoke panes (`z-index` ~210, under smoke's 250 and the
  canvas dots' 400 — preserves today's "FWI beneath everything" order). Pane opacity `0↔1` with a
  `transition: opacity <fwiFadeMs>ms ease` (the crossfade rides the pane, like smoke).
- Each buffer holds **two `L.imageOverlay`s**: a **global** GWIS overlay (`FWI_GLOBE_BOX` bounds, drawn
  lower) + a **Canada** CWFIS overlay (`FWI_BOX` bounds, on top) — mirroring the current
  `fwiGlobalLayer`/`fwiLayer` z-order, both at `LIVEFIRE.fwiOpacity`.
- `showFrame(day)`: point the **back** buffer's two overlays at `fwiFrameUrl('gwis'|'cwfis', day, width)`,
  wait for **both** images to load (count 2 `load` events / `Promise.all`), then crossfade panes. A request
  `token` (bumped per call) makes a fast scrub always land on the latest day; a superseded late load bails.
  Optional `onState(loading)` buffering callback, same as smoke.
- `preload(days: string[])`: `new Image().src = fwiFrameUrl(...)` for each src×day to warm the HTTP cache.
- `setVisible(on)` / `dispose()` parallel to `SmokeForecastLayer`.
- `imageOverlay.on('error', …)` → settle the buffering hint and keep the prior frame draped (never throw —
  honest graceful degrade, no loop-death risk).

Rewire `FireMap`:
- Replace the `fwiLayer` + `fwiGlobalLayer` fields/construction with `private fwi: FwiForecastLayer`.
- `setFwiTime(day)` → `this.fwi.showFrame(day)` (no more strobing `setParams`).
- `applyVisibility()` → `this.fwi.setVisible(this.visible.fwi && isLiveFireEnabled())` (keeps the
  kill-switch gate).
- Implement the new `preloadFwi(days)` contract method → `this.fwi.preload(days)`.
- `dispose()` → dispose the fwi layer.

### 5. View contract — `src/three/livefire/view.ts`
Add one **optional** method so the change is additive and can't break the (transient) globe:
`preloadFwi?(days: string[]): void;` on `LiveMapView`.

### 6. Playback wiring + config-ize the constants — `src/three/ui/home/menus.ts`
- When FWI takes the scrubber (`setForecastMode('fwi')`, in `setLayerState`/the toggle path), call
  `map?.preloadFwi?.(fwiFrames)` once so Play is instant.
- Replace the local `FWI_FC_DAYS = 7` / `FWI_FRAME_MS = 1200` literals with config reads (below). Playback
  structure is unchanged — each step now morphs because `setFwiTime` crossfades.

### 7. Config — `src/three/config.ts` (`LIVEFIRE` block, beside the smoke tokens)
Add, each with a one-line comment in the existing house style:
- `fwiForecastDays: 7` — span of the daily FWI scrubber/morph.
- `fwiFrameMs: 1200` — playback dwell per day (was the menus.ts literal).
- `fwiFadeMs: 900` — crossfade/morph dissolve duration; near the dwell so playback reads as a continuous
  morph (smoke's 140 is a quick cut between hourly frames; FWI wants a longer dissolve).
- `fwiProxyWidth: 2048` — GetMap width handed to `fwiFrameUrl` (matches the proven globe `rasterW`).

## Honesty note
Crossfading between daily FWI model runs is consistent with how the **smoke** layer already animates (it
crossfades hourly forecast frames and is labeled a forecast). Keep the existing "Forecast · <day>" chip +
ledger labeling unchanged — nothing presents the morph as observed data.

## Verification
1. `npm run typecheck` (the strict gate; unused imports break it — remove the old FWI layer imports).
2. `npm run build` — full type-gate + multi-page build.
3. `npm run verify:livefire` — normalizers unaffected, confirm still green; `npm run verify` umbrella.
4. `npm run verify:render` (headless) — in CI the proxy + upstream are both unreachable, so FWI falls back
   to direct and degrades to a blank wash; the `net::ERR_` allowlist already keeps this benign (per the
   `verify-render-ci-net-err-allowlist` memory). Confirm no new red.
5. **Manual dogfood** (`npm run dev`, open `/?flat=1` → tracker → Layers → Fire weather → Play):
   - The danger field **dissolves smoothly** day-to-day (no blank strobe).
   - Network tab: with `VITE_SUPABASE_URL` set, frames load from `…/functions/v1/fwi-frame`; unset → direct
     CWFIS/GWIS. All 7 days warm on first toggle (preload), so Play never stalls.
6. **Edge function smoke** (after deploy or via `supabase functions serve fwi-frame`):
   `curl '…/functions/v1/fwi-frame?src=cwfis&day=<tomorrow>&w=512' -o f.png` → a valid PNG; bad `src`/`day`
   → 400; upstream-down simulation → 502.

## Sequencing / safety
- The **client** changes ship safely first: with the proxy not yet deployed (or Supabase unconfigured),
  `fwiFrameUrl` returns direct-upstream URLs, so the morph + preload work immediately against CWFIS/GWIS.
- The **edge-function deploy** (`supabase functions deploy fwi-frame --no-verify-jwt`) is a manual,
  outward-facing step — flag it for the user / run only on explicit go-ahead. No DB migration, no cron, no
  Storage bucket; nothing destructive.
- Do **not** edit `FireGlobe.ts` or the globe code path (parallel session owns its removal).