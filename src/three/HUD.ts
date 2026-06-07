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

import type { TrackerItem, CommsSpeaker, CommsUrgency, MissionDef, Objective } from './missions/types';
import type { FireFieldView } from './sim/FireSystem';
import { UI, FS, FW, R, el, frosted, makeCanvas, clamp01, anchor, prefersReducedMotion } from './ui/theme';
import { onLayout, type LayoutState } from './ui/layout';
import { Radar } from './hud/Radar';
import { EndScreen } from './hud/EndScreen';
import { EngineStart } from './hud/engineStart';
import { CoachOverlay } from './ui/coach/CoachOverlay';
import type { CoachPrompt } from './ui/coach/CoachDirector';
import { bannerButton, fmtTime, AIRFRAME_OK } from './hud/common';
import type { HudState, EndScreenHooks, MapLabels } from './hud/types';

// Re-exported so every existing `import { … } from './HUD'` keeps working unchanged.
export type { HudState, EndScreenHooks, MapLabels };

// Design tokens + DOM helpers (el / frosted / makeCanvas / clamp01) live in ui/theme.ts and are
// imported above, so the HUD and the touch controls share one glass-cockpit language. `anchor()`
// (also from theme) + `onLayout` (layout.ts) drive the responsive, safe-area-aware placement.

const TAPE_W = 78; // jet tape canvas width
const TAPE_H = 188; // jet tape canvas height (the scrolling window)
const LOW_AGL_FT = 250; // altimeter reads LOW (red) below this AGL in feet
const HINT_VISIBLE_MS = 3600; // status hint flashes on, then auto-fades after this (no permanent nag)

// --- Pre-flight DISPATCH SLIP helpers ------------------------------------------------------------
// The briefing card reads like a fireline dispatch slip: fielded SITUATION / TASK / WINDS rows, not a
// prose paragraph. TASK + WINDS are DERIVED from the MissionDef so they can never drift from what the
// mission actually is (the win rule, the seeded wind). Mono labels in the warm/fight register.
const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';
const TIME_OF_DAY_LABEL: Record<string, string> = {
  dawn: 'DAWN',
  day: 'DAY',
  noon: 'NOON',
  overcast: 'OVERCAST',
  golden: 'GOLDEN HR',
  dusk: 'DUSK',
};

/** One terse TASK phrase per objective — derived so the slip can't contradict the real win rule. */
function briefTaskPhrase(o: Objective): string {
  switch (o.kind) {
    case 'extinguishAll':
      return 'Put every fire out.';
    case 'extinguishCount':
      return `Knock down ${o.n ?? 0} fires.`;
    case 'deliver':
      return o.label ?? `Work ${o.n ?? 0} zones.`;
    case 'evacuate':
      return o.label ?? `Lift ${o.n ?? 0} families clear.`;
    case 'survive':
      return o.seconds ? `Hold the line ${Math.round(o.seconds)}s.` : 'Hold the line.';
    case 'backburn':
      return 'Lay the backburn line.';
  }
}

/** WINDS row from the mission's wind-strength scale (1 = the config baseline when unset). */
function briefWindPhrase(scale: number | undefined): string {
  const s = scale ?? 1;
  if (s <= 0.4) return 'Light, variable.';
  if (s <= 0.8) return 'Light.';
  if (s <= 1.1) return 'Moderate.';
  if (s <= 1.4) return 'Strong, gusting.';
  return 'Extreme — gusting hard.';
}

// Inject the warning-caption flash keyframes once (the GPWS-style "SINK RATE" / "PULL UP" / "TERRAIN"
// alert pulses to read as urgent). Pattern mirrors ui/flow/chrome.ts. Reduced-motion users get a
// steady caption instead (HUD.setAlert skips the animation), so this is purely the throb.
let alertStylesInjected = false;
function ensureAlertStyles(): void {
  if (alertStylesInjected) return;
  alertStylesInjected = true;
  const tag = document.createElement('style');
  tag.textContent = `@keyframes bmf-alert-pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.45; } }`;
  document.head.appendChild(tag);
}

export class HUD {
  private readonly root: HTMLDivElement;
  private unsubLayout: (() => void) | null = null; // onLayout unsubscribe — detached in dispose()

  // Instrument strip: ONE frosted capsule of compact icon + NUMBER "pods" laid out
  // as a horizontal, wrapping top band (water / airframe / fuel / fires / threat / compass /
  // wind) — the mobile-portrait "all info in the top band, no bars" layout. Pods are
  // transparent — only the capsule carries glass, so it's a single backdrop-blur layer.
  private readonly spine: HTMLDivElement;
  private readonly waterPod: Pod;
  private waterNumBg = ''; // baseline water-readout color (captured at build), restored after a drop-result flash
  private waterIconStroke = '#eaf6ff'; // baseline water-icon stroke (captured at build), restored when a bucket is re-rigged
  private gaugeFlashTimer = 0; // setTimeout id: restore the water readout after a result tint
  private readonly airframePod: Pod;
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
  private objPrev = new Map<string, { current: number; done: boolean }>(); // per-goal last state → flash on advance
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
  private readonly hitFlash: HTMLDivElement; // red impact vignette pulsed on a hard-landing airframe dent
  private hitFlashTimer = 0; // setTimeout id: fade the impact flash back out
  private readonly alertEl: HTMLDivElement; // big centred GPWS-style caption (SINK RATE / PULL UP / TERRAIN)
  private alertText: string | null = null; // current caption (idempotent guard — never re-trigger the same one)
  private readonly commsWrap: HTMLDivElement; // radio comms log (DISPATCH/CREW/WARNING toasts)

  // Fighter-jet scrolling tapes (canvas): airspeed left of the heli, altitude right.
  private readonly spdCtx: CanvasRenderingContext2D;
  private readonly altCtx: CanvasRenderingContext2D;
  private tapeGap = 70; // px from center to each flight tape (set by applyLayout)
  private spdCanvas!: HTMLCanvasElement;
  private altCanvas!: HTMLCanvasElement;

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
    // there's nothing to warn about, so it costs nothing while flying clean. ---
    ensureAlertStyles();
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
    if (end) {
      this.menuCell = makeMenuCell(end.onMenu);
      this.spine.appendChild(this.menuCell);
    }
    // Resource gauges (water / airframe / fuel / threat) carry a thin animated fill BAR at the cell's
    // base — the glanceable "how full / how healthy" cue the bare number didn't convey. Count + units
    // cells (fires / compass / wind) stay number-only.
    this.waterPod = makePod(WATER_SVG, true); // % of bucket capacity
    this.waterNumBg = this.waterPod.num.style.color; // baseline readout color, restored after a drop-result flash
    this.waterIconStroke = this.waterPod.svg.getAttribute('stroke') ?? '#eaf6ff'; // restored when a bucket is re-rigged
    this.airframePod = makePod(HEALTH_SVG, true); // airframe %
    this.fuelPod = makePod(FUEL_SVG, true); // tank %
    this.firesPod = makePod(FIRES_SVG); // fires remaining (count)
    this.threatPod = makePod(THREAT_SVG, true); // most-endangered structure %
    this.crewPod = makePod(CREW_SVG, true); // crew aboard (0/1) — bar reads as a filled/empty seat
    this.compassPod = makePod(COMPASS_SVG); // heading °
    this.windPod = makePod(WIND_SVG); // wind kt (icon rotates to the heading-relative gust)
    this.pods = [
      this.waterPod,
      this.airframePod,
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
    setPodHidden(this.compassPod, true); // #10 density: numeric heading is redundant with the heading-up radar — hidden to thin the in-flight strip (flip to false to restore)
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

    // --- Radar (top-right anchor) — its own module owns the canvas + interaction. The radio comms
    // tuck in directly under the map (same column, reflow down when the radar expands). ---
    this.radar = new Radar(minimap, labels ?? { communities: [], lakes: [] });
    this.topRight = anchor('top-right');
    this.topRight.appendChild(this.radar.canvas);
    this.topRight.appendChild(this.commsWrap);
    this.root.appendChild(this.topRight);

    // Mission end screen + cold-start dial — fire-once sub-systems mounted into the root on demand.
    this.endScreen = new EndScreen(this.root, end, this.pilotName);
    this.engine = new EngineStart(this.root);
    this.coach = new CoachOverlay(this.root);

    parent.appendChild(this.root);

    // Size + place everything for the current breakpoint, and re-apply on every
    // resize / orientation change (event-driven — never per frame).
    this.unsubLayout = onLayout((s) => this.applyLayout(s));
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

    // Radar — collapsed base per set; expanded capped to the short viewport side. The radar
    // module owns the canvas + backing store; we just hand it the two computed sizes.
    const radarBase = radarW;
    const radarMax = Math.max(radarBase + 40, Math.round(Math.min(set.radarMaxFrac * Math.min(s.w, s.h), 320)));
    this.radar.setLayout(radarBase, radarMax);

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
    if (s.bucketDetached) {
      // No bucket on the line — read "NO" with a warn-amber droplet + empty bar + a dimmed cell, so the
      // gauge says "you have nothing to scoop or drop" rather than a misleading 0% (RTB to a base to re-rig).
      this.waterPod.num.textContent = 'NO';
      this.waterPod.svg.setAttribute('stroke', UI.warn);
      this.waterPod.cell.style.opacity = '0.6';
      setPodBar(this.waterPod, 0, UI.warn, false);
    } else {
      const waterFrac = clamp01(s.water / s.waterMax);
      this.waterPod.num.textContent = `${Math.round(waterFrac * 100)}`;
      this.waterPod.svg.setAttribute('stroke', this.waterIconStroke);
      this.waterPod.cell.style.opacity = '1';
      setPodBar(this.waterPod, waterFrac, UI.accent, !!s.scooping); // glow while actively filling → "keep dipping"
    }
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

    this.radar.draw(s);

    if ((s.won || s.lost) && !this.endScreen.shown) this.endScreen.show(s);
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
      const col = t.failed ? UI.warn : t.done ? UI.accent : 'rgba(231,247,255,0.85)';
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
        row.style.backgroundColor = t.done ? UI.accentFill : 'rgba(103,232,255,0.22)';
        requestAnimationFrame(() => {
          row.style.transition = 'background-color 0.6s ease';
          row.style.backgroundColor = 'transparent';
        });
      }
    }
    this.objPrev = next;
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
    const col = boarding ? UI.accent : UI.ok; // cyan picking up / green setting down (#8: was an ad-hoc 3rd green, now the shared success token)
    this.crewBarLabel.textContent = boarding ? 'CREW BOARDING' : 'CREW DISEMBARKING';
    this.crewBarLabel.style.color = col;
    this.crewBarFill.style.background = col;
    this.crewBarFill.style.transform = `scaleX(${clamp01(crew.progress)})`;
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

  // --- Radio comms + pre-flight briefing (the mission "experience" layer) ----

  /**
   * Personalize a radio/briefing line: the mission catalog + hardcoded callouts use "Water-1" as the
   * pilot callsign placeholder (see missions/catalog.ts), so swap in the player's own callsign and
   * Dispatch addresses them by name. No profile (e.g. headless ?autostart) → the "Water-1" default
   * rides through unchanged.
   */
  private personalize(text: string): string {
    const name = this.pilotName;
    if (!name) return text;
    return text.replace(/Water-1/g, () => name); // fn form: a "$"-bearing callsign can't trigger replace's special patterns
  }

  /**
   * Post a radio line to the comms log: a slim frosted toast tagged DISPATCH / CREW / WARNING,
   * dropping in UNDER THE RADAR (right) and auto-expiring. A small colored tag sits inline before
   * the text (one tight line, not a chunky card). Created on demand (events, not per-frame); the
   * stack is capped to a few visible lines so it never crowds the HUD.
   */
  pushComms(speaker: CommsSpeaker, text: string, urgency: CommsUrgency): void {
    text = this.personalize(text);
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
   * Pre-flight DISPATCH SLIP (the arc's opening): a frosted modal over the frozen scene styled like a
   * fireline dispatch slip — a mono header strip, the mission no. + name + threat pips, then fielded
   * SITUATION / TASK / WINDS rows (TASK + WINDS derived from the def so they can't drift from the real
   * scenario), and a BEGIN FLIGHT button. Warm/fight register chrome, cyan action. Game keeps the sim +
   * clock paused until `onBegin` fires. Dismissed on BEGIN or a tap on the scrim.
   */
  showBriefing(def: MissionDef, onBegin: () => void): void {
    this.endScreen.setContext(def); // capture name/place/index + prior best for the end-screen + Share text
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
    const card = frosted({ maxWidth: '420px', margin: '0 20px', padding: '0', borderRadius: R.xl, overflow: 'hidden' });

    // Header strip — the dispatch banner. Mono, warm tint, ruled off from the body.
    const head = el('div', {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: '11px 18px',
      background: 'rgba(255,106,44,0.10)',
      borderBottom: `1px solid ${UI.stroke}`,
      fontFamily: MONO,
      fontSize: FS.tag,
      fontWeight: FW.bold,
      letterSpacing: '2px',
    });
    head.appendChild(el('div', { color: UI.emberHi }, 'DISPATCH BRIEFING'));
    head.appendChild(el('div', { color: UI.dim }, def.timeOfDay ? (TIME_OF_DAY_LABEL[def.timeOfDay] ?? '') : ''));
    card.appendChild(head);

    const body = el('div', { padding: '15px 18px 16px' });

    // Mission number (mono, dim) over the title + threat pips.
    body.appendChild(
      el('div', { fontFamily: MONO, fontSize: FS.tag, fontWeight: FW.bold, letterSpacing: '2px', color: UI.dim, marginBottom: '3px' }, `MISSION ${String(def.index + 1).padStart(2, '0')}`),
    );
    const titleRow = el('div', { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' });
    titleRow.appendChild(el('div', { fontSize: FS.title, fontWeight: FW.heavy, letterSpacing: '0.4px', textTransform: 'uppercase' }, def.name));
    const pips = el('div', { display: 'flex', gap: '3px', flexShrink: '0' });
    for (let i = 0; i < 5; i++) {
      pips.appendChild(el('div', { width: '14px', height: '4px', borderRadius: R.pill, background: i < def.difficulty ? UI.fire : 'rgba(255,255,255,0.14)' }));
    }
    titleRow.appendChild(pips);
    body.appendChild(titleRow);

    // Hairline-ruled fielded rows — the "document" feel: a mono label gutter, dry value.
    const rule = (): HTMLElement => el('div', { height: '1px', background: UI.stroke, margin: '12px 0' });
    const field = (key: string, value: string): HTMLElement => {
      const row = el('div', { display: 'flex', gap: '12px', alignItems: 'baseline', marginBottom: '9px' });
      row.appendChild(el('div', { flex: '0 0 62px', fontFamily: MONO, fontSize: FS.tag, fontWeight: FW.bold, letterSpacing: '1.5px', color: UI.ember }, key));
      row.appendChild(el('div', { flex: '1', fontSize: FS.sm, lineHeight: '1.42', color: UI.text }, value));
      return row;
    };

    body.appendChild(rule());
    body.appendChild(field('SITUATION', this.personalize(def.situation ?? def.tagline ?? def.brief)));
    body.appendChild(field('TASK', def.objectives.map(briefTaskPhrase).join('  ·  ')));
    body.appendChild(field('WINDS', briefWindPhrase(def.wind?.strengthScale)));
    body.appendChild(rule());

    const begin = bannerButton('BEGIN FLIGHT ▸', 'primary', () => {
      scrim.remove();
      onBegin();
    });
    const actions = el('div', { display: 'flex', justifyContent: 'flex-end', marginTop: '2px' });
    actions.appendChild(begin);
    body.appendChild(actions);

    card.appendChild(body);
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
    window.clearTimeout(this.gaugeFlashTimer);
    window.clearTimeout(this.hintHideTimer);
    window.clearTimeout(this.hintFadeTimer);
    window.clearTimeout(this.hitFlashTimer);
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
 *  resource gauges (water/airframe/fuel/threat) — function = icon + number, plus a glanceable bar. */
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
