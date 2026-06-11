/**
 * Lightweight DOM heads-up display. Three.js renders the world; the HUD is just
 * absolutely-positioned HTML (+ small 2D canvases) over the canvas — cheaper and
 * crisper than drawing text in WebGL, and it scales with the viewport for free. Pure
 * presentation: it reads a state snapshot handed in each frame and never touches the scene.
 *
 * This class is the COMPOSER + the per-frame instrument core (the strip of gauge pods, the
 * flight tapes, the status hint, objective checklist, radio comms, hazard captions). The three
 * heavy, rarely-churning sub-systems live in their own modules under `hud/` and are driven
 * through this thin facade so the public API Game calls is unchanged:
 *   - `hud/Radar.ts`       the radar / minimap (its own canvas + pan/zoom + burn overlay)
 *   - `hud/EndScreen.ts`   the mission end screen (fires once per run)
 *   - `hud/engineStart.ts` the cold-start hold-to-spool dial (fires once at boot)
 *
 * Visual language: a modern EV-cluster / "glass cockpit" look — frosted-glass surfaces
 * (backdrop blur), hairline strokes, one cyan accent, light type.
 */

import type { TrackerItem, CommsSpeaker, CommsUrgency, MissionDef } from './missions/types';
import type { FireFieldView } from './sim/FireSystem';
import { UI, FS, FW, R, el, makeCanvas, clamp01, prefersReducedMotion } from './ui/theme';
import { onLayout, type LayoutState } from './ui/layout';
import { ic } from './ui/home/icons';
import { injectHudStyles } from './hud/styles';
import { Radar } from './hud/Radar';
import { EndScreen } from './hud/EndScreen';
import { EngineStart } from './hud/engineStart';
import { MessageBar } from './hud/MessageBar';
import { CoachOverlay } from './ui/coach/CoachOverlay';
import type { CoachPrompt } from './ui/coach/CoachDirector';
import { fmtTime, AIRFRAME_OK, personalize } from './hud/common';
import type { HudState, EndScreenHooks, MapLabels } from './hud/types';

// Re-exported so every existing `import { … } from './HUD'` keeps working unchanged.
export type { HudState, EndScreenHooks, MapLabels };

// Design tokens + DOM helpers (el / makeCanvas / clamp01) live in ui/theme.ts; the responsive LAYOUT now
// lives in the injected `.bmf-hud` stylesheet (hud/styles.ts) — CSS grid + clamp() + real @media
// breakpoints — so this class only builds the DOM, writes per-frame state, and re-sizes the one canvas
// (the radar) that genuinely needs JS pixels via `onLayout` (layout.ts).

const TAPE_W = 78; // jet tape canvas width
const TAPE_H = 188; // jet tape canvas height (the scrolling window)
const LOW_AGL_FT = 250; // altimeter reads LOW (red) below this AGL in feet
const CAUTION_EXPAND_MS = 4500; // a raised caution shows its full message this long, then minimizes to the ⚠ chip

// The cockpit instrument face (JetBrains Mono) — one source via theme.ts; used by the flight tapes +
// radar text below. (The pre-flight DISPATCH SLIP that also used it now lives in ui/Briefing.ts, so it
// can paint instantly before the World/HUD are built — see main.ts bootMission.)
const MONO = UI.fontMono;

// The GPWS-style hazard-caption flash keyframe (`bmf-alert-pulse`) now lives in the injected `.bmf-hud`
// stylesheet (hud/styles.ts); reduced-motion users still get a steady caption (HUD.setAlert skips the
// animation). The instrument strip + every gauge cell are laid out by that stylesheet's classes too — this
// class only builds the DOM and writes per-frame STATE (numbers, colours, bar fills) into it.

export class HUD {
  private readonly root: HTMLDivElement;
  private unsubLayout: (() => void) | null = null; // onLayout unsubscribe — detached in dispose()

  // Instrument strip: ONE frosted capsule of compact icon + NUMBER "pods" laid out
  // as a horizontal, wrapping top band (water / airframe / fuel / fires / threat / compass /
  // wind) — the mobile-portrait "all info in the top band, no bars" layout. Pods are
  // transparent — only the capsule carries glass, so it's a single backdrop-blur layer.
  private readonly spine: HTMLDivElement;
  // NB: WATER moved out of the strip into the DROP "bucket" (Input.setBucket / flashBucket) — carry +
  // spend fused into one element — so there is no longer a water pod here.
  private readonly airframePod: Pod;
  private readonly fuelPod: Pod;
  private readonly firesPod: Pod;
  private readonly threatPod: Pod;
  private readonly crewPod: Pod; // crew aboard count (delivery/evac missions only — hidden otherwise)
  private readonly compassPod: Pod; // heading in degrees (replaces the scrolling heading tape)
  private readonly windPod: Pod; // wind speed in knots + a heading-relative direction arrow
  private menuCell?: HTMLDivElement; // ☰ tucked at the head of the strip (campaign only)
  private readonly objPanel: HTMLDivElement; // campaign objective checklist (hidden in sandbox)
  private objSig = ''; // last-rendered objective signature (skip DOM churn when unchanged)
  private objPrev = new Map<string, { current: number; done: boolean }>(); // per-goal last state → flash on advance
  // Open-world LIVE readout (Open Skies / Living Province) — the panel that replaced the old "DISPATCH"
  // shift card. Built ONCE (refs kept) so the points total can count UP in place each frame rather than
  // churning the DOM, and the pilot count is a single guarded text write.
  private liveBuilt = false;
  private livePilotsNum?: HTMLDivElement; // the live-pilot count readout
  private livePointsNum?: HTMLDivElement; // the running points total (animated count-up + on-gain flash)
  private livePrevPilots = -1; // last-written pilot count (skip the DOM write when unchanged)
  private liveTargetPoints = 0; // latest points from Game (the shown value eases toward this)
  private liveShownPoints = 0; // the currently-displayed (eased) points value
  private liveShownText = ''; // last string written to the points number (skip redundant per-frame writes)
  private livePrevPoints = -1; // last frame's target → detect a gain to flash the number
  private livePointsFlashT = 0; // setTimeout id: clear the on-gain glow on the points number
  // Crew board/disembark progress bar — a labelled fill that appears while landed on a zone
  // ("CREW BOARDING" climbing in / "CREW DISEMBARKING" stepping off). Hidden when not working a zone.
  private readonly crewBar: HTMLDivElement;
  private readonly crewBarLabel: HTMLDivElement;
  private readonly crewBarFill: HTMLDivElement;
  private crewBarShown = false; // last visibility (re-seat the bar only when it toggles)
  // Caution annunciator — a persistent amber "heads up" under the strip. It pops EXPANDED (the message),
  // then minimizes to a ⚠ chip and STAYS until cleared. Driven each frame by the detached-bucket state
  // (no scoop/drop until you set down at a base). Idempotent on the text, so per-frame calls are cheap.
  private readonly caution: HTMLDivElement;
  private readonly cautionTx: HTMLDivElement;
  private cautionText: string | null = null; // current shown message (the per-frame idempotent guard)
  private cautionMiniT = 0; // setTimeout id: collapse the expanded message to the ⚠ chip
  // The ONE glass advisory bar: dispatch/comms + contextual hints + idle flying tips, all through a single
  // pill, mounted in the top-band grid's centre column (hud/styles.ts `.hud-comms`). It can no longer
  // overlap a corner, so the old getBoundingClientRect measure-and-nudge (positionMessages) is gone.
  private readonly messages: MessageBar;
  private readonly hudRight: HTMLDivElement; // top-band grid RADAR column — the help "?" tucks under the map (mountUnderRadar)
  private readonly smoke: HTMLDivElement; // C5: blinding-smoke veil when the camera is in a plume
  private readonly hitFlash: HTMLDivElement; // red impact vignette pulsed on a hard-landing airframe dent
  private hitFlashTimer = 0; // setTimeout id: fade the impact flash back out
  private readonly alertEl: HTMLDivElement; // big centred GPWS-style caption (SINK RATE / PULL UP / TERRAIN)
  private alertText: string | null = null; // current caption (idempotent guard — never re-trigger the same one)

  // Fighter-jet scrolling tapes (canvas): airspeed left of the heli, altitude right. Only the 2D contexts
  // are kept — the canvases are placed + scaled by CSS (`.tape.spd` / `.tape.alt`), so there's no element
  // ref to hold. The backing stores are fixed-size (TAPE_W × TAPE_H); CSS only transforms the display.
  private readonly spdCtx: CanvasRenderingContext2D;
  private readonly altCtx: CanvasRenderingContext2D;

  private readonly pilotName?: string; // callsign from onboarding — personalizes the radio comms + briefing

  // Lifted-out sub-systems — each owns its own DOM sub-tree + state behind this thin facade
  // (the public API Game calls is unchanged; these just absorb the cold, rarely-churning mass).
  private readonly radar: Radar;
  private readonly endScreen: EndScreen;
  private readonly engine: EngineStart;
  private readonly coach: CoachOverlay;

  constructor(
    parent: HTMLElement,
    minimap: HTMLCanvasElement,
    labels?: MapLabels,
    pilotName?: string,
    end?: EndScreenHooks,
  ) {
    this.pilotName = pilotName?.trim() || undefined;
    injectHudStyles(); // the responsive `.bmf-hud` stylesheet (idempotent): tokens + clamp() sizing + grid

    this.root = el('div', {
      position: 'absolute',
      inset: '0',
      pointerEvents: 'none',
      userSelect: 'none',
      textRendering: 'geometricPrecision',
    });
    this.root.className = 'bmf-hud';

    // --- Blinding-smoke veil (C5) — a full-screen haze that thickens when the camera flies
    // into a fire's plume. Appended FIRST so it sits behind the gauges (instruments stay
    // readable through it). Denser toward the edges so the centre keeps a little visibility.
    this.smoke = el('div', {
      position: 'absolute',
      inset: '0',
      pointerEvents: 'none',
      opacity: '0',
      background:
        'radial-gradient(ellipse at 50% 46%, rgba(168,160,150,0.30) 0%, rgba(126,118,110,0.62) 56%, rgba(84,78,72,0.9) 100%)',
    });
    this.root.appendChild(this.smoke);

    // --- Damage impact flash — a red edge-vignette pulsed when the airframe takes a hard-landing dent.
    // The quiet health NUMBER ticking down went unnoticed, so this is the unmissable "you just took a
    // hit" cue. Appended behind the gauges (like the smoke veil) so instruments stay readable; driven
    // event-only by flashDamage() (fast in, slow out), so it costs nothing while flying clean. ---
    this.hitFlash = el('div', {
      position: 'absolute',
      inset: '0',
      pointerEvents: 'none',
      opacity: '0',
      background: 'radial-gradient(ellipse at 50% 50%, rgba(255,40,30,0) 42%, rgba(255,38,28,0.7) 100%)',
      transition: 'opacity 0.55s ease',
    });
    this.root.appendChild(this.hitFlash);

    // --- Hazard caption — the unmissable, aviation-correct warning before a crash: "SINK RATE" /
    // "PULL UP" while descending too fast and low, "TERRAIN — PULL UP" closing on the canopy. Big,
    // centred, red, pulsing (GPWS-style). Driven idempotently by setAlert() each frame; hidden when
    // there's nothing to warn about, so it costs nothing while flying clean. (The pulse keyframe is in the
    // injected `.bmf-hud` stylesheet now — see injectHudStyles, called at the top of this constructor.) ---
    this.alertEl = el('div', {
      position: 'absolute',
      top: '21%',
      left: '50%',
      transform: 'translateX(-50%)',
      pointerEvents: 'none',
      display: 'none',
      padding: '6px 16px',
      borderRadius: R.sm,
      border: `2px solid ${UI.warn}`,
      background: 'rgba(28,6,4,0.42)',
      color: UI.warn,
      fontSize: FS.title,
      fontWeight: FW.heavy,
      letterSpacing: '2.5px',
      textAlign: 'center',
      whiteSpace: 'nowrap',
      textShadow: '0 1px 3px rgba(0,0,0,0.8)',
      boxShadow: `0 0 18px ${UI.warn}77`,
      zIndex: '22',
    });
    this.root.appendChild(this.alertEl);

    // --- Top band — a CSS grid frame [strip | comms | radar] (hud/styles.ts `.hud-top`). The comms
    // column is bounded BETWEEN the strip and radar, so the advisory bar can never overlap a corner; a
    // portrait/narrow @media restacks comms onto its own row. The strip + DISPATCH panel stack in the LEFT
    // column. (This retired the three absolutely-positioned anchors AND the positionMessages measure-nudge.)
    const top = el('div', {});
    top.className = 'hud-top';
    const leftCol = el('div', {});
    leftCol.className = 'hud-left';
    const commsCol = el('div', {});
    commsCol.className = 'hud-comms';
    this.hudRight = el('div', {});
    this.hudRight.className = 'hud-right';

    // --- Instrument strip: ONE frosted pill of bezelled CHAMBERS (AIRCRAFT / FIRE / WIND), each a cluster
    // of icon+number pods. The frosted look + the wrap/clamp sizing are CSS (`.strip` / `.pod` + the --pod
    // clamp in hud/styles.ts); this just assembles the DOM. It hugs its content and stays one row on phones
    // ≥360px (clamp shrinks the cells); the WIND chamber drops on the narrowest screens so nothing orphans. ---
    this.spine = el('div', {});
    this.spine.className = 'strip';
    if (end) {
      this.menuCell = makeMenuCell(end.onMenu);
      this.spine.appendChild(this.menuCell);
    }
    // Resource gauges (water / airframe / fuel / threat) carry a thin animated fill BAR at the cell's
    // base — the glanceable "how full / how healthy" cue the bare number didn't convey. Count + units
    // cells (fires / compass / wind) stay number-only.
    this.airframePod = makePod(HEALTH_SVG, true); // airframe %
    this.fuelPod = makePod(FUEL_SVG, true); // tank %
    this.firesPod = makePod(FIRES_SVG, false, 'fire'); // fires remaining (count) — the mission HERO (CSS .pod.fire steps it up)
    this.threatPod = makePod(THREAT_SVG, true); // most-endangered structure %
    this.crewPod = makePod(CREW_SVG, true); // crew aboard (0/1) — bar reads as a filled/empty seat
    this.compassPod = makePod(COMPASS_SVG); // heading ° (parked hidden — redundant with the heading-up radar)
    this.windPod = makePod(WIND_SVG); // wind kt (icon rotates to the heading-relative gust)
    // Bezelled instrument CHAMBERS: the flat pod row is grouped into clusters inside the single frosted
    // pill — AIRCRAFT (the systems that can down you: airframe / fuel) and FIRE (the fight: fires / threat /
    // crew), plus a small WIND chamber. Each chamber is one recessed well; the (hidden) compass is parked
    // after so its heading readout stays live without showing. (The FIRE-hero weight is now CSS .pod.fire.)
    this.spine.append(
      makeGroup([this.airframePod, this.fuelPod]),
      makeGroup([this.firesPod, this.threatPod, this.crewPod]),
      makeGroup([this.windPod], 'wind'), // tagged so the narrowest phones can drop it (CSS) and keep one row
    );
    this.spine.append(this.compassPod.cell);
    setPodHidden(this.fuelPod, true); // hidden until a mission supplies fuel
    setPodHidden(this.threatPod, true); // hidden until there are structures to defend
    setPodHidden(this.crewPod, true); // hidden until a crew-transport mission supplies a count
    setPodHidden(this.compassPod, true); // #10 density: numeric heading is redundant with the heading-up radar — parked hidden (flip to false to restore)
    leftCol.appendChild(this.spine);

    // Caution annunciator — a persistent amber heads-up directly under the strip. Hidden until raised
    // (setCaution); it pops with its full message, then minimizes to a ⚠ chip that stays put. The ⚠ glyph
    // is always present; the message text collapses out under the `mini` class (CSS).
    this.caution = el('div', {});
    this.caution.className = 'caution';
    const cautionIc = el('span', {}, '⚠');
    cautionIc.className = 'caution-ic';
    this.cautionTx = el('div', {});
    this.cautionTx.className = 'caution-tx';
    this.caution.append(cautionIc, this.cautionTx);
    leftCol.appendChild(this.caution);

    // Objective checklist / Living-Province DISPATCH readout (same panel; populated each frame). Frosted +
    // bounded to the left column by CSS (`.dispatch`); shown via the `show` class (no inline display flip).
    this.objPanel = el('div', {});
    this.objPanel.className = 'dispatch';
    leftCol.appendChild(this.objPanel);

    // Crew board/disembark bar (delivery/evac missions): a labelled progress fill that appears while
    // the heli is set down on a zone and the crew climb in / step off. It sits under the objective
    // list, grouped with the rest of the mission readouts; hidden until a zone is being worked.
    this.crewBar = el('div', {});
    this.crewBar.className = 'crew-bar';
    this.crewBarLabel = el('div', {
      fontSize: FS.label,
      fontWeight: FW.bold,
      letterSpacing: '1.5px',
      color: UI.accent,
      marginBottom: '6px',
    }, 'CREW BOARDING');
    const crewTrack = el('div', {
      position: 'relative',
      height: '6px',
      borderRadius: R.pill,
      background: UI.track,
      overflow: 'hidden',
    });
    this.crewBarFill = el('div', {
      position: 'absolute',
      inset: '0',
      borderRadius: R.pill,
      background: UI.accent,
      transformOrigin: 'left center',
      transform: 'scaleX(0)',
      transition: 'transform 0.12s linear, background-color 0.2s ease',
    });
    crewTrack.appendChild(this.crewBarFill);
    this.crewBar.append(this.crewBarLabel, crewTrack);
    leftCol.appendChild(this.crewBar);

    // (leftCol is placed into the grid below, once the comms + radar columns are built.)

    // --- Fighter-jet scrolling tapes flanking the heli: airspeed LEFT, altitude RIGHT. Transparent
    // canvases — thin glowing ladders over the world. Their left/right placement + scale are CSS now
    // (`.tape.spd` / `.tape.alt` + the --tape-* vars); the canvases keep their crisp DPR backing store. ---
    const spd = makeCanvas(TAPE_W, TAPE_H, {});
    spd.canvas.className = 'tape spd';
    this.spdCtx = spd.ctx;
    this.root.appendChild(spd.canvas);

    const alt = makeCanvas(TAPE_W, TAPE_H, {});
    alt.canvas.className = 'tape alt';
    this.altCtx = alt.ctx;
    this.root.appendChild(alt.canvas);

    // --- Comms / advisory pill (hud/MessageBar.ts) into the grid's CENTRE column. Heading lives in the
    // strip's compass cell, so the old scrolling heading tape is retired. ---
    this.messages = new MessageBar();
    commsCol.appendChild(this.messages.root);

    // --- Radar into the grid's RIGHT column — its own module owns the canvas + interaction. The help "?"
    // tucks directly under the map (mountUnderRadar → hudRight), reflowing down when the radar expands. ---
    this.radar = new Radar(minimap, labels ?? { communities: [], lakes: [] });
    this.hudRight.appendChild(this.radar.canvas);

    // Assemble the top-band grid (grid-template-areas place the columns; source order is irrelevant).
    top.append(leftCol, commsCol, this.hudRight);
    this.root.appendChild(top);

    // Mission end screen + cold-start dial — fire-once sub-systems mounted into the root on demand.
    this.endScreen = new EndScreen(this.root, end, this.pilotName);
    this.engine = new EngineStart(this.root);
    this.coach = new CoachOverlay(this.root);

    parent.appendChild(this.root);

    // Size + place everything for the current breakpoint, and re-apply on every
    // resize / orientation change (event-driven — never per frame).
    this.unsubLayout = onLayout((s) => this.applyLayout(s));
  }

  /** The radar's canvas backing store is the ONE HUD element that still needs JS pixels (a canvas can't
   *  size from CSS, and the radar's pinch/zoom math reads its size). Everything else — strip cells, tapes,
   *  the comms/dispatch placement — is the `.bmf-hud` stylesheet's job now, reflowing on resize for free.
   *  So this just re-sizes the radar for the active breakpoint on each resize / orientation change. */
  private applyLayout(s: LayoutState): void {
    const { base, max } = radarSize(s);
    this.radar.setLayout(base, max);
  }

  /** C5: set the blinding-smoke veil opacity (0 clear → 1 fully socked in). */
  setSmoke(density: number): void {
    this.smoke.style.opacity = `${clamp01(density)}`;
  }

  /** Mount an extra control (the help "?" button) into the radar column, directly under the
   *  minimap — so it shares the top-right corner and reflows down when the radar expands. */
  mountUnderRadar(node: HTMLElement): void {
    this.hudRight.appendChild(node);
  }

  update(s: HudState): void {
    // --- Instrument strip: one text write per cell (O(1)); colour flips/glows only when flagged. ---
    // Water now lives in the DROP "bucket" (driven from Game via Input.setBucket / flashBucket), so the
    // strip is just the AIRCRAFT + FIRE chambers: whole-percent gauges, a raw fires count, units for wind.
    const hp = clamp01(s.health ?? 1);
    this.airframePod.num.textContent = `${Math.round(hp * 100)}`;
    setNumWarn(this.airframePod, !!s.healthLow); // critical → red + pulse (sin only runs when low)
    setPodBar(this.airframePod, hp, s.healthLow ? UI.warn : AIRFRAME_OK, !!s.healthLow); // visible HP — drops on a hit
    if (s.fuel !== undefined) {
      setPodHidden(this.fuelPod, false);
      const fuelFrac = clamp01(s.fuel);
      this.fuelPod.num.textContent = `${Math.round(fuelFrac * 100)}`;
      setNumWarn(this.fuelPod, !!s.fuelLow);
      setPodBar(this.fuelPod, fuelFrac, s.fuelLow ? UI.warn : UI.accent, !!s.fuelLow);
    } else {
      setPodHidden(this.fuelPod, true); // sandbox / non-fuel mission → drop the cell entirely
    }
    this.firesPod.num.textContent = `${s.firesLeft}`;
    const firesOut = s.firesLeft === 0;
    this.firesPod.cell.style.opacity = firesOut ? '0.5' : '1'; // "no fires left" reads as resolved
    this.firesPod.num.style.color = firesOut ? UI.dim : UI.text;
    // Threat: only shown when there are structures to defend; turns red + glows when high.
    const hasStructures = s.structures.length > 0;
    setPodHidden(this.threatPod, !hasStructures);
    if (hasStructures) {
      const threat = clamp01(s.threat);
      const threatHot = threat > 0.6;
      const pct = Math.round(threat * 100);
      // Name the threatened community at the critical moment ("Denare Beach 72") so the player knows
      // WHERE to go; just the % otherwise, so the compact pod only widens when it actually matters.
      this.threatPod.num.textContent = threatHot && s.threatName ? `${s.threatName} ${pct}` : `${pct}`;
      this.threatPod.cell.title = s.threatName ?? '';
      this.threatPod.svg.setAttribute('stroke', threatHot ? UI.warn : UI.instrument); // one attribute flip, gated
      this.threatPod.num.style.color = threatHot ? UI.warn : UI.text;
      this.threatPod.cell.style.textShadow = threatHot ? `0 0 8px ${UI.warn}` : 'none';
      setPodBar(this.threatPod, threat, threatHot ? UI.warn : UI.commsAmber, threatHot); // fills toward red as the fire closes in
    }
    // Crew aboard (delivery/evac missions only): an icon + the count in the cabin (0/1), with the
    // base bar reading as a filled/empty seat. The animated BOARDING/DISEMBARKING bar lives below the
    // objective list and is driven from the same snapshot.
    const crew = s.crew;
    setPodHidden(this.crewPod, !crew);
    if (crew) {
      this.crewPod.num.textContent = `${crew.onboard}`;
      const aboard = crew.onboard > 0;
      this.crewPod.num.style.color = aboard ? UI.text : UI.dim;
      setPodBar(this.crewPod, aboard ? 1 : 0, UI.accent, aboard); // full + glowing while a crew rides
    }
    this.renderCrewBar(crew);

    // Compass: numeric heading (replaces the old scrolling tape). Wind: knots, with the icon
    // rotated to the heading-relative gust direction (the radar wind-arrow, folded in here).
    this.compassPod.num.textContent = `${Math.round(headingDeg(s.yaw))}°`;
    this.windPod.num.textContent = `${Math.round(s.windKt)}`;
    const cy = Math.cos(s.yaw);
    const sy = Math.sin(s.yaw);
    const wfwd = Math.cos(s.windDir) * cy - Math.sin(s.windDir) * sy; // gust along the nose
    const wrgt = Math.cos(s.windDir) * sy + Math.sin(s.windDir) * cy; // gust along the right
    this.windPod.svg.style.transform = `rotate(${Math.atan2(-wfwd, wrgt)}rad)`; // screen dir = (rgt, −fwd)
    // One capsule-edge warn glow if anything is critical (single write on the whole instrument).
    const anyLow = !!s.healthLow || !!s.fuelLow || (hasStructures && clamp01(s.threat) > 0.6);
    this.spine.style.boxShadow = anyLow ? `0 0 12px ${UI.warn}, ${UI.shadow}` : UI.shadow;

    this.messages.setHint(s.hint);
    // Persistent caution: bucket jettisoned → no scoop/drop until you set down at a base for a fresh one.
    this.setCaution(s.bucketDetached ? 'No bucket. Land at any base to rig a fresh one.' : null);

    // The open-world modes (Open Skies / Living Province) swap the objective checklist for the LIVE
    // readout — pilots in the sky + the running points total (animated). The campaign/sandbox keeps the
    // objective checklist. (This replaced the old province "DISPATCH" shift panel.)
    if (s.live) this.renderLive(s.live);
    else this.renderObjectives(s.objectives);

    // Jet scrolling tapes: airspeed in knots (left), altitude in feet (right) + VSI.
    this.drawTape(this.spdCtx, {
      side: 'right', // value box on the RIGHT (inner) edge, toward the heli
      name: 'KT',
      value: s.speed,
      tickEvery: 10,
      labelEvery: 20,
      pxPerTick: 22,
    });
    this.drawTape(this.altCtx, {
      side: 'left', // value box on the LEFT (inner) edge, toward the heli
      name: 'FT',
      value: s.altFt, // MSL on the tape — rises whenever you climb (no dip over hills)
      tickEvery: 100,
      labelEvery: 500,
      pxPerTick: 17,
      warn: s.raFt < LOW_AGL_FT, // low warning keys off true height above the surface (reddens the chip)
    });

    this.radar.draw(s);

    if ((s.won || s.lost) && !this.endScreen.shown) this.endScreen.show(s);
  }

  /** Rebuild the objective checklist only when its visible content changes. */
  private renderObjectives(items?: readonly TrackerItem[]): void {
    if (!items || items.length === 0) {
      if (this.objSig !== '') {
        this.objPanel.classList.remove('show');
        this.objSig = '';
      }
      return;
    }
    const sig = items
      .map((t) => `${t.label}|${t.current ?? ''}/${t.target ?? ''}|${t.timeLeft !== undefined ? Math.ceil(t.timeLeft) : ''}|${t.done}|${t.failed}`)
      .join(';');
    if (sig === this.objSig) return;
    this.objSig = sig;
    this.liveBuilt = false; // if the panel ever flips back from the live readout, rebuild it fresh next time

    this.objPanel.classList.add('show');
    this.objPanel.replaceChildren(label('OBJECTIVES'));
    const next = new Map<string, { current: number; done: boolean }>();
    for (const t of items) {
      const cur = t.current ?? 0;
      const prev = this.objPrev.get(t.label);
      // "Advanced" = a count ticked up, or the goal just latched done — the moment worth flagging so a
      // sub-goal completion doesn't pass silently (the gather's #1 direction gap). Not on first paint.
      const advanced = !!prev && !t.failed && (cur > prev.current || (t.done && !prev.done));
      next.set(t.label, { current: cur, done: t.done });
      const row = el('div', {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        marginTop: '5px',
        fontSize: FS.sm,
        borderRadius: R.sm,
      });
      const mark = t.failed ? '✕' : t.done ? '✓' : t.kind === 'constraint' ? '◆' : '○';
      const col = t.failed ? UI.warn : t.done ? UI.accent : UI.textCool;
      row.appendChild(el('div', { color: col, fontWeight: FW.bold, width: '12px' }, mark));
      row.appendChild(el('div', { color: col, flex: '1' }, t.label));
      let val = '';
      if (t.done && t.completedAt !== undefined) val = `✓ ${fmtTime(t.completedAt)}`; // latched: stamp the time
      else if (t.timeLeft !== undefined) val = fmtTime(t.timeLeft);
      else if (t.target !== undefined) val = `${t.current ?? 0}/${t.target}`;
      if (val) row.appendChild(el('div', { color: UI.dim, fontWeight: FW.semibold }, val));
      this.objPanel.appendChild(row);
      // Progress flash — an accent wash that snaps in and bleeds out (DESIGN.md impact-flash motion),
      // gated on reduced-motion. Purely visual; no layout shift (background only).
      if (advanced && !prefersReducedMotion()) {
        row.style.transition = 'none';
        row.style.backgroundColor = t.done ? UI.accentFill : UI.accentFlash;
        requestAnimationFrame(() => {
          row.style.transition = 'background-color 0.6s ease';
          row.style.backgroundColor = 'transparent';
        });
      }
    }
    this.objPrev = next;
  }

  /** Open-world LIVE readout (Open Skies / Living Province) — the panel that replaced the province
   *  "DISPATCH" shift card. The running POINTS total is the hero, and it keeps the SAME warm brand-currency
   *  treatment used everywhere else (the menus/Hangar wallet chip): the `spark` glyph + an ember number +
   *  a lowercase "pts". It eases up to the latest value and flashes the warm brand glow on every gain, so
   *  banking points reads the same here as on the site. Below it, how many PILOTS are in the sky right now —
   *  that stays cool/cyan (a live instrument value, not the points currency). Built once (refs kept), then
   *  updated in place each frame — O(1), no DOM churn. */
  private renderLive(live: NonNullable<HudState['live']>): void {
    if (!this.liveBuilt) {
      this.liveBuilt = true;
      this.objSig = ''; // a later flip back to the objective checklist must rebuild from scratch

      this.objPanel.classList.add('show');
      // Points hero — the WARM brand currency: spark glyph (ember) + the running total (menu/ember, bold) +
      // a lowercase "pts", matching the menus/Hangar wallet chip exactly so points read the same everywhere.
      const ptsRow = el('div', { display: 'flex', alignItems: 'baseline', gap: '6px' });
      const spark = el('span', { display: 'flex', alignSelf: 'center', color: UI.emberHi });
      spark.innerHTML = ic('spark');
      sizeIcon(spark, 18);
      this.livePointsNum = el('div', { fontSize: FS.display, fontWeight: FW.heavy, color: UI.menu, lineHeight: '1' }, '0');
      this.livePointsNum.style.setProperty('font-variant-numeric', 'tabular-nums');
      ptsRow.append(spark, this.livePointsNum, el('div', { fontSize: FS.meta, fontWeight: FW.semibold, color: UI.textCool }, 'pts'));

      // Pilots — the live count, with the Lucide "users" glyph (cyan = a live/interactive instrument value).
      const pilotsRow = el('div', { display: 'flex', alignItems: 'center', gap: '7px', marginTop: '7px' });
      const users = el('span', { display: 'flex', alignItems: 'center', color: UI.accent });
      users.innerHTML = ic('users');
      sizeIcon(users, 14);
      this.livePilotsNum = el('div', { color: UI.accent, fontWeight: FW.bold, fontSize: FS.sm }, '1');
      pilotsRow.append(
        users,
        this.livePilotsNum,
        el('div', { color: UI.textCool, fontSize: FS.label, fontWeight: FW.semibold, letterSpacing: '1.5px' }, 'PILOTS'),
      );

      this.objPanel.replaceChildren(ptsRow, pilotsRow);

      // Seed the counters so the first paint doesn't streak up from zero or flash on entry.
      this.liveShownPoints = live.points;
      this.liveTargetPoints = live.points;
      this.livePrevPoints = live.points;
      this.liveShownText = '';
      this.livePrevPilots = -1;
    }

    // Pilots: one text write, only when the count changes.
    if (live.pilots !== this.livePrevPilots) {
      this.livePrevPilots = live.pilots;
      this.livePilotsNum!.textContent = `${live.pilots}`;
    }

    // Points: flash the warm brand glow the instant the total ticks up, then ease the SHOWN value toward it
    // so the number visibly counts up (snap for reduced-motion). The flash is event-driven; the ease is
    // O(1)/frame and the text only writes when the rounded value actually changes.
    const reduce = prefersReducedMotion();
    this.liveTargetPoints = live.points;
    if (live.points > this.livePrevPoints && !reduce) {
      this.livePointsNum!.style.textShadow = UI.emberGlow; // warm brand glow — the "+N just banked" pulse
      window.clearTimeout(this.livePointsFlashT);
      this.livePointsFlashT = window.setTimeout(() => {
        this.livePointsNum!.style.textShadow = 'none';
        this.livePointsFlashT = 0;
      }, 480);
    }
    this.livePrevPoints = live.points;
    if (reduce) {
      this.liveShownPoints = this.liveTargetPoints;
    } else {
      const d = this.liveTargetPoints - this.liveShownPoints;
      this.liveShownPoints = Math.abs(d) < 1 ? this.liveTargetPoints : this.liveShownPoints + d * 0.18;
    }
    const txt = Math.round(this.liveShownPoints).toLocaleString('en-US');
    if (txt !== this.liveShownText) {
      this.liveShownText = txt;
      this.livePointsNum!.textContent = txt;
    }
  }

  /**
   * Drive the crew board/disembark bar: show it only while a zone is being worked, set the label
   * (CREW BOARDING climbing in / CREW DISEMBARKING stepping off) + colour, and scale the fill to the
   * dwell. Visibility is the `show` class; the grid reflows the comms bar below it for free.
   */
  private renderCrewBar(crew?: HudState['crew']): void {
    const working = !!crew && crew.mode !== null;
    if (working !== this.crewBarShown) {
      this.crewBarShown = working;
      this.crewBar.classList.toggle('show', working);
    }
    if (!working || !crew) return;
    const boarding = crew.mode === 'boarding';
    const col = boarding ? UI.accent : UI.ok; // cyan picking up / green setting down or deploying (#8: the shared success token)
    this.crewBarLabel.textContent = boarding
      ? 'CREW BOARDING'
      : crew.mode === 'deploying'
        ? 'CREW DEPLOYING'
        : 'CREW DISEMBARKING';
    this.crewBarLabel.style.color = col;
    this.crewBarFill.style.background = col;
    this.crewBarFill.style.transform = `scaleX(${clamp01(crew.progress)})`;
  }

  /**
   * Pulse the red impact vignette over the whole view — the unmissable "you just took a hit" cue for
   * a hard-landing airframe dent (the quiet HEALTH number ticking down went unnoticed). `severity` 0..1
   * scales the flash strength; a fast snap in, slow fade out. Event-driven (one call per impact), so
   * it costs nothing while flying clean. The HEALTH bar visibly drops alongside it (animated scaleX).
   */
  flashDamage(severity: number): void {
    const peak = 0.32 + 0.46 * clamp01(severity);
    if (this.hitFlashTimer) window.clearTimeout(this.hitFlashTimer);
    this.hitFlash.style.transition = 'opacity 0.05s ease-out'; // snap to peak…
    this.hitFlash.style.opacity = `${peak}`;
    this.hitFlashTimer = window.setTimeout(() => {
      this.hitFlash.style.transition = 'opacity 0.55s ease'; // …then bleed back out
      this.hitFlash.style.opacity = '0';
      this.hitFlashTimer = 0;
    }, 60);
  }

  /**
   * Show (or clear) the centred hazard caption — the proper, aviation-correct warning before a crash:
   * "SINK RATE", "PULL UP", "TERRAIN — PULL UP". Game computes the current hazard every frame and
   * passes the caption (or null to clear); idempotent on the text so a held condition pulses steadily
   * instead of re-triggering. Reduced-motion users get a steady caption (no flash).
   */
  setAlert(text: string | null): void {
    if (text === this.alertText) return; // unchanged since last frame — leave it pulsing
    this.alertText = text;
    if (!text) {
      this.alertEl.style.display = 'none';
      this.alertEl.style.animation = 'none';
      return;
    }
    this.alertEl.textContent = text;
    this.alertEl.style.display = 'block';
    this.alertEl.style.animation = prefersReducedMotion() ? 'none' : 'bmf-alert-pulse 0.7s ease-in-out infinite';
  }

  /**
   * Raise or clear the persistent caution annunciator. Pass a message to RAISE it: it pops EXPANDED
   * (icon + text), then auto-minimizes to a ⚠ chip after `CAUTION_EXPAND_MS` and STAYS until cleared.
   * Pass `null` to clear it once the condition is resolved. Idempotent on the text — safe every frame.
   * Currently the detached-bucket cue (Game drives it from `bucketDetached`).
   */
  setCaution(text: string | null): void {
    if (text === this.cautionText) return; // unchanged since last frame — leave it as-is (expanded or mini)
    this.cautionText = text;
    window.clearTimeout(this.cautionMiniT);
    if (!text) {
      this.caution.classList.remove('show', 'mini');
      return;
    }
    this.cautionTx.textContent = text;
    this.caution.classList.remove('mini'); // pop EXPANDED…
    this.caution.classList.add('show');
    this.cautionMiniT = window.setTimeout(() => {
      this.caution.classList.add('mini'); // …then minimize to the ⚠ chip (stays until cleared)
    }, CAUTION_EXPAND_MS);
  }

  // --- Radio comms (the mission "experience" layer) --------------------------
  // (The pre-flight DISPATCH SLIP moved to ui/Briefing.ts so it can paint before the World/HUD exist;
  // `personalize` is now the shared helper in hud/common.ts, used by both the comms below and the slip.)

  /**
   * Post a radio line. It now routes through the single top-center MessageBar (tagged DISPATCH / CREW /
   * WARNING, colored + edge-lit by urgency, queued FIFO with `alert` preempting). The bar shows one line
   * at a time and fills the quiet between them with flying tips — so dispatch + tips share one surface.
   */
  pushComms(speaker: CommsSpeaker, text: string, urgency: CommsUrgency): void {
    this.messages.push(speaker, personalize(text, this.pilotName), urgency);
  }

  /**
   * Capture the mission context for the end-screen + Share text (name / place / index + prior best).
   * This used to live inside `showBriefing`; the briefing card itself now paints from `ui/Briefing.ts`
   * BEFORE the Game/HUD exist (so the UI is instant), so Game calls this directly in its constructor.
   */
  setMissionContext(def: MissionDef): void {
    this.endScreen.setContext(def);
  }

  // --- Cold engine start (hold-to-spool dial) — delegated to the engineStart module --------

  /** True while the START dial is being held (pointer drag or Space/Enter). Game reads this each
   *  frame to spool the rotor RPM up; releasing lets it bleed back down. */
  get engineHold(): boolean {
    return this.engine.hold;
  }

  /** Show the cold-start dial (Game surfaces it once the briefing is dismissed). */
  showEngineStart(): void {
    this.engine.show();
  }

  /** Update the dial to the live RPM (0..1) and held state — ring fill, % readout, hold glow. */
  setEngineStart(rpm: number, holding: boolean): void {
    this.engine.set(rpm, holding);
  }

  /** Tear down the dial (rotors are up). */
  hideEngineStart(): void {
    this.engine.hide();
  }

  // --- Interactive first-flight coach — delegated to the coach overlay (driven by Game) -----------

  /** Surface the coach card (Game calls this once when the tutorial goes live). */
  showCoach(opts: { onSkip: () => void }): void {
    this.coach.show(opts);
  }

  /** Render the current coach step. */
  setCoach(prompt: CoachPrompt): void {
    this.coach.set(prompt);
  }

  /** Swap to the completion sign-off, then fade the coach out. */
  completeCoach(): void {
    this.coach.complete();
  }

  /** Fold the coach away (mission loss / skip). */
  hideCoach(): void {
    this.coach.hide();
  }

  /** C5: hand the radar the live fire field (FireSystem.fieldView) for the burnt-area overlay. */
  setBurnField(view: FireFieldView): void {
    this.radar.setBurnField(view);
  }

  /**
   * Teardown for an in-place mission switch: clear the tracked fade timers, tear down the engine-start
   * dial's window key listeners (engine.hide() is idempotent) if it's still up, drop the layout
   * subscription, and remove the HUD root — which detaches every pointer listener on the radar / pods /
   * buttons inside it. (Untracked one-shot timers — briefing/comms/dial fades — only touch elements
   * under the root, so they're harmless once it's gone.) Idempotent.
   */
  dispose(): void {
    this.messages.dispose(); // clears the bar's queue + tip/hint timers
    window.clearTimeout(this.hitFlashTimer);
    window.clearTimeout(this.cautionMiniT);
    window.clearTimeout(this.livePointsFlashT);
    this.engine.hide(); // detaches the dial's window key listeners if still up
    this.coach.hide(); // fold the coach overlay (clears its hide timer); idempotent
    this.unsubLayout?.();
    this.unsubLayout = null;
    this.root.remove();
  }

  // --- Tape builder ---------------------------------------------------------

  /** A fighter-jet scrolling tape. A vertical ladder of ticks/labels scrolls so the
   *  live value stays centered (the "rolling number" feel), with a boxed readout +
   *  pointer on the inner edge aimed at the heli. `side` is the inner (box) edge. */
  private drawTape(
    ctx: CanvasRenderingContext2D,
    o: {
      side: 'left' | 'right';
      name: string;
      value: number;
      tickEvery: number;
      labelEvery: number;
      pxPerTick: number;
      warn?: boolean; // low-altitude caution → reddens the chip + numerals (keys off true AGL)
    },
  ): void {
    const w = TAPE_W;
    const h = TAPE_H;
    const cy = h / 2;
    const pxPerUnit = o.pxPerTick / o.tickEvery;
    const accent = o.warn ? UI.warn : UI.accent;
    const accentRgb = o.warn ? '255,93,77' : '103,232,255'; // UI.warn / UI.accent rgb — for alpha-faded canvas strokes
    const inner = o.side === 'right' ? w : 0; // tape edge facing the heli (screen centre)
    const baseX = o.side === 'right' ? w - 7 : 7; // ladder spine just inside the inner edge
    const dir = o.side === 'right' ? -1 : 1; // ticks grow outward, away from the heli
    ctx.clearRect(0, 0, w, h);

    // 1) Recessed tape band — a soft dark well behind the ladder, faded top & bottom so the ladder
    //    floats into the scene (the same recessed-bezel language as the instrument strip's chambers).
    const bandW = 42;
    const bandX = o.side === 'right' ? w - bandW : 0;
    const band = ctx.createLinearGradient(0, 0, 0, h);
    band.addColorStop(0, 'rgba(8,13,18,0)');
    band.addColorStop(0.5, 'rgba(8,13,18,0.46)');
    band.addColorStop(1, 'rgba(8,13,18,0)');
    ctx.fillStyle = band;
    ctx.fillRect(bandX, 0, bandW, h);

    // 2) Inner "live rail" — a thin cyan accent line on the edge facing the heli, faded top/bottom.
    //    It brackets the flight view and ties both tapes to the aircraft (cyan = live instrument).
    const rail = ctx.createLinearGradient(0, 0, 0, h);
    rail.addColorStop(0, `rgba(${accentRgb},0)`);
    rail.addColorStop(0.5, `rgba(${accentRgb},0.42)`);
    rail.addColorStop(1, `rgba(${accentRgb},0)`);
    ctx.strokeStyle = rail;
    ctx.lineWidth = 1;
    const railX = inner + (o.side === 'right' ? -0.5 : 0.5);
    ctx.beginPath();
    ctx.moveTo(railX, 8);
    ctx.lineTo(railX, h - 8);
    ctx.stroke();

    // 3) Unit caption at the top — small, dim, the same uppercase voice as the strip labels.
    ctx.textBaseline = 'middle';
    ctx.textAlign = o.side === 'right' ? 'right' : 'left';
    ctx.fillStyle = UI.dim;
    ctx.font = '700 9px ' + MONO;
    ctx.fillText(o.name, baseX, 10);

    // 4) Scrolling ladder: faint minor ticks, longer/brighter major ticks + a numeral. The rungs
    //    nearest centre are skipped so they never collide with the value chip.
    const topVal = o.value + cy / pxPerUnit;
    const botVal = o.value - cy / pxPerUnit;
    const first = Math.ceil(botVal / o.tickEvery) * o.tickEvery;
    ctx.lineWidth = 1;
    for (let t = first; t <= topVal; t += o.tickEvery) {
      if (t < 0) continue;
      const y = cy + (o.value - t) * pxPerUnit;
      if (y < 18 || y > h - 8) continue;
      if (Math.abs(y - cy) < 14) continue; // keep the rungs clear of the centre value chip
      const fade = 1 - Math.min(1, Math.abs(y - cy) / (cy + 8)); // dim toward the edges
      const major = Math.round(t) % o.labelEvery === 0;
      ctx.strokeStyle = `rgba(255,255,255,${(major ? 0.5 : 0.2) * (0.35 + 0.65 * fade)})`;
      ctx.beginPath();
      ctx.moveTo(baseX, y);
      ctx.lineTo(baseX + dir * (major ? 11 : 5), y);
      ctx.stroke();
      if (major) {
        ctx.fillStyle = `rgba(226,244,255,${0.45 + 0.5 * fade})`;
        ctx.font = '500 11px ' + MONO;
        ctx.fillText(`${t}`, baseX + dir * 15, y);
      }
    }

    // 5) Live value chip — a clean rounded readout shaped like a tag: rounded outer corners, a pointer
    //    on the inner edge aimed at the heli. Recessed fill + a cyan hairline + a soft glow.
    const boxW = 46;
    const boxH = 26;
    const by = cy - boxH / 2;
    const r = 5;
    const pb = o.side === 'right' ? w - 7 : 7; // pointer base x (just inside the inner edge)
    const ox = o.side === 'right' ? w - boxW : boxW; // outer edge x (the rounded corners live here)
    ctx.beginPath();
    if (o.side === 'right') {
      ctx.moveTo(ox + r, by);
      ctx.lineTo(pb, by);
      ctx.lineTo(inner, cy); // tip toward the heli
      ctx.lineTo(pb, by + boxH);
      ctx.lineTo(ox + r, by + boxH);
      ctx.arcTo(ox, by + boxH, ox, by + boxH - r, r);
      ctx.lineTo(ox, by + r);
      ctx.arcTo(ox, by, ox + r, by, r);
    } else {
      ctx.moveTo(inner, cy); // tip toward the heli
      ctx.lineTo(pb, by);
      ctx.lineTo(ox - r, by);
      ctx.arcTo(ox, by, ox, by + r, r);
      ctx.lineTo(ox, by + boxH - r);
      ctx.arcTo(ox, by + boxH, ox - r, by + boxH, r);
      ctx.lineTo(pb, by + boxH);
    }
    ctx.closePath();
    ctx.fillStyle = UI.field; // recessed readout fill (the form-field / sunken-well token)
    ctx.fill();
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1.25;
    ctx.shadowColor = accent;
    ctx.shadowBlur = 5;
    ctx.stroke();
    ctx.shadowBlur = 0;

    // The number — bold, centred in the chip body (reddened when low; never hidden — you land on it).
    ctx.fillStyle = o.warn ? UI.warn : '#fff';
    ctx.font = '700 16px ' + MONO;
    ctx.textAlign = 'center';
    ctx.fillText(`${Math.round(o.value)}`, (ox + pb) / 2, cy + 1);
    // (The VSI ft/min + "R" radar-altitude readouts were removed — the altitude tape is now just the
    //  clean ladder + value chip, symmetric with the speed tape. The low-altitude red chip carries the
    //  caution that the RA line used to spell out.)
  }
}

/** yaw (rad) → compass heading degrees [0,360). North = −Z, East = +X. */
function headingDeg(yaw: number): number {
  const deg = (Math.atan2(Math.cos(yaw), Math.sin(yaw)) * 180) / Math.PI;
  return (deg + 360) % 360;
}

// --- DOM helpers (el / frosted / makeCanvas / clamp01 live in ui/theme.ts) --

/** A small uppercase tracked caption. */
function label(text: string): HTMLDivElement {
  return el('div', { fontSize: FS.label, fontWeight: FW.semibold, letterSpacing: '2px', color: UI.dim }, text);
}

/** Size an inline `ic()` glyph (it ships no width/height of its own) to a square px box. Colour comes from
 *  `currentColor`, so set the host's `color` to tint the stroke. */
function sizeIcon(host: HTMLElement, px: number): void {
  const svg = host.querySelector('svg');
  if (svg) {
    svg.setAttribute('width', `${px}`);
    svg.setAttribute('height', `${px}`);
  }
}

// --- Instrument-strip cells -------------------------------------------------
// Compact icon + NUMBER cells inside the single frosted capsule. Stroked 24x24
// glyphs (same idiom as the eye icon); icon size + number font are set per breakpoint.
// (The water droplet glyph retired with the water pod — water now lives in the DROP bucket.)
const HEALTH_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="#eaf6ff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M12 3 19 6V11c0 5-3.4 8.3-7 10-3.6-1.7-7-5-7-10V6Z"/><path d="M9 12 11 14 15 9.5"/></svg>';
const FUEL_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="#eaf6ff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
  '<rect x="5" y="4" width="9" height="16" rx="1.5"/><path d="M5 9H14"/><path d="M14 8h3a2 2 0 0 1 2 2v5a1.5 1.5 0 0 0 2 1.5"/><path d="M19 7V5"/></svg>';
const FIRES_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="#ff7a45" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M12 3c1 4 5 5 5 10a5 5 0 0 1-10 0c0-3 2-3.5 2.5-6 1.3 1 2.5 1 2.5-4Z"/></svg>';
const THREAT_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="#eaf6ff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M12 4 21 19H3Z"/><path d="M12 10V14"/><circle cx="12" cy="17" r="0.9" fill="currentColor" stroke="none"/></svg>';
const COMPASS_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="#eaf6ff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
  '<circle cx="12" cy="12" r="9"/><path d="M12 5 14 12 12 19 10 12Z" fill="#67e8ff" stroke="#67e8ff"/></svg>';
// Arrow points local +X (right); the cell rotates it to the heading-relative gust each frame
// (set every frame, so no CSS transition — that would only lag + spin on the ±180° wrap).
const WIND_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="#67e8ff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M3 12H17"/><path d="M13 7 18 12 13 17"/></svg>';
// Crew aboard — a helmeted fire-crew figure (head + shoulders), the cabin-occupancy glyph.
const CREW_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="#eaf6ff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
  '<circle cx="12" cy="8" r="3.4"/><path d="M5.5 20a6.5 6.5 0 0 1 13 0Z"/></svg>';

interface Pod {
  cell: HTMLDivElement; // the icon + number row (hidden/pulsed as a unit)
  svg: SVGElement; // stroked glyph (recoloured / rotated per state)
  num: HTMLDivElement; // the live numeric readout
  barFill?: HTMLDivElement; // optional fill bar (resource gauges only) — scaleX 0..1, animated
}

/** Build one strip cell: a stroked icon + a bold numeric readout (the `.pod` class supplies the size /
 *  padding / left-hairline — all from the --pod clamp in hud/styles.ts). `withBar` adds the thin animated
 *  base fill bar for a 0..1 resource gauge (airframe / fuel / threat / crew). `extraClass` tags a pod for
 *  CSS (e.g. `'fire'` → the mission-HERO step-up). */
function makePod(iconSvg: string, withBar = false, extraClass?: string): Pod {
  const cell = el('div', {});
  cell.className = extraClass ? `pod ${extraClass}` : 'pod';
  const box = el('div', {});
  box.className = 'icon';
  box.innerHTML = iconSvg;
  const svg = box.querySelector('svg') as SVGElement;
  const num = el('div', {});
  num.className = 'num';
  cell.append(box, num);

  let barFill: HTMLDivElement | undefined;
  if (withBar) {
    // The thin progress track pinned across the cell's base (CSS `.bar`); the `.fill` scales on the X axis
    // (GPU transform, no layout). Driven by setPodBar.
    const track = el('div', {});
    track.className = 'bar';
    barFill = el('div', {});
    barFill.className = 'fill';
    track.appendChild(barFill);
    cell.appendChild(track);
  }
  return { cell, svg, num, barFill };
}

/** Wrap a run of pods into one bezelled instrument CHAMBER (`.chamber` — a recessed well grouping the
 *  gauges AIRCRAFT / FIRE / WIND). The leading pod's left hairline is dropped by CSS (`.chamber > .pod:
 *  first-child`); `extraClass` tags a chamber (e.g. `'wind'` → droppable on the narrowest phones). */
function makeGroup(pods: Pod[], extraClass?: string): HTMLDivElement {
  const group = el('div', {});
  group.className = extraClass ? `chamber ${extraClass}` : 'chamber';
  for (const p of pods) group.appendChild(p.cell);
  return group;
}

/** Drive a gauge pod's base fill bar: `frac` 0..1 (scaleX), `color`, and an optional glow that
 *  draws the eye (used while actively scooping, or when a gauge is in its warning band). No-op on
 *  pods built without a bar. */
function setPodBar(p: Pod, frac: number, color: string, glow = false): void {
  if (!p.barFill) return;
  p.barFill.style.transform = `scaleX(${clamp01(frac)})`;
  p.barFill.style.background = color;
  p.barFill.style.boxShadow = glow ? `0 0 7px ${color}` : 'none';
}

/** The ☰ menu control, styled as the first cell of the strip (no left divider — it heads
 *  the row). Reloads back to the mission-select, same path as the end-banner MENU. */
function makeMenuCell(onMenu: () => void): HTMLDivElement {
  const cell = el('div', {});
  cell.className = 'menu-cell'; // size + hover are CSS (.menu-cell)
  cell.textContent = '☰';
  cell.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    onMenu();
  });
  return cell;
}

/** Drive a gauge cell's critical state: red readout + a gentle pulse while low
 *  (the sin only runs when low, so it's free at full health). */
function setNumWarn(p: Pod, low: boolean): void {
  p.num.style.color = low ? UI.warn : UI.text;
  p.cell.style.opacity = low ? `${0.6 + 0.4 * Math.abs(Math.sin(Date.now() / 200))}` : '1';
}

/** Collapse a cell entirely (hides FUEL / THREAT / CREW / COMPASS when a mission doesn't use them). Uses
 *  the `hidden` attribute — CSS `.pod[hidden]{display:none}` wins, and showing falls back to the class's
 *  `display:flex` instead of being pinned by an inline value. */
function setPodHidden(p: Pod, hidden: boolean): void {
  p.cell.hidden = hidden;
}

/** Collapsed + expanded radar sizes for the active breakpoint — the radar canvas is the ONE HUD element
 *  still sized in JS (a canvas needs real backing-store pixels and the pinch/zoom math reads them; see
 *  HUD.applyLayout / Radar.setLayout). Mirrors the old layout-set radarBase / radarMaxFrac values. */
function radarSize(s: LayoutState): { base: number; max: number } {
  const base = s.breakpoint === 'desktop' ? 140 : s.breakpoint === 'tablet' ? 128 : 112;
  const frac = s.breakpoint === 'desktop' ? 0.5 : s.breakpoint === 'tablet' ? 0.66 : 0.82;
  const max = Math.max(base + 40, Math.round(Math.min(frac * Math.min(s.w, s.h), 320)));
  return { base, max };
}
