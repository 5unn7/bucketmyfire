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

import type { TrackerItem } from './missions/types';
import type { FireFieldView } from './sim/FireSystem';

export interface HudState {
  water: number;
  waterMax: number;
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
  threat: number; // 0..1 — most-endangered structure (drives the THREAT gauge)
  lost: boolean; // every structure destroyed → mission failed
  score: number; // final score (shown on the end banner)
  // Campaign layer: the live objective checklist + optional fuel gauge. Empty / undefined
  // in the open sandbox, so the mission UI simply doesn't render.
  objectives?: readonly TrackerItem[];
  fuel?: number; // 0..1 tank fraction (undefined → no FuelSim → fuel gauge hidden)
  fuelLow?: boolean; // gauge flashes (below reserve)
  zones?: { x: number; z: number; active: boolean; done: boolean }[]; // crew landing zones (radar blips)
}

/** Campaign end-banner callbacks (set by Game from main's mission router). */
export interface EndScreenHooks {
  hasNext: boolean; // is there a next mission to advance to?
  onNext(): void; // ▶ Next sortie
  onMenu(): void; // ◂ Mission menu
  onRetry(): void; // ↻ Retry this mission
  onLeaderboard?(): void; // 🏆 open the global leaderboard on this mission
}

/** Static world place-name labels for the radar (A5) — set once, world-fixed. */
export interface MapLabels {
  communities: { name: string; x: number; z: number }[];
  lakes: { name: string; x: number; z: number }[];
}

// --- Design tokens ----------------------------------------------------------
const UI = {
  accent: '#67e8ff',
  accentSoft: 'rgba(103,232,255,0.55)',
  text: 'rgba(255,255,255,0.94)',
  dim: 'rgba(255,255,255,0.45)',
  warn: '#ff5d4d',
  fire: '#ff7a45',
  water: '#56c4ee',
  panel: 'rgba(14,20,27,0.38)',
  stroke: 'rgba(255,255,255,0.12)',
  blur: 'blur(12px) saturate(120%)',
  font: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  shadow: '0 6px 28px rgba(0,0,0,0.32)',
  glow: '0 0 10px rgba(103,232,255,0.45)',
};

const TAPE_W = 78; // jet tape canvas width
const TAPE_H = 188; // jet tape canvas height (the scrolling window)
const TAPE_GAP = 70; // px from screen center to each tape's inner edge (clearance for the heli)
const LOW_AGL_FT = 250; // altimeter reads LOW (red) below this AGL in feet
const HEAD_W = 244;
const HEAD_H = 34;
const RADAR_MIN = 128; // collapsed radar side (px, square)
const RADAR_MAX = 300; // expanded radar side (px)
const RANGE_NEAR = 160; // world units to the radar edge when collapsed (zoomed-in local map)

export class HUD {
  private readonly root: HTMLDivElement;

  private readonly waterFill: HTMLDivElement;
  private readonly firesText: HTMLDivElement;
  private readonly threatFill: HTMLDivElement; // C3: structure-danger gauge
  private readonly fuelWrap: HTMLDivElement; // campaign fuel gauge (hidden unless fuel supplied)
  private readonly fuelFill: HTMLDivElement;
  private readonly objPanel: HTMLDivElement; // campaign objective checklist (hidden in sandbox)
  private objSig = ''; // last-rendered objective signature (skip DOM churn when unchanged)
  private readonly hint: HTMLDivElement;
  private readonly smoke: HTMLDivElement; // C5: blinding-smoke veil when the camera is in a plume
  private banner?: HTMLDivElement;

  // Fighter-jet scrolling tapes (canvas): airspeed left of the heli, altitude right.
  private readonly spdCtx: CanvasRenderingContext2D;
  private readonly altCtx: CanvasRenderingContext2D;

  private readonly headCtx: CanvasRenderingContext2D;
  private readonly radarCanvas: HTMLCanvasElement;
  private readonly radarCtx: CanvasRenderingContext2D;
  private readonly minimap: HTMLCanvasElement; // baked satellite terrain (world-aligned)
  private readonly labels: MapLabels; // A5: static place names drawn screen-upright on the radar
  private readonly dpr = Math.min(window.devicePixelRatio || 1, 2);
  private radarExpanded = false; // tap the radar to toggle local ↔ whole-world view
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

    // --- Left instrument column. Stacked in a flex column (was three absolutely-positioned
    // chips) so the campaign's optional FUEL gauge and OBJECTIVE checklist can slot in without
    // colliding. Water → fuel → fires → threat → objectives, top to bottom. ---
    const leftCol = el('div', {
      position: 'absolute',
      left: '18px',
      top: '14px',
      display: 'flex',
      flexDirection: 'column',
      gap: '8px',
      alignItems: 'flex-start',
    });

    // Menu button — bail back to the campaign mission-select at any time (reload-based,
    // same path as the end-banner MENU). Sits at the top of the left column: clear of the
    // bottom-corner touch controls and the right-hand radar, and away from the flight thumb.
    // Only shown when a menu hook was supplied (campaign play).
    if (this.end) {
      const onMenu = this.end.onMenu;
      const menuBtn = frosted({
        padding: '8px 14px',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        pointerEvents: 'auto',
        cursor: 'pointer',
        transition: 'border-color 0.15s ease',
      });
      menuBtn.appendChild(el('div', { fontSize: '15px', lineHeight: '1', color: UI.text }, '☰'));
      menuBtn.appendChild(
        el('div', { fontSize: '11px', fontWeight: '700', letterSpacing: '2px', color: UI.dim }, 'MENU'),
      );
      menuBtn.addEventListener('pointerenter', () => (menuBtn.style.borderColor = UI.accent));
      menuBtn.addEventListener('pointerleave', () => (menuBtn.style.borderColor = UI.stroke));
      menuBtn.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        onMenu();
      });
      leftCol.appendChild(menuBtn);
    }

    // Water gauge
    const waterWrap = frosted({ padding: '8px 12px 10px' });
    waterWrap.appendChild(label('WATER'));
    const wtrack = barTrack();
    this.waterFill = barFill(`linear-gradient(90deg, ${UI.water}, ${UI.accent})`);
    this.waterFill.style.boxShadow = UI.glow;
    wtrack.appendChild(this.waterFill);
    waterWrap.appendChild(wtrack);
    leftCol.appendChild(waterWrap);

    // Fuel gauge (campaign — hidden unless a mission runs the FuelSim)
    this.fuelWrap = frosted({ padding: '8px 12px 10px', display: 'none' });
    this.fuelWrap.appendChild(label('FUEL'));
    const ftrack = barTrack();
    this.fuelFill = barFill(`linear-gradient(90deg, #ff5d4d, #ffb24a, #67e8ff)`);
    ftrack.appendChild(this.fuelFill);
    this.fuelWrap.appendChild(ftrack);
    leftCol.appendChild(this.fuelWrap);

    // Fire counter
    const fireWrap = frosted({ padding: '8px 14px', display: 'flex', alignItems: 'center', gap: '9px' });
    const fireDot = el('div', {
      width: '9px',
      height: '9px',
      borderRadius: '99px',
      background: UI.fire,
      boxShadow: `0 0 9px ${UI.fire}`,
    });
    this.firesText = el('div', { fontSize: '19px', fontWeight: '600', letterSpacing: '0.5px' });
    const fireCol = el('div', {});
    fireCol.appendChild(label('FIRES'));
    fireCol.appendChild(this.firesText);
    fireWrap.appendChild(fireDot);
    fireWrap.appendChild(fireCol);
    leftCol.appendChild(fireWrap);

    // Threat gauge: how endangered the structures are (amber→red as fires close in).
    const threatWrap = frosted({ padding: '8px 12px 10px' });
    threatWrap.appendChild(label('THREAT'));
    const ttrack = barTrack();
    this.threatFill = barFill(`linear-gradient(90deg, #ffb24a, ${UI.warn})`);
    ttrack.appendChild(this.threatFill);
    threatWrap.appendChild(ttrack);
    leftCol.appendChild(threatWrap);

    // Objective checklist (campaign — populated each frame from the mission tracker).
    this.objPanel = frosted({ padding: '9px 13px 10px', display: 'none', minWidth: '190px' });
    leftCol.appendChild(this.objPanel);

    this.root.appendChild(leftCol);

    // --- Status hint (top-center, under the heading tape) ---
    this.hint = frosted({
      position: 'absolute',
      left: '50%',
      top: '58px',
      transform: 'translateX(-50%)',
      fontSize: '14px',
      fontWeight: '500',
      color: '#dff6ff',
      padding: '6px 13px',
      borderRadius: '99px',
      whiteSpace: 'nowrap',
      display: 'none',
    });
    this.root.appendChild(this.hint);

    // --- Fighter-jet scrolling tapes flanking the heli: airspeed LEFT, altitude
    // RIGHT (real HUD convention). Transparent canvases — thin glowing ladders that
    // float over the world, with numbers scrolling past a boxed live readout. ---
    const spd = makeCanvas(TAPE_W, TAPE_H, {
      position: 'absolute',
      left: `calc(50% - ${TAPE_GAP + TAPE_W}px)`,
      top: '52%',
      transform: 'translateY(-50%)',
    });
    this.spdCtx = spd.ctx;
    this.root.appendChild(spd.canvas);

    const alt = makeCanvas(TAPE_W, TAPE_H, {
      position: 'absolute',
      left: `calc(50% + ${TAPE_GAP}px)`,
      top: '52%',
      transform: 'translateY(-50%)',
    });
    this.altCtx = alt.ctx;
    this.root.appendChild(alt.canvas);

    // --- Heading tape (top center) ---
    const head = makeCanvas(HEAD_W, HEAD_H, {
      position: 'absolute',
      left: '50%',
      top: '14px',
      transform: 'translateX(-50%)',
      borderRadius: '99px',
      background: UI.panel,
      border: `1px solid ${UI.stroke}`,
      boxShadow: UI.shadow,
      backdropFilter: UI.blur,
    });
    this.headCtx = head.ctx;
    this.root.appendChild(head.canvas);

    // --- Radar (top-right, rounded square, tap to expand local ↔ whole-world) ---
    const radar = makeCanvas(RADAR_MIN, RADAR_MIN, {
      position: 'absolute',
      right: '14px',
      top: '14px',
      borderRadius: '16px',
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
    this.root.appendChild(radar.canvas);

    parent.appendChild(this.root);
  }

  /** Resize the radar canvas backing store for the current expand state (resets the
   *  context transform, so re-apply the DPR scale). Anchored top-right, so it grows
   *  down-and-left and stays in the corner. */
  private sizeRadar(): void {
    const size = this.radarExpanded ? RADAR_MAX : RADAR_MIN;
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

  update(s: HudState): void {
    this.waterFill.style.width = `${clamp01(s.water / s.waterMax) * 100}%`;
    this.firesText.textContent = `${s.firesLeft}`;
    // Threat gauge fills as fires close on the structures; it pulses red when critical.
    const threat = clamp01(s.threat);
    this.threatFill.style.width = `${threat * 100}%`;
    this.threatFill.style.boxShadow = threat > 0.6 ? `0 0 10px ${UI.warn}` : 'none';
    if (s.hint) {
      this.hint.textContent = s.hint;
      this.hint.style.display = 'block';
    } else {
      this.hint.style.display = 'none';
    }

    // Campaign fuel gauge (hidden in the sandbox / non-fuel missions). Flashes under reserve.
    if (s.fuel !== undefined) {
      this.fuelWrap.style.display = '';
      this.fuelFill.style.width = `${clamp01(s.fuel) * 100}%`;
      this.fuelWrap.style.boxShadow = s.fuelLow ? `0 0 12px ${UI.warn}` : UI.shadow;
      this.fuelWrap.style.opacity = s.fuelLow ? `${0.6 + 0.4 * Math.abs(Math.sin(Date.now() / 200))}` : '1';
    } else {
      this.fuelWrap.style.display = 'none';
    }

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

    this.drawHeading(headingDeg(s.yaw));
    this.drawRadar(s);

    if ((s.won || s.lost) && !this.banner) this.showBanner(s);
  }

  /** Rebuild the objective checklist only when its visible content changes. */
  private renderObjectives(items?: readonly TrackerItem[]): void {
    if (!items || items.length === 0) {
      this.objPanel.style.display = 'none';
      this.objSig = '';
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
        marginTop: '6px',
        fontSize: '13px',
      });
      const mark = t.failed ? '✕' : t.done ? '✓' : t.kind === 'constraint' ? '◆' : '○';
      const col = t.failed ? UI.warn : t.done ? UI.accent : 'rgba(231,247,255,0.85)';
      row.appendChild(el('div', { color: col, fontWeight: '700', width: '12px' }, mark));
      row.appendChild(el('div', { color: col, flex: '1' }, t.label));
      let val = '';
      if (t.done && t.completedAt !== undefined) val = `✓ ${fmtTime(t.completedAt)}`; // latched: stamp the time
      else if (t.timeLeft !== undefined) val = fmtTime(t.timeLeft);
      else if (t.target !== undefined) val = `${t.current ?? 0}/${t.target}`;
      if (val) row.appendChild(el('div', { color: UI.dim, fontWeight: '600' }, val));
      this.objPanel.appendChild(row);
    }
  }

  /** Mission end banner: outcome headline + score + Next/Retry/Menu (campaign) buttons. */
  private showBanner(s: HudState): void {
    this.banner = frosted({
      position: 'absolute',
      left: '50%',
      top: '50%',
      transform: 'translate(-50%,-50%)',
      textAlign: 'center',
      padding: '26px 36px 22px',
      borderRadius: '20px',
      pointerEvents: 'auto',
      minWidth: '300px',
    });
    const who = this.pilotName ?? 'pilot';
    const headline = s.won ? 'MISSION COMPLETE' : 'MISSION FAILED';
    this.banner.appendChild(
      el('div', { fontSize: '32px', fontWeight: '800', letterSpacing: '0.5px', color: s.lost ? UI.warn : UI.accent }, headline),
    );
    this.banner.appendChild(
      el(
        'div',
        { fontSize: '15px', marginTop: '8px', color: 'rgba(231,247,255,0.82)' },
        s.won ? `Great flying, ${who}.` : 'The fire won this time.',
      ),
    );
    this.banner.appendChild(
      el('div', { fontSize: '18px', fontWeight: '700', marginTop: '12px' }, `Score ${s.score.toLocaleString()}`),
    );

    if (this.end) {
      const row = el('div', { display: 'flex', gap: '10px', justifyContent: 'center', marginTop: '20px', flexWrap: 'wrap' });
      if (s.won && this.end.hasNext) row.appendChild(bannerButton('NEXT ▸', UI.accent, this.end.onNext));
      if (!s.won) row.appendChild(bannerButton('↻ RETRY', UI.fire, this.end.onRetry));
      row.appendChild(bannerButton('MENU', UI.dim, this.end.onMenu));
      this.banner.appendChild(row);
      if (this.end.onLeaderboard) {
        const lbRow = el('div', { display: 'flex', justifyContent: 'center', marginTop: '10px' });
        lbRow.appendChild(bannerButton('🏆 LEADERBOARD', UI.accent, this.end.onLeaderboard));
        this.banner.appendChild(lbRow);
      }
    }
    this.root.appendChild(this.banner);
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

  /** Scrolling compass tape: hairline ticks every 10°, cardinals every 90°, the
   *  live heading centered under an accent pointer with a light numeric readout. */
  private drawHeading(deg: number): void {
    const ctx = this.headCtx;
    const w = HEAD_W;
    const h = HEAD_H;
    ctx.clearRect(0, 0, w, h);

    const cx = w / 2;
    const pxPerDeg = w / 96;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let d = Math.ceil(deg - 48); d <= deg + 48; d++) {
      if (d % 5 !== 0) continue;
      const norm = ((d % 360) + 360) % 360;
      const x = cx + (d - deg) * pxPerDeg;
      const fade = 1 - Math.min(1, Math.abs(d - deg) / 52); // dim toward the edges
      const major = norm % 90 === 0;
      ctx.strokeStyle = `rgba(255,255,255,${(major ? 0.85 : 0.35) * fade})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, h - 7);
      ctx.lineTo(x, h - (major ? 15 : 11));
      ctx.stroke();
      if (major) {
        ctx.fillStyle = `rgba(231,247,255,${fade})`;
        ctx.font = '600 11px ' + UI.font;
        ctx.fillText(CARDINALS[norm / 90], x, 9);
      }
    }

    // Center pointer + heading number.
    ctx.fillStyle = UI.accent;
    ctx.shadowColor = UI.accent;
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.moveTo(cx, h - 5);
    ctx.lineTo(cx - 5, h - 13);
    ctx.lineTo(cx + 5, h - 13);
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#fff';
    ctx.font = '600 12px ' + UI.font;
    ctx.fillText(`${Math.round(deg).toString().padStart(3, '0')}°`, cx, h - 22);
  }

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
    const d = this.radarExpanded ? RADAR_MAX : RADAR_MIN;
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

    // Crew landing zones (campaign): a hollow diamond — active = cyan, done = grey.
    if (s.zones) {
      for (const zn of s.zones) {
        const p = local(zn.x, zn.z);
        const ox = p.x - R;
        const oy = p.y - R;
        if (Math.hypot(ox, oy) > reach) continue;
        const col = zn.done ? 'rgba(150,160,165,0.55)' : zn.active ? UI.accent : 'rgba(103,232,255,0.4)';
        ctx.strokeStyle = col;
        ctx.lineWidth = 1.6;
        if (zn.active) {
          ctx.shadowColor = UI.accent;
          ctx.shadowBlur = 8;
        }
        ctx.beginPath();
        ctx.moveTo(p.x, p.y - 4.5);
        ctx.lineTo(p.x + 4.5, p.y);
        ctx.lineTo(p.x, p.y + 4.5);
        ctx.lineTo(p.x - 4.5, p.y);
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
        ctx.fillStyle = 'rgba(255,122,69,0.30)';
        ctx.beginPath();
        ctx.arc(p.x, p.y, 5.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = UI.fire;
        ctx.shadowColor = UI.fire;
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
        ctx.fillStyle = UI.fire;
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

    // Wind widget (top-left): a heading-relative arrow (pointing the way the wind
    // blows you) + the speed in knots. Rotates as you turn, like the rest of the map.
    const wfwd = Math.cos(s.windDir) * cos - Math.sin(s.windDir) * sin;
    const wrgt = Math.cos(s.windDir) * sin + Math.sin(s.windDir) * cos;
    const wx = 15;
    const wy = 14;
    ctx.save();
    ctx.translate(wx, wy);
    ctx.rotate(Math.atan2(-wfwd, wrgt)); // screen dir = (rgt, −fwd)
    ctx.strokeStyle = UI.accent;
    ctx.fillStyle = UI.accent;
    ctx.lineWidth = 1.5;
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 2;
    ctx.beginPath();
    ctx.moveTo(-7, 0);
    ctx.lineTo(5, 0);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(8, 0);
    ctx.lineTo(2, -3.5);
    ctx.lineTo(2, 3.5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(231,247,255,0.92)';
    ctx.font = '600 9px ' + UI.font;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${Math.round(s.windKt)} kt`, wx + 13, wy);
  }
}

const CARDINALS = ['N', 'E', 'S', 'W'];

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

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

// --- DOM helpers ------------------------------------------------------------

function el(_tag: 'div', style: Partial<CSSStyleDeclaration>, text?: string): HTMLDivElement {
  const node = document.createElement('div');
  Object.assign(node.style, style);
  if (text !== undefined) node.textContent = text;
  return node;
}

/** A small uppercase tracked caption. */
function label(text: string): HTMLDivElement {
  return el('div', { fontSize: '10px', fontWeight: '600', letterSpacing: '2px', color: UI.dim }, text);
}

/** The grey rail behind a gauge fill (water / fuel / threat all share this shape). */
function barTrack(): HTMLDivElement {
  return el('div', {
    width: '184px',
    height: '6px',
    marginTop: '7px',
    background: 'rgba(255,255,255,0.10)',
    borderRadius: '99px',
    overflow: 'hidden',
  });
}

/** A gauge fill bar with the given background; width is driven each frame. */
function barFill(background: string): HTMLDivElement {
  return el('div', { width: '0%', height: '100%', borderRadius: '99px', background, transition: 'width 0.12s linear' });
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
    borderRadius: '99px',
    border: `1px solid ${accent}`,
    color: accent,
    fontSize: '14px',
    fontWeight: '700',
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

/** A frosted-glass panel: translucent fill, hairline border, backdrop blur. */
function frosted(extra: Partial<CSSStyleDeclaration>): HTMLDivElement {
  const node = el('div', {
    background: UI.panel,
    border: `1px solid ${UI.stroke}`,
    borderRadius: '12px',
    boxShadow: UI.shadow,
    backdropFilter: UI.blur,
    ...extra,
  });
  node.style.setProperty('-webkit-backdrop-filter', UI.blur);
  return node;
}

/** Create a DPR-crisp 2D canvas positioned via inline styles. Mirrors any
 *  `backdropFilter` into the -webkit- prefix for Safari/iOS. */
function makeCanvas(
  w: number,
  h: number,
  style: Partial<CSSStyleDeclaration>,
): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  Object.assign(canvas.style, { width: `${w}px`, height: `${h}px`, pointerEvents: 'none' }, style);
  if (style.backdropFilter) canvas.style.setProperty('-webkit-backdrop-filter', style.backdropFilter);
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  ctx.scale(dpr, dpr);
  return { canvas, ctx };
}
