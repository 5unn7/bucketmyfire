import * as THREE from 'three';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { ENV } from '../config';

/**
 * Image-based lighting from a downloaded CC0 HDRI (Poly Haven, see
 * public/textures/ATTRIBUTION.txt). The equirect .hdr is PMREM-prefiltered ONCE into a small
 * cube env map and assigned as `scene.environment` — reflections + soft ambient only. The
 * procedural sky dome stays the visible background (we never touch `scene.background`), so this
 * is pure polish on top of the existing sun/hemi/fog atmosphere.
 *
 * Owned by main.ts (where the renderer lives — PMREM needs it). The prefiltered texture is
 * cached at module scope and re-applied to each new scene across the in-place mission switch, so
 * the HDRI is fetched + prefiltered exactly once per page. `Game.dispose()` never frees it (it
 * only walks material texture slots, and this lives on `scene.environment`).
 *
 * Mobile-60fps: one-time load cost, zero per-frame work. Gate the caller on the quality tier
 * (off on low) — the IBL ambient + env memory aren't worth it on the weakest devices.
 */

let cached: THREE.Texture | null = null;
let loading: Promise<THREE.Texture | null> | null = null;

/** Fetch + PMREM-prefilter the configured HDRI once; resolves to the env texture (or null on
 *  failure — the game just keeps its procedural look). Safe to call repeatedly: cached. */
export function loadEnvironment(renderer: THREE.WebGLRenderer): Promise<THREE.Texture | null> {
  if (cached) return Promise.resolve(cached);
  if (loading) return loading;

  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();

  loading = new RGBELoader()
    .setPath(import.meta.env.BASE_URL)
    .loadAsync(ENV.file)
    .then((hdr) => {
      hdr.mapping = THREE.EquirectangularReflectionMapping;
      const rt = pmrem.fromEquirectangular(hdr);
      hdr.dispose();
      pmrem.dispose();
      cached = rt.texture;
      return cached;
    })
    .catch(() => null); // missing/corrupt HDRI → procedural-only, no crash

  return loading;
}

/** Apply the prefiltered env map to a scene (reflections + ambient). No-op if `tex` is null. */
export function applyEnvironment(scene: THREE.Scene, tex: THREE.Texture | null): void {
  if (!tex) return;
  scene.environment = tex;
  scene.environmentIntensity = ENV.intensity;
}
