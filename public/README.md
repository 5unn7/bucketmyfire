# `public/` — static assets

Everything here is copied verbatim into `dist/` at build and served from the site root.
Reference any asset through Vite's `import.meta.env.BASE_URL` (NOT a leading `/`) so it
resolves under both root and the `/bucketmyfire/` project-pages base.

There are two kinds of asset, and they live apart on purpose:

## 1. Runtime 3D assets — loaded into the WebGL scene

Leave these where they are; the engine loads them by path.

| Folder       | What                                                              |
|--------------|-------------------------------------------------------------------|
| `models/`    | glTF/glb helicopters + the wildlife glb (one subfolder each, with a `license.txt`/`ATTRIBUTION.txt`) |
| `textures/`  | runtime art: `pbr/<slug>/` PBR sets, `hdri/` environment maps, `smoke-puff.png` sprite — see `textures/ATTRIBUTION.txt` |
| `audio/`     | rotor loop + engine-start mp3                                     |
| `animals/`   | the optimized wildlife glb + attribution                          |

## 2. 2D / UI imagery — **one home, one rule**

> **Every 2D image goes under `images/<category>/`, folders lowercase.**
> No new top-level image folders. If a new category is needed, add it here first.

```
images/
  maps/                 province card art (the map picker)        → e.g. Saskatchewan.webp
  missions/<region>/    mission poster art (campaign carousel)    → e.g. saskatchewan/FirstLight.webp
  ui/                   site / home chrome
  cardsbg/              front-door card background art            → e.g. map.webp
  halloffame/           Hall of Fame + home/title key-art         → e.g. home212-bg.webp
  shop/                 shop / merch imagery
```

Where each is wired:

- **Map cards** → `imageUrl` in each `src/three/maps/<region>/` card (e.g. `'images/maps/Saskatchewan.webp'`).
- **Mission posters** → add one line to `MISSION_POSTERS` in `src/three/ui/missionArt.ts`
  (keyed by mission id; a missing entry falls back to a procedural cover).
- **UI backgrounds** → referenced directly (e.g. `TitleScreen.ts` `BG_URL`).

`brand/` (logo SVGs, referenced by `ui/brandLogo.ts`) stays a separate top-level folder
— it's identity, not raster art.

## 3. Site & PWA meta — web-root convention, leave at top level

`index`/`404`/`privacy`/`terms` HTML, `manifest.webmanifest`, `robots.txt`,
`sitemap.xml`, `CNAME`, `og-image.jpg`, and the `icon-*.png` / `apple-touch-icon.png` /
`icon.svg` PWA icons must sit at the `public/` root — the manifest, `index.html` meta
tags, and crawlers expect them there. Don't fold these into `images/`.

## Optimizing

Source masters (1k+ PBR, full-res photos) live in the gitignored `art-source/`, NOT here.
`npm run optimize:assets` (sharp webp + gltf-transform meshopt) emits the shipped,
size-trimmed versions into `public/`. Ship webp for raster UI art.
