---
name: bmf-content
description: >-
  Produce or manage a bucketmyfire "Field Notes" blog article — the content engine + SEO/AEO/GEO blog
  layer. Use whenever the task is to write a new wildfire article, plan content pillars, run the content
  pipeline, fix the blog's structured data, or change how articles are rendered/verified. The engine is a
  multi-agent Workflow (`.claude/workflows/bmf-content.mjs`): pillar -> research -> fact-check -> outline
  -> draft -> image brief -> audit, with ONE backbone rule — every external link must be on
  `content/sources.allowlist.json` (official government / provincial / recognized-authority sources only),
  which is the project's E-E-A-T / GEO moat. Articles are Markdown in `content/<slug>.md`, rendered at
  build time to pre-rendered static HTML under `/blog/<slug>/` (Article + FAQ + HowTo JSON-LD, OG card,
  sitemap) by `scripts/content/` and gated by `npm run verify:content`. Reach for it on "write a blog
  post", "content strategy", "SEO article", "add a Field Note", "new pillar", "blog isn't ranking", or any
  change under `content/` or `scripts/content/`. NOT the game UI (bmf-ui), NOT in-game art prompts
  (bmf-art) — though the engine borrows bmf-art's guardrails for the hero image.
---

# Field Notes — the content engine

The blog ("Field Notes") is bucketmyfire's organic-search wing: original, fact-checked wildfire
explainers so we rank in search, get quoted by answer engines, and get cited by generative engines.
The strategy of record is **`docs/CONTENT-STRATEGY.md`** (pillars, keywords, voice brief, SEO/AEO/GEO
checklist, cadence). Read it first. This skill is the routing oracle.

## The one rule

**Official sources only.** Every external link in every article must resolve to a hostname on
`content/sources.allowlist.json` (government `.gc.ca` / provincial `.ca`, CIFFC, FireSmart Canada).
That is not a limitation — it is the whole strategy. `verify:content` fails the build on any off-list
link, and the engine's fact-check stage drops any claim it can't tie to an official source.

## "I want to X" → here

| Want | Do |
|---|---|
| Write one new article | Run the engine (below), then land its output |
| Plan pillars / topics / keywords | Edit `docs/CONTENT-STRATEGY.md` |
| Add/remove a citeable source | Edit `content/sources.allowlist.json` **and** the mirrored `ALLOW` array in the workflow |
| Change how a page looks / its tokens | `scripts/content/template.mjs` (+ render `BLOG_CSS` in `render.mjs`); never hard-code a token |
| Change what the gate enforces | `scripts/verify-content.mjs` |
| Add a blog link / nav entry | `index.html` (front door) |

## Run the engine (the automated form)

```
Workflow({ scriptPath: '.claude/workflows/bmf-content.mjs',
           args: { pillar, topic, slug, keyword, internalLinks?, howto? } })
```

It fans out research (official domains only) → adversarially fact-checks each claim → outlines →
drafts in brand voice → writes a `bmf-art`-guardrailed hero/OG prompt → audits (voice + SEO/AEO/GEO +
source-compliance) and revises. It returns `{ frontmatter, markdown, imagePrompts, audit, stats }`.
The workflow sandbox has no filesystem, so it **returns** the article — it does not write it.

## Land the output (main loop)

1. Write `content/<slug>.md` — a `---` frontmatter block then the Markdown body. Frontmatter fields:
   `title, slug, description, pillar, date, updated?, keyword, takeaways[], faq[], sources[],
   internalLinks[], howto?` (arrays/objects are authored as one-line JSON — see any existing article).
   Stamp `date`/`updated` here (the workflow can't read the clock).
2. `npm run build:content` → renders into `dist/blog/`. `npm run verify:content` → must be green.
3. Render the real hero art from `imagePrompts.ogPrompt` when ready and drop it in; until then an
   on-brand SVG card is rasterized to `og.png` automatically (via the existing `sharp` devDep).
4. **Publish boundary:** every push to `main` auto-deploys to prod. Stop at local build + green
   verify; the `git push` that makes it live is a separate, human-confirmed step.

## Verify

- `npm run build:content` — fast local render of `content/` → `dist/blog/` (then `npm run preview`, open `/blog/`).
- `npm run verify:content` — the gate (allowlist + SEO bounds + voice + sitemap sync); also runs inside
  `npm run verify` and the deploy.
- `npm run build` — the full type-gate + Vite build runs the same render via the `bmf-content` Vite plugin.

## Delegates / boundaries

- **Hero art:** the engine inlines `bmf-art`'s brand guardrails to write the prompt; the raster render is
  your image tool. For richer art direction, hand the topic to **bmf-art** directly.
- NOT the game's DOM UI (**bmf-ui**), NOT in-game meshes/shaders (**bmf-asset**), NOT missions
  (**bmf-mission**) or maps (**bmf-map**).