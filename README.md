# 🚁 Bucket My Fire

A mobile-browser helicopter sim. Fly a water-bomber over northern Saskatchewan,
scoop water from lakes with a Bambi bucket, and drop it on the forest fires
before they spread.

## Play / develop

```bash
npm install
npm run dev      # open the printed URL — on the same Wi-Fi you can open it on your phone too
```

### Controls

| Action | Touch | Keyboard |
| --- | --- | --- |
| Fly | left-thumb joystick | WASD / arrow keys |
| Scoop water (descend over a lake) | **SCOOP** button | Shift |
| Drop water | **DROP** button | Space |

Get the bucket low over a lake and hold **SCOOP** to fill (watch the water bar),
then fly over a fire and hold **DROP**. Fires regrow and spread if you ignore
them — put them all out to win.

## Build

```bash
npm run build    # → dist/ , a static site you can host anywhere
npm run preview  # preview that build locally
```

## Tech

Phaser 3 · TypeScript · Vite. Pure client-side, no backend, no binary assets
(all textures are generated at runtime — see `src/scenes/PreloadScene.ts`).

See [CLAUDE.md](CLAUDE.md) for architecture.

## Status

Early scaffold — playable core loop (fly · scoop · drop · fires spread · win).
Placeholder procedural art stands in for the realistic style shown in `Training/`.
