import * as THREE from 'three';
import { WATER, RIPPLE_SLOTS } from '../config';
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
    roughness: 0.18, // near-mirror so the sun glints
    metalness: 0.15,
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
    shader.uniforms.uWaveAmp = { value: WATER.waveAmp };
    shader.uniforms.uWaveScale = { value: WATER.waveScale };
    shader.uniforms.uWaveSpeed = { value: WATER.waveSpeed };
    shader.uniforms.uNormalStrength = { value: WATER.normalStrength };
    shader.uniforms.uFresnelPower = { value: WATER.fresnelPower };
    shader.uniforms.uRippleSpeed = { value: WATER.rippleSpeed };
    shader.uniforms.uRippleLife = { value: WATER.rippleLife };
    shader.uniforms.uRippleWidth = { value: WATER.rippleWidth };

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
        uniform float uTime, uDepthRange, uFoamWidth, uNormalStrength, uFresnelPower;
        uniform float uRippleSpeed, uRippleLife, uRippleWidth;
        uniform vec3 uShallow, uDeep, uSkyTint, uFoam;
        uniform vec4 uRipples[${RIPPLE_SLOTS}];
        varying vec3 vWorldPos;
        varying float vWaterDepth;

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
            g += dir * amt * 3.0;
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
          vec2 p = vWorldPos.xz;
          vec2 g = vec2(0.0);
          g.x += cos(p.x * 0.55 + uTime * 1.3) * 0.30;
          g.y += cos(p.y * 0.62 - uTime * 1.1) * 0.30;
          g.x += cos((p.x + p.y) * 0.90 + uTime * 1.9) * 0.16;
          g.y += cos((p.x - p.y) * 1.05 - uTime * 1.7) * 0.16;
          g.x += cos(p.y * 1.7 + uTime * 2.6) * 0.08;
          g.y += cos(p.x * 1.9 - uTime * 2.3) * 0.08;
          float crest = rippleField(p, g);

          vec3 perturbed = normalize(vec3(-g.x, 1.0 / max(uNormalStrength, 0.001), -g.y));
          normal = normalize(mix(normal, perturbed, clamp(uNormalStrength, 0.0, 1.0)));

          // Depth-fade body color (shallow near shore → deep in the middle).
          float depthF = clamp(vWaterDepth / uDepthRange, 0.0, 1.0);
          vec3 wcol = mix(uShallow, uDeep, depthF);

          // Fresnel sky tint — brighter, sky-toned at grazing angles (fake reflection).
          vec3 V = normalize(cameraPosition - vWorldPos);
          float fres = pow(1.0 - clamp(dot(normalize(normal), V), 0.0, 1.0), uFresnelPower);
          wcol = mix(wcol, uSkyTint, fres * 0.6);

          // Shoreline foam (shallow band) + ripple crests, with a time shimmer.
          float foam = 1.0 - smoothstep(0.0, uFoamWidth, vWaterDepth);
          foam = clamp(foam + crest * 0.6, 0.0, 1.0);
          foam *= 0.6 + 0.4 * sin(uTime * 4.0 + p.x * 0.5 + p.y * 0.5);
          wcol = mix(wcol, uFoam, clamp(foam, 0.0, 1.0));

          diffuseColor.rgb = wcol;
          diffuseColor.a = max(diffuseColor.a, clamp(foam, 0.0, 1.0)); // foam reads solid
        }
        #include <lights_physical_fragment>`,
      );
  };

  // Stable cache key so the patched program compiles exactly once.
  material.customProgramCacheKey = () => 'bmf-water-v2';
  return material;
}
