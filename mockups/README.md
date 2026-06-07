# mockups/ — reference previews, **not** the source of truth

These static HTML screens (`index.html` + the per-screen files, styled by `kit.css`) are a
**hand-maintained design reference** — useful for eyeballing a whole-screen layout or sharing a
look without booting the game. They are **not authoritative**.

## Read this before trusting a mockup

- **The live UI is the source of truth.** Every screen actually ships from `src/three/ui/`
  (tokens in `ui/theme.ts`, components in `ui/components/`, prose system in `DESIGN.md`). If a
  mockup and the code disagree, **the code wins** — fix the mockup, not the game.
- **Design tokens are generated, not hand-mirrored.** `tokens.css` is written from `theme.ts` by
  `npm run gen:tokens`, and `kit.css` `@import`s it — so when a token changes in `theme.ts` the
  mockups follow, and `npm run verify:tokens` fails the build if `tokens.css` is stale. (`kit.css`'s
  *component* CSS — buttons, cards, … — and the per-screen HTML are still hand-maintained, so those
  can still drift; the live TS UI wins on disagreement.)
- **Editing a mockup is not shipping a change.** It changes a preview, nothing the player sees.
  To change the game, edit `src/three/ui/` (see the **bmf-ui** skill) and verify with
  `npm run build` + `npm run verify:ui`. The live component gallery at the **`?kit`** URL renders
  the *real* components and is the trustworthy visual-QA surface.

## If a mockup has gone stale

Either bring it back in line with the live screen, or delete it. A wrong preview is worse than no
preview — it reads as "this is how it looks" when it isn't. Don't let this folder become a second,
competing design system.
