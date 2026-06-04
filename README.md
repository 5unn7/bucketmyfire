# 🚁 Bucket My Fire

A mobile-browser helicopter firefighting sim. Fly over northern Saskatchewan,
scoop water from lakes with a slung bucket, and drop it on the forest fires
before they spread.

## Play / develop

```bash
npm install
npm run dev      # open the printed URL — on the same Wi-Fi you can open it on your phone too
```

### Controls

| Action | Touch | Keyboard |
| --- | --- | --- |
| Fly (steer + throttle) | left-thumb joystick | WASD / arrow keys |
| Climb / descend | ▲ / ▼ buttons | I / J |
| Drop water | **DROP** button | Space |

Scooping has no button: fly low over a lake until the slung bucket dips in and it
fills on its own. Then line up over a fire and hit **DROP**. Fires spread if you
ignore them — clear each mission's objectives to win.

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
a 6-mission campaign, and 3 playable helicopters. (The original 2D Phaser prototype was
removed once the 3D build was proven.)
