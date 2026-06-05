import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

/**
 * A GLTFLoader with the meshopt decoder wired in, so the glbs that `scripts/optimize-assets.mjs`
 * re-encodes with EXT_meshopt_compression (the playable helis + the wildlife pack) actually decode.
 * The meshopt decoder is bundled with Three's addons — it adds NO extra network fetch, just the
 * runtime transcode. Uncompressed glbs load through it unchanged, so every model can share this.
 */
export function makeGLTFLoader(): GLTFLoader {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  return loader;
}
