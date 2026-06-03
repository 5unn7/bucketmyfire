import * as THREE from 'three';
import { Game } from './Game';
import { QualityTier } from './render/QualityTier';
import { Composer } from './postfx/Composer';
import { shouldAutostart, defaultProfile } from './ui/Onboarding';
import { MissionSelect } from './ui/MissionSelect';
import { CAMPAIGN, missionById } from './missions/catalog';
import { getSelectedId, setSelectedId, clearSelectedId } from './missions/progress';
import type { MissionDef } from './missions/types';
import type { EndScreenHooks } from './HUD';

/**
 * 3D entry point + campaign router. With no mission selected we show the MissionSelect menu;
 * picking a mission boots the Game with that MissionDef. The end-banner buttons (next / retry /
 * menu) persist the choice to localStorage and reload — so mission switching needs no Three.js
 * teardown (the renderer/composer/HUD/Input all own GPU + DOM resources that a reload clears).
 *
 * `?autostart` skips the menu and boots straight into a mission (default: the first sortie), so
 * the headless QA harness can drive `window.__game`. `?m=<id>` selects a specific mission.
 */
const container = document.getElementById('game') as HTMLDivElement;

const params = new URLSearchParams(location.search);
const urlMission = params.get('m');
let selectedId = urlMission ?? getSelectedId();
if (!selectedId && shouldAutostart()) selectedId = CAMPAIGN[0].id;

if (selectedId) {
  const mission = missionById(selectedId) ?? CAMPAIGN[0];
  setSelectedId(mission.id);
  bootMission(mission);
} else {
  // No mission chosen yet → the campaign menu. First pick boots directly (nothing built yet,
  // so no teardown); subsequent switches go through the end-banner reload path.
  let menu: MissionSelect | undefined;
  menu = new MissionSelect(container, CAMPAIGN, (id) => {
    setSelectedId(id);
    menu?.dispose();
    bootMission(missionById(id) ?? CAMPAIGN[0]);
  });
}

/** End-banner buttons: advance / retry / back to menu, all via localStorage + reload. */
function endHooks(mission: MissionDef): EndScreenHooks {
  const next = CAMPAIGN.find((m) => m.index === mission.index + 1);
  return {
    hasNext: !!next,
    onNext: () => {
      if (next) setSelectedId(next.id);
      location.reload();
    },
    onRetry: () => location.reload(),
    onMenu: () => {
      clearSelectedId();
      location.reload();
    },
  };
}

function bootMission(mission: MissionDef): void {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.shadowMap.type = THREE.PCFShadowMap;
  // Cinematic lens: ACES filmic tone mapping rolls the HDR fire core off into film-like
  // highlights instead of clipping to flat white — the single biggest "Hollywood" lever.
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.02; // lowered: 1.15 lifted the whole golden-hour frame into a
  // milky wash; a near-neutral exposure keeps deep shadows so the fire + dark smoke read with punch
  container.appendChild(renderer.domElement);

  // Quality tier: apply DPR + shadow on/off at load; adaptive downgrade only touches the
  // cheap, recompile-free lever (DPR), so shadows stay fixed after load.
  const tier = new QualityTier();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, tier.current.dprCap));
  renderer.shadowMap.enabled = tier.current.shadows;
  tier.onChange((s) => renderer.setPixelRatio(Math.min(window.devicePixelRatio, s.dprCap)));

  const game = new Game(container, tier, mission, defaultProfile(), endHooks(mission));

  // Bloom post-process (B3) — fire/sun glow, render path chosen by tier at load.
  const composer = new Composer(renderer, game.scene, game.camera, tier);

  // Debug/QA hook: lets a test harness read flight/game/mission state. Harmless in prod.
  (window as unknown as Record<string, unknown>).__game = game;

  function resize(): void {
    const w = container.clientWidth;
    const h = container.clientHeight;
    renderer.setSize(w, h);
    composer.setSize(w, h);
    game.resize(w / h);
  }
  window.addEventListener('resize', resize);

  // dt is derived from the rAF timestamp Three hands the loop. The first frame only seeds the
  // clock and bails: dt must be > 0 or the sim's acceleration term (Δvel / dt) divides by zero.
  let prevTime = 0;
  renderer.setAnimationLoop((time: number) => {
    if (prevTime === 0) {
      prevTime = time;
      return;
    }
    const dt = Math.min((time - prevTime) / 1000, 1 / 20); // clamp big stalls so physics stays sane
    prevTime = time;
    tier.sample(dt); // adaptive frame-time watchdog (may step DPR down under load)
    game.update(dt);
    composer.render(renderer, game.scene, game.camera, game.sunDir, game.hazeSources);
  });
}
