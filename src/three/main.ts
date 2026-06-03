import * as THREE from 'three';
import { Game } from './Game';
import { QualityTier } from './render/QualityTier';
import { Composer } from './postfx/Composer';
import { shouldAutostart, defaultProfile } from './ui/Onboarding';
import { MissionSelect } from './ui/MissionSelect';
import { CAMPAIGN, missionById } from './missions/catalog';
import { getSelectedId, setSelectedId, clearSelectedId } from './missions/progress';
import { openLeaderboard } from './ui/Leaderboard';
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

// Pre-flight (launch-readiness P0.2): on the long tail of devices WebGL2 is disabled, blocked, or
// just absent. Constructing the renderer then throws and the player gets a silent blank screen. A
// capability check up front lets us show a friendly message instead of a black void.
if (webglAvailable()) {
  routeMission();
} else {
  showFatalMessage(
    container,
    'Graphics not supported',
    'bucketmyfire needs WebGL to run, and this browser/device doesn’t have it available. ' +
      'Try a different browser, enable hardware acceleration, or update your device.',
  );
}

/** Campaign router: a chosen mission (URL `?m=` / saved / autostart) boots the Game; otherwise we
 *  show the menu. Pulled into a function so the WebGL guard above can gate it cleanly. */
function routeMission(): void {
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
}

/** Can this device create a WebGL2 context (what THREE.WebGLRenderer requires since r163)?
 *  A false here means the renderer would fail — we show a message instead of a blank canvas. */
function webglAvailable(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return !!(window.WebGL2RenderingContext && canvas.getContext('webgl2'));
  } catch {
    return false;
  }
}

/** Replace the game container with a centered, styled fatal message (used for the no-WebGL
 *  pre-flight and for context-loss recovery). Pure DOM — no renderer needed. */
function showFatalMessage(host: HTMLElement, title: string, body: string): void {
  host.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.style.cssText =
    'position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;' +
    'justify-content:center;gap:12px;padding:24px;text-align:center;background:#0c1411;' +
    'font-family:system-ui,-apple-system,sans-serif;color:#cdd6e0;';
  const h = document.createElement('div');
  h.textContent = title;
  h.style.cssText = 'font-size:20px;font-weight:700;letter-spacing:0.04em;color:#7fd4ff;';
  const p = document.createElement('div');
  p.textContent = body;
  p.style.cssText = 'font-size:14px;max-width:440px;line-height:1.55;opacity:0.85;';
  wrap.append(h, p);
  host.appendChild(wrap);
}

/**
 * Navigate the campaign by URL, making the `m` deep-link param AUTHORITATIVE while preserving
 * incidental params (e.g. `qa`). Pass a mission id to boot it, or `null` to return to the menu.
 *
 * Why not a bare `location.reload()`: `routeMission()` reads `?m=<id>` with precedence over the
 * localStorage handoff, and a reload keeps the current URL — so when the game was opened via a
 * `?m=` deep link, the in-game MENU button (and NEXT) just re-booted the SAME mission and never
 * reached the menu / advanced. Rewriting the URL here fixes both. (`autostart` is also dropped on
 * the way to the menu so "menu" actually lands on the menu rather than auto-booting mission 0.)
 */
function gotoCampaign(missionId: string | null): void {
  const url = new URL(location.href);
  if (missionId) {
    url.searchParams.set('m', missionId);
  } else {
    url.searchParams.delete('m');
    url.searchParams.delete('autostart');
  }
  location.assign(url.toString());
}

/** End-banner + in-game buttons: advance / retry / back to menu. */
function endHooks(mission: MissionDef): EndScreenHooks {
  const next = CAMPAIGN.find((m) => m.index === mission.index + 1);
  return {
    hasNext: !!next,
    onNext: () => {
      if (next) {
        setSelectedId(next.id);
        gotoCampaign(next.id); // explicit URL so a stale ?m= doesn't override the advance
      }
    },
    onRetry: () => location.reload(), // same mission — a plain reload keeps the right target
    onMenu: () => {
      clearSelectedId();
      gotoCampaign(null); // drop ?m= (+ autostart) so the router lands on the menu
    },
    onLeaderboard: () => openLeaderboard(CAMPAIGN, mission.id),
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

  // Context-loss recovery (launch-readiness P0.2): under mobile memory pressure the GPU can yank
  // the GL context — without this the game freezes on a dead canvas. preventDefault() is required
  // for the browser to consider restoring; we pause the loop and offer a one-tap reload.
  renderer.domElement.addEventListener(
    'webglcontextlost',
    (e) => {
      e.preventDefault();
      renderer.setAnimationLoop(null);
      showFatalMessage(
        container,
        'Graphics paused',
        'The graphics context was lost (the device may be low on memory). Tap to resume.',
      );
      container.addEventListener('pointerdown', () => location.reload(), { once: true });
    },
    false,
  );

  // Quality tier: scene complexity (shadows / tessellation / post-fx) is fixed at load;
  // render resolution (DPR) is the one runtime-adaptive lever. Set the renderer's DPR
  // before the composer is built below (it reads getPixelRatio() at construction).
  const tier = new QualityTier();
  renderer.setPixelRatio(tier.dpr);
  renderer.shadowMap.enabled = tier.current.shadows;

  // Headless QA (?qa drives __game; ?autostart boots straight into a mission) skips the cold-start
  // ritual — the autopilot/teleport/screenshot flows expect a running, airborne aircraft.
  const skipColdStart = params.has('qa') || params.has('autostart');
  const game = new Game(container, tier, mission, defaultProfile(), endHooks(mission), { skipColdStart });

  // Bloom post-process (B3) — fire/sun glow, render path chosen by tier at load.
  const composer = new Composer(renderer, game.scene, game.camera, tier);

  // Adaptive resolution: the watchdog scales DPR up/down within the device range under
  // sustained load / headroom. Re-apply it to the renderer AND the composer (which draws
  // the on-screen image) in lockstep — recompile-free, just a render-target resize.
  tier.onDpr((dpr) => {
    renderer.setPixelRatio(dpr);
    composer.setPixelRatio(dpr);
  });

  // Debug/QA hook: lets a test harness read flight/game/mission state. On in dev always; in a prod
  // build only when `?qa` is present — so normal players don't get a global handle, but the headless
  // Playwright harness (which can add `?qa`) still can. (Launch-readiness P2.1.)
  if (import.meta.env.DEV || params.has('qa')) {
    (window as unknown as Record<string, unknown>).__game = game;
  }

  function resize(): void {
    const w = container.clientWidth;
    const h = container.clientHeight;
    renderer.setSize(w, h);
    composer.setSize(w, h);
    game.resize(w / h);
  }
  window.addEventListener('resize', resize);
  // A phone rotate fires 'orientationchange' (and sometimes only that), so re-run the Hor+ FOV /
  // portrait framing immediately on rotate, not just on a width 'resize'.
  window.addEventListener('orientationchange', resize);

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
    tier.sample(dt); // adaptive frame-time watchdog (scales DPR down under load, up under headroom)
    game.update(dt);
    composer.render(renderer, game.scene, game.camera, game.sunDir, game.hazeSources);
  });
}
