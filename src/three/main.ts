import * as THREE from 'three';
import { Game } from './Game';
import { QualityTier } from './render/QualityTier';

/**
 * 3D entry point. Sets up the WebGL renderer, picks a quality tier (which scales DPR,
 * shadows, and water tessellation), builds the Game, and runs a clamped-dt animation
 * loop. Each frame feeds the tier the frame time so it can step DOWN (DPR) if the
 * device can't hold rate. This replaces the old Phaser bootstrap — see index.html.
 */
const container = document.getElementById('game') as HTMLDivElement;

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setSize(container.clientWidth, container.clientHeight);
renderer.shadowMap.type = THREE.PCFShadowMap;
container.appendChild(renderer.domElement);

// Quality tier: apply DPR + shadow on/off at load; adaptive downgrade only touches
// the cheap, recompile-free lever (DPR), so shadows stay fixed after load.
const tier = new QualityTier();
renderer.setPixelRatio(Math.min(window.devicePixelRatio, tier.current.dprCap));
renderer.shadowMap.enabled = tier.current.shadows;
tier.onChange((s) => renderer.setPixelRatio(Math.min(window.devicePixelRatio, s.dprCap)));

const game = new Game(container, tier);

// Debug/QA hook: lets a test harness read flight/game state. Harmless in prod.
(window as unknown as Record<string, unknown>).__game = game;

function resize(): void {
  const w = container.clientWidth;
  const h = container.clientHeight;
  renderer.setSize(w, h);
  game.resize(w / h);
}
window.addEventListener('resize', resize);

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 1 / 20); // clamp big stalls so physics stays sane
  tier.sample(dt); // adaptive frame-time watchdog (may step DPR down under load)
  game.update(dt);
  renderer.render(game.scene, game.camera);
});
