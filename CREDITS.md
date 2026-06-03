# Credits — third-party assets

The game world (terrain, water, trees, fire, smoke, UI) is **procedural / zero-asset**.
A few binary assets are used and are credited here per their licenses.

## Wildlife models

This work is based on **"ULTIMATE 3D ANIMAL PACK (Free Download)"**
(https://sketchfab.com/3d-models/ultimate-3d-animal-pack-free-download-741b52992790405185b4ede33b112080)
by **WildMesh 3D** (https://sketchfab.com/WildMesh_3D), licensed under
**CC-BY-4.0** (http://creativecommons.org/licenses/by/4.0/).

Used in `src/three/meshes/animalPack.ts` for the moose, deer, bear, fox, wolf, and rabbit
that roam the map (the boar from the pack is unused). Loons are procedural.

## Helicopter models

See the `ATTRIBUTION.txt` alongside each model under `public/models/` for the UH-1 and
UH-60 credits.

## Smoke sprite

`public/textures/smoke-puff.png` — a soft grayscale smoke-puff sprite billboarded per particle by
`src/three/vfx/SmokePlume.ts` to render the wildfire smoke as a dense, view-blocking volume. Sourced
from **Lee Stemkoski's Three.js examples** (https://github.com/stemkoski/stemkoski.github.com,
`Three.js/images/smokeparticle.png`), released for free public/educational use. The smoke's colour,
density, motion, and height zoning are all generated in-shader at runtime — the sprite is only the
soft alpha mask.

## Audio

Two recorded helicopter clips under `public/audio/`, played by `src/three/audio/HeliAudio.ts` —
both **free to use, no attribution required**:

- `helicopter-start.mp3` — a ~7s engine-start crank fired once as the cold-start rotor spool begins.
- `helicopter-flying-loop.mp3` — the steady in-flight rotor drone, looped seamlessly.
