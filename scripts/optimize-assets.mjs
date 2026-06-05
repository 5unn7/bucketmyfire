// Asset-optimization pipeline (build-time, Node). Turns the high-res MASTERS in `art-source/`
// (not deployed) into the small, GPU-friendly, SHIPPABLE subset under `public/`. The cardinal
// rule for this mobile-web game: only what a loader actually fetches should ship, and it should
// ship as small as it can without a visible cost.
//
//   node scripts/optimize-assets.mjs [textures|models|all]   (default: all)
//
//   • textures → WebP + downscale (sharp). 1k jpg/png masters → 512 webp. ~5-10x smaller download.
//                Browsers decode webp natively, so the loaders just point at .webp — no runtime change.
//   • models   → EXT_meshopt_compression + quantize (gltf-transform). Needs the runtime MeshoptDecoder
//                wired into the GLTFLoader call sites (heliModels.ts, animalPack.ts).
//
// Add a new asset = add a row to TEXTURES / MODELS below and re-run. Masters live in art-source/
// (gitignored — re-downloadable from public/textures/ATTRIBUTION.txt), so this is reproducible.

import sharp from 'sharp';
import { mkdirSync, existsSync, copyFileSync, statSync } from 'node:fs';
import { dirname } from 'node:path';

const arg = (process.argv[2] || 'all').toLowerCase();
const kb = (p) => (existsSync(p) ? Math.round(statSync(p).size / 1024) : 0);

// --- TEXTURES ---------------------------------------------------------------
// Only the maps a loader fetches. nor_gl/rough exist for the helipad (real PBR); the terrain uses
// diffuse only (its bump/relief is procedural). Output name drops the `_1k` + `_gl` noise.
const TEX_SRC = 'art-source/textures/pbr';
const TEX_OUT = 'public/textures/pbr';
const TEXTURES = [
  { slug: 'brushed_concrete_03', maps: ['diff', 'nor_gl', 'rough'], size: 512 }, // helipad deck
  { slug: 'forest_ground_04', maps: ['diff'], size: 512 }, // terrain ground grain
  { slug: 'rock_ground', maps: ['diff'], size: 512 }, // terrain steep faces
  { slug: 'burned_ground_01', maps: ['diff'], size: 512 }, // terrain burn scar
  { slug: 'pine_bark', maps: ['diff'], size: 512 }, // tree trunks (bark)
  { slug: 'forest_leaves_04', maps: ['diff'], size: 512 }, // tree foliage (leaf detail)
];
// HDRI: webp can't hold HDR, so the env map ships as-is — but only the ONE the config uses.
const HDRI_KEEP = ['autumn_field_puresky_1k.hdr'];

async function optimizeTextures() {
  let before = 0;
  let after = 0;
  for (const t of TEXTURES) {
    for (const m of t.maps) {
      const inFile = `${TEX_SRC}/${t.slug}/${t.slug}_${m}_1k.jpg`;
      if (!existsSync(inFile)) {
        console.warn(`  SKIP (missing master): ${inFile}`);
        continue;
      }
      const outName = m === 'nor_gl' ? 'nor' : m; // diff | nor | rough
      const outFile = `${TEX_OUT}/${t.slug}/${t.slug}_${outName}.webp`;
      mkdirSync(dirname(outFile), { recursive: true });
      // Diffuse is albedo (tolerates more loss); normal/rough carry data → higher quality.
      const quality = m === 'diff' ? 82 : 90;
      await sharp(inFile).resize(t.size, t.size).webp({ quality }).toFile(outFile);
      before += kb(inFile);
      after += kb(outFile);
      console.log(`  ${t.slug}/${outName}.webp  ${kb(inFile)}KB → ${kb(outFile)}KB`);
    }
  }
  mkdirSync('public/textures/hdri', { recursive: true });
  for (const h of HDRI_KEEP) {
    const src = `art-source/textures/hdri/${h}`;
    if (existsSync(src)) {
      copyFileSync(src, `public/textures/hdri/${h}`);
      before += kb(src);
      after += kb(src);
    }
  }
  console.log(`TEXTURES: ${before}KB → ${after}KB  (saved ${before - after}KB)`);
}

// --- MODELS -----------------------------------------------------------------
// meshopt-compress the single-file glbs in place (originals are tiny licensed downloads; re-encoding
// is a lossless geometry repack). The multi-file gltf helis (blackhawk/bell212) are left for a
// follow-up (they need repacking to .glb + a loader path change).
const MODELS = [
  'public/animals/animals-opt.glb',
  'public/models/uh1/huey-opt.glb',
];

async function optimizeModels() {
  const { NodeIO } = await import('@gltf-transform/core');
  const { ALL_EXTENSIONS, EXTMeshoptCompression } = await import('@gltf-transform/extensions');
  const { reorder, quantize, dedup, prune } = await import('@gltf-transform/functions');
  const { MeshoptEncoder, MeshoptDecoder } = await import('meshoptimizer');
  await MeshoptEncoder.ready;
  await MeshoptDecoder.ready;

  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });

  for (const file of MODELS) {
    if (!existsSync(file)) {
      console.warn(`  SKIP (missing): ${file}`);
      continue;
    }
    const before = kb(file);
    const doc = await io.read(file);
    await doc.transform(dedup(), prune(), reorder({ encoder: MeshoptEncoder }), quantize());
    doc
      .createExtension(EXTMeshoptCompression)
      .setRequired(true)
      .setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.FILTER });
    await io.write(file, doc);
    console.log(`  ${file}  ${before}KB → ${kb(file)}KB`);
  }
  console.log('MODELS: re-encoded with EXT_meshopt_compression (wire MeshoptDecoder at the GLTFLoader sites)');
}

// --- run --------------------------------------------------------------------
if (arg === 'textures' || arg === 'all') {
  console.log('• Textures → WebP 512');
  await optimizeTextures();
}
if (arg === 'models' || arg === 'all') {
  console.log('• Models → meshopt');
  await optimizeModels();
}
