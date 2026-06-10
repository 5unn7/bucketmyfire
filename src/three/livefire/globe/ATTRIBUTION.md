# Globe basemap outline data

`land.json` is baked by `scripts/gen-globe-land.mjs` from **Natural Earth** vector data
(https://www.naturalearthdata.com — public domain; no attribution required, credited anyway):

- World land polygons: Natural Earth 1:50m `land`, via the world-atlas TopoJSON mirror
  (https://github.com/topojson/world-atlas).
- International boundaries: Natural Earth 1:110m `countries` (shared-arc extraction).
- Canadian province/territory boundaries: Natural Earth 1:50m `admin_1_states_provinces_lines`.

The outlines are simplified (Douglas–Peucker) and delta-encoded; the globe paints its earth
texture from them at runtime — no basemap imagery is downloaded or shipped.
