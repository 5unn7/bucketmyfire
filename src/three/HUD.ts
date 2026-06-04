/**
 * Lightweight DOM heads-up display. Three.js renders the world; the HUD is just
 * absolutely-positioned HTML (+ two small 2D canvases) over the canvas — cheaper
 * and crisper than drawing text in WebGL, and it scales with the viewport for
 * free. Pure presentation: it reads a state snapshot handed in each frame and
 * never touches the scene.
 *
 * Visual language: a modern EV-cluster / "glass cockpit" look — frosted-glass
 * surfaces (backdrop blur), hairline strokes, one cyan accent, light type.
 *
 * Pilot instruments:
 *   - WATER + FIRES        (top corners — mission state, frosted chips)
 *   - ALTITUDE tape (AGL)  (left edge) with low-altitude warning + VSI
 *   - AIRSPEED tape        (right edge)
 *   - HEADING tape         (top center — scrolling compass)
 *   - RADAR                (bottom center — ego-centric, heading-up; the heli is
 *                           fixed pointing up, the world rotates; lakes blue,
 *                           fires red, out-of-range fires pinned to the rim)
 */

import type { TrackerItem, CommsSpeaker, CommsUrgency, MissionDef, ScoreBreakdown, ScoreGrade } from './missions/types';
import type { FireFieldView } from './sim/FireSystem';
import { UI, FS, FW, R, el, frosted, makeCanvas, clamp01, anchor, setBlur, scrim, prefersReducedMotion } from './ui/theme';
import { onLayout, type LayoutState } from './ui/layout';

export interface HudState {
  water: number;
  waterMax: number;
  scooping?: boolean; // bucket is actively filling — the water fill-bar glows so "keep dipping" reads
  health?: number; // 0..1 airframe health (always supplied; drives the HEALTH gauge)
  healthLow?: boolean; // gauge flashes red below the warn line
  firesLeft: number;
  hint: string | null;
  won: boolean;
  altFt: number; // barometric altitude (MSL, above sea-level datum) in FEET — the tape value
  raFt: number; // radar altitude (above the surface directly below) in FEET — low-flight / landing
  speed: number; // airspeed in KNOTS
  vertSpeed: number; // vertical speed in FT/MIN (+ climb, − descend)
  heliX: number;
  heliZ: number;
  yaw: number; // heading (rad) — drives heading tape + radar
  windKt: number; // wind speed in knots
  windDir: number; // world angle (rad) the wind blows TOWARD
  fires: { x: number; z: number }[];
  lakes: { x: number; z: number; r: number }[];
  worldSize: number;
  // C3 stakes: structures to defend, the threat gauge, lose state + final score.
  structures: { x: number; z: number; kind: 'cabin' | 'depot'; health: number; burning: boolean }[];
  bases?: { x: number; z: number }[]; // refuel bases (home + forward pads) — radar markers + low-fuel RTB cue
  threat: number; // 0..1 — most-endangered structure (drives the THREAT gauge)
  lost: boolean; // every structure destroyed → mission failed
  score: number; // final score (shown on the end banner)
  // Campaign layer: the live objective checklist + optional fuel gauge. Empty / undefined
  // in the open sandbox, so the mission UI simply doesn't render.
  objectives?: readonly TrackerItem[];
  fuel?: number; // 0..1 tank fraction (undefined → no FuelSim → fuel gauge hidden)
  fuelLow?: boolean; // gauge flashes (below reserve)
  zones?: { x: number; z: number; active: boolean; done: boolean; home: boolean }[]; // crew landing zones (radar blips); `home` = the always-marked base
  // Crew transport (delivery/evac missions): how many crew are aboard + the live board/disembark dwell.
  // Drives the strip's crew-count icon and the "CREW BOARDING / DISEMBARKING" progress bar. Undefined
  // on water missions, so neither element renders.
  crew?: {
    onboard: number; // crew currently in the cabin (0 or 1)
    delivered: number; // crews set down so far
    total: number; // crews to deliver this mission
    mode: 'boarding' | 'disembarking' | null; // actively working a zone (drives the bar), else null
    progress: number; // 0..1 dwell on the worked zone
  };
  // Debrief summary for the end banner (what the run achieved) — built once at outcome.
  debrief?: {
    firesOut: number;
    firesTotal: number;
    structSaved: number;
    structTotal: number;
    crewDone: number;
    crewTotal: number;
    timeSec: number;
    breakdown?: ScoreBreakdown; // line-itemed score + grade (absent on a crash → plain score shown)
  };
  // Aircraft whose campaign gate this WIN just crossed — drives the end-screen "NEW AIRCRAFT
  // UNLOCKED" callout (the progression payoff, otherwise invisible until the menu). Empty/undefined
  // when nothing new opened (a loss, a replay, or a mission that doesn't cross a threshold).
  unlocked?: { name: string; tagline: string }[];
}

/** Campaign end-banner callbacks (set by Game from main's mission router). */
export interface EndScreenHooks {
  hasNext: boolean; // is there a next mission to advance to?
  onNext(): void; // ▶ Next mission
  onMenu(): void; // ◂ Mission menu
  onRetry(): void; // ↻ Retry this mission
  onLeaderboard?(): void; // 🏆 open the global leaderboard on this mission
}

/** Static world place-name labels for the radar (A5) — set once, world-fixed. */
export interface MapLabels {
  communities: { name: string; x: number; z: number }[];
  lakes: { name: string; x: number; z: number }[];
}

// Design tokens + DOM helpers (el / frosted / makeCanvas / clamp01) now live in
// ui/theme.ts and are imported above, so HUD and the touch controls share one
// glass-cockpit language. `anchor()` (also from theme) + `onLayout` (layout.ts)
// drive the responsive, safe-area-aware placement.

const TAPE_W = 78; // jet tape canvas width
const TAPE_H = 188; // jet tape canvas height (the scrolling window)
const LOW_AGL_FT = 250; // altimeter reads LOW (red) below this AGL in feet
const RANGE_NEAR = 160; // world units to the radar edge when collapsed (zoomed-in local map)
const HINT_VISIBLE_MS = 3600; // status hint flashes on, then auto-fades after this (no permanent nag)
const HULL_OK = '#46d17a'; // healthy-hull bar green (matches the engine-ready green); turns red when low

export class HUD {
  private readonly root: HTMLDivElement;

  // Instrument strip: ONE frosted capsule of compact icon + NUMBER "pods" laid out
  // as a horizontal, wrapping top band (water / hull / fuel / fires / threat / compass /
  // wind) — the mobile-portrait "all info in the top band, no bars" layout. Pods are
  // transparent — only the capsule carries glass, so it's a single backdrop-blur layer.
  private readonly spine: HTMLDivElement;
  private readonly waterPod: Pod;
  private waterNumBg = ''; // baseline water-readout color (captured at build), restored after a drop-result flash
  private gaugeFlashTimer = 0; // setTimeout id: restore the water readout after a result tint
  private readonly hullPod: Pod;
  private readonly fuelPod: Pod;
  private readonly firesPod: Pod;
  private readonly threatPod: Pod;
  private readonly crewPod: Pod; // crew aboard count (delivery/evac missions only — hidden otherwise)
  private readonly compassPod: Pod; // heading in degrees (replaces the scrolling heading tape)
  private readonly windPod: Pod; // wind speed in knots + a heading-relative direction arrow
  private readonly pods: Pod[];
  private menuCell?: HTMLDivElement; // ☰ tucked at the head of the strip (campaign only)
  private readonly objPanel: HTMLDivElement; // campaign objective checklist (hidden in sandbox)
  private objSig = ''; // last-rendered objective signature (skip DOM churn when unchanged)
  // Crew board/disembark progress bar — a labelled fill that appears while landed on a zone
  // ("CREW BOARDING" climbing in / "CREW DISEMBARKING" stepping off). Hidden when not working a zone.
  private readonly crewBar: HTMLDivElement;
  private readonly crewBarLabel: HTMLDivElement;
  private readonly crewBarFill: HTMLDivElement;
  private crewBarShown = false; // last visibility (re-seat the hint only when it toggles)
  private readonly hint: HTMLDivElement;
  private hintText: string | null = null; // last hint we acted on (skip re-trigger when unchanged)
  private hintHideTimer = 0; // setTimeout: start the fade-out
  private hintFadeTimer = 0; // setTimeout: drop it from layout once the fade finishes
  private readonly topLeft: HTMLDivElement; // top-left anchor (measured to drop the hint below it on portrait)
  private readonly topCenter: HTMLDivElement; // status-hint column — dropped below the instrument band on portrait
  private readonly topRight: HTMLDivElement; // radar column — help "?" + the radio comms log tuck under the map
  private portraitMessages = false; // the hint drops below the band (phone/portrait) vs rides at the top (wide)
  private bandClear = 0; // floor px the hint is dropped by when portraitMessages
  private readonly smoke: HTMLDivElement; // C5: blinding-smoke veil when the camera is in a plume
  private readonly hitFlash: HTMLDivElement; // red impact vignette pulsed on a hard-landing hull dent
  private hitFlashTimer = 0; // setTimeout id: fade the impact flash back out
  private banner?: HTMLDivElement;
  private missionName = ''; // captured from the briefing → used in the end-screen Share text
  private readonly commsWrap: HTMLDivElement; // radio comms log (DISPATCH/CREW/WARNING toasts)
  // Cold-start engine dial (hold to spool the rotors) — present only between BEGIN and full RPM.
  private engineHoldState = false; // the START dial is pressed (pointer or Space/Enter) this frame
  private engineStartEl?: {
    wrap: HTMLDivElement;
    dial: HTMLDivElement;
    ring: HTMLDivElement;
    label: HTMLDivElement;
    sub: HTMLDivElement;
    onKey: (e: KeyboardEvent) => void;
    onKeyUp: (e: KeyboardEvent) => void;
  };

  // Fighter-jet scrolling tapes (canvas): airspeed left of the heli, altitude right.
  private readonly spdCtx: CanvasRenderingContext2D;
  private readonly altCtx: CanvasRenderingContext2D;

  private readonly radarCanvas: HTMLCanvasElement;
  private readonly radarCtx: CanvasRenderingContext2D;
  private readonly minimap: HTMLCanvasElement; // baked satellite terrain (world-aligned)
  private readonly labels: MapLabels; // A5: static place names drawn screen-upright on the radar
  private readonly dpr = Math.min(window.devicePixelRatio || 1, 2);
  private radarExpanded = false; // tap the radar to toggle local ↔ whole-world view
  // Responsive sizing — driven by applyLayout() from the layout controller (event-driven, not per-frame).
  private tapeGap = 70; // px from center to each flight tape
  private radarBase = 128; // collapsed radar side
  private radarMax = 300; // expanded radar side (clamped to the short viewport side)
  private spdCanvas!: HTMLCanvasElement;
  private altCanvas!: HTMLCanvasElement;
  // C5 burn overlay: the live fire field + a small offscreen raster of it (burnt = ash scar,
  // hot = warm front). Rebuilt every few frames (fire spreads slowly) and blitted under the blips
  // with the SAME heading-up affine as the satellite map, so it stays registered with the terrain.
  private burnField: FireFieldView | null = null;
  private burnCanvas: HTMLCanvasElement | null = null;
  private burnCtx: CanvasRenderingContext2D | null = null;
  private burnImg: ImageData | null = null;
  private burnAge = 999; // frames since the raster was last rebuilt (force a build on first draw)
  private readonly pilotName?: string; // callsign from onboarding — personalizes the end banner
  private readonly end?: EndScreenHooks; // campaign end-banner buttons (next / menu)

  constructor(
    parent: HTMLElement,
    minimap: HTMLCanvasElement,
    labels?: MapLabels,
    pilotName?: string,
    end?: EndScreenHooks,
  ) {
    this.minimap = minimap;
    this.labels = labels ?? { communities: [], lakes: [] };
    this.pilotName = pilotName?.trim() || undefined;
    this.end = end;

    this.root = el('div', {
      position: 'absolute',
      inset: '0',
      pointerEvents: 'none',
      fontFamily: UI.font,
      color: UI.text,
      userSelect: 'none',
      textRendering: 'geometricPrecision',
    });

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

    // --- Damage impact flash — a red edge-vignette pulsed when the hull takes a hard-landing dent.
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

    // --- Left instrument column. Stacked in a flex column (was three absolutely-positioned
    // chips) so the campaign's optional FUEL gauge and OBJECTIVE checklist can slot in without
    // colliding. Water → fuel → fires → threat → objectives, top to bottom. ---
    const leftCol = el('div', {
      display: 'flex',
      flexDirection: 'column',
      gap: 'var(--bmf-gap)',
      alignItems: 'flex-start',
    });

    // --- Instrument strip: ONE slim frosted pill of compact icon + NUMBER cells —
    // "all the info in the top band, function = icon + number, no bars". A small ☰ menu
    // (campaign) tucks in at the head, then water → health → fuel → fires → threat →
    // compass → wind, each split by a hairline. Cells are transparent; only the pill
    // blurs (one GPU layer). It hugs its content on wide screens (one row) and wraps to a
    // second row on a narrow phone, kept clear of the radar by a per-breakpoint max-width. ---
    this.spine = frosted({
      display: 'flex',
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'stretch',
      padding: '0',
      borderRadius: R.md,
    });
    if (this.end) {
      this.menuCell = makeMenuCell(this.end.onMenu);
      this.spine.appendChild(this.menuCell);
    }
    // Resource gauges (water / hull / fuel / threat) carry a thin animated fill BAR at the cell's
    // base — the glanceable "how full / how healthy" cue the bare number didn't convey. Count + units
    // cells (fires / compass / wind) stay number-only.
    this.waterPod = makePod(WATER_SVG, true); // % of bucket capacity
    this.waterNumBg = this.waterPod.num.style.color; // baseline readout color, restored after a drop-result flash
    this.hullPod = makePod(HEALTH_SVG, true); // airframe %
    this.fuelPod = makePod(FUEL_SVG, true); // tank %
    this.firesPod = makePod(FIRES_SVG); // fires remaining (count)
    this.threatPod = makePod(THREAT_SVG, true); // most-endangered structure %
    this.crewPod = makePod(CREW_SVG, true); // crew aboard (0/1) — bar reads as a filled/empty seat
    this.compassPod = makePod(COMPASS_SVG); // heading °
    this.windPod = makePod(WIND_SVG); // wind kt (icon rotates to the heading-relative gust)
    this.pods = [
      this.waterPod,
      this.hullPod,
      this.fuelPod,
      this.firesPod,
      this.threatPod,
      this.crewPod,
      this.compassPod,
      this.windPod,
    ];
    for (const p of this.pods) this.spine.append(p.cell);
    if (!this.menuCell) this.waterPod.cell.style.boxShadow = 'none'; // no menu → no leading hairline
    setPodHidden(this.fuelPod, true); // hidden until a mission supplies fuel
    setPodHidden(this.threatPod, true); // hidden until there are structures to defend
    setPodHidden(this.crewPod, true); // hidden until a crew-transport mission supplies a count
    leftCol.appendChild(this.spine);

    // Objective checklist (campaign — populated each frame from the mission tracker).
    this.objPanel = frosted({ padding: '7px 11px 8px', borderRadius: R.md, display: 'none', minWidth: '170px' });
    leftCol.appendChild(this.objPanel);

    // Crew board/disembark bar (delivery/evac missions): a labelled progress fill that appears while
    // the heli is set down on a zone and the crew climb in / step off. It sits under the objective
    // list, grouped with the rest of the mission readouts; hidden until a zone is being worked.
    this.crewBar = frosted({ padding: '7px 11px 9px', borderRadius: R.md, display: 'none', minWidth: '170px' });
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
      background: 'rgba(255,255,255,0.13)',
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

    // Radio comms log — DISPATCH/CREW/WARNING lines that drop in BELOW THE RADAR (top-right) and
    // auto-expire (the mission "talking" to the pilot). Right-aligned under the map so it never
    // crowds the flight view or the instrument strip; lines are created on demand (events, not
    // per-frame). Appended into the top-right column below where the radar is assembled.
    this.commsWrap = el('div', {
      display: 'flex',
      flexDirection: 'column',
      gap: '5px',
      alignItems: 'flex-end', // hug the right edge, under the radar
      width: 'min(260px, 64vw)',
      marginTop: '1px',
      pointerEvents: 'none',
    });

    this.topLeft = anchor('top-left');
    this.topLeft.appendChild(leftCol);
    this.root.appendChild(this.topLeft);

    // --- Status hint (the "tooltip"): top-center, dropped below the band on portrait ---
    this.hint = frosted({
      fontSize: FS.sm,
      fontWeight: FW.medium,
      color: '#dff6ff',
      padding: '5px 12px',
      borderRadius: R.pill,
      whiteSpace: 'nowrap',
      maxWidth: '90vw',
      boxSizing: 'border-box',
      display: 'none',
      opacity: '0',
      transition: 'opacity 0.35s ease',
    });

    // --- Fighter-jet scrolling tapes flanking the heli: airspeed LEFT, altitude
    // RIGHT (real HUD convention). Transparent canvases — thin glowing ladders that
    // float over the world, with numbers scrolling past a boxed live readout. ---
    // Left/right placement + scale come from applyLayout; transform-origin pins each
    // tape's INNER edge (toward the heli) so shrinking on small screens keeps the
    // center gap honest.
    const spd = makeCanvas(TAPE_W, TAPE_H, {
      position: 'absolute',
      top: '52%',
      transformOrigin: 'right center',
      transform: 'translateY(-50%)',
    });
    this.spdCtx = spd.ctx;
    this.spdCanvas = spd.canvas;
    this.root.appendChild(spd.canvas);

    const alt = makeCanvas(TAPE_W, TAPE_H, {
      position: 'absolute',
      top: '52%',
      transformOrigin: 'left center',
      transform: 'translateY(-50%)',
    });
    this.altCtx = alt.ctx;
    this.altCanvas = alt.canvas;
    this.root.appendChild(alt.canvas);

    // --- Status hint (top-center anchor). Just the transient tooltip now — the comms log
    // moved under the radar (right). Heading lives in the strip's compass cell, so the old
    // scrolling heading tape is retired. positionMessages() drops this below the strip band
    // on a phone so it never overlaps the corners. ---
    this.topCenter = anchor('top-center');
    this.topCenter.appendChild(this.hint);
    this.root.appendChild(this.topCenter);

    // --- Radar (top-right anchor, rounded square, tap to expand local ↔ whole-world) ---
    const radar = makeCanvas(this.radarBase, this.radarBase, {
      borderRadius: R.xl,
      background: UI.panel,
      border: `1px solid ${UI.stroke}`,
      boxShadow: UI.shadow,
      backdropFilter: UI.blur,
      pointerEvents: 'auto',
      cursor: 'pointer',
    });
    this.radarCanvas = radar.canvas;
    this.radarCtx = radar.ctx;
    this.radarCanvas.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.radarExpanded = !this.radarExpanded;
      this.sizeRadar();
    });
    this.topRight = anchor('top-right');
    this.topRight.appendChild(radar.canvas);
    this.topRight.appendChild(this.commsWrap); // radio comms tuck in directly under the map
    this.root.appendChild(this.topRight);

    parent.appendChild(this.root);

    // Size + place everything for the current breakpoint, and re-apply on every
    // resize / orientation change (event-driven — never per frame).
    onLayout((s) => this.applyLayout(s));
  }

  /** Size the responsive instruments for the active breakpoint. Anchors own
   *  position + safe-area in CSS; this sets only the exact pixel sizes (instrument
   *  cells, tape scale, radar) that have to be computed. */
  private applyLayout(s: LayoutState): void {
    const k = s.compact ? 0.92 : 1;
    const set = s.set;

    // Instrument strip: size each icon + number cell from podSize. Tuned tight — a slim
    // modern cluster, not chunky chips.
    const pod = Math.round(set.podSize * k);
    const ic = Math.round(pod * 0.44); // icon glyph
    const padV = Math.round(pod * 0.21); // cell vertical padding (sets the pill height)
    const padH = Math.round(pod * 0.28); // cell horizontal padding (sets inter-cell spacing)
    const gap = Math.round(pod * 0.16); // icon ↔ number gap
    const numFs = Math.round(pod * 0.5); // number font
    for (const p of this.pods) {
      p.cell.style.padding = `${padV}px ${padH}px`;
      p.cell.style.gap = `${gap}px`;
      p.svg.setAttribute('width', `${ic}`);
      p.svg.setAttribute('height', `${ic}`);
      p.num.style.fontSize = `${numFs}px`;
      p.num.style.minWidth = `${Math.round(pod * 0.5)}px`; // stable as a digit count changes (e.g. fires 9 → 10)
    }
    if (this.menuCell) {
      this.menuCell.style.padding = `${padV}px ${Math.round(padH * 1.05)}px`;
      this.menuCell.style.fontSize = `${Math.round(pod * 0.5)}px`;
    }

    // Cap the strip's width so it WRAPS to a second row instead of running into the
    // top-right radar on narrow phones; on wide screens this is far bigger than the content
    // so it stays a single row. Span up to the radar's left edge less a small gutter.
    const radarW = Math.round(set.radarBase * k);
    const stripMax = Math.max(150, s.w - radarW - set.edge * 2 - 16);
    this.spine.style.maxWidth = `${stripMax}px`;

    // The status hint is centered; on a phone the strip spans toward center, so drop it BELOW
    // the band. On a wide screen the center-top is clear so it rides at the very top.
    this.portraitMessages = s.orientation === 'portrait' || s.w < 760;
    this.bandClear = this.portraitMessages ? radarW + Math.round(set.gap) + 10 : 0;

    // Flight tapes — center gap + scale (backing stores stay crisp; only display moves).
    this.tapeGap = Math.round(set.tapeGap * k);
    const tf = `translateY(-50%) scale(${set.tapeScale})`;
    this.spdCanvas.style.left = `calc(50% - ${this.tapeGap + TAPE_W}px)`;
    this.spdCanvas.style.transform = tf;
    this.altCanvas.style.left = `calc(50% + ${this.tapeGap}px)`;
    this.altCanvas.style.transform = tf;

    // Radar — collapsed base per set; expanded capped to the short viewport side.
    this.radarBase = Math.round(set.radarBase * k);
    this.radarMax = Math.max(this.radarBase + 40, Math.round(Math.min(set.radarMaxFrac * Math.min(s.w, s.h), 320)));
    this.sizeRadar();

    this.positionMessages(); // seat the hint below the now-sized instrument band
  }

  /** Drop the top-center status hint just below the real left instrument band (strip +
   *  objectives) so it never overlaps the strip on a phone; on a wide screen it rides at the
   *  very top. Measures the live left-column height (cheap; only on layout change + when the
   *  objective list changes). The comms log lives under the radar, so it's not measured here. */
  private positionMessages(): void {
    if (!this.portraitMessages) {
      this.topCenter.style.paddingTop = '0px';
      return;
    }
    let band = this.bandClear;
    const top = this.topCenter.getBoundingClientRect().top;
    const leftBottom = this.topLeft.getBoundingClientRect().bottom - top;
    if (leftBottom > band) band = leftBottom;
    this.topCenter.style.paddingTop = `${Math.round(band + 8)}px`;
  }

  /** Resize the radar canvas backing store for the current expand state (resets the
   *  context transform, so re-apply the DPR scale). Anchored top-right, so it grows
   *  down-and-left and stays in the corner. */
  private sizeRadar(): void {
    const size = this.radarExpanded ? this.radarMax : this.radarBase;
    this.radarCanvas.width = Math.round(size * this.dpr);
    this.radarCanvas.height = Math.round(size * this.dpr);
    this.radarCanvas.style.width = `${size}px`;
    this.radarCanvas.style.height = `${size}px`;
    this.radarCtx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  /** C5: set the blinding-smoke veil opacity (0 clear → 1 fully socked in). */
  setSmoke(density: number): void {
    this.smoke.style.opacity = `${clamp01(density)}`;
  }

  /** Mount an extra control (the help "?" button) into the radar column, directly under the
   *  minimap — so it shares the top-right corner and reflows down when the radar expands.
   *  Inserted ABOVE the comms log so the transient toasts never shove the button around. */
  mountUnderRadar(node: HTMLElement): void {
    this.topRight.insertBefore(node, this.commsWrap);
  }

  /**
   * Status hint: flash a NEW message briefly, then fade it out — and never nag with the same
   * message twice running. Game recomputes the hint string every frame, so a persistent
   * condition (e.g. "Descend to fill the bucket" while loitering over a lake) used to pin the
   * banner on permanently; now each distinct prompt shows once and clears itself.
   */
  private setHint(text: string | null): void {
    if (text === this.hintText) return; // unchanged since last frame — don't re-trigger the flash
    this.hintText = text;
    window.clearTimeout(this.hintHideTimer);
    window.clearTimeout(this.hintFadeTimer);
    if (!text) {
      this.fadeOutHint(); // condition cleared — let whatever is showing fade away
      return;
    }
    this.hint.textContent = text;
    this.hint.style.display = 'block';
    void this.hint.offsetWidth; // force reflow so the fade-in runs from opacity 0
    this.hint.style.opacity = '1';
    this.hintHideTimer = window.setTimeout(() => this.fadeOutHint(), HINT_VISIBLE_MS);
  }

  /** Fade the hint out, then drop it from layout once the transition has finished. */
  private fadeOutHint(): void {
    this.hint.style.opacity = '0';
    this.hintFadeTimer = window.setTimeout(() => {
      this.hint.style.display = 'none';
    }, 360);
  }

  update(s: HudState): void {
    // --- Instrument strip: one text write per cell (O(1)); colour flips/glows only when flagged. ---
    // Gauges read as whole-percent numbers (no bars); fires is a raw count; compass/wind are units.
    const waterFrac = clamp01(s.water / s.waterMax);
    this.waterPod.num.textContent = `${Math.round(waterFrac * 100)}`;
    setPodBar(this.waterPod, waterFrac, UI.accent, !!s.scooping); // glow while actively filling → "keep dipping"
    const hp = clamp01(s.health ?? 1);
    this.hullPod.num.textContent = `${Math.round(hp * 100)}`;
    setNumWarn(this.hullPod, !!s.healthLow); // critical → red + pulse (sin only runs when low)
    setPodBar(this.hullPod, hp, s.healthLow ? UI.warn : HULL_OK, !!s.healthLow); // visible HP — drops on a hit
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
      this.threatPod.num.textContent = `${Math.round(threat * 100)}`;
      const threatHot = threat > 0.6;
      this.threatPod.svg.setAttribute('stroke', threatHot ? UI.warn : '#eaf6ff'); // one attribute flip, gated
      this.threatPod.num.style.color = threatHot ? UI.warn : UI.text;
      this.threatPod.cell.style.textShadow = threatHot ? `0 0 8px ${UI.warn}` : 'none';
      setPodBar(this.threatPod, threat, threatHot ? UI.warn : '#ffb24a', threatHot); // fills toward red as the fire closes in
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

    this.setHint(s.hint);

    // Campaign objective checklist — rebuilt only when its rendered text changes (no per-frame churn).
    this.renderObjectives(s.objectives);

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
      warn: s.raFt < LOW_AGL_FT, // low warning keys off true height above the surface
      vsi: s.vertSpeed,
      ra: s.raFt, // radar altitude readout (the landing number)
    });

    this.drawRadar(s);

    if ((s.won || s.lost) && !this.banner) this.showBanner(s);
  }

  /** Rebuild the objective checklist only when its visible content changes. */
  private renderObjectives(items?: readonly TrackerItem[]): void {
    if (!items || items.length === 0) {
      if (this.objSig !== '') {
        this.objPanel.style.display = 'none';
        this.objSig = '';
        this.positionMessages(); // left column shrank — re-seat the hint
      }
      return;
    }
    const sig = items
      .map((t) => `${t.label}|${t.current ?? ''}/${t.target ?? ''}|${t.timeLeft !== undefined ? Math.ceil(t.timeLeft) : ''}|${t.done}|${t.failed}`)
      .join(';');
    if (sig === this.objSig) return;
    this.objSig = sig;

    this.objPanel.style.display = '';
    this.objPanel.replaceChildren(label('OBJECTIVES'));
    for (const t of items) {
      const row = el('div', {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        marginTop: '5px',
        fontSize: FS.sm,
      });
      const mark = t.failed ? '✕' : t.done ? '✓' : t.kind === 'constraint' ? '◆' : '○';
      const col = t.failed ? UI.warn : t.done ? UI.accent : 'rgba(231,247,255,0.85)';
      row.appendChild(el('div', { color: col, fontWeight: FW.bold, width: '12px' }, mark));
      row.appendChild(el('div', { color: col, flex: '1' }, t.label));
      let val = '';
      if (t.done && t.completedAt !== undefined) val = `✓ ${fmtTime(t.completedAt)}`; // latched: stamp the time
      else if (t.timeLeft !== undefined) val = fmtTime(t.timeLeft);
      else if (t.target !== undefined) val = `${t.current ?? 0}/${t.target}`;
      if (val) row.appendChild(el('div', { color: UI.dim, fontWeight: FW.semibold }, val));
      this.objPanel.appendChild(row);
    }
    this.positionMessages(); // left column grew/changed — re-seat the hint below it
  }

  /**
   * Drive the crew board/disembark bar: show it only while a zone is being worked, set the label
   * (CREW BOARDING climbing in / CREW DISEMBARKING stepping off) + colour, and scale the fill to the
   * dwell. Toggling its visibility changes the left column height, so re-seat the hint then (cheap —
   * only on the show/hide edge, not every frame the bar fills).
   */
  private renderCrewBar(crew?: HudState['crew']): void {
    const working = !!crew && crew.mode !== null;
    if (working !== this.crewBarShown) {
      this.crewBarShown = working;
      this.crewBar.style.display = working ? '' : 'none';
      this.positionMessages();
    }
    if (!working || !crew) return;
    const boarding = crew.mode === 'boarding';
    const col = boarding ? UI.accent : '#5fe0a0'; // cyan picking up / green setting down (matches the home pad)
    this.crewBarLabel.textContent = boarding ? 'CREW BOARDING' : 'CREW DISEMBARKING';
    this.crewBarLabel.style.color = col;
    this.crewBarFill.style.background = col;
    this.crewBarFill.style.transform = `scaleX(${clamp01(crew.progress)})`;
  }

  /**
   * Mission end screen: outcome headline + grade + itemised score + Next/Retry/Menu/Leaderboard/Share.
   * Now mounted in a full-screen BLURRED SCRIM (the frozen world is dimmed + pushed out of focus) so
   * the highest-visibility moment reads as one polished results screen instead of a chip floating over
   * live 3D. A win that crossed a campaign unlock also celebrates the newly-earned aircraft here.
   */
  private showBanner(s: HudState): void {
    const reduce = prefersReducedMotion();
    // Blurred backdrop — captures pointer events (taps don't leak to the game) and centers the card.
    const back = scrim({ opacity: reduce ? '1' : '0', transition: reduce ? 'none' : 'opacity 0.3s ease' });
    this.banner = back; // the `!this.banner` guard in update() keys off this

    const card = frosted({
      textAlign: 'center',
      padding: '26px 30px 22px',
      borderRadius: R.xl,
      pointerEvents: 'auto',
      width: '100%',
      maxWidth: 'min(92vw, 380px)',
      maxHeight: 'calc(100% - 8px)',
      overflowY: 'auto',
      boxShadow: UI.shadowCard,
      boxSizing: 'border-box',
    });

    const who = this.pilotName ?? 'pilot';
    const headline = s.won ? 'MISSION COMPLETE' : 'MISSION FAILED';
    card.appendChild(
      el('div', { fontSize: FS.banner, fontWeight: FW.heavy, letterSpacing: '0.5px', color: s.lost ? UI.warn : UI.accent }, headline),
    );
    const d = s.debrief;
    // Run grade — the headline accolade. A big letter badge in its rank colour (S gold → D red),
    // with the 1..3 star medal beneath it (same baseline ratio, so they always agree).
    const grade = s.won ? d?.breakdown?.grade ?? null : null;
    const stars = s.won ? d?.breakdown?.stars ?? null : null;
    if (grade) card.appendChild(gradeBadge(grade, stars));
    // Reactive closing line — reads the outcome, not a canned string.
    let sub: string;
    if (s.won) {
      if (d && d.structTotal > 0 && d.structSaved === d.structTotal && d.firesOut >= d.firesTotal) sub = `Flawless mission, ${who}. Not a structure lost.`;
      else if (d && d.structTotal > 0 && d.structSaved < d.structTotal) sub = `Mission complete — but the fire took ${d.structTotal - d.structSaved}.`;
      else sub = `Good flying, ${who}.`;
    } else if (d && d.structTotal > 0 && d.structSaved < d.structTotal) {
      sub = "The community couldn't be held.";
    } else {
      sub = 'The fire won this time.';
    }
    card.appendChild(el('div', { fontSize: FS.lg, marginTop: '8px', color: 'rgba(231,247,255,0.82)' }, sub));

    // Score readout. With a breakdown (every non-crash outcome) we show the itemised math so the player
    // SEES where the points came from — hardship, precision, defense, penalties — then the total. On a
    // crash (no breakdown) we fall back to the plain "what you did" summary + a single score line.
    if (d?.breakdown) {
      card.appendChild(scoreBreakdownBlock(d.breakdown, d.timeSec));
    } else if (d) {
      const stats = el('div', {
        marginTop: '14px',
        display: 'inline-flex',
        flexDirection: 'column',
        gap: '4px',
        padding: '10px 16px',
        borderRadius: R.md,
        background: 'rgba(255,255,255,0.04)',
        border: `1px solid ${UI.stroke}`,
        fontSize: FS.body,
        color: 'rgba(231,247,255,0.85)',
      });
      const row = (k: string, v: string): void => {
        const r = el('div', { display: 'flex', justifyContent: 'space-between', gap: '22px', minWidth: '180px' });
        r.appendChild(el('div', { color: UI.dim }, k));
        r.appendChild(el('div', { fontWeight: FW.bold }, v));
        stats.appendChild(r);
      };
      row('Fires out', `${d.firesOut}/${d.firesTotal}`);
      if (d.structTotal > 0) row('Structures saved', `${d.structSaved}/${d.structTotal}`);
      if (d.crewTotal > 0) row('Crews delivered', `${d.crewDone}/${d.crewTotal}`);
      row('Time', fmtTime(d.timeSec));
      card.appendChild(stats);
      card.appendChild(el('div', { fontSize: FS.title, fontWeight: FW.bold, marginTop: '12px' }, `Score ${s.score.toLocaleString()}`));
    } else {
      card.appendChild(el('div', { fontSize: FS.title, fontWeight: FW.bold, marginTop: '12px' }, `Score ${s.score.toLocaleString()}`));
    }

    // Progression payoff: a win that just crossed a heli's campaign gate celebrates it here, so the
    // reward isn't invisible until the player wanders back to the aircraft carousel.
    if (s.won && s.unlocked && s.unlocked.length) card.appendChild(unlockCallout(s.unlocked));

    if (this.end) {
      // Primary action row — the obvious next move (advance / retry) + back to the menu.
      const row = el('div', { display: 'flex', gap: '10px', justifyContent: 'center', marginTop: '20px', flexWrap: 'wrap' });
      if (s.won && this.end.hasNext) row.appendChild(bannerButton('NEXT ▸', UI.accent, this.end.onNext));
      if (!s.won) row.appendChild(bannerButton('↻ RETRY', UI.fire, this.end.onRetry));
      row.appendChild(bannerButton('MENU', UI.dim, this.end.onMenu));
      card.appendChild(row);
      // Secondary row — leaderboard + share (the free viral loop; OG tags already unfurl the link).
      const row2 = el('div', { display: 'flex', gap: '10px', justifyContent: 'center', marginTop: '10px', flexWrap: 'wrap' });
      if (this.end.onLeaderboard) row2.appendChild(bannerButton('🏆 LEADERBOARD', UI.accent, this.end.onLeaderboard));
      row2.appendChild(this.shareButton(s));
      card.appendChild(row2);
    }

    back.appendChild(card);
    this.root.appendChild(back);
    if (!reduce) {
      void back.offsetWidth; // force reflow so the fade runs from opacity 0
      back.style.opacity = '1';
    }
  }

  /** A Share button for the end screen: Web Share API where available (the native mobile sheet),
   *  else copy a link to the clipboard with an inline "✓ COPIED" confirmation. */
  private shareButton(s: HudState): HTMLDivElement {
    const btn = bannerButton('↗ SHARE', UI.water, () => void this.shareRun(s, btn));
    return btn;
  }

  private async shareRun(s: HudState, btn: HTMLDivElement): Promise<void> {
    const url = 'https://bucketmyfire.com';
    const mission = this.missionName || 'a wildfire';
    const did = s.won ? `cleared "${mission}"` : `fought "${mission}"`;
    const text = `I ${did} and scored ${s.score.toLocaleString()} in Bucket My Fire 🚁🔥`;
    const nav = navigator as Navigator & { share?: (d: { title?: string; text?: string; url?: string }) => Promise<void> };
    if (nav.share) {
      try {
        await nav.share({ title: 'Bucket My Fire', text, url });
      } catch {
        /* user dismissed the share sheet — no fallback needed */
      }
      return;
    }
    try {
      await navigator.clipboard?.writeText(`${text} — play free at ${url}`);
    } catch {
      /* clipboard blocked — nothing more we can do quietly */
    }
    const orig = btn.textContent;
    btn.textContent = '✓ COPIED';
    window.setTimeout(() => {
      btn.textContent = orig;
    }, 1600);
  }

  /**
   * Flash the WATER readout a result color for `ms`, then restore its baseline — the quick visual
   * confirmation of a drop's result (green direct / amber too-high / red miss), paired with the
   * Dispatch readout. Event-driven (called once per committed drop), so no per-frame cost.
   */
  flashGauge(color: string, ms: number): void {
    if (this.gaugeFlashTimer) window.clearTimeout(this.gaugeFlashTimer); // re-flash: restart cleanly
    this.waterPod.num.style.color = color;
    this.waterPod.num.style.textShadow = `0 0 8px ${color}`;
    this.gaugeFlashTimer = window.setTimeout(() => {
      this.waterPod.num.style.color = this.waterNumBg;
      this.waterPod.num.style.textShadow = 'none';
      this.gaugeFlashTimer = 0;
    }, ms);
  }

  /**
   * Pulse the red impact vignette over the whole view — the unmissable "you just took a hit" cue for
   * a hard-landing hull dent (the quiet HEALTH number ticking down went unnoticed). `severity` 0..1
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

  // --- Radio comms + pre-flight briefing (the mission "experience" layer) ----

  /**
   * Post a radio line to the comms log: a slim frosted toast tagged DISPATCH / CREW / WARNING,
   * dropping in UNDER THE RADAR (right) and auto-expiring. A small colored tag sits inline before
   * the text (one tight line, not a chunky card). Created on demand (events, not per-frame); the
   * stack is capped to a few visible lines so it never crowds the HUD.
   */
  pushComms(speaker: CommsSpeaker, text: string, urgency: CommsUrgency): void {
    const color =
      speaker === 'warning' || urgency === 'alert' ? UI.warn : speaker === 'crew' ? '#ffb24a' : speaker === 'pilot' ? UI.text : UI.accent;
    const line = frosted({
      padding: '4px 9px',
      borderLeft: `2px solid ${color}`,
      borderRadius: R.sm,
      maxWidth: '100%',
      display: 'flex',
      alignItems: 'baseline',
      gap: '6px',
      textAlign: 'left',
      opacity: '0',
      transform: 'translateY(-6px)',
      transition: 'opacity 0.22s ease, transform 0.22s ease',
    });
    if (urgency === 'alert') line.style.boxShadow = `0 0 12px ${color}66, ${UI.shadow}`;
    line.appendChild(
      el('span', { fontSize: FS.micro, fontWeight: FW.bold, letterSpacing: '1.2px', color, flex: '0 0 auto' }, speaker.toUpperCase()),
    );
    line.appendChild(el('span', { fontSize: FS.meta, lineHeight: '1.3', color: UI.text }, text));
    this.commsWrap.appendChild(line);
    // Force a reflow so the transition runs from the initial (faded/offset) state, then reveal.
    // (A rAF-based reveal can be throttled when the tab is backgrounded; this is synchronous.)
    void line.offsetWidth;
    line.style.opacity = '1';
    line.style.transform = 'translateY(0)';
    while (this.commsWrap.childElementCount > 3) this.commsWrap.firstElementChild?.remove();
    const ttl = urgency === 'alert' ? 6500 : urgency === 'warn' ? 5500 : 4800;
    window.setTimeout(() => {
      line.style.opacity = '0';
      line.style.transform = 'translateY(-6px)';
      window.setTimeout(() => line.remove(), 300);
    }, ttl);
  }

  /**
   * Pre-flight briefing card (the arc's opening): a frosted modal over the frozen scene with the
   * mission name, the intel paragraph, and a BEGIN FLIGHT button. Game keeps the sim + clock paused
   * until `onBegin` fires. Dismissed on BEGIN or a tap on the scrim.
   */
  showBriefing(def: MissionDef, onBegin: () => void): void {
    this.missionName = def.name; // remember for the end-screen Share text
    const scrim = el('div', {
      position: 'fixed',
      inset: '0',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'rgba(4,8,12,0.55)',
      backdropFilter: 'blur(6px) saturate(108%)', // blur the world so the briefing reads as the focus
      zIndex: '30',
      pointerEvents: 'auto',
    });
    scrim.style.setProperty('-webkit-backdrop-filter', 'blur(6px) saturate(108%)');
    const card = frosted({ maxWidth: '440px', margin: '0 20px', padding: '24px 26px 20px', borderRadius: R.xl });
    card.appendChild(
      el('div', { fontSize: FS.meta, fontWeight: FW.bold, letterSpacing: '3px', color: UI.accent, marginBottom: '4px' }, 'DISPATCH BRIEFING'),
    );
    card.appendChild(el('div', { fontSize: FS.display, fontWeight: FW.heavy, letterSpacing: '0.3px' }, def.name));
    // Difficulty pips.
    const pips = el('div', { display: 'flex', gap: '4px', marginTop: '8px', marginBottom: '12px' });
    for (let i = 0; i < 5; i++) {
      pips.appendChild(el('div', { width: '18px', height: '4px', borderRadius: R.pill, background: i < def.difficulty ? UI.fire : 'rgba(255,255,255,0.14)' }));
    }
    card.appendChild(pips);
    card.appendChild(
      el('div', { fontSize: FS.md, lineHeight: '1.55', color: 'rgba(231,247,255,0.86)', marginBottom: '18px' }, def.intel ?? def.brief),
    );
    const begin = bannerButton('BEGIN FLIGHT ▸', UI.accent, () => {
      scrim.remove();
      onBegin();
    });
    const row = el('div', { display: 'flex', justifyContent: 'flex-end' });
    row.appendChild(begin);
    card.appendChild(row);
    scrim.appendChild(card);
    // Tapping the scrim (outside the card) also begins — forgiving on mobile.
    scrim.addEventListener('pointerdown', (e) => {
      if (e.target === scrim) {
        scrim.remove();
        onBegin();
      }
    });
    this.root.appendChild(scrim);
  }

  // --- Cold engine start (hold-to-spool dial) --------------------------------

  /** True while the START dial is being held (pointer drag or Space/Enter). Game reads this each
   *  frame to spool the rotor RPM up; releasing lets it bleed back down. */
  get engineHold(): boolean {
    return this.engineHoldState;
  }

  /**
   * Show the cold-start dial: a big circular HOLD-TO-START control with a progress ring that fills
   * as the rotor spools. Surfaced by Game once the briefing is dismissed (and only when the engine
   * isn't already running). Holding it — by pointer, or Space/Enter on desktop — drives `engineHold`;
   * Game integrates RPM and calls `setEngineStart`/`hideEngineStart`.
   */
  showEngineStart(): void {
    if (this.engineStartEl) return;

    // Click-through wrapper tucked into the BOTTOM-RIGHT, just above the DROP hero so the cold
    // start sits right under the thumb that will fly the aircraft. Right-aligned with the DROP
    // button; raised clear of the collective/DROP cluster. Only the dial itself is interactive.
    const wrap = el('div', {
      position: 'fixed',
      right: 'calc(var(--bmf-safe-r) + var(--bmf-edge))',
      bottom: 'calc(var(--bmf-safe-b) + var(--bmf-edge) + 124px)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: '7px',
      zIndex: '25',
      pointerEvents: 'none',
      transition: 'opacity 0.3s ease, transform 0.3s ease',
    });

    const size = 80;
    const dial = el('div', {
      position: 'relative',
      width: `${size}px`,
      height: `${size}px`,
      borderRadius: R.round,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      cursor: 'pointer',
      pointerEvents: 'auto',
      touchAction: 'none',
      background: 'radial-gradient(circle at 50% 40%, rgba(20,30,40,0.72), rgba(6,10,14,0.84))',
      border: `1px solid ${UI.strokeStrong}`,
      boxShadow: UI.shadowBtn,
      userSelect: 'none',
    });
    setBlur(dial);

    // Progress ring: a conic-gradient sweep masked down to a thin annulus around the dial.
    const ringPx = 5;
    const ring = el('div', {
      position: 'absolute',
      inset: `-${ringPx + 1}px`,
      borderRadius: R.round,
      background: `conic-gradient(${UI.accent} 0deg, rgba(255,255,255,0.08) 0deg)`,
      pointerEvents: 'none',
    });
    const ringMask = `radial-gradient(farthest-side, transparent calc(100% - ${ringPx}px), #000 calc(100% - ${ringPx}px))`;
    ring.style.setProperty('-webkit-mask', ringMask);
    ring.style.setProperty('mask', ringMask);

    const inner = el('div', {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: '2px',
      pointerEvents: 'none',
    });
    const label = el('div', { fontSize: FS.body, fontWeight: FW.heavy, letterSpacing: '1.5px', color: UI.text }, 'START');
    const sub = el('div', { fontSize: FS.label, fontWeight: FW.bold, letterSpacing: '1px', color: UI.dim }, '0%');
    inner.append(label, sub);
    dial.append(ring, inner);

    const caption = el(
      'div',
      { fontSize: FS.tag, fontWeight: FW.bold, letterSpacing: '1.2px', color: UI.accent, textShadow: '0 1px 8px rgba(0,0,0,0.7)', whiteSpace: 'nowrap' },
      'HOLD TO START',
    );
    wrap.append(dial, caption);

    // Pointer and keyboard holds are tracked separately and OR'd, so releasing one input doesn't
    // cancel a hold still active on the other.
    let pointerHeld = false;
    let keyHeld = false;
    const sync = (): void => {
      this.engineHoldState = pointerHeld || keyHeld;
    };

    // Press handling. NB: do NOT stopPropagation — let the pointerdown bubble to window so HeliAudio
    // unlocks on this gesture. setPointerCapture keeps the hold alive if the finger drifts off.
    dial.addEventListener('pointerdown', (e) => {
      pointerHeld = true;
      sync();
      try {
        dial.setPointerCapture(e.pointerId);
      } catch {
        /* capture is best-effort */
      }
    });
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave'] as const) {
      dial.addEventListener(ev, () => {
        pointerHeld = false;
        sync();
      });
    }

    // Desktop convenience: hold Space or Enter to start (flight is frozen during the spool, so the
    // usual Space=drop binding is inert here).
    const onKey = (e: KeyboardEvent): void => {
      if (e.code === 'Space' || e.code === 'Enter') {
        e.preventDefault();
        keyHeld = true;
        sync();
      }
    };
    const onKeyUp = (e: KeyboardEvent): void => {
      if (e.code === 'Space' || e.code === 'Enter') {
        keyHeld = false;
        sync();
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);

    this.root.appendChild(wrap);
    this.engineStartEl = { wrap, dial, ring, label, sub, onKey, onKeyUp };
  }

  /** Update the dial to the live RPM (0..1) and held state — ring fill, % readout, hold glow. */
  setEngineStart(rpm: number, holding: boolean): void {
    const e = this.engineStartEl;
    if (!e) return;
    const r = clamp01(rpm);
    const full = r >= 1;
    const col = full ? '#46d17a' : UI.accent;
    e.ring.style.background = `conic-gradient(${col} ${r * 360}deg, rgba(255,255,255,0.08) ${r * 360}deg)`;
    e.sub.textContent = `${Math.round(r * 100)}%`;
    e.label.textContent = full ? 'READY' : 'START';
    e.label.style.color = full ? col : UI.text;
    e.dial.style.boxShadow = holding || full ? `0 0 24px ${col}, ${UI.shadowBtn}` : UI.shadowBtn;
  }

  /** Tear down the dial (rotors are up) — detach key listeners, fade out, remove. */
  hideEngineStart(): void {
    const e = this.engineStartEl;
    if (!e) return;
    window.removeEventListener('keydown', e.onKey);
    window.removeEventListener('keyup', e.onKeyUp);
    this.engineHoldState = false;
    this.engineStartEl = undefined;
    e.wrap.style.opacity = '0';
    e.wrap.style.transform = 'scale(0.85)';
    window.setTimeout(() => e.wrap.remove(), 320);
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
      warn?: boolean;
      vsi?: number;
      ra?: number; // radar altitude (ft) — small readout under the box (altitude tape)
    },
  ): void {
    const w = TAPE_W;
    const h = TAPE_H;
    const cy = h / 2;
    const pxPerUnit = o.pxPerTick / o.tickEvery;
    const accent = o.warn ? UI.warn : UI.accent;
    const baseX = o.side === 'right' ? w - 5 : 5; // ladder spine on the inner edge
    const dir = o.side === 'right' ? -1 : 1; // ticks grow outward (away from the heli)
    ctx.clearRect(0, 0, w, h);

    // Faint legibility column behind the ladder, fading top/bottom.
    const strip = ctx.createLinearGradient(0, 0, 0, h);
    strip.addColorStop(0, 'rgba(6,12,18,0)');
    strip.addColorStop(0.5, 'rgba(6,12,18,0.30)');
    strip.addColorStop(1, 'rgba(6,12,18,0)');
    ctx.fillStyle = strip;
    const sx = o.side === 'right' ? w - 34 : 0;
    ctx.fillRect(sx, 0, 34, h);

    // Section caption at the top.
    ctx.textBaseline = 'middle';
    ctx.textAlign = o.side === 'right' ? 'right' : 'left';
    ctx.fillStyle = UI.dim;
    ctx.font = '600 10px ' + UI.font;
    ctx.fillText(o.name, baseX, 9);

    // Scrolling ladder: ticks + labels, positioned continuously from the live value.
    const topVal = o.value + cy / pxPerUnit;
    const botVal = o.value - cy / pxPerUnit;
    const first = Math.ceil(botVal / o.tickEvery) * o.tickEvery;
    ctx.lineWidth = 1;
    for (let t = first; t <= topVal; t += o.tickEvery) {
      if (t < 0) continue;
      const y = cy + (o.value - t) * pxPerUnit;
      if (y < 16 || y > h - 6) continue;
      const fade = 1 - Math.min(1, Math.abs(y - cy) / (cy + 8)); // dim toward the edges
      const major = Math.round(t) % o.labelEvery === 0;
      ctx.strokeStyle = `rgba(255,255,255,${(major ? 0.55 : 0.28) * (0.4 + 0.6 * fade)})`;
      ctx.beginPath();
      ctx.moveTo(baseX, y);
      ctx.lineTo(baseX + dir * (major ? 12 : 6), y);
      ctx.stroke();
      if (major) {
        ctx.fillStyle = `rgba(226,244,255,${0.5 + 0.5 * fade})`;
        ctx.font = '500 11px ' + UI.font;
        ctx.fillText(`${t}`, baseX + dir * 16, y);
      }
    }

    // Center readout: a pointer aimed at the heli + a boxed live value.
    const boxW = 44;
    const boxH = 24;
    const bx = o.side === 'right' ? w - boxW : 0;
    const by = cy - boxH / 2;
    const tip = o.side === 'right' ? w : 0; // chevron points toward the heli (screen center)
    const tipBase = o.side === 'right' ? w - 7 : 7;
    ctx.beginPath();
    ctx.moveTo(o.side === 'right' ? bx : boxW, by);
    if (o.side === 'right') {
      ctx.lineTo(tipBase, by);
      ctx.lineTo(tip, cy);
      ctx.lineTo(tipBase, by + boxH);
      ctx.lineTo(bx, by + boxH);
    } else {
      ctx.lineTo(tipBase, by);
      ctx.lineTo(tip, cy);
      ctx.lineTo(tipBase, by + boxH);
      ctx.lineTo(boxW, by + boxH);
    }
    ctx.closePath();
    ctx.fillStyle = 'rgba(6,12,18,0.78)';
    ctx.fill();
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1.5;
    ctx.shadowColor = accent;
    ctx.shadowBlur = 6;
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Always show the number (reddened when low) — keeping it readable matters for
    // landing; the RA line + color carry the low caution instead of hiding the value.
    ctx.fillStyle = o.warn ? UI.warn : '#fff';
    ctx.font = '700 17px ' + UI.font;
    ctx.textAlign = 'center';
    ctx.fillText(`${Math.round(o.value)}`, bx + boxW / 2, cy + 1);

    // VSI under the box (altitude tape only).
    if (o.vsi !== undefined) {
      const vs = o.vsi; // ft/min
      let txt = '— LVL';
      let col = UI.dim;
      if (vs > 50) {
        txt = `▲${Math.round(vs / 10) * 10}`;
        col = UI.accent;
      } else if (vs < -50) {
        txt = `▼${Math.abs(Math.round(vs / 10) * 10)}`;
        col = '#ffc36b';
      }
      ctx.fillStyle = col;
      ctx.font = '600 11px ' + UI.font;
      ctx.textAlign = o.side === 'right' ? 'right' : 'left';
      ctx.fillText(txt, baseX, by + boxH + 14);
    }

    // Radar altitude (true height above the surface below) — the landing number.
    if (o.ra !== undefined) {
      ctx.fillStyle = o.warn ? UI.warn : 'rgba(231,247,255,0.85)';
      ctx.font = '600 11px ' + UI.font;
      ctx.textAlign = o.side === 'right' ? 'right' : 'left';
      ctx.fillText(`R ${Math.round(o.ra)}`, baseX, by + boxH + 28);
    }
  }

  // --- Canvas instruments ---------------------------------------------------

  /** C5: hand the radar the live fire field (FireSystem.fieldView). The arrays are stable, so we
   *  keep the reference and re-raster it every few frames into a tiny offscreen canvas. */
  setBurnField(view: FireFieldView): void {
    this.burnField = view;
    const c = document.createElement('canvas');
    c.width = view.n;
    c.height = view.n;
    const cx = c.getContext('2d');
    if (!cx) return;
    this.burnCanvas = c;
    this.burnCtx = cx;
    this.burnImg = cx.createImageData(view.n, view.n);
    this.burnAge = 999;
  }

  /** Rebuild the offscreen burn raster from the field: BURNT cells → a light ash scar (the user's
   *  "light shaded region"), actively-BURNING cells → a warm front, both translucent so the
   *  terrain reads through. Cheap (n² = 16k) and only run every few frames. */
  private rasterizeBurn(view: FireFieldView): void {
    if (!this.burnImg || !this.burnCtx) return;
    const { n, heat, scorch } = view;
    const d = this.burnImg.data;
    for (let i = 0; i < n * n; i++) {
      const o = i * 4;
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      if (scorch[i] !== 0) {
        // Burned-out ground: pale ash — a light shaded scar over the terrain.
        r = 196;
        g = 188;
        b = 176;
        a = 120;
      }
      const h = heat[i];
      if (h > 0.06) {
        // Actively burning: warm front, hotter = more opaque + more orange (over the ash).
        const t = h > 1 ? 1 : h;
        r = 255;
        g = (110 + 70 * (1 - t)) | 0;
        b = 40;
        a = Math.max(a, (140 + 100 * t) | 0);
      }
      d[o] = r;
      d[o + 1] = g;
      d[o + 2] = b;
      d[o + 3] = a;
    }
    this.burnCtx.putImageData(this.burnImg, 0, 0);
  }

  /** Blit the burn raster onto the radar using the SAME heading-up affine as the satellite map
   *  (so it stays registered). `a,b,c,dd,tx,tz` are the map-blit basis from drawRadar. */
  private drawBurnOverlay(
    ctx: CanvasRenderingContext2D,
    R: number,
    a: number,
    b: number,
    c: number,
    dd: number,
    tx: number,
    tz: number,
  ): void {
    const view = this.burnField;
    if (!view || !this.burnCanvas) return;
    if (this.burnAge++ >= 6) {
      this.burnAge = 0;
      this.rasterizeBurn(view);
    }
    const k = view.cellSize; // world units per burn-canvas pixel (one cell)
    const A = a * k;
    const B = c * k;
    const C = b * k;
    const D = dd * k;
    const E = R + a * tx + b * tz;
    const F = R + c * tx + dd * tz;
    ctx.save();
    ctx.setTransform(this.dpr * A, this.dpr * B, this.dpr * C, this.dpr * D, this.dpr * E, this.dpr * F);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.burnCanvas, 0, 0);
    ctx.restore();
  }

  /** Ego-centric radar: the heli is fixed at center pointing UP and the world
   *  rotates around it (heading-up). Under the blips sits a baked SATELLITE terrain
   *  map, cropped + rotated to the heli; then range rings, a soft forward cone,
   *  glowing fires (rim chevrons when out of range), and a north tick. */
  private drawRadar(s: HudState): void {
    const ctx = this.radarCtx;
    const dpr = this.dpr;
    const d = this.radarExpanded ? this.radarMax : this.radarBase;
    const R = d / 2;
    const reach = R - 9;
    // Collapsed = tight local map; expanded = (almost) the whole world.
    const range = this.radarExpanded ? s.worldSize * 0.52 : RANGE_NEAR;
    const scale = reach / range; // css px per world unit
    const cos = Math.cos(s.yaw);
    const sin = Math.sin(s.yaw);
    ctx.clearRect(0, 0, d, d);

    ctx.save();
    roundRectPath(ctx, 1, 1, d - 2, d - 2, 15);
    ctx.clip();

    // --- Satellite terrain backdrop: blit the world map, cropped + rotated so the
    // heli sits at center and the nose points up. The affine matches local() below
    // exactly, so the map and the blips stay perfectly registered. ---
    const S = s.worldSize;
    const k = S / this.minimap.width; // world units per source pixel
    const a = scale * sin;
    const b = scale * cos;
    const c = -scale * cos;
    const dd = scale * sin;
    const tx = -S / 2 - s.heliX;
    const tz = -S / 2 - s.heliZ;
    const A = a * k;
    const B = c * k;
    const C = b * k;
    const D = dd * k;
    const E = R + a * tx + b * tz;
    const F = R + c * tx + dd * tz;
    ctx.save();
    ctx.setTransform(dpr * A, dpr * B, dpr * C, dpr * D, dpr * E, dpr * F);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.minimap, 0, 0);
    ctx.restore(); // back to the dpr-scaled default; clip still active

    // Darken + vignette over the map for contrast and a glass-lens edge falloff.
    ctx.fillStyle = 'rgba(8,13,18,0.28)';
    ctx.fillRect(0, 0, d, d);
    const g = ctx.createRadialGradient(R, R, reach * 0.55, R, R, R);
    g.addColorStop(0, 'rgba(6,10,14,0)');
    g.addColorStop(1, 'rgba(4,7,10,0.55)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, d, d);

    // C5: burnt-area scar + live front, registered to the map by the same affine basis.
    this.drawBurnOverlay(ctx, R, a, b, c, dd, tx, tz);

    // Forward field-of-view cone (points up).
    const cone = ctx.createRadialGradient(R, R, 2, R, R, reach);
    cone.addColorStop(0, 'rgba(103,232,255,0.14)');
    cone.addColorStop(1, 'rgba(103,232,255,0)');
    ctx.fillStyle = cone;
    ctx.beginPath();
    ctx.moveTo(R, R);
    ctx.arc(R, R, reach, -Math.PI / 2 - 0.5, -Math.PI / 2 + 0.5);
    ctx.closePath();
    ctx.fill();

    // Range rings.
    ctx.strokeStyle = 'rgba(255,255,255,0.13)';
    ctx.lineWidth = 1;
    for (const rr of [0.5, 1]) {
      ctx.beginPath();
      ctx.arc(R, R, reach * rr, 0, Math.PI * 2);
      ctx.stroke();
    }

    // World → ego-centric (heading-up) screen position (same math as the map affine).
    const local = (wx: number, wz: number) => {
      const dx = wx - s.heliX;
      const dz = wz - s.heliZ;
      const fwd = dx * cos + dz * -sin; // along nose
      const rgt = dx * sin + dz * cos; // along right
      return { x: R + rgt * scale, y: R - fwd * scale }; // up = forward
    };

    // Refuel bases (home + forward pads) — a green helipad "H" marker. In range: an H glyph; out of
    // range: a chevron pinned to the rim. When fuel is LOW the NEAREST base turns amber + glows and a
    // dashed needle points at it from centre, so "return to the nearest base to refuel" has a target.
    if (s.bases && s.bases.length) {
      let near = s.bases[0];
      let nearD = Infinity;
      for (const b of s.bases) {
        const d = Math.hypot(b.x - s.heliX, b.z - s.heliZ);
        if (d < nearD) {
          nearD = d;
          near = b;
        }
      }
      const low = !!s.fuelLow;
      const PAD = '#5fe0a0'; // soft green = friendly fuel/refuel pad (distinct from cyan crew LZs)
      for (const b of s.bases) {
        const p = local(b.x, b.z);
        const ox = p.x - R;
        const oy = p.y - R;
        const hot = low && b === near; // the RTB target, highlighted when low
        const col = hot ? UI.warn : PAD;
        if (Math.hypot(ox, oy) <= reach) {
          ctx.save();
          if (hot) {
            ctx.shadowColor = UI.warn;
            ctx.shadowBlur = 9;
          }
          ctx.strokeStyle = col;
          ctx.lineWidth = 1.6;
          ctx.beginPath();
          ctx.arc(p.x, p.y, 4.5, 0, Math.PI * 2); // pad ring
          ctx.stroke();
          ctx.beginPath(); // "H" glyph
          ctx.moveTo(p.x - 2, p.y - 2.6);
          ctx.lineTo(p.x - 2, p.y + 2.6);
          ctx.moveTo(p.x + 2, p.y - 2.6);
          ctx.lineTo(p.x + 2, p.y + 2.6);
          ctx.moveTo(p.x - 2, p.y);
          ctx.lineTo(p.x + 2, p.y);
          ctx.stroke();
          ctx.restore();
        } else {
          const a = Math.atan2(oy, ox);
          ctx.save();
          ctx.translate(R + Math.cos(a) * reach, R + Math.sin(a) * reach);
          ctx.rotate(a);
          if (hot) {
            ctx.shadowColor = UI.warn;
            ctx.shadowBlur = 8;
          }
          ctx.fillStyle = col;
          ctx.beginPath();
          ctx.moveTo(3, 0);
          ctx.lineTo(-3, -3);
          ctx.lineTo(-3, 3);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
        }
      }
      // Low-fuel RTB needle: a dashed line from centre toward the nearest base.
      if (low) {
        const p = local(near.x, near.z);
        const a = Math.atan2(p.y - R, p.x - R);
        ctx.save();
        ctx.strokeStyle = UI.warn;
        ctx.lineWidth = 1.4;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(R, R);
        ctx.lineTo(R + Math.cos(a) * reach * 0.92, R + Math.sin(a) * reach * 0.92);
        ctx.stroke();
        ctx.restore();
      }
    }

    // Structures to defend — small squares: intact (accent), burning (amber), lost (dim).
    for (const st of s.structures) {
      const p = local(st.x, st.z);
      if (Math.hypot(p.x - R, p.y - R) > reach) continue; // skip off-radar
      const dead = st.health <= 0;
      const half = st.kind === 'depot' ? 4 : 3;
      const col = dead ? 'rgba(150,150,150,0.5)' : st.burning ? '#ffb24a' : UI.accent;
      ctx.fillStyle = col;
      if (st.burning && !dead) {
        ctx.shadowColor = '#ffb24a';
        ctx.shadowBlur = 7;
      }
      ctx.fillRect(p.x - half, p.y - half, half * 2, half * 2);
      ctx.shadowBlur = 0;
      if (dead) {
        // a small X over a lost structure
        ctx.strokeStyle = 'rgba(255,93,77,0.8)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(p.x - half, p.y - half);
        ctx.lineTo(p.x + half, p.y + half);
        ctx.moveTo(p.x + half, p.y - half);
        ctx.lineTo(p.x - half, p.y + half);
        ctx.stroke();
      }
    }

    // Crew landing zones (campaign): a hollow diamond. The reusable BASE is the always-marked HOME
    // pad (green, glowing, a touch larger — unmistakable); the LZs are active = cyan, done = grey.
    // With sequential targeting, exactly ONE LZ is ever cyan at a time (the guide the player follows).
    if (s.zones) {
      const HOME = '#5fe0a0'; // green = home base (matches the refuel-pad tint)
      for (const zn of s.zones) {
        const p = local(zn.x, zn.z);
        const ox = p.x - R;
        const oy = p.y - R;
        if (Math.hypot(ox, oy) > reach) {
          // Off the local radar: the ACTIVE target still gets a chevron pinned to the rim so you
          // always know which way to fly to reach it (the hint text fades, but the pointer stays).
          // Home direction is already carried by the green refuel-base markers, and done/inactive
          // zones would just clutter the rim — so only the one lit LZ. Matches the fire/base chevrons.
          if (!zn.active) continue;
          const a = Math.atan2(oy, ox);
          ctx.save();
          ctx.translate(R + Math.cos(a) * reach, R + Math.sin(a) * reach);
          ctx.rotate(a);
          ctx.fillStyle = UI.accent;
          ctx.shadowColor = UI.accent;
          ctx.shadowBlur = 8;
          ctx.beginPath();
          ctx.moveTo(3, 0);
          ctx.lineTo(-3, -3);
          ctx.lineTo(-3, 3);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
          ctx.shadowBlur = 0;
          continue;
        }
        const r = zn.home ? 5.5 : 4.5;
        const col = zn.home
          ? HOME
          : zn.done
            ? 'rgba(150,160,165,0.55)'
            : zn.active
              ? UI.accent
              : 'rgba(103,232,255,0.4)';
        ctx.strokeStyle = col;
        ctx.lineWidth = zn.home ? 2 : 1.6;
        if (zn.home || zn.active) {
          ctx.shadowColor = col;
          ctx.shadowBlur = 8;
        }
        ctx.beginPath();
        ctx.moveTo(p.x, p.y - r);
        ctx.lineTo(p.x + r, p.y);
        ctx.lineTo(p.x, p.y + r);
        ctx.lineTo(p.x - r, p.y);
        ctx.closePath();
        ctx.stroke();
        ctx.shadowBlur = 0;
      }
    }

    // Fires — in range: glowing dot; out of range: chevron pinned to the rim.
    for (const f of s.fires) {
      const p = local(f.x, f.z);
      const ox = p.x - R;
      const oy = p.y - R;
      const dist = Math.hypot(ox, oy);
      if (dist <= reach) {
        ctx.fillStyle = 'rgba(255,42,42,0.32)'; // RED halo — a fire MARKER, distinct from the orange burn shade
        ctx.beginPath();
        ctx.arc(p.x, p.y, 5.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = UI.fireMarker;
        ctx.shadowColor = UI.fireMarker;
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 2.6, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      } else {
        const a = Math.atan2(oy, ox);
        const rx = R + Math.cos(a) * reach;
        const ry = R + Math.sin(a) * reach;
        ctx.save();
        ctx.translate(rx, ry);
        ctx.rotate(a);
        ctx.fillStyle = UI.fireMarker;
        ctx.beginPath();
        ctx.moveTo(2, 0);
        ctx.lineTo(-3, -3);
        ctx.lineTo(-3, 3);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
    }

    // Place names (A5) — drawn screen-UPRIGHT (the map under them is rotated, but text
    // must read level). Communities always; lake names only on the expanded radar (they'd
    // clutter the tight local view). A dark stroke keeps them legible over any terrain.
    const drawLabel = (wx: number, wz: number, text: string, color: string, dy: number, size: number): void => {
      const p = local(wx, wz);
      if (Math.hypot(p.x - R, p.y - R) > reach - 6) return; // off-radar
      ctx.font = `600 ${size}px ${UI.font}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 2.4;
      ctx.lineJoin = 'round';
      ctx.strokeStyle = 'rgba(4,8,12,0.85)';
      ctx.strokeText(text, p.x, p.y + dy);
      ctx.fillStyle = color;
      ctx.fillText(text, p.x, p.y + dy);
    };
    if (this.radarExpanded) {
      for (const lk of this.labels.lakes) drawLabel(lk.x, lk.z, lk.name, 'rgba(150,205,235,0.92)', 0, 8);
    }
    for (const c of this.labels.communities) {
      drawLabel(c.x, c.z, c.name, 'rgba(232,238,242,0.95)', this.radarExpanded ? -8 : -7, 9);
    }

    ctx.restore(); // unclip

    // Heli — fixed at center, pointing up.
    ctx.fillStyle = '#fff';
    ctx.shadowColor = UI.accent;
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.moveTo(R, R - 6);
    ctx.lineTo(R - 4.5, R + 5);
    ctx.lineTo(R, R + 2.5);
    ctx.lineTo(R + 4.5, R + 5);
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0;

    // Rim + north marker (tracks where north sits as you turn).
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 1;
    roundRectPath(ctx, 1, 1, d - 2, d - 2, 15);
    ctx.stroke();
    const nx = -cos; // local screen dir of north (0,−Z)
    const ny = -sin;
    const nlen = Math.hypot(nx, ny) || 1;
    ctx.fillStyle = UI.accent;
    ctx.font = '700 9px ' + UI.font;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('N', R + (nx / nlen) * (reach - 4), R + (ny / nlen) * (reach - 4));
    // (Wind moved to the top instrument strip's wind cell — no longer drawn on the radar.)
  }
}

/** Trace a rounded-rectangle path (clip/stroke the square radar lens). */
function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
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

// --- Instrument-strip cells -------------------------------------------------
// Compact icon + NUMBER cells inside the single frosted capsule. Stroked 24x24
// glyphs (same idiom as the eye icon); icon size + number font are set per breakpoint.
const WATER_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="#67e8ff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M12 3.2C12 3.2 5.5 10.3 5.5 14.5a6.5 6.5 0 0 0 13 0C18.5 10.3 12 3.2 12 3.2Z"/></svg>';
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

/** Build one strip cell: a stroked icon + a bold numeric readout, with a hairline divider on
 *  its left so the readouts read as one cluster (the pill supplies the glass; the cell is
 *  transparent). `withBar` adds a thin animated fill track across the cell's base for the 0..1
 *  resource gauges (water/hull/fuel/threat) — function = icon + number, plus a glanceable bar. */
function makePod(iconSvg: string, withBar = false): Pod {
  const cell = el('div', {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '0 9px',
    lineHeight: '1',
    position: 'relative', // anchor the optional fill bar
    boxShadow: `inset 1px 0 0 ${UI.stroke}`, // hairline divider on the left edge (free, layout-neutral)
  });
  const box = el('div', { flex: '0 0 auto', display: 'flex', alignItems: 'center', justifyContent: 'center' });
  box.innerHTML = iconSvg;
  const svg = box.querySelector('svg') as SVGElement;
  const num = el('div', {
    fontWeight: FW.semibold,
    color: UI.text,
    lineHeight: '1',
    textAlign: 'left',
  });
  num.style.setProperty('font-variant-numeric', 'tabular-nums');
  cell.append(box, num);

  let barFill: HTMLDivElement | undefined;
  if (withBar) {
    // A hairline progress track pinned across the cell's base. Absolutely placed so it never
    // disturbs the icon+number flex row; the fill scales on the X axis (GPU transform, no layout)
    // with a short transition so a change in level reads as smooth motion, not a jump.
    const track = el('div', {
      position: 'absolute',
      left: '8px',
      right: '8px',
      bottom: '2px',
      height: '2.5px',
      borderRadius: R.xs,
      background: 'rgba(255,255,255,0.13)',
      overflow: 'hidden',
    });
    barFill = el('div', {
      width: '100%',
      height: '100%',
      borderRadius: R.xs,
      background: UI.accent,
      transformOrigin: 'left center',
      transform: 'scaleX(1)',
      transition: 'transform 0.18s ease, background-color 0.2s ease, box-shadow 0.2s ease',
    });
    track.appendChild(barFill);
    cell.appendChild(track);
  }
  return { cell, svg, num, barFill };
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
  const cell = el('div', {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '0 10px',
    color: UI.dim,
    lineHeight: '1',
    cursor: 'pointer',
    pointerEvents: 'auto',
    transition: 'color 0.15s ease',
  });
  cell.textContent = '☰';
  cell.addEventListener('pointerenter', () => (cell.style.color = UI.accent));
  cell.addEventListener('pointerleave', () => (cell.style.color = UI.dim));
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

/** Collapse a cell entirely (hides FUEL / THREAT when a mission doesn't use them). */
function setPodHidden(p: Pod, hidden: boolean): void {
  p.cell.style.display = hidden ? 'none' : 'flex';
}

/** Seconds → m:ss for survive / time-limit readouts. */
function fmtTime(sec: number): string {
  const s = Math.max(0, Math.ceil(sec));
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
}

/** A pill button for the mission end banner. */
function bannerButton(text: string, accent: string, onClick: () => void): HTMLDivElement {
  const b = el('div', {
    padding: '10px 18px',
    borderRadius: R.pill,
    border: `1px solid ${accent}`,
    color: accent,
    fontSize: FS.md,
    fontWeight: FW.bold,
    letterSpacing: '1px',
    cursor: 'pointer',
    pointerEvents: 'auto',
    background: 'rgba(255,255,255,0.04)',
  });
  b.textContent = text;
  b.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    onClick();
  });
  return b;
}

/** The "NEW AIRCRAFT UNLOCKED" celebration strip on the end screen — one accent-framed panel listing
 *  each airframe whose campaign gate this win just crossed (name + tagline). */
function unlockCallout(items: { name: string; tagline: string }[]): HTMLDivElement {
  const box = el('div', {
    marginTop: '16px',
    padding: '12px 16px',
    borderRadius: R.md,
    border: `1px solid ${UI.accent}66`,
    background: UI.accentFill,
    boxShadow: `0 0 16px ${UI.accent}33`,
    textAlign: 'center',
  });
  box.appendChild(
    el('div', { fontSize: FS.label, fontWeight: FW.heavy, letterSpacing: '2px', color: UI.accent }, '🎉 NEW AIRCRAFT UNLOCKED'),
  );
  for (const it of items) {
    box.appendChild(el('div', { fontSize: FS.title, fontWeight: FW.bold, marginTop: '6px' }, `🚁 ${it.name}`));
    box.appendChild(el('div', { fontSize: FS.meta, color: 'rgba(231,247,255,0.7)', marginTop: '1px' }, it.tagline));
  }
  box.appendChild(
    el('div', { fontSize: FS.meta, color: UI.dim, marginTop: '8px' }, 'Choose it from the aircraft carousel on the menu.'),
  );
  return box;
}

/** Rank-letter colours: S gold (mastery) → A green → B cyan → C neutral → D red (a sloppy win). */
const GRADE_COLORS: Record<ScoreGrade, string> = {
  S: '#ffce54',
  A: '#7cffb2',
  B: UI.accent,
  C: '#cfe6f2',
  D: UI.warn,
};

/** The big rank-letter badge under the headline (win only) — the run's headline accolade, with
 *  the star medal (1..3) beneath it. */
function gradeBadge(grade: ScoreGrade, stars: number | null): HTMLDivElement {
  const c = GRADE_COLORS[grade];
  const col = el('div', { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '7px', marginTop: '10px' });
  const wrap = el('div', { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px' });
  wrap.appendChild(el('div', { fontSize: FS.sm, letterSpacing: '3px', color: UI.dim, fontWeight: FW.bold }, 'RANK'));
  wrap.appendChild(el('div', { fontSize: FS.mega, fontWeight: FW.black, lineHeight: '1', color: c, textShadow: `0 0 18px ${c}66` }, grade));
  col.appendChild(wrap);
  if (stars) {
    const row = el('div', { display: 'flex', gap: '3px', fontSize: FS.lg, lineHeight: '1' });
    for (let i = 1; i <= 3; i++) row.appendChild(el('div', { color: i <= stars ? UI.warm : UI.faint }, i <= stars ? '★' : '☆'));
    col.appendChild(row);
  }
  return col;
}

/**
 * The itemised score breakdown on the end banner — the whole point of the rework: the player SEES where
 * the points came from. Outcome / skill / coordination lines, the hardship × multiplier, red penalty
 * lines, a divider, then the total + run time. Pure presentation over the pre-computed `ScoreBreakdown`.
 */
function scoreBreakdownBlock(b: ScoreBreakdown, timeSec: number): HTMLDivElement {
  const box = el('div', {
    marginTop: '14px',
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    padding: '12px 16px',
    borderRadius: R.md,
    background: 'rgba(255,255,255,0.04)',
    border: `1px solid ${UI.stroke}`,
    fontSize: FS.body,
    minWidth: '214px',
  });
  for (const ln of b.lines) {
    const row = el('div', { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '18px' });
    const left = el('div', { display: 'flex', gap: '6px', alignItems: 'baseline', color: ln.kind === 'sub' ? UI.warn : UI.dim }, ln.label);
    if (ln.note) left.appendChild(el('span', { color: 'rgba(231,247,255,0.4)', fontSize: FS.meta }, ln.note));
    row.appendChild(left);
    let text: string;
    let color: string;
    if (ln.kind === 'mul') {
      text = `×${ln.value.toFixed(2)}`;
      color = UI.accent;
    } else if (ln.kind === 'sub') {
      text = ln.value.toLocaleString(); // already negative
      color = UI.warn;
    } else {
      text = `+${ln.value.toLocaleString()}`;
      color = 'rgba(231,247,255,0.92)';
    }
    row.appendChild(el('div', { color, fontWeight: FW.bold, whiteSpace: 'nowrap' }, text));
    box.appendChild(row);
  }
  box.appendChild(el('div', { height: '1px', background: UI.stroke, margin: '6px 0 2px' }));
  const total = el('div', { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '18px' });
  total.appendChild(el('div', { color: 'rgba(231,247,255,0.92)', fontWeight: FW.heavy, letterSpacing: '1px', fontSize: FS.md }, 'SCORE'));
  total.appendChild(el('div', { color: UI.accent, fontWeight: FW.heavy, fontSize: FS.hero }, b.total.toLocaleString()));
  box.appendChild(total);
  box.appendChild(el('div', { color: UI.dim, fontSize: FS.meta, marginTop: '2px', textAlign: 'right' }, `time ${fmtTime(timeSec)}`));
  return box;
}

