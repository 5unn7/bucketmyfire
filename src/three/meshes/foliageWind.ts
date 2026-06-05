import * as THREE from 'three';
import { FrameContext } from '../render/FrameContext';
import { WASH } from '../config';

/**
 * Foliage wind-sway (Track B6). Patches the instanced tree-foliage material so the
 * canopy bends downwind in the SAME shared wind that bends the smoke plumes — a vertex
 * shader displaces each crown horizontally toward the live `FrameContext.uWind`, scaled
 * by height² (the base stays planted on the trunk, the top sways most) and oscillated on
 * a per-tree phase so the forest shimmers rather than pulsing in unison.
 *
 * It works in WORLD space (so the bend follows world wind regardless of each instance's
 * random yaw) by re-deriving the position through `<project_vertex>`. Free per-frame:
 * the only inputs are the shared time/wind uniforms already updated once a frame.
 *
 * On top of the ambient wind it adds the ROTOR DOWNWASH (C4): the canopy directly
 * under a low-hovering heli flattens radially OUTWARD, away from the rotor — read from
 * the shared `FrameContext.uWash` disc (centerXZ, radius, strength). Same height² law
 * so the crowns bow and the trunks stay planted.
 */
const SWAY_AMP = 1.1; // crown sway (world units) at full wind
const SWAY_FREQ = 1.25; // oscillation rate (rad/s)
const TREE_TOP = 6.0; // local foliage apex height (≈ trees.ts CANOPY_APEX) for the height factor
const WASH_BEND = WASH.foliageBend; // max outward crown displacement under the downwash (units)

/** Optional CC0 leaf-litter detail blended into the canopy albedo (TREE_TEX) — see applyFoliageSway. */
export interface LeafDetail {
  tex: THREE.Texture; // forest_leaves_04 albedo (sRGB, RepeatWrapping)
  strength: number; // 0 = procedural only, 1 = full photo modulation
  repeat: number; // tiling across the cones
}
const LEAF_MID = 0.38; // ≈ mean luma of forest_leaves_04 — divides it out so the modulate is brightness-neutral

export function applyFoliageSway(material: THREE.Material, frame: FrameContext, leaf?: LeafDetail): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = frame.uTime;
    shader.uniforms.uWind = frame.uWind;
    shader.uniforms.uWash = frame.uWash;
    if (leaf) {
      shader.uniforms.uLeafTex = { value: leaf.tex };
      shader.uniforms.uLeafStr = { value: leaf.strength };
    }

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform float uTime;\nuniform vec2 uWind;\nuniform vec4 uWash;' +
          (leaf ? '\nvarying vec2 vLeafUv;' : ''),
      )
      .replace('#include <begin_vertex>', '#include <begin_vertex>' + (leaf ? '\nvLeafUv = uv;' : ''))
      .replace(
        '#include <project_vertex>',
        /* glsl */ `
        // --- B6 wind sway: bend the crown downwind, most at the top, per-tree phase ---
        vec4 swayWorld = vec4(transformed, 1.0);
        vec3 instBase = vec3(0.0);
        #ifdef USE_INSTANCING
          swayWorld = instanceMatrix * swayWorld;
          instBase = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
        #endif
        swayWorld = modelMatrix * swayWorld;
        instBase = (modelMatrix * vec4(instBase, 1.0)).xyz;
        float heightF = clamp(transformed.y / ${TREE_TOP.toFixed(1)}, 0.0, 1.0);
        float ph = instBase.x * 0.13 + instBase.z * 0.11;            // per-tree phase
        float t = uTime * ${SWAY_FREQ.toFixed(2)} + ph;
        float osc = sin(t) + 0.3 * sin(t * 2.3 + 1.7);               // gusty, not a pure sine
        vec2 bend = uWind * ${SWAY_AMP.toFixed(2)} * heightF * heightF * (0.6 + 0.4 * osc);
        swayWorld.x += bend.x;
        swayWorld.z += bend.y;
        // --- C4 rotor downwash: bow the crown OUTWARD from the wash center, falling
        // off to nothing at the disc edge. uWash = (centerX, centerZ, radius, strength). ---
        vec2 toTree = instBase.xz - uWash.xy;
        float wd = length(toTree);
        float wfall = 1.0 - smoothstep(0.0, uWash.z, wd);
        vec2 wdir = toTree / max(wd, 0.001);
        vec2 wbend = wdir * (uWash.w * wfall * ${WASH_BEND.toFixed(2)}) * heightF * heightF;
        swayWorld.x += wbend.x;
        swayWorld.z += wbend.y;
        vec4 mvPosition = viewMatrix * swayWorld;
        gl_Position = projectionMatrix * mvPosition;`,
      );

    if (leaf) {
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          '#include <common>\nuniform sampler2D uLeafTex;\nuniform float uLeafStr;\nvarying vec2 vLeafUv;',
        )
        .replace(
          '#include <color_fragment>',
          /* glsl */ `#include <color_fragment>
          { // CC0 leaf-litter detail — modulate the canopy LIGHTNESS by the leaf texture (keeps the biome
            // tint/gradient), normalised by its mean luma so it stays brightness-neutral. Subtle by uLeafStr.
            vec3 lt = texture2D(uLeafTex, vLeafUv * ${leaf.repeat.toFixed(2)}).rgb;
            float ll = dot(lt, vec3(0.299, 0.587, 0.114));
            diffuseColor.rgb *= mix(1.0, ll / ${LEAF_MID.toFixed(3)}, uLeafStr);
          }`,
        );
    }
  };
  material.customProgramCacheKey = () => (leaf ? 'bmf-foliage-sway-v2-leaf' : 'bmf-foliage-sway-v2');
  material.needsUpdate = true;
}
