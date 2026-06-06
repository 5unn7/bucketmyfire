import * as THREE from 'three';
import type { TimeOfDay } from '../missions/types';

/**
 * Time-of-day atmosphere presets (Track B2). One preset bundles everything that sets
 * the scene's mood — the sky-dome gradient + sun halo, the directional sun (colour AND
 * elevation/azimuth), the sky/ground hemisphere fill, and the aerial-perspective fog — so a
 * single object keeps them all coherent (the fog color matches the sky horizon, the hemisphere
 * sky matches the zenith, the sun sits where the light comes from). `applyAtmosphere` pushes a
 * preset onto the live lights/fog; `createSkyDome` reads the sky colors; `Game` reads `sunDir`
 * to place the sun. Swapping presets re-skies the whole world — a mission picks one by name
 * (`SKY_PRESETS`) so not every sortie is golden hour.
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
  // Unit vector pointing TOWARD the sun (world space). Its Y is the sun ELEVATION — low for
  // dawn/dusk (long raking shadows, halo on the horizon), high for noon (short shadows). Game
  // multiplies it by SUN_DISTANCE and offsets it from the heli each frame so shadows + god-rays
  // read the right time of day.
  sunDir: THREE.Vector3;
}

/** World-units the directional sun sits from the aircraft (shadow framing distance). */
export const SUN_DISTANCE = 188;

/** Bright clear boreal day — a crisp blue sky with a mid-high sun (~45°). */
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
  fogNear: 950, // fog all but gone — past the playable world, so the whole scene reads crisp
  fogFar: 2100, // only the far floor edge fades (masks the ground-plane edge; killing fog shows it)
  sunDir: new THREE.Vector3(0.5, 0.707, 0.5).normalize(),
};

/** Harsh clear NOON — a high overhead sun, deep blue zenith, short shadows, the air at its
 *  clearest (fog pushed far out). The bright contrast to golden hour. */
export const NOON: SkyPreset = {
  name: 'noon',
  zenith: 0x3f7fd0,
  horizon: 0xc8def0,
  sunHalo: 0xffffff,
  sunColor: 0xfffaf0,
  sunIntensity: 1.75,
  hemiSky: 0xcfe6fb,
  hemiGround: 0x49592f,
  hemiIntensity: 0.82,
  fogNear: 1050, // the clearest preset — air essentially transparent
  fogFar: 2200, // only the very far floor edge dissolves
  sunDir: new THREE.Vector3(0.2, 0.95, 0.26).normalize(), // nearly overhead
};

/** Cool misty DAWN — soft morning light, a pale mauve-pink haze on the horizon, a low sun just
 *  off the deck. Calm and quiet — the tutorial morning. */
export const DAWN: SkyPreset = {
  name: 'dawn',
  zenith: 0x6b8fc4,
  horizon: 0xd9c3c9, // pale mauve-pink mist band
  sunHalo: 0xffe4cf,
  sunColor: 0xffe2cb, // soft warm-pale morning light
  sunIntensity: 1.18,
  hemiSky: 0xbcd0e8,
  hemiGround: 0x4b5340,
  hemiIntensity: 0.64,
  fogNear: 880, // keeps the faintest hint of morning mist (it's the misty preset), otherwise clear
  fogFar: 2050,
  sunDir: new THREE.Vector3(0.42, 0.25, -0.86).normalize(), // low, raking from the NE
};

/** Flat smoke-grey OVERCAST — a diffuse sky with no hard sun disk, faint shadows, desaturated.
 *  The grim, socked-in look for a heavy-fire day (and it tames into-sun smoke backlighting). */
export const OVERCAST: SkyPreset = {
  name: 'overcast',
  zenith: 0x8a96a2,
  horizon: 0xb9c0c6,
  sunHalo: 0xccd2d7, // barely-there veiled sun
  sunColor: 0xc6cdd5, // weak, cool, diffuse key
  sunIntensity: 0.9,
  hemiSky: 0xb3bcc4,
  hemiGround: 0x555c4a,
  hemiIntensity: 0.98, // the diffuse hemisphere fill carries the lighting, not the sun
  fogNear: 900, // mood now comes from the grey sky/light, not a haze wall — air reads clear
  fogFar: 2050,
  sunDir: new THREE.Vector3(0.22, 0.78, 0.58).normalize(), // high but soft (shadows stay faint)
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
  sunIntensity: 1.62,
  hemiSky: 0xebd6b0,
  hemiGround: 0x524e30,
  hemiIntensity: 0.78,
  fogNear: 950, // fog all but gone — the amber comes from the sky/sun now, not a haze wall over the ground
  fogFar: 2100, // only the far floor edge dissolves into the horizon (masks the ground-plane edge)
  // ~18° elevation low sun — preserves the original hard-coded look (normalize(150, 58, 95)).
  sunDir: new THREE.Vector3(150, 58, 95).normalize(),
};

/** Deep ominous DUSK — the sun on the deck behind a deep ember-orange horizon under an indigo
 *  sky. Darker and redder than golden — the apocalyptic, fire-at-the-doorstep climax look. */
export const DUSK: SkyPreset = {
  name: 'dusk',
  zenith: 0x3a3a6b, // deep dusk indigo overhead
  horizon: 0xc9663b, // deep ember orange the terrain dissolves into
  sunHalo: 0xff8a3d,
  sunColor: 0xff9b54, // warm-red raking light
  sunIntensity: 1.2,
  hemiSky: 0xb98a86,
  hemiGround: 0x3a3326,
  hemiIntensity: 0.5,
  fogNear: 920, // still ominous from the dark indigo sky + ember horizon, but no haze over the ground
  fogFar: 2050,
  sunDir: new THREE.Vector3(0.8, 0.15, 0.58).normalize(), // ~9° — right on the deck
};

/**
 * The mood registry: a mission's `timeOfDay` key → its preset. Game resolves
 * `SKY_PRESETS[mission.timeOfDay ?? 'golden']` once at load. Keys mirror the `TimeOfDay` union.
 */
export const SKY_PRESETS: Record<TimeOfDay, SkyPreset> = {
  dawn: DAWN,
  day: DAY,
  noon: NOON,
  overcast: OVERCAST,
  golden: GOLDEN,
  dusk: DUSK,
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
