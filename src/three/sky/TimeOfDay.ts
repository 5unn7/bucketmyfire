import * as THREE from 'three';

/**
 * Time-of-day atmosphere presets (Track B2). One preset bundles everything that sets
 * the scene's mood — the sky-dome gradient + sun halo, the directional sun, the
 * sky/ground hemisphere fill, and the aerial-perspective fog — so a single object
 * keeps them all coherent (the fog color matches the sky horizon, the hemisphere sky
 * matches the zenith, etc). `applyAtmosphere` pushes a preset onto the live lights/fog;
 * `createSkyDome` reads the sky colors. Swapping presets re-skies the whole world.
 */
export interface SkyPreset {
  name: string;
  zenith: number; // sky color straight up
  horizon: number; // sky color at the horizon — the fog blends INTO this
  sunHalo: number; // glow color bloomed around the sun in the dome
  sunColor: number; // directional light color
  sunIntensity: number;
  hemiSky: number; // hemisphere fill from above
  hemiGround: number; // hemisphere bounce from below
  hemiIntensity: number;
  fogNear: number; // distance where aerial haze starts
  fogFar: number; // distance where terrain fully fades into the horizon
}

/** Bright clear boreal day (default). */
export const DAY: SkyPreset = {
  name: 'day',
  zenith: 0x4f8fd6,
  horizon: 0xbcd6e8,
  sunHalo: 0xfff2d0,
  sunColor: 0xfff5e2,
  sunIntensity: 1.55,
  hemiSky: 0xc2dcf2,
  hemiGround: 0x46552f,
  hemiIntensity: 0.7,
  fogNear: 130,
  fogFar: 520,
};

/**
 * Low golden-hour sun, warm + deeply hazy — the cinematic "wildfire at dusk" look (the
 * reference aesthetic). Muted dusk-blue overhead grading to a rich amber haze band at the
 * horizon, a warm raking sun, and lifted fog so distant ridges LAYER into the haze (aerial
 * perspective) instead of hitting a wall. The default atmosphere for the game.
 */
export const GOLDEN: SkyPreset = {
  name: 'golden',
  zenith: 0x5b79b3, // deeper dusk blue overhead (cooler, so the warm horizon reads richer)
  horizon: 0xeec083, // rich amber haze band — distant terrain dissolves into this
  sunHalo: 0xffca78, // warm gold glow around the low sun
  sunColor: 0xffc784, // warm raking directional light
  sunIntensity: 1.4,
  hemiSky: 0xe6cfa6,
  hemiGround: 0x4a4a2e,
  hemiIntensity: 0.6,
  fogNear: 175, // pushed out so the near + mid ground stays CRISP (was a milky wash at 120) —
  fogFar: 720, // only the far ridgelines dissolve into the amber haze (true aerial perspective)
};

/** Push a preset onto the live sun, hemisphere light, scene fog + background. */
export function applyAtmosphere(
  scene: THREE.Scene,
  sun: THREE.DirectionalLight,
  hemi: THREE.HemisphereLight,
  preset: SkyPreset,
): void {
  sun.color.setHex(preset.sunColor);
  sun.intensity = preset.sunIntensity;
  hemi.color.setHex(preset.hemiSky);
  hemi.groundColor.setHex(preset.hemiGround);
  hemi.intensity = preset.hemiIntensity;
  // Fog fades distant terrain INTO the sky's horizon band → aerial perspective.
  scene.fog = new THREE.Fog(preset.horizon, preset.fogNear, preset.fogFar);
  scene.background = new THREE.Color(preset.horizon); // fallback behind the dome
}
