# mockups/ — reference previews, **not** the source of truth

These static HTML screens (`index.html` + the per-screen files, styled by `kit.css`) are a
**hand-maintained design reference** — useful for eyeballing a whole-screen layout or sharing a
look without booting the game. They are **not authoritative**.

## Read this before trusting a mockup

- **The live UI is the source of truth.** Every screen actually ships from `src/three/ui/`
  (tokens in `ui/theme.ts`, components in `ui/components/`, prose system in `DESIGN.md`). If a
  mockup and the code disagree, **the code wins** — fix the mockup, not the game.
- **`kit.css` is a hand-written mirror, not a build artifact.** Its CSS custom properties
  (`--menu`, `--fs-tag`, …) were transcribed from `theme.ts` by hand; nothing regenerates them.
  So when a token changes in `theme.ts`, these mockups do **not** follow — they drift silently.
- **Editing a mockup is not shipping a change.** It changes a preview, nothing the player sees.
  To change the game, edit `src/three/ui/` (see the **bmf-ui** skill) and verify with
  `npm run build` + `npm run verify:ui`. The live component gallery at the **`?kit`** URL renders
  the *real* components and is the trustworthy visual-QA surface.

## If a mockup has gone stale

Either bring it back in line with the live screen, or delete it. A wrong preview is worse than no
preview — it reads as "this is how it looks" when it isn't. Don't let this folder become a second,
competing design system.
