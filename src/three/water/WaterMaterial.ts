import * as THREE from 'three';
import { WATER, RIPPLE_SLOTS, CLOUDS } from '../config';
import { FrameContext } from '../render/FrameContext';
import { Ripples } from './Ripples';

/**
 * The lake water material (B1) — the top visual win, since you stare at it on every
 * scoop. One shared ShaderMaterial built by patching MeshStandardMaterial via
 * onBeforeCompile, so it keeps real PBR lighting + Three's shadows and fog for free
 * while adding:
 *   - animated surface normals (two scrolling wave gradients in world XZ) for glints
 *   - REAL depth-fade color from a per-vertex water depth baked off World.groundHeightAt
 *     (no depth prepass, no planar reflection — just geometry we already know)
 *   - a fresnel sky tint that fakes reflectivity at grazing angles, cheaply
 *   - shoreline foam where the water is shallow, shimmering over time
 *   - an 8-slot ripple ring (bucket dips + drop splashes) perturbing normal + foam
 *
 * All animated inputs come from the shared FrameContext (time/wind) and the Ripples
 * pool (fixed-size uniform array), so there are NO per-frame uniform writes here and
 * NO shader recompiles after load. One material instance is shared by every lake.
 */
export function createWaterMaterial(frame: FrameContext, ripples: Ripples): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.32, // soft sheen (raised from near-mirror — sharp glints were streaking)
    metalness: 0.0, // water is a dielectric; the metallic white sheen added grey smear
    transparent: true,
    opacity: WATER.opacity,
  });

  material.onBeforeCompile = (shader) => {
    // Share the live uniform objects (same references the FrameContext/Ripples mutate).
    shader.uniforms.uTime = frame.uTime;
    shader.uniforms.uWind = frame.uWind;
    shader.uniforms.uRipples = ripples.uniform;
    // Static tuning uniforms (set once).
    shader.uniforms.uShallow = { value: new THREE.Color(WATER.shallowColor) };
    shader.uniforms.uDeep = { value: new THREE.Color(WATER.deepColor) };
    shader.uniforms.uSkyTint = { value: new THREE.Color(WATER.skyTint) };
    shader.uniforms.uFoam = { value: new THREE.Color(WATER.foamColor) };
    shader.uniforms.uDepthRange = { value: WATER.depthRange };
    shader.uniforms.uFoamWidth = { value: WATER.foamWidth };
    shader.uniforms.uFoamStrength = { value: WATER.foamStrength };
    shader.uniforms.uWaveAmp = { value: WATER.waveAmp };
    shader.uniforms.uWaveScale = { value: WATER.waveScale };
    shader.uniforms.uWaveSpeed = { value: WATER.waveSpeed };
    shader.uniforms.uNormalStrength = { value: WATER.normalStrength };
    shader.uniforms.uFresnelPower = { value: WATER.fresnelPower };
    shader.uniforms.uFresnelTint = { value: WATER.fresnelTint };
    shader.uniforms.uRippleSpeed = { value: WATER.rippleSpeed };
    shader.uniforms.uRippleLife = { value: WATER.rippleLife };
    shader.uniforms.uRippleWidth = { value: WATER.rippleWidth };
    // Sun glitter (shares the live sun direction) + drifting cloud shadows (shared wind/time,
    // SAME field + tuning as the terrain so a shadow crosses seamlessly from land onto the lake).
    shader.uniforms.uSunDir = frame.uSunDir;
    shader.uniforms.uGlitterCol = { value: new THREE.Color(WATER.sunGlitterColor) };
    shader.uniforms.uGlitterStrength = { value: WATER.glitterStrength };
    shader.uniforms.uGlitterPower = { value: WATER.glitterPower };
    shader.uniforms.uCloudScale = { value: CLOUDS.scale };
    shader.uniforms.uCloudSpeed = { value: CLOUDS.speed };
    shader.uniforms.uCloudLo = { value: CLOUDS.coverageLo };
    shader.uniforms.uCloudHi = { value: CLOUDS.coverageHi };
    shader.uniforms.uCloudDark = { value: CLOUDS.darken };

    // --- Vertex: gentle swell + carry world position & water depth to the fragment ---
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
        attribute float aDepth;
        uniform float uTime, uWaveAmp, uWaveScale, uWaveSpeed;
        uniform vec2 uWind;
        varying vec3 vWorldPos;
        varying float vWaterDepth;`,
      )
      .replace(
        '#include <begin_vertex>',
        /* glsl */ `#include <begin_vertex>
        vec3 wp = (modelMatrix * vec4(position, 1.0)).xyz;
        float swell = sin(wp.x * uWaveScale + uTime * uWaveSpeed + uWind.x) * 0.6
                    + sin(wp.z * uWaveScale * 1.3 - uTime * uWaveSpeed * 0.8 + uWind.y) * 0.4;
        transformed.y += swell * uWaveAmp;
        vWaterDepth = aDepth;
        vWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
      );

    // --- Fragment: animated normal, depth-fade color, fresnel, foam, ripples ---
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
        uniform float uTime, uDepthRange, uFoamWidth, uFoamStrength, uNormalStrength, uFresnelPower, uFresnelTint;
        uniform float uRippleSpeed, uRippleLife, uRippleWidth;
        uniform float uGlitterStrength, uGlitterPower, uCloudScale, uCloudSpeed, uCloudLo, uCloudHi, uCloudDark;
        uniform vec2 uWind;
        uniform vec3 uShallow, uDeep, uSkyTint, uFoam, uSunDir, uGlitterCol;
        uniform vec4 uRipples[${RIPPLE_SLOTS}];
        varying vec3 vWorldPos;
        varying float vWaterDepth;

        // Cheap value-noise fbm (for the drifting cloud shadow — same recipe as the terrain).
        float wh21(vec2 p){ p = fract(p * vec2(123.34, 345.45)); p += dot(p, p + 34.345); return fract(p.x * p.y); }
        float wvnoise(vec2 p){
          vec2 i = floor(p), f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          float a = wh21(i), b = wh21(i + vec2(1.0, 0.0)), c = wh21(i + vec2(0.0, 1.0)), d = wh21(i + vec2(1.0, 1.0));
          return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
        }
        float wfbm(vec2 p){ return wvnoise(p) * 0.6 + wvnoise(p * 2.3 + 5.1) * 0.3 + wvnoise(p * 4.7 + 9.2) * 0.1; }

        // Sum the ripple rings at world point p. Writes a normal-gradient into g and
        // returns the scalar foam/crest contribution.
        float rippleField(vec2 p, inout vec2 g) {
          float crest = 0.0;
          for (int i = 0; i < ${RIPPLE_SLOTS}; i++) {
            vec4 r = uRipples[i];
            if (r.z < 0.0) continue;                 // inactive slot (age < 0)
            float d = distance(p, r.xy);
            float radius = r.z * uRippleSpeed;        // expanding ring
            float ring = exp(-pow((d - radius) / uRippleWidth, 2.0));
            float fade = 1.0 - clamp(r.z / uRippleLife, 0.0, 1.0);
            float amt = ring * fade * r.w;
            vec2 dir = normalize(p - r.xy + vec2(1e-5));
            g += dir * amt * 2.0;
            crest += amt;
          }
          return crest;
        }`,
      )
      .replace(
        // Inject BEFORE the PBR material struct is built — <lights_physical_fragment>
        // bakes diffuseColor + normal into `material`, so overriding them any later
        // (e.g. at <lights_fragment_begin>) leaves the white base albedo in the BRDF.
        '#include <lights_physical_fragment>',
        /* glsl */ `
        // Perturb the (flat +Y) surface normal with two scrolling wave gradients plus
        // the ripple rings — this is what makes the sun sparkle and rings read.
        {
          // Fine, multi-octave ripples (short wavelengths ~6–12 units) so the water
          // reads as rippling texture rather than a couple of giant stripes across a
          // small lake. Each octave is gentler than the last.
          // Wave-normal gradient. The axis-aligned terms are kept SMALL (they were the main
          // cause of the white-grey streaking — strong single-axis cosines tilt the normal in
          // long stripes that the fresnel sky-tint then smears); the cross/diagonal terms carry
          // more of the texture so the surface reads as organic chop, not banding.
          vec2 p = vWorldPos.xz;
          vec2 g = vec2(0.0);
          g.x += cos(p.x * 0.55 + uTime * 1.3) * 0.15;
          g.y += cos(p.y * 0.62 - uTime * 1.1) * 0.15;
          g.x += cos((p.x + p.y) * 0.90 + uTime * 1.9) * 0.13;
          g.y += cos((p.x - p.y) * 1.05 - uTime * 1.7) * 0.13;
          g.x += cos(p.y * 1.7 + uTime * 2.6) * 0.06;
          g.y += cos(p.x * 1.9 - uTime * 2.3) * 0.06;
          float crest = rippleField(p, g);

          vec3 perturbed = normalize(vec3(-g.x, 1.0 / max(uNormalStrength, 0.001), -g.y));
          normal = normalize(mix(normal, perturbed, clamp(uNormalStrength, 0.0, 1.0)));

          // Depth-fade body color (shallow near shore → deep in the middle).
          float depthF = clamp(vWaterDepth / uDepthRange, 0.0, 1.0);
          vec3 wcol = mix(uShallow, uDeep, depthF);

          // Fresnel sky tint — brighter, sky-toned at grazing angles (fake reflection).
          vec3 V = normalize(cameraPosition - vWorldPos);
          float fres = pow(1.0 - clamp(dot(normalize(normal), V), 0.0, 1.0), uFresnelPower);
          wcol = mix(wcol, uSkyTint, fres * uFresnelTint);

          // Shoreline foam (thin shallow band) + ripple crests, with a gentle time shimmer.
          // Capped at uFoamStrength so the very edge softens to pale water rather than a
          // hard white-grey rim along every shore and river bank.
          float shore = 1.0 - smoothstep(0.0, uFoamWidth, vWaterDepth);
          shore *= 0.8 + 0.2 * sin(uTime * 4.0 + p.x * 0.5 + p.y * 0.5); // subtle shimmer
          float foam = clamp(shore * uFoamStrength + crest * 0.45, 0.0, 1.0);
          wcol = mix(wcol, uFoam, foam);

          // Sun glitter: a sharp half-vector specular toward the sun, broken into sparkly
          // points by the wave normal (the highlights feed the bloom for a sun path on the lake).
          vec3 H = normalize(uSunDir + V);
          float glit = pow(max(dot(normalize(normal), H), 0.0), uGlitterPower);
          wcol += uGlitterCol * glit * uGlitterStrength;

          // Drifting cloud shadow (same field as the land) — dims the body AND the glitter,
          // so a cloud passing over the lake reads as a real shadow crossing the water.
          vec2 cp = (vWorldPos.xz + uWind * uTime * uCloudSpeed) * uCloudScale;
          float cloudSh = smoothstep(uCloudLo, uCloudHi, wfbm(cp));
          wcol *= mix(1.0, uCloudDark, cloudSh);

          diffuseColor.rgb = wcol;
          diffuseColor.a = max(diffuseColor.a, foam); // foam reads a touch more solid
        }
        #include <lights_physical_fragment>`,
      );
  };

  // Stable cache key so the patched program compiles exactly once.
  material.customProgramCacheKey = () => 'bmf-water-v5';
  return material;
}
