# Content Strategy — bucketmyfire "Field Notes"

> The plan of record for the blog + the content engine. The engine
> (`.claude/workflows/bmf-content.mjs`) and `verify:content` both read their rules from
> here and from `content/sources.allowlist.json`. Keep this doc and the allowlist in sync.

## Why we own the words

The site currently points users *outward* — to FireSmart, SPSA, CIFFC — for substance.
That leaks authority, trust, and search traffic to other domains. The blog fixes it: we
write original, fact-checked answers to the wildfire questions people actually ask, so
bucketmyfire ranks in search, gets quoted by answer engines (Google AI Overviews,
Perplexity), and gets cited by generative engines (ChatGPT, Claude).

The one hard rule that makes this work: **every factual claim cites an official
government, provincial, or recognized-authority source** (the
`content/sources.allowlist.json` list). "Official sources only" is not a constraint we
tolerate — it is the *whole strategy*. It is why an answer engine trusts the page over a
content farm. The game is the hook; the rigour is the moat.

## The position

Field Notes is the editorial wing of the "credible wildfire window" (see
`docs/FRONT-DOOR-PLAN.md`). It is allowed to scroll (it is content, not a cockpit). It
reads in the warm **"fight" register** (see `DESIGN.md`): ember on charcoal, dry and
direct. It is never alarmist, never preachy, never a content farm. It explains the real
thing, plainly, and links the fight back into the game.

---

## The four pillars (hub-and-spoke)

Each pillar gets a **hub page** (`/blog/<pillar>/`) that frames the topic and links to
its **spoke articles**, which interlink back to the hub and to each other. This is the
SEO structure that compounds.

### Pillar 1 — How wildfires are fought *(SEO workhorse · strongest brand bridge)*
The clearest bridge between the game and the real subject; durable "how does X work"
demand.
| Article | Target keyword / intent | Type |
|---|---|---|
| **How helicopters fight wildfires** *(proof article)* | "how do helicopters fight wildfires" — informational | explainer + FAQ |
| What is a Bambi bucket? | "what is a bambi bucket" — definitional | explainer + FAQ |
| Water bomber vs helicopter | "water bomber vs helicopter" — comparison | comparison |
| Stages of control, explained | "out of control vs being held fire" — definitional | explainer |
Sources: NRCan/CWFIS, CIFFC, provincial wildfire agencies.

### Pillar 2 — Wildfire preparedness *(highest practical intent · HowTo schema)*
| Article | Target keyword / intent | Type |
|---|---|---|
| How to FireSmart your home | "how to firesmart your home" — how-to | HowTo + FAQ |
| What to pack in a wildfire go-bag | "wildfire go bag checklist" — how-to | HowTo + list |
| How to get wildfire alerts in Saskatchewan | "saskatchewan wildfire alerts" — transactional | how-to |
Sources: FireSmart Canada (flagged authority), SPSA/saskatchewan.ca, SaskAlert, GetPrepared.gc.ca.

### Pillar 3 — Wildfire data explainers *(pairs with our live data + the "honest window")*
| Article | Target keyword / intent | Type |
|---|---|---|
| What the Fire Weather Index means | "what is the fire weather index" — definitional | explainer + FAQ |
| Out of control vs being held vs under control | "wildfire stages of control canada" — definitional | explainer |
| Canada's fire season by the numbers | "canada wildfire area burned 2026" — informational | data explainer |
Sources: CWFIS, CIFFC, ECCC.

### Pillar 4 — The cause & brand story *(brand funnel · lower SEO)*
| Article | Intent | Type |
|---|---|---|
| Why we built a wildfire game | brand / about | narrative |
| Where your purchase goes ("Wear the fight") | brand / cause | narrative |
Sources: brand-owned (these may state opinion/intent; any *factual* wildfire claim still cites the allowlist).

**Sequencing:** Pillars 1–3 are the SEO workhorses — lead with them. Pillar 4 is the
brand funnel; publish it once there's traffic to funnel.

---

## Voice brief (the engine inlines this into its Draft + Audit stages)

Distilled from `DESIGN.md` and `src/three/province/strings.ts`. The `verify:content` gate
enforces the mechanical rules; the rest is taste.

- **Register:** warm "fight". Dry, direct, calm. Fire is loud enough — say it straight.
- **Headlines:** primal, declarative, ideally ≤8 words. "How helicopters fight wildfires",
  not "Everything You Need To Know About Aerial Firefighting Operations".
- **No em-dashes.** Shipped copy is em-dash-free (enforced). Use periods and commas.
- **No AI-slop tells:** no "in today's fast-paced world", no "it's important to note",
  no "delve", no "unleash", no "game-changer", no hype, no participation-trophy softness,
  no fake hedging. Make a claim, cite it, move on.
- **No false authority.** We are a window, not an emergency service. Every preparedness or
  live-data article carries the standing disclaimer: *"This is general information, not an
  emergency tool. In an emergency, follow official sources and local authorities."*
- **Cite inline, plainly.** "CIFFC reports X" with the link — not a wall of footnotes.
- **Bridge to the fight,** once, naturally, near the end — never a hard sell mid-article.

---

## SEO / AEO / GEO checklist (the engine builds to this; the gate enforces the mechanical subset)

**SEO** (classic search)
- Clean URL `/blog/<slug>/`, one `<h1>`, logical `<h2>/<h3>` hierarchy, semantic `<article>`.
- Unique `<title>` ≤ 60 chars, meta description ≤ 160 chars *(gate-enforced)*.
- Internal links: to the pillar hub + ≥1 sibling article *(gate-enforced: ≥1 internal link)*.
- `<link rel="canonical">`, OG + Twitter tags, an `og:image` *(gate-enforced)*.
- A sitemap entry, auto-generated at build *(gate-enforced: sitemap in sync)*.

**AEO** (answer engines — get quoted)
- A **"Key takeaways"** block near the top: 3–5 one-sentence, self-contained answers.
- An explicit **FAQ** section whose Q&As become `FAQPage` JSON-LD *(gate: ≥1 FAQ on explainers)*.
- **`HowTo` JSON-LD** on preparedness how-tos (numbered steps).
- Question-shaped `<h2>`s with the answer in the first sentence underneath.

**GEO** (generative engines — get cited)
- A definitional **"What is X"** section that states the term plainly.
- Every fact stated plainly with an **inline citation to an allowlisted source**
  *(gate: every external link on the allowlist; ≥1 official citation per article)*.
- A visible dateline: **published + "Last updated"** date.
- E-E-A-T signals: `Article` JSON-LD with `author`/`publisher` = the Organization, and the
  standing "general information, not an emergency tool" note where relevant.

---

## Cadence & workflow

- **Cadence target:** 1 article / week, rotating through pillars 1 → 2 → 3 (→ 4 occasionally).
- **Produce one article:** run the engine — see `.claude/skills/bmf-content/SKILL.md`:
  ```
  Workflow({ name: 'bmf-content', args: { pillar, topic, slug, keyword } })
  ```
  It runs research → fact-check → outline → draft → image brief → audit and returns the
  Markdown + frontmatter + image prompts + audit report.
- **Land it:** write the returned Markdown to `content/<slug>.md`, then
  `npm run build:content` → `npm run verify:content`. Render the custom OG art from the
  returned `bmf-art` prompt when ready (an on-brand SVG OG card ships as the fallback).
- **Publish boundary:** every push to `main` auto-deploys to prod. The engine stops at
  *local build + green verify*. The `git push` that makes it live is always a separate,
  human-confirmed step.

## The files

| Thing | Path |
|---|---|
| Source allowlist (the rule) | `content/sources.allowlist.json` |
| Article sources (Markdown + frontmatter) | `content/<slug>.md` |
| Render module (Markdown → static HTML) | `scripts/content/` |
| Build wiring (Vite plugin + sitemap) | `vite.config.ts`, `npm run build:content` |
| The gate | `scripts/verify-content.mjs` (`npm run verify:content`, in `npm run verify`) |
| The engine | `.claude/workflows/bmf-content.mjs` |
| How to run it | `.claude/skills/bmf-content/SKILL.md` |
