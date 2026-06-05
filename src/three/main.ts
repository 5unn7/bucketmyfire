import * as THREE from 'three';
import { Game } from './Game';
import { QualityTier } from './render/QualityTier';
import { Composer } from './postfx/Composer';
import { shouldAutostart, defaultProfile } from './ui/Onboarding';
import { MenuFlow } from './ui/flow/MenuFlow';
import { TitleScreen } from './ui/title/TitleScreen';
import { CAMPAIGN, missionById } from './missions/catalog';
import { buildDailyMission, isDailyId } from './missions/daily';
import { HELI_MODELS } from './meshes/heliModels';
import { coldStartSeen } from './ui/profile';
import { openLeaderboard } from './ui/Leaderboard';
import { resetStaleStorage } from './storage/reset';
import { installErrorBeacon } from './telemetry/errorBeacon';
import { signalFirstFrame } from './splashSignal';
import type { MissionDef } from './missions/types';
import type { EndScreenHooks } from './HUD';

/**
 * 3D entry point + campaign router. The home screen (the MenuFlow pre-flight wizard) is the DEFAULT
 * landing for everyone — new and returning. A mission runs only when the URL carries `?m=<id>`: picking a
 * mission, advancing (next), and retrying all navigate via `?m=` and reload, so a refresh resumes
 * the current mission with no Three.js teardown, while a fresh visit to the bare URL always lands
 * on the home screen (we deliberately do NOT persist a "resume into last mission" across sessions —
 * returning pilots see their record on the menu and pick from there).
 *
 * `?autostart` boots straight into the first mission (so the headless QA harness can drive
 * `window.__game`); `?m=<id>` deep-links a specific mission.
 */
const container = document.getElementById('game') as HTMLDivElement;

// Crash/error beacon FIRST, so a failure during storage reset / renderer / world construction is
// reported too. Env-gated sink (VITE_ERROR_BEACON_URL); console-only when unset. PII-free.
installErrorBeacon(() => ({
  webgl2: typeof window.WebGL2RenderingContext !== 'undefined',
  dpr: window.devicePixelRatio,
  vw: window.innerWidth,
  vh: window.innerHeight,
}));

// Clean-slate switch: wipe all local game data once if the data epoch was bumped (e.g. after the
// scoring rescale). Runs before anything reads storage (Onboarding/profile/progress/menu).
resetStaleStorage();

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
    'Bucket My Fire needs WebGL to run, and this browser/device doesn\'t have it available. ' +
      'Try a different browser, enable hardware acceleration, or update your device.',
  );
}

/** Campaign router: a chosen mission (URL `?m=` / saved / autostart) boots the Game; otherwise we
 *  show the home-screen wizard. Pulled into a function so the WebGL guard above can gate it cleanly. */
function routeMission(): void {
  // Map editor (?editor): the in-3D map sculptor — lazy-loaded so none of it ships in a player's bundle.
  // `?map=<id>` opens a specific map. Bypasses the campaign/title router entirely.
  if (params.has('editor')) {
    void import('./editor/MapEditor').then((m) => m.bootEditor(container, params.get('map') ?? undefined));
    return;
  }

  // Daily Burn: ?daily boots today's procedurally-seeded "clear every fire" challenge (FIX #1/#8) —
  // a fresh shared map each day with its own per-day leaderboard. Bypasses the campaign router.
  if (params.has('daily')) {
    bootMission(buildDailyMission(new Date()));
    return;
  }

  let selectedId = params.get('m');
  if (!selectedId && shouldAutostart()) selectedId = CAMPAIGN[0].id;

  if (selectedId) {
    bootMission(missionById(selectedId) ?? CAMPAIGN[0]);
  } else {
    // No `?m=` → the home screen: the 3D TitleScreen (an attract-scene backdrop + ember logo + PLAY).
    // PLAY tears the title down and mounts the guided pre-flight wizard (MenuFlow) — whose Screen 1 IS
    // the identity gate (a required callsign), so first-run players can't reach a mission without a
    // name; returning pilots get a "Skip to missions →". Picking a mission navigates with `?m=` (a
    // reload). Headless/deep-link (?m= / ?autostart / ?qa) bypasses this branch and boots the game.
    new TitleScreen(container, CAMPAIGN, () => {
      // Smart PLAY (#1): MenuFlow lands a RETURNING pilot straight on the mission carousel (it gates
      // skipToMissions on a real saved callsign), so PLAY → pick a sortie in one tap. First-run pilots
      // still start on Screen 1 (the callsign gate).
      new MenuFlow(container, CAMPAIGN, (id) => gotoCampaign(id), { skipToMissions: true });
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
  signalFirstFrame(); // no canvas will render on this path — clear the splash so the message shows
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
  url.searchParams.delete('daily'); // leaving Daily Burn → never carry ?daily into a campaign/menu nav
  if (missionId) {
    url.searchParams.set('m', missionId);
  } else {
    url.searchParams.delete('m');
    url.searchParams.delete('autostart');
  }
  location.assign(url.toString());
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
  // Skip the hold-to-spool ritual for headless QA/autostart, AND once the pilot has completed it once
  // before (#9) — after the first time it's a speed bump, so later sorties boot engine-running.
  const skipColdStart = params.has('qa') || params.has('autostart') || coldStartSeen();
  // QA / dev: fly ANY airframe regardless of unlock progress with ?heli=<id> (bell-205a1 | bell-212 |
  // uh-60), e.g. ?m=first-light&autostart&heli=uh-60. Unknown ids fall back to the saved default.
  const heliOverride = params.get('heli');
  const profile =
    heliOverride && HELI_MODELS[heliOverride] ? { ...defaultProfile(), heliId: heliOverride } : defaultProfile();

  // The live Game. `let`, because RETRY and NEXT now rebuild it IN PLACE (no page reload): the
  // renderer, composer, window listeners, and the render loop below are created ONCE and reused, and
  // only the Game (scene graph + sims + HUD) is torn down and rebuilt. Every closure below reads
  // `game` from this scope, so a reassignment is picked up transparently on the next frame.
  let game = buildGame(mission);

  // Bloom post-process (B3) — fire/sun glow, render path chosen by tier at load. Re-aimed at the
  // new scene/camera on each in-place switch via composer.setScene (see switchMission).
  const composer = new Composer(renderer, game.scene, game.camera, tier);

  // Adaptive resolution: the watchdog scales DPR up/down within the device range under
  // sustained load / headroom. Re-apply it to the renderer AND the composer (which draws
  // the on-screen image) in lockstep — recompile-free, just a render-target resize.
  tier.onDpr((dpr) => {
    renderer.setPixelRatio(dpr);
    composer.setPixelRatio(dpr);
  });

  // Live tuning panel (dev only): an auto-generated slider board over every config.ts block.
  // Toggle with the backtick key or the ⚙ button. Lazy-imported so it stays out of a player's
  // bundle; gated like __game plus an explicit ?tune for opening it on a prod ?qa session.
  if (import.meta.env.DEV || params.has('qa') || params.has('tune')) {
    void import('./dev/ConfigPanel').then((m) => m.mountConfigPanel()).catch(() => {});
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

  // Tab-blur pause (launch-readiness): a hidden tab keeps Web Audio playing through a throttled rAF —
  // i.e. the rotor drone blares on in the background. Suspend audio + skip stepping while hidden, and
  // reseed the clock on return so a single resume frame can't lurch the sim.
  let hidden = document.hidden;
  document.addEventListener('visibilitychange', () => {
    hidden = document.hidden;
    game.setActive(!hidden);
  });

  // dt is derived from the rAF timestamp Three hands the loop. The first frame only seeds the
  // clock and bails: dt must be > 0 or the sim's acceleration term (Δvel / dt) divides by zero.
  let prevTime = 0;
  renderer.setAnimationLoop((time: number) => {
    if (hidden) {
      prevTime = 0; // tab backgrounded — skip stepping; reseed the clock so resume doesn't lurch
      return;
    }
    if (prevTime === 0) {
      prevTime = time;
      return;
    }
    const dt = Math.min((time - prevTime) / 1000, 1 / 20); // clamp big stalls so physics stays sane
    prevTime = time;
    tier.sample(dt); // adaptive frame-time watchdog (scales DPR down under load, up under headroom)
    game.update(dt);
    composer.render(renderer, game.scene, game.camera, game.sunDir, game.hazeSources);
    signalFirstFrame(); // first mission frame is on screen — fade out the cold-start splash
  });

  /** Construct a Game for `m` with its end-hooks + (dev/QA) debug handle. The renderer/composer/tier
   *  are the shared ones captured above — only the Game itself is per-mission. */
  function buildGame(m: MissionDef): Game {
    const g = new Game(container, tier, m, profile, makeEndHooks(m), { skipColdStart });
    // Debug/QA hook: lets a test harness read flight/game/mission state. On in dev always; in a prod
    // build only when `?qa` is present — re-pointed so a switched-to mission stays inspectable.
    if (import.meta.env.DEV || params.has('qa')) {
      (window as unknown as Record<string, unknown>).__game = g;
    }
    return g;
  }

  /** Switch missions WITHOUT a page reload: dispose the old Game (closes its audio context, detaches
   *  its listeners + DOM overlays, frees its GPU resources), build the new one, re-aim the composer
   *  at its scene/camera, and rewrite the `?m=` deep link so a refresh resumes the right mission. This
   *  is the Phase-2 win — it removes a full bundle re-parse + renderer rebuild from every retry/advance. */
  function switchMission(m: MissionDef): void {
    game.dispose();
    game = buildGame(m);
    composer.setScene(game.scene, game.camera);
    const url = new URL(location.href);
    url.searchParams.delete('daily'); // a campaign switch never carries a stale ?daily
    url.searchParams.set('m', m.id);
    history.replaceState(null, '', url.toString());
  }

  // Dev/QA hook (gated exactly like __game): drive an in-place mission switch headlessly, e.g.
  // `window.__switchMission('after-burn')`, so the dispose→rebuild path can be exercised without
  // playing a sortie to its end screen. Never present in a normal player's prod bundle.
  if (import.meta.env.DEV || params.has('qa')) {
    (window as unknown as Record<string, unknown>).__switchMission = (id: string): void =>
      switchMission(missionById(id) ?? mission);
  }

  /** End-banner + in-game buttons. RETRY and NEXT rebuild in place (instant — no reload); MENU still
   *  navigates back to the home screen via a reload (it crosses into the TitleScreen's own renderer). */
  function makeEndHooks(m: MissionDef): EndScreenHooks {
    // Daily Burn: no campaign NEXT; replay re-runs today's same-seed map. Kept as a reload — the daily
    // mission is rebuilt from `new Date()` and is a rare path, so it's not worth wiring in-place.
    if (isDailyId(m.id)) {
      return {
        hasNext: false,
        onNext: () => location.reload(),
        onRetry: () => location.reload(),
        onMenu: () => gotoCampaign(null),
        onLeaderboard: () => openLeaderboard([...CAMPAIGN, m], m.id),
      };
    }
    // Advance stays within the SAME map (each map owns its own campaign), so per-map indices are honoured.
    const next = CAMPAIGN.find((c) => (c.map ?? '') === (m.map ?? '') && c.index === m.index + 1);
    return {
      hasNext: !!next,
      onNext: () => {
        if (next) switchMission(next); // in-place advance — no reload
      },
      onRetry: () => switchMission(m), // in-place restart of the same mission
      onMenu: () => gotoCampaign(null), // drop ?m= (+ autostart) so the router lands on the home screen
      onLeaderboard: () => openLeaderboard(CAMPAIGN, m.id),
    };
  }
}
