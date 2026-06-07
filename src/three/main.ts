import * as THREE from 'three';
import { Game } from './Game';
import { QualityTier } from './render/QualityTier';
import { Composer } from './postfx/Composer';
import { loadEnvironment, applyEnvironment } from './render/Environment';
import { ENV } from './config';
import { shouldAutostart, defaultProfile } from './ui/Onboarding';
import { HomeScreen } from './ui/home/HomeScreen';
import { NewPilotScreen } from './ui/home/NewPilot';
import { TitleScreen } from './ui/title/TitleScreen';
import { CAMPAIGN, missionById } from './missions/catalog';
import { buildDailyMission, isDailyId } from './missions/daily';
import { buildFreeForAll, isFfaId } from './missions/freeforall';
import { hasCompletedDaily } from './missions/dailyPlay';
import { HELI_MODELS } from './meshes/heliModels';
import { coldStartSeen, hasNamedProfile } from './ui/profile';
import { openLeaderboard } from './ui/Leaderboard';
import { resetStaleStorage } from './storage/reset';
import { installErrorBeacon } from './telemetry/errorBeacon';
import { signalFirstFrame } from './splashSignal';
import { showLoading, hideLoading } from './ui/LoadingOverlay';
import { injectFonts } from './ui/fonts';
import type { MissionDef } from './missions/types';
import type { EndScreenHooks } from './HUD';

/**
 * 3D entry point + campaign router. The home screen (the HomeScreen hub) is the DEFAULT landing for
 * RETURNING pilots (a saved callsign skips the title cinematic and lands on the hub); a brand-new
 * pilot still gets the cinematic TitleScreen → registration gate, which lands on the SAME hub once a
 * callsign is set. A mission runs only when the URL carries `?m=<id>`: picking a
 * mission, advancing (next), and retrying all navigate via `?m=` and reload, so a refresh resumes
 * the current mission with no Three.js teardown, while a fresh visit to the bare URL always lands
 * on the home screen (we deliberately do NOT persist a "resume into last mission" across sessions —
 * returning pilots see their record on the menu and pick from there).
 *
 * `?autostart` boots straight into the first mission (so the headless QA harness can drive
 * `window.__game`); `?m=<id>` deep-links a specific mission.
 */
const container = document.getElementById('game') as HTMLDivElement;

// Brand type — inject the self-hosted Saira + JetBrains Mono @font-faces before any UI paints, so the
// title/hub/HUD render in the real faces (font-display:swap keeps the first paint instant on a cold cache).
injectFonts();

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

  // Dev tools hub (?dev) + helicopter viewer (?heliview) — lazy-loaded creator/inspector tools kept off the
  // player bundle. The hub gathers the Map Editor, the heli viewer, and the live Config panel in one place.
  if (params.has('dev')) {
    void import('./dev/DevHub').then((m) => m.bootDevHub(container));
    return;
  }
  if (params.has('heliview')) {
    void import('./dev/HeliViewer').then((m) => m.bootHeliViewer(container));
    return;
  }

  // Component-kit gallery (?kit): every kit component × state on one page — the visual-QA surface
  // this repo lacks (no test runner). Lazy-loaded so it never ships in the player bundle.
  if (params.has('kit')) {
    void import('./ui/components/gallery').then((m) => m.mountKitGallery(container));
    return;
  }

  // No `?m=` → TitleScreen is the first screen; PLAY mounts this hub (the daily-played redirect below
  // also lands here directly). Returning pilot → HomeScreen; new pilot → the registration gate.
  const openHome = (): void => {
    new HomeScreen(container, CAMPAIGN, {
      onContinue: (id) => gotoCampaign(id),
      onDaily: () => {
        const url = new URL(location.href);
        url.searchParams.set('daily', '1');
        url.searchParams.delete('m');
        location.assign(url.toString());
      },
    });
    // The hub is pure DOM with no render loop, so nothing else fires the cold-start splash teardown
    // — without this the splash lingers over the ready hub until the 12s safety net. On a warm-cache
    // reload (the in-game ☰ HOME nav) the splash paints straight into the ~1MB JS-parse stall, which
    // freezes its CSS embers mid-rise — reading as a "broken" frozen spinner. Hand off to the painted
    // hub after two frames, exactly like the TitleScreen reveal.
    requestAnimationFrame(() => requestAnimationFrame(() => signalFirstFrame()));
  };

  // Daily Burn: ?daily boots today's procedurally-seeded "clear every fire" challenge (FIX #1/#8) —
  // a fresh shared map each day with its own per-day leaderboard. Bypasses the campaign router.
  if (params.has('daily')) {
    // Retry until cleared, then locked: an already-CLEARED daily bounces straight back to the hub (the
    // card shows the locked "cleared — resets in Xh" state). A loss/quit leaves it open to retry. The
    // lock is set on the WIN (see Game.latchOutcome), not at boot. ?qa is exempt so headless
    // verification can always boot it.
    if (!params.has('qa') && hasCompletedDaily()) {
      openHome();
      return;
    }
    bootMission(buildDailyMission(new Date()));
    return;
  }

  // Open Skies (?ffa): the endless FREE-FOR-ALL — the same daily-seeded Saskatchewan for everyone, fires
  // never stop, rack up a personal score. Bypasses the campaign router. No once-per-day lock (unlike the
  // daily): it's a sandbox you can re-enter anytime.
  if (params.has('ffa')) {
    bootMission(buildFreeForAll(new Date()));
    return;
  }

  let selectedId = params.get('m');
  if (!selectedId && shouldAutostart()) selectedId = CAMPAIGN[0].id;

  if (selectedId) {
    bootMission(missionById(selectedId) ?? CAMPAIGN[0]);
  } else if (hasNamedProfile()) {
    // Returning pilot (saved callsign) → straight to the HomeScreen hub, no title cinematic in the way.
    // The home hub is the DEFAULT landing for everyone who's already played.
    // Headless/deep-link (?m= / ?autostart / ?qa) bypasses this branch and boots the game directly.
    openHome();
  } else {
    // New pilot → the cinematic TitleScreen first; PLAY routes into the branded registration gate
    // (NewPilotScreen), which lands on the SAME hub once a callsign is set.
    new TitleScreen(container, CAMPAIGN, () => {
      new NewPilotScreen(container, openHome);
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
  url.searchParams.delete('ffa'); // leaving Open Skies → never carry ?ffa into a campaign/menu nav
  if (missionId) {
    url.searchParams.set('m', missionId);
  } else {
    url.searchParams.delete('m');
    url.searchParams.delete('autostart');
  }
  location.assign(url.toString());
}

/** Re-boot today's Daily Burn via `?daily` — the retry path after a loss. A reload is fine here (it
 *  mirrors the Open Skies restart); the `?daily` guard re-checks `hasCompletedDaily`, so this only ever
 *  re-boots while today's burn is still UNcleared (a win never reaches a RETRY button). */
function gotoDaily(): void {
  const url = new URL(location.href);
  url.searchParams.delete('m');
  url.searchParams.delete('autostart');
  url.searchParams.delete('ffa');
  url.searchParams.set('daily', '1');
  location.assign(url.toString());
}

/** Boot (or re-boot) Open Skies via `?ffa`, dropping any campaign/daily params. A reload is fine here —
 *  it's the free-for-all's restart (after a crash) and re-entry path, mirroring the Daily Burn nav. */
function gotoFfa(): void {
  const url = new URL(location.href);
  url.searchParams.delete('m');
  url.searchParams.delete('autostart');
  url.searchParams.delete('daily');
  url.searchParams.set('ffa', '1');
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
  // before (#9) — after the first time it's a speed bump, so later missions boot engine-running.
  // Open Skies (free-for-all) ALWAYS boots in flight — "no start cycle" (it's a drop-in sandbox, and a
  // respawn is in-flight too). Campaign/daily keep the cold-start ritual for a first-time pilot.
  const skipColdStart = params.has('qa') || params.has('autostart') || coldStartSeen() || isFfaId(mission.id);
  // The interactive first-flight coach must be OFF under headless QA — it would interfere with the
  // verify:render scoop→drop autopilot (a hard CI deploy gate). Real boots leave it on; the Game
  // gates it further to a new pilot's first campaign mission.
  const disableCoach = params.has('qa') || params.has('autostart');
  // QA / dev: fly ANY airframe regardless of unlock progress with ?heli=<id> (bell-205a1 | bell-212 |
  // uh-60), e.g. ?m=first-light&autostart&heli=uh-60. Unknown ids fall back to the saved default.
  const heliOverride = params.get('heli');
  // QA / dev: force the world MAP regardless of the saved pick with ?region=<id> (e.g.
  // ?region=british-columbia). Unknown ids fall back to the default map (saskatchewan, now the
  // true-shape rectangular playfield) inside World.getRegion, so a typo can't crash the boot.
  const regionOverride = params.get('region');
  let profile = defaultProfile();
  if (heliOverride && HELI_MODELS[heliOverride]) profile = { ...profile, heliId: heliOverride };
  if (regionOverride) profile = { ...profile, mapId: regionOverride };

  // The live Game. `let`, because RETRY and NEXT now rebuild it IN PLACE (no page reload): the
  // renderer, composer, window listeners, and the render loop below are created ONCE and reused, and
  // only the Game (scene graph + sims + HUD) is torn down and rebuilt. Every closure below reads
  // `game` from this scope, so a reassignment is picked up transparently on the next frame.
  const tBoot = performance.now();
  let game = buildGame(mission);
  let firstFrameLogged = false;
  let buildComplete = false; // deferred (lakes/rivers/roads) scene build — pumped a few ms/frame after first frame
  if (params.has('qa')) console.log('[boot] Game constructed in', Math.round(performance.now() - tBoot), 'ms');

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

  // Image-based environment lighting (downloaded CC0 HDRI). Loaded + PMREM-prefiltered ONCE
  // (cached in the module), applied as `scene.environment` for specular reflections + soft ambient
  // on the heli body and lake water — the procedural sky dome stays the visible background. Gated
  // OFF on the low tier. Re-applied to each new scene on the in-place mission switch below.
  let envTex: THREE.Texture | null = null;
  if (ENV.enabled && tier.current.name !== 'low') {
    void loadEnvironment(renderer).then((tex) => {
      envTex = tex;
      applyEnvironment(game.scene, tex); // the scene live at resolve time (first mission, or a later one)
    });
  }

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
  let loopErrorReported = false; // surface a frame-throw to the beacon ONCE, then keep going
  let consecutiveThrows = 0; // a PERSISTENT throw (NaN-poisoned sim / broken pass) → recover screen
  const LOOP_FATAL_AFTER = 60; // ~1s of solid throwing = unrecoverable; reload beats a silent 60fps spin
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
    // GUARD THE LOOP. A throw escaping this rAF callback kills setAnimationLoop forever — the scene
    // freezes, audio keeps playing, controls go dead (the prod-freeze class: a bad mesh merge, a NaN,
    // a streamed builder regression). Swallow a TRANSIENT throw so rAF keeps scheduling: a bad frame
    // degrades to a dropped frame, not a permanent freeze. Re-surface it ONCE on a macrotask so the
    // global 'error' listener (→ console + error beacon) records it without re-killing the loop. But
    // a PERSISTENT throw (every frame — a corrupt sim or a broken pass) would otherwise spin silently
    // at 60fps on a black canvas, which is no better than the old freeze — so after ~1s of solid
    // throwing, stop the loop and show a tap-to-reload screen (mirrors the context-loss recovery).
    try {
      tier.sample(dt); // adaptive frame-time watchdog (scales DPR down under load, up under headroom)
      game.update(dt);
      composer.render(renderer, game.scene, game.camera, game.sunDir, game.hazeSources);
      if (params.has('qa') && !firstFrameLogged) {
        firstFrameLogged = true;
        console.log('[boot] first frame at', Math.round(performance.now() - tBoot), 'ms (since Game ctor start)');
      }
      signalFirstFrame(); // first mission frame is on screen — fade out the cold-start splash
      // Stream the deferred scene build (lakes/rivers/roads/yards) in a few ms/frame now that the
      // first frame is up — it fills in under the cold-start spool instead of having frozen the boot.
      if (!buildComplete) buildComplete = game.pumpBuild(6);
      consecutiveThrows = 0; // a clean frame clears the persistent-throw count
    } catch (err) {
      if (!loopErrorReported) {
        loopErrorReported = true;
        console.error('[bmf:loop] frame threw — recovering (subsequent frames continue):', err);
        setTimeout(() => {
          throw err; // re-throw off the rAF stack → caught by window 'error' → beacon, loop survives
        });
      }
      if (++consecutiveThrows >= LOOP_FATAL_AFTER) {
        renderer.setAnimationLoop(null); // every frame is throwing — stop the silent spin
        signalFirstFrame(); // tear down the cold-start splash so the recover screen is visible
        showFatalMessage(container, 'Something went wrong', 'The game hit an unexpected error. Tap to reload.');
        container.addEventListener('pointerdown', () => location.reload(), { once: true });
      }
    }
  });

  /** Construct a Game for `m` with its end-hooks + (dev/QA) debug handle. The renderer/composer/tier
   *  are the shared ones captured above — only the Game itself is per-mission. */
  function buildGame(m: MissionDef): Game {
    const g = new Game(container, tier, m, profile, makeEndHooks(m), { skipColdStart, disableCoach });
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
    // The new Game's constructor regenerates the World (terrain + forest) synchronously — a multi-
    // second frame freeze with no static splash to hide it (this path never reloads). Show the
    // ember-rise loader, then yield two frames so it actually paints before the heavy ctor blocks
    // the thread; otherwise the overlay node is mounted but never composited before the stall.
    showLoading();
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        game.dispose();
        game = buildGame(m);
        buildComplete = false; // the new Game has its own deferred queue to pump
        composer.setScene(game.scene, game.camera);
        applyEnvironment(game.scene, envTex); // re-point the cached env map at the freshly built scene
        const url = new URL(location.href);
        url.searchParams.delete('daily'); // a campaign switch never carries a stale ?daily
        url.searchParams.set('m', m.id);
        history.replaceState(null, '', url.toString());
        // Hide once the new scene has composited at least one frame (the render loop draws it on the
        // next tick after setScene), so the loader hands off to real pixels, not a black flash.
        requestAnimationFrame(() => requestAnimationFrame(() => hideLoading()));
      }),
    );
  }

  // Dev/QA hook (gated exactly like __game): drive an in-place mission switch headlessly, e.g.
  // `window.__switchMission('after-burn')`, so the dispose→rebuild path can be exercised without
  // playing a mission to its end screen. Never present in a normal player's prod bundle.
  if (import.meta.env.DEV || params.has('qa')) {
    (window as unknown as Record<string, unknown>).__switchMission = (id: string): void =>
      switchMission(missionById(id) ?? mission);
  }

  /** End-banner + in-game buttons. RETRY and NEXT rebuild in place (instant — no reload); MENU still
   *  navigates back to the home screen via a reload (it crosses into the TitleScreen's own renderer). */
  function makeEndHooks(m: MissionDef): EndScreenHooks {
    // Daily Burn: no campaign NEXT, but RETRY is allowed until it's CLEARED — the end screen only shows
    // RETRY on a loss (it gates on !won), and a win locks the daily for the day (see Game.latchOutcome),
    // so this re-boots today's burn only while it's still unbeaten. Every other exit returns to the hub.
    if (isDailyId(m.id)) {
      return {
        hasNext: false,
        onNext: () => gotoCampaign(null),
        onRetry: () => gotoDaily(), // re-fly today's burn after a loss (guard blocks it once cleared)
        onMenu: () => gotoCampaign(null),
        onLeaderboard: () => openLeaderboard([...CAMPAIGN, m], m.id),
      };
    }
    // Open Skies (free-for-all): the run is endless, so the end screen is only ever reached by a CRASH.
    // RETRY restarts a fresh Open Skies (recovers from the wreck); MENU returns to the hub; the board is
    // this session's per-day FFA board. No campaign NEXT.
    if (isFfaId(m.id)) {
      return {
        hasNext: false,
        onNext: () => gotoCampaign(null),
        onRetry: () => gotoFfa(), // restart the free-for-all
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
