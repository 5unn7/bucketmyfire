import * as THREE from 'three';

/**
 * Shared loader for the downloaded CC0 PBR texture sets (Poly Haven, see
 * public/textures/ATTRIBUTION.txt). The 1k masters live in `art-source/` (not deployed);
 * `scripts/optimize-assets.mjs` emits the SHIPPED maps as `public/textures/pbr/<slug>/
 * <slug>_{diff,nor,rough}.webp` (512px webp) — so a caller only needs the slug.
 *
 * Textures are CACHED at module scope and SHARED across every consumer (and across the
 * in-place mission switch): one GPU upload per slug+repeat, alive for the page's lifetime.
 * That is safe with `Game.dispose()` ONLY because the materials that reference these are
 * flagged `userData.shared` — dispose frees a material's textures just when it disposes the
 * material, and it skips shared materials. Reference these from a shared material, never an
 * ephemeral one, or the next mission switch will dispose them out from under you.
 *
 * Procedural-first invariant: this is a polish layer behind the procedural look — the game
 * renders fully without these files, so a missing/failed download just leaves the base colour.
 */

export interface PBRSet {
  map: THREE.Texture;
  normalMap: THREE.Texture;
  roughnessMap: THREE.Texture;
}

const cache = new Map<string, PBRSet>();
const loader = new THREE.TextureLoader();

/**
 * Load (or return the cached) diffuse + OpenGL-normal + roughness set for `slug`, tiled
 * `repeat`× in both axes. `repeat` is part of the cache key because it lives on the Texture
 * object (shared), so two different tilings get two instances.
 */
export function loadPBR(slug: string, repeat = 1, anisotropy = 4): PBRSet {
  const key = `${slug}@${repeat}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const base = `${import.meta.env.BASE_URL}textures/pbr/${slug}/${slug}`;
  const cfg = (url: string, srgb: boolean): THREE.Texture => {
    const t = loader.load(url);
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; // albedo is sRGB; normal/rough are linear data
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat, repeat);
    t.anisotropy = anisotropy; // crisp at grazing angles (the deck seen from the air)
    return t;
  };

  const set: PBRSet = {
    map: cfg(`${base}_diff.webp`, true),
    normalMap: cfg(`${base}_nor.webp`, false),
    roughnessMap: cfg(`${base}_rough.webp`, false),
  };
  cache.set(key, set);
  return set;
}

const albedoCache = new Map<string, THREE.Texture>();

/**
 * Load (or return the cached) DIFFUSE map only — for the in-shader triplanar terrain blend, which
 * samples albedo in world space and supplies its own normals procedurally. Avoids fetching the
 * normal/rough maps a full `loadPBR` would. `RepeatWrapping` so the world-space tiling wraps; sRGB
 * so the WebGL2 hardware sampler returns linear RGB in the shader (correct for the diffuse multiply).
 */
export function loadAlbedo(slug: string, anisotropy = 4): THREE.Texture {
  const hit = albedoCache.get(slug);
  if (hit) return hit;
  const url = `${import.meta.env.BASE_URL}textures/pbr/${slug}/${slug}_diff.webp`;
  const t = loader.load(url);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = anisotropy;
  albedoCache.set(slug, t);
  return t;
}
