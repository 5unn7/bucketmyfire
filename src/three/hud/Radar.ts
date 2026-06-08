/**
 * The radar / minimap instrument — the single fattest sub-system of the HUD, lifted out
 * whole. It owns its own canvas, all the pan / zoom / pinch interaction state, the live
 * burn-field overlay raster, and the per-frame draw. The HUD constructs one, appends
 * `radar.canvas` into the top-right column, sizes it from the layout controller via
 * `setLayout`, and calls `draw(state)` once per frame.
 *
 * Two modes. COLLAPSED: an ego-centric tactical scope — the heli is fixed at centre pointing
 * UP and the world rotates around it (heading-up). EXPANDED (tap to toggle): a legible NORTH-UP
 * map you DRAG to pan around (the whole province won't fit at a readable zoom), with +/− / wheel
 * / pinch zoom; the heli is a moving marker and the cities read in their true orientation.
 */

import { UI, R, makeCanvas } from '../ui/theme';
import type { FireFieldView } from '../sim/FireSystem';
import type { HudState, MapLabels } from './types';

const RANGE_NEAR = 160; // world units to the radar edge when collapsed (zoomed-in local map)
const EXPAND_ZOOM = 0.6; // DEFAULT px per world unit in the expanded map — DRAG to pan, +/−/wheel/pinch to zoom
const ZOOM_MIN = 0.22; // most zoomed-OUT (roughly the whole province in view)
const ZOOM_MAX = 1.8; // most zoomed-IN (a base + its lake fill the panel)

export class Radar {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly minimap: HTMLCanvasElement; // baked satellite terrain (world-aligned)
  private readonly labels: MapLabels; // A5: static place names drawn screen-upright on the radar
  private readonly dpr = Math.min(window.devicePixelRatio || 1, 2);
  private radarExpanded = false; // tap the radar to toggle local ↔ pannable map view
  // Expanded-map pan: a north-up readable map you DRAG to move around (the whole province won't fit at a
  // legible zoom). panX/panZ = world point shown at the radar centre; set to the heli on expand, clamped.
  private panX = 0;
  private panZ = 0;
  private dragging = false;
  private dragMoved = false; // distinguishes a pan-drag from a tap (tap toggles expand)
  private dragStartX = 0;
  private dragStartY = 0;
  private dragStartPanX = 0;
  private dragStartPanZ = 0;
  private expandZoom = EXPAND_ZOOM; // live px/world-unit in the expanded map (wheel / pinch / +/− buttons adjust it)
  private pointers = new Map<number, { x: number; y: number }>(); // active pointers on the radar (for pinch-zoom)
  private pinchDist0 = 1; // baseline finger spread + zoom + world-midpoint at the start of a pinch
  private pinchZoom0 = EXPAND_ZOOM;
  private pinchMidWX = 0;
  private pinchMidWZ = 0;
  private lastHeliX = 0; // last heli world pos — centres the map when you expand
  private lastHeliZ = 0;
  // Sizes — driven by setLayout() from the HUD's layout controller (event-driven, not per-frame).
  private radarBase = 128; // collapsed radar side
  private radarMax = 300; // expanded radar side (clamped to the short viewport side)
  // C5 burn overlay: the live fire field + a small offscreen raster of it (burnt = ash scar,
  // hot = warm front). Rebuilt every few frames (fire spreads slowly) and blitted under the blips
  // with the SAME heading-up affine as the satellite map, so it stays registered with the terrain.
  private burnField: FireFieldView | null = null;
  private burnCanvas: HTMLCanvasElement | null = null;
  private burnCtx: CanvasRenderingContext2D | null = null;
  private burnImg: ImageData | null = null;
  private burnAge = 999; // frames since the raster was last rebuilt (force a build on first draw)

  constructor(minimap: HTMLCanvasElement, labels: MapLabels) {
    this.minimap = minimap;
    this.labels = labels;

    const radar = makeCanvas(this.radarBase, this.radarBase, {
      borderRadius: R.xl,
      background: UI.panel,
      border: `1px solid ${UI.stroke}`,
      boxShadow: UI.shadow,
      backdropFilter: UI.blur,
      pointerEvents: 'auto',
      cursor: 'pointer',
    });
    this.canvas = radar.canvas;
    this.ctx = radar.ctx;
    // Interaction model. Collapsed: a tap expands. Expanded: a tap collapses, a DRAG pans, the +/− corner
    // buttons + mouse WHEEL + two-finger PINCH zoom. A pointerdown that moves < a few px counts as a tap.
    const ptr = (e: { clientX: number; clientY: number }) => {
      const r = this.canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    this.canvas.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      try {
        this.canvas.setPointerCapture?.(e.pointerId);
      } catch {
        /* capture is best-effort — never let it abort the gesture */
      }
      const p = ptr(e);
      this.pointers.set(e.pointerId, p);
      // Zoom buttons (expanded): a tap on +/− zooms toward centre; not a pan or a collapse.
      if (this.radarExpanded) {
        const zb = this.hitZoomButton(p.x, p.y);
        if (zb) {
          const R = this.radarMax / 2;
          this.zoomAt(R, R, zb > 0 ? 1.3 : 1 / 1.3);
          this.dragging = false;
          this.dragMoved = true;
          return;
        }
      }
      if (this.pointers.size >= 2) {
        // Begin a pinch: cancel any single-finger pan, snapshot the spread + the world point at the midpoint.
        this.dragging = false;
        this.dragMoved = true;
        const [a, b] = [...this.pointers.values()];
        const R = this.radarMax / 2;
        this.pinchDist0 = Math.hypot(a.x - b.x, a.y - b.y) || 1;
        this.pinchZoom0 = this.expandZoom;
        this.pinchMidWX = this.panX + ((a.x + b.x) / 2 - R) / this.expandZoom;
        this.pinchMidWZ = this.panZ + ((a.y + b.y) / 2 - R) / this.expandZoom;
        return;
      }
      this.dragging = true;
      this.dragMoved = false;
      this.dragStartX = e.clientX;
      this.dragStartY = e.clientY;
      this.dragStartPanX = this.panX;
      this.dragStartPanZ = this.panZ;
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (!this.pointers.has(e.pointerId)) return;
      this.pointers.set(e.pointerId, ptr(e));
      if (this.radarExpanded && this.pointers.size >= 2) {
        // Pinch zoom: keep the gesture's world midpoint under the live finger midpoint.
        const [a, b] = [...this.pointers.values()];
        const R = this.radarMax / 2;
        const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
        this.expandZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, this.pinchZoom0 * (dist / this.pinchDist0)));
        this.panX = this.pinchMidWX - ((a.x + b.x) / 2 - R) / this.expandZoom;
        this.panZ = this.pinchMidWZ - ((a.y + b.y) / 2 - R) / this.expandZoom;
        this.clampPan();
        this.dragMoved = true;
        return;
      }
      if (!this.dragging) return;
      const dx = e.clientX - this.dragStartX;
      const dy = e.clientY - this.dragStartY;
      if (Math.abs(dx) + Math.abs(dy) > 5) this.dragMoved = true;
      if (this.radarExpanded) {
        // Drag-to-pan: the world point under the finger stays put → the centre moves opposite the drag.
        this.panX = this.dragStartPanX - dx / this.expandZoom;
        this.panZ = this.dragStartPanZ - dy / this.expandZoom;
        this.clampPan();
      }
    });
    const endDrag = (e: PointerEvent) => {
      try {
        this.canvas.releasePointerCapture?.(e.pointerId);
      } catch {
        /* best-effort */
      }
      this.pointers.delete(e.pointerId);
      if (this.pointers.size >= 1) {
        // A finger lifted but others remain (e.g. one pinch finger up) — don't pan/toggle until all are up.
        this.dragging = false;
        this.dragMoved = true;
        return;
      }
      const wasTap = this.dragging && !this.dragMoved;
      this.dragging = false;
      if (wasTap) {
        // Toggle local ↔ expanded; on expand, centre the map on the heli.
        this.radarExpanded = !this.radarExpanded;
        if (this.radarExpanded) {
          this.panX = this.lastHeliX;
          this.panZ = this.lastHeliZ;
          this.clampPan();
        }
        this.sizeRadar();
      }
    };
    this.canvas.addEventListener('pointerup', endDrag);
    this.canvas.addEventListener('pointercancel', endDrag);
    // Desktop wheel zoom, toward the cursor.
    this.canvas.addEventListener(
      'wheel',
      (e) => {
        if (!this.radarExpanded) return;
        e.preventDefault();
        const p = ptr(e);
        this.zoomAt(p.x, p.y, Math.exp(-e.deltaY * 0.0015));
      },
      { passive: false },
    );
    this.canvas.style.touchAction = 'none'; // we own drag + pinch (no browser scroll/zoom)
  }

  /** Set the collapsed + expanded radar sizes for the active breakpoint (from HUD.applyLayout),
   *  then resize the backing store. */
  setLayout(base: number, max: number): void {
    this.radarBase = base;
    this.radarMax = max;
    this.sizeRadar();
  }

  /** Resize the radar canvas backing store for the current expand state (resets the
   *  context transform, so re-apply the DPR scale). Anchored top-right, so it grows
   *  down-and-left and stays in the corner. */
  private sizeRadar(): void {
    const size = this.radarExpanded ? this.radarMax : this.radarBase;
    this.canvas.width = Math.round(size * this.dpr);
    this.canvas.height = Math.round(size * this.dpr);
    this.canvas.style.width = `${size}px`;
    this.canvas.style.height = `${size}px`;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  /** World-space bounding box of the active map's province outline, or null (procedural map). */
  private outlineBBox(): { minX: number; maxX: number; minZ: number; maxZ: number } | null {
    const o = this.labels.outline;
    if (!o || o.length < 3) return null;
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const p of o) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z);
      maxZ = Math.max(maxZ, p.z);
    }
    return { minX, maxX, minZ, maxZ };
  }

  /** Keep the expanded-map pan centre over the province (a little overscan past the border is allowed). */
  private clampPan(): void {
    const bb = this.outlineBBox();
    if (!bb) return;
    const m = 80;
    this.panX = Math.max(bb.minX - m, Math.min(bb.maxX + m, this.panX));
    this.panZ = Math.max(bb.minZ - m, Math.min(bb.maxZ + m, this.panZ));
  }

  /** Zoom the expanded map by `factor` while keeping the world point under screen (sx,sy) fixed. */
  private zoomAt(sx: number, sy: number, factor: number): void {
    const R = this.radarMax / 2;
    const z1 = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, this.expandZoom * factor));
    if (z1 === this.expandZoom) return;
    const wx = this.panX + (sx - R) / this.expandZoom; // world point currently under (sx,sy)
    const wz = this.panZ + (sy - R) / this.expandZoom;
    this.panX = wx - (sx - R) / z1; // re-centre so it stays under (sx,sy) at the new zoom
    this.panZ = wz - (sy - R) / z1;
    this.expandZoom = z1;
    this.clampPan();
  }

  /** Geometry of the on-map +/− zoom buttons (bottom-right corner of the expanded panel), in CSS px. */
  private zoomButtons(d: number): { rb: number; plus: { x: number; y: number }; minus: { x: number; y: number } } {
    const rb = 13;
    const m = 9;
    const cx = d - m - rb;
    return { rb, minus: { x: cx, y: d - m - rb }, plus: { x: cx, y: d - m - rb - (2 * rb + 6) } };
  }

  /** Which zoom button (if any) sits under screen (sx,sy): +1 in, −1 out, 0 none. */
  private hitZoomButton(sx: number, sy: number): number {
    const b = this.zoomButtons(this.radarMax);
    if (Math.hypot(sx - b.plus.x, sy - b.plus.y) <= b.rb) return 1;
    if (Math.hypot(sx - b.minus.x, sy - b.minus.y) <= b.rb) return -1;
    return 0;
  }

  /** Draw the +/− zoom buttons over the expanded map (a frosted disc + glyph each). */
  private drawZoomButtons(ctx: CanvasRenderingContext2D, d: number): void {
    const b = this.zoomButtons(d);
    for (const [c, sign] of [
      [b.plus, 1],
      [b.minus, -1],
    ] as const) {
      ctx.beginPath();
      ctx.arc(c.x, c.y, b.rb, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(10,16,22,0.66)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.32)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.strokeStyle = '#eaf6ff';
      ctx.lineWidth = 1.8;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(c.x - 5, c.y);
      ctx.lineTo(c.x + 5, c.y);
      if (sign > 0) {
        ctx.moveTo(c.x, c.y - 5);
        ctx.lineTo(c.x, c.y + 5);
      }
      ctx.stroke();
    }
  }

  /** C5: hand the radar the live fire field (FireSystem.fieldView). The arrays are stable, so we
   *  keep the reference and re-raster it every few frames into a tiny offscreen canvas. */
  setBurnField(view: FireFieldView): void {
    this.burnField = view;
    const c = document.createElement('canvas');
    c.width = view.nx;
    c.height = view.nz;
    const cx = c.getContext('2d');
    if (!cx) return;
    this.burnCanvas = c;
    this.burnCtx = cx;
    this.burnImg = cx.createImageData(view.nx, view.nz);
    this.burnAge = 999;
  }

  /** Rebuild the offscreen burn raster from the field: BURNT cells → a light ash scar (the user's
   *  "light shaded region"), actively-BURNING cells → a warm front, both translucent so the
   *  terrain reads through. Cheap (n² = 16k) and only run every few frames. */
  private rasterizeBurn(view: FireFieldView): void {
    if (!this.burnImg || !this.burnCtx) return;
    const { nx, nz, heat, scorch } = view;
    const d = this.burnImg.data;
    for (let i = 0; i < nx * nz; i++) {
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

  /** Blit the burn raster onto the radar using the SAME world→screen affine as the satellite map (so it
   *  stays registered in either radar mode). `m` = [m00,m01,m10,m11,m0,m1]; burn pixel (0,0) is the
   *  field's world origin (−halfX,−halfZ) — per-axis now, so a rectangular field stays registered — and
   *  the blit transform is the affine pre-scaled by the (square) burn cell size. */
  private drawBurnOverlay(ctx: CanvasRenderingContext2D, m: number[]): void {
    const view = this.burnField;
    if (!view || !this.burnCanvas) return;
    if (this.burnAge++ >= 6) {
      this.burnAge = 0;
      this.rasterizeBurn(view);
    }
    const k = view.cellSize; // world units per burn-canvas pixel (one cell — square on every map)
    const [m00, m01, m10, m11, m0, m1] = m;
    const A = m00 * k;
    const B = m10 * k;
    const C = m01 * k;
    const D = m11 * k;
    // Burn pixel (0,0) maps to the field origin (−halfX,−halfZ); fold that through the world→screen affine.
    const E = m00 * -view.halfX + m01 * -view.halfZ + m0;
    const F = m10 * -view.halfX + m11 * -view.halfZ + m1;
    ctx.save();
    ctx.setTransform(this.dpr * A, this.dpr * B, this.dpr * C, this.dpr * D, this.dpr * E, this.dpr * F);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.burnCanvas, 0, 0);
    ctx.restore();
  }

  /** Per-frame radar paint. See the class doc for the two modes. */
  draw(s: HudState): void {
    const ctx = this.ctx;
    const dpr = this.dpr;
    const exp = this.radarExpanded;
    this.lastHeliX = s.heliX; // remember the heli so expanding centres the map on it
    this.lastHeliZ = s.heliZ;
    const d = exp ? this.radarMax : this.radarBase;
    const R = d / 2;
    const reach = R - 9;
    const cos = Math.cos(s.yaw);
    const sin = Math.sin(s.yaw);
    ctx.clearRect(0, 0, d, d);

    // World→screen affine: px = m00·x + m01·z + m0, py = m10·x + m11·z + m1.
    let m00: number, m01: number, m10: number, m11: number, m0: number, m1: number;
    if (exp) {
      // EXPANDED north-up map: panX/panZ is the world point shown at centre (+x east → right, +z south → down).
      const z = this.expandZoom;
      m00 = z;
      m01 = 0;
      m0 = R - z * this.panX;
      m10 = 0;
      m11 = z;
      m1 = R - z * this.panZ;
    } else {
      // COLLAPSED ego-centric heading-up: heli at centre, nose up.
      const scale = reach / RANGE_NEAR;
      m00 = scale * sin;
      m01 = scale * cos;
      m0 = R - scale * (sin * s.heliX + cos * s.heliZ);
      m10 = -scale * cos;
      m11 = scale * sin;
      m1 = R + scale * (cos * s.heliX - sin * s.heliZ);
    }
    const local = (wx: number, wz: number) => ({ x: m00 * wx + m01 * wz + m0, y: m10 * wx + m11 * wz + m1 });
    // Expanded: draw every blip as a glyph (clipped to the panel, no rim chevrons); collapsed: chevrons past `reach`.
    const effReach = exp ? d * 4 : reach;

    ctx.save();
    roundRectPath(ctx, 1, 1, d - 2, d - 2, 15);
    ctx.clip();

    // --- Satellite terrain backdrop: blit the baked world map through the SAME affine, so map + blips
    // stay registered in either mode. ---
    // The satellite map covers the TRUE playfield rectangle (worldSizeX × worldSizeZ) over the minimap's
    // own pixel dims, so per-axis world-units-per-pixel (equal on a square map → identical to the old blit).
    const sx = s.worldSizeX;
    const sz = s.worldSizeZ;
    const kx = sx / this.minimap.width;
    const kz = sz / this.minimap.height;
    ctx.save();
    ctx.setTransform(
      dpr * m00 * kx,
      dpr * m10 * kx,
      dpr * m01 * kz,
      dpr * m11 * kz,
      dpr * (m00 * (-sx / 2) + m01 * (-sz / 2) + m0),
      dpr * (m10 * (-sx / 2) + m11 * (-sz / 2) + m1),
    );
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.minimap, 0, 0);
    ctx.restore(); // back to the dpr-scaled default; clip still active

    // Darken for contrast; the local scope also gets a glass-lens vignette.
    ctx.fillStyle = 'rgba(8,13,18,0.28)';
    ctx.fillRect(0, 0, d, d);
    if (!exp) {
      const g = ctx.createRadialGradient(R, R, reach * 0.55, R, R, R);
      g.addColorStop(0, 'rgba(6,10,14,0)');
      g.addColorStop(1, 'rgba(4,7,10,0.55)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, d, d);
    }

    // C5: burnt-area scar + live front, registered to the map by the same affine.
    this.drawBurnOverlay(ctx, [m00, m01, m10, m11, m0, m1]);

    // Forward field-of-view cone + range rings — only in the ego-centric local scope.
    if (!exp) {
      const cone = ctx.createRadialGradient(R, R, 2, R, R, reach);
      cone.addColorStop(0, 'rgba(103,232,255,0.14)');
      cone.addColorStop(1, 'rgba(103,232,255,0)');
      ctx.fillStyle = cone;
      ctx.beginPath();
      ctx.moveTo(R, R);
      ctx.arc(R, R, reach, -Math.PI / 2 - 0.5, -Math.PI / 2 + 0.5);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.13)';
      ctx.lineWidth = 1;
      for (const rr of [0.5, 1]) {
        ctx.beginPath();
        ctx.arc(R, R, reach * rr, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

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
        if (Math.hypot(ox, oy) <= effReach) {
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
      // Low-fuel RTB needle: a dashed line from centre toward the nearest base (local scope only —
      // in the fixed full-map view the centre isn't the heli, so the needle would point from nowhere).
      if (low && !exp) {
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
      if (Math.hypot(p.x - R, p.y - R) > effReach) continue; // skip off-radar
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
        if (Math.hypot(ox, oy) > effReach) {
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

    // Fires — in range: glowing dot; out of range: chevron pinned to the rim. The NEAREST active fire
    // is the "next target" WAYPOINT: a cyan (actionable, cockpit-register) ring on it in range, or a
    // brighter cyan chevron off-radar — a clear go-here cue. One fire → it's trivially the waypoint.
    let nearestIdx = -1;
    let nearestD = Infinity;
    for (let i = 0; i < s.fires.length; i++) {
      const lp = local(s.fires[i].x, s.fires[i].z);
      const d = Math.hypot(lp.x - R, lp.y - R);
      if (d < nearestD) {
        nearestD = d;
        nearestIdx = i;
      }
    }
    const wpPulse = 0.5 + 0.5 * Math.sin(performance.now() * 0.005); // gentle "you are here / go here" pulse
    for (let i = 0; i < s.fires.length; i++) {
      const f = s.fires[i];
      const p = local(f.x, f.z);
      const ox = p.x - R;
      const oy = p.y - R;
      const dist = Math.hypot(ox, oy);
      const isWaypoint = i === nearestIdx;
      if (dist <= effReach) {
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
        if (isWaypoint) {
          ctx.save();
          ctx.strokeStyle = UI.accent; // cyan = act on this (two-register: the cockpit's one interactive hue)
          ctx.globalAlpha = 0.45 + 0.4 * wpPulse;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(p.x, p.y, 8 + 1.5 * wpPulse, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }
      } else {
        const a = Math.atan2(oy, ox);
        const rx = R + Math.cos(a) * reach;
        const ry = R + Math.sin(a) * reach;
        const sc = isWaypoint ? 1.6 : 1; // the nearest off-radar fire reads bigger + cyan: "head this way"
        ctx.save();
        ctx.translate(rx, ry);
        ctx.rotate(a);
        ctx.fillStyle = isWaypoint ? UI.accent : UI.fireMarker;
        ctx.beginPath();
        ctx.moveTo(2 * sc, 0);
        ctx.lineTo(-3 * sc, -3 * sc);
        ctx.lineTo(-3 * sc, 3 * sc);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
    }

    // Living Province — town-status rings: a quiet ring marks every protected town so the province reads
    // at a glance; a THREATENED town (an active town-threat dispatch call) glows warn + pulses (defend
    // here); a DAMAGED town goes dim + slashed. Rationed: standing towns stay faint so threats pop, and
    // only a threatened town earns an off-radar rim chevron (standing towns would just clutter the rim).
    if (s.townPins) {
      for (const t of s.townPins) {
        const p = local(t.x, t.z);
        const ox = p.x - R;
        const oy = p.y - R;
        if (Math.hypot(ox, oy) > effReach) {
          if (t.status !== 'threatened') continue; // only the call that needs you gets a rim pointer
          const a = Math.atan2(oy, ox);
          ctx.save();
          ctx.translate(R + Math.cos(a) * reach, R + Math.sin(a) * reach);
          ctx.rotate(a);
          ctx.fillStyle = UI.warn;
          ctx.beginPath();
          ctx.moveTo(3, 0);
          ctx.lineTo(-3, -3);
          ctx.lineTo(-3, 3);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
          continue;
        }
        ctx.save(); // isolate every branch's stroke/shadow/alpha so nothing leaks into the next blip
        if (t.status === 'threatened') {
          ctx.strokeStyle = UI.warn;
          ctx.shadowColor = UI.warn;
          ctx.shadowBlur = 8;
          ctx.globalAlpha = 0.5 + 0.4 * wpPulse;
          ctx.lineWidth = 1.8;
          ctx.beginPath();
          ctx.arc(p.x, p.y, 7 + 1.5 * wpPulse, 0, Math.PI * 2);
          ctx.stroke();
        } else if (t.status === 'damaged') {
          ctx.strokeStyle = UI.dim;
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.arc(p.x, p.y, 5.5, 0, Math.PI * 2);
          ctx.moveTo(p.x - 4, p.y + 4);
          ctx.lineTo(p.x + 4, p.y - 4); // a small slash → "hit"
          ctx.stroke();
        } else {
          ctx.strokeStyle = UI.faint; // standing: a quiet ring so your towns read without clutter
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.restore();
      }
    }

    // Place names (A5) — drawn screen-UPRIGHT (the map under them is rotated, but text
    // must read level). Communities always; lake names only on the expanded radar (they'd
    // clutter the tight local view). A dark stroke keeps them legible over any terrain.
    const placed: { x: number; y: number }[] = []; // de-collide: skip a label that overlaps an earlier one
    const drawLabel = (wx: number, wz: number, text: string, color: string, dy: number, size: number): void => {
      if (!text) return;
      const p = local(wx, wz);
      if (Math.hypot(p.x - R, p.y - R) > effReach - 6) return; // off-radar
      const ly = p.y + dy;
      for (const q of placed) if (Math.hypot(p.x - q.x, ly - q.y) < 13) return; // too close to an earlier label
      placed.push({ x: p.x, y: ly });
      ctx.font = `600 ${size}px ${UI.font}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 2.4;
      ctx.lineJoin = 'round';
      ctx.strokeStyle = 'rgba(4,8,12,0.85)';
      ctx.strokeText(text, p.x, ly);
      ctx.fillStyle = color;
      ctx.fillText(text, p.x, ly);
    };
    // Communities first (priority over lake names), then lake names on the expanded map only.
    for (const c of this.labels.communities) {
      drawLabel(c.x, c.z, c.name, 'rgba(232,238,242,0.95)', exp ? -8 : -7, 9);
    }
    if (exp) {
      for (const lk of this.labels.lakes) drawLabel(lk.x, lk.z, lk.name, 'rgba(150,205,235,0.92)', 0, 8);
      // Reference places (far-north settlements + southern cities) — dimmer than the gameplay bases/towns and
      // shown only on the expanded province map, so the WHOLE of Saskatchewan reads right without cluttering the
      // tight local scope. Lowest label priority (drawn last → yields to a base/lake name it would overlap).
      for (const lm of this.labels.landmarks ?? []) {
        const city = lm.kind === 'city';
        drawLabel(lm.x, lm.z, lm.name, city ? 'rgba(224,230,238,0.82)' : 'rgba(194,205,216,0.6)', -7, city ? 9 : 8);
      }
    }

    ctx.restore(); // unclip

    // Heli marker.
    ctx.fillStyle = '#fff';
    ctx.shadowColor = UI.accent;
    ctx.shadowBlur = 10;
    if (exp) {
      // Moving aircraft icon at the heli's map position, rotated to its heading (the map is fixed north-up).
      const hp = local(s.heliX, s.heliZ);
      ctx.save();
      ctx.translate(hp.x, hp.y);
      ctx.rotate(Math.atan2(-sin, cos)); // world forward (cos,−sin) on the north-up map
      ctx.beginPath();
      ctx.moveTo(7, 0);
      ctx.lineTo(-4.5, -4.5);
      ctx.lineTo(-1.5, 0);
      ctx.lineTo(-4.5, 4.5);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    } else {
      // Fixed at centre, pointing up.
      ctx.beginPath();
      ctx.moveTo(R, R - 6);
      ctx.lineTo(R - 4.5, R + 5);
      ctx.lineTo(R, R + 2.5);
      ctx.lineTo(R + 4.5, R + 5);
      ctx.closePath();
      ctx.fill();
    }
    ctx.shadowBlur = 0;

    // Rounded-square rim + north marker (expanded map is north-up → N pinned top; local scope tracks heading).
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 1;
    roundRectPath(ctx, 1, 1, d - 2, d - 2, 15);
    ctx.stroke();
    ctx.fillStyle = UI.accent;
    ctx.font = '700 9px ' + UI.font;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (exp) {
      ctx.fillText('N', R, 11);
      this.drawZoomButtons(ctx, d); // +/− zoom controls (also wheel + pinch)
    } else {
      const nx = -cos; // local screen dir of north (0,−Z)
      const ny = -sin;
      const nlen = Math.hypot(nx, ny) || 1;
      ctx.fillText('N', R + (nx / nlen) * (reach - 4), R + (ny / nlen) * (reach - 4));
    }
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
