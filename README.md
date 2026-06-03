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

Three.js (WebGL) · TypeScript · Vite. Real-3D, client-side, no backend. Art is
procedural-first (geometry + GLSL + runtime textures) with a few credited licensed
assets under `public/`. See `src/three/` for the live build.

See [CLAUDE.md](CLAUDE.md) for architecture.

## Status

Live at [bucketmyfire.com](https://bucketmyfire.com) — full flight/bucket/fire physics,
a 10-mission campaign, and 3 playable helicopters. (The original 2D Phaser prototype was
removed once the 3D build was proven.)
