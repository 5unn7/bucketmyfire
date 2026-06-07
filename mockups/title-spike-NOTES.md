# title-spike.html — notes

A single-file, no-server mockup of the bucketmyfire **title screen** in the chosen direction:
**"Ember-glow horizon."** Open it directly in a browser.

## Copy used (verbatim)

- Eyebrow (PLACE signal): **Northern Saskatchewan**
- Wordmark: **BUCKET MY FIRE**
- Tagline (FIGHT signal): **Fight the fire.**
- Welcome line: **Welcome back, DUSTOFF**
- Hero CTA: **PLAY**
- Secondary: **Resume**
- Footer: **v1.0 · Marakana**

The retired three-noun hook ("A bucket, a chopper, a wildfire") is **not** present. No em dashes.
Every line is <=8 words, declarative. The THREAT signal is **never stated in words** — it is
carried only by light + motion (see below).

## Three-signal rule (one of each, no doubling)

- **FIGHT** = the tagline "Fight the fire."
- **PLACE** = the eyebrow "Northern Saskatchewan".
- **THREAT** = light + motion only: (1) a warm ember glow rising from the bottom edge (radial
  gradients anchored at `50% 122%` — the fire is off-screen below, advancing up toward the
  lockup); (2) a breathing "horizon" heat band at the bottom; (3) rising ember motes; (4) the
  wordmark's flame icon **burns** (a fire gradient masked to the flame shape, drifting up, under
  a flickering ember glow). No "3 fires" / "the fire is winning" text — the glow *is* the threat.

## Token choices (warm "fight" register only — no cockpit cyan)

CSS custom properties in `:root` are seeded **from `theme.ts`**, mirroring how
`src/three/ui/home/styles.ts` builds its `.bmf-app` VARS block:

- `--ember #ff6a2c` (UI.ember), `--ember-hi #ffc24a` (UI.emberHi), `--fire #ff7a45` (UI.fire),
  `--menu #ffc24a` (UI.menu) for the eyebrow.
- PLAY uses the gold CTA gradient verbatim: `--cta` / `--cta-hi` (UI.cta/ctaHi) with `--cta-ink
  #3a2406` (UI.ctaInk) dark text and `--cta-glow` (UI.ctaGlow) shadow — identical to the live
  `.btn.primary`.
- Resume uses `--warm-glass` (UI.warmGlass) + `--warm-stroke` (UI.warmStroke), the live secondary
  treatment. It is deliberately **not** gold, so PLAY is the only gold thing on screen.
- The ember/fire/glow alpha stops (`--ember-12/20/30/50`, `--fire-12/16/28`, `--glow-50/60/80`,
  `--warm-26/38`) are the `HOME` ramp from `theme.ts`.
- Type/weight/radius use the `FS` / `FW` / `R` scales (`--fs-mega 42px`, `--fw-black 900`,
  `--r-lg 10px`, etc.). No raw colours/sizes invented outside these tokens.

The ember-mote CSS (`.mote` + `ts-rise-mote` keyframes + the JS spawn loop) is copied from the
established pattern in `styles.ts` (`.mote` / `bmf-rise-mote` / `spawnEmbers`). The icon burn
(masked fire gradient + `ts-burn-shimmer` / `ts-burn-glow`) mirrors `TitleScreen.addBurn()`.

## How the scoped-CSS-from-tokens approach mirrors home/styles.ts

`styles.ts` injects one stylesheet whose first block is a `VARS` string that interpolates the
`UI`/`HOME`/`FS`/`FW`/`R` token objects into CSS custom properties under `.bmf-app`, then a `CSS`
string styles plain classes against those vars. This mockup does the same thing statically: a
`:root{ … }` block declares the same vars (hand-copied from `theme.ts`), and every rule reads
`var(--token)`. So the mockup's palette/scale is the real one, and a port can lift the rules
nearly unchanged — the only difference is that the live build interpolates the values at
build-time instead of me transcribing them.

## What a live TitleScreen port would reuse vs rebuild

**Reuse as-is:**
- The whole token model — the live screen already imports `UI`/`HOME`/`FS`/`FW`/`R`. No new tokens
  are needed; everything here maps to an existing one.
- The burning brand mark: `TitleScreen.addBurn()` already does exactly the masked-gradient + glow
  used here, against `makeBrandIcon('white')` / `brandIconUrl('white')`.
- The ember motes: `spawnEmbers()` + the `.mote`/`bmf-rise-mote` CSS already exist.
- `makeBrandWordmark('white')` for the wordmark (the live screen uses the vector wordmark; this
  mockup fakes it with gradient text — the port should use the real vector).
- The PLAY button is essentially the live `buildPlayButton()` (gold gradient, ink text, hover lift).

**Rebuild / add:**
- The **ember-glow scene + horizon band**: the current `TitleScreen` uses a full-bleed photo
  (`home212-bg.webp`) with a bottom legibility gradient. This direction swaps the photo for a
  procedural ember-glow scene (or layers the glow over the live 3D attract scene). That's the one
  real change — the rest is the existing screen re-skinned.
- **Eyebrow** ("Northern Saskatchewan") + **Resume** secondary: the live screen currently shows
  the tagline + PLAY + **Shop**. This direction drops Shop from the title (it lives one layer
  deeper) and replaces it with **Resume**; the eyebrow is new. Both are trivial DOM additions.
- The current centred-top lockup would move to a vertically-centred column (this mockup) or stay
  bottom-anchored — a layout call for the owner, not a token change.

## escapeHtml requirement (callsign)

The "Welcome back, DUSTOFF" line shows a **user-controlled callsign** (`profile.name`). In this
static mockup it's hard-coded safe text. In the live port the name **must be HTML-escaped** before
injection to avoid XSS/markup injection — i.e. set it via `textContent` (as the live `TitleScreen`
already does with a template literal into `div(..., text)` → `node.textContent`), or run it through
an `escapeHtml()` if ever composed into an HTML string. Never `innerHTML` the raw callsign. This
mockup deliberately does not solve it (no live profile here) — flagging it for the port.

## Verdict: is HTML + scoped-CSS genuinely faster/cleaner to author than imperative el()/div()?

Yes, clearly, **for laying out and iterating on a static visual surface like a title screen.** The
markup-plus-stylesheet form lets the whole hierarchy, spacing, type, hover/active states, media
queries, and keyframes sit in one declarative place you can eyeball and tweak in a browser with
instant feedback; the equivalent imperative `el()/div()` code (see `TitleScreen.ts`) spends most of
its lines threading `Object.assign` style objects and wiring pointer listeners by hand, which is
slower to write, noisier to read, and far slower to iterate (rebuild to see a 4px change). The token
seeding makes the two approaches *equivalently* type-safe in spirit — both pull from the same
palette — so the HTML form gives up little. The honest caveat: the imperative form is the right tool
where the UI is **dynamic and stateful** (the live screen toggles welcome/no-welcome, drives the
splash handoff, tears itself down on PLAY), and a mockup-to-code port still has to re-express the
static CSS as `el()` calls or move to an injected `<style>` string (which `styles.ts` already does
for the hub — arguably the best of both). So: HTML+scoped-CSS is the better **authoring/design**
model; the strongest production pattern is the hub's hybrid — author in scoped CSS, inject one
stylesheet, keep only the dynamic wiring in TS.
