import { World } from '../World';

/**
 * Bakes a top-down "satellite" image of the whole world ONCE at load, for the HUD
 * radar to blit under the live blips. Pure read-off-the-World: each pixel samples
 * the biome color (or a depth-tinted blue over water) and applies a hillshade from
 * the height gradient so ridges/valleys read like real terrain relief.
 *
 * This is deterministic from the World seed and runs a single time (heavy gen is a
 * load-time cost, per the mobile-60fps invariant) — the per-frame radar just draws
 * a rotated crop of the returned canvas.
 */
export function buildMinimap(world: World, worldSize: number, px = 224): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = px;
  canvas.height = px;
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  const img = ctx.createImageData(px, px);
  const data = img.data;

  const half = worldSize / 2;
  const step = worldSize / px;

  // Precompute the ground height grid once so the hillshade gradient reuses it
  // instead of re-sampling the (expensive) heightfield four extra times per pixel.
  const H = new Float32Array(px * px);
  for (let j = 0; j < px; j++) {
    const wz = -half + (j + 0.5) * step;
    for (let i = 0; i < px; i++) {
      H[j * px + i] = world.groundHeightAt(-half + (i + 0.5) * step, wz);
    }
  }

  // Hillshade light direction (in world XZ), roughly matching the scene sun.
  const lx = 0.55;
  const lz = 0.35;

  for (let j = 0; j < px; j++) {
    const wz = -half + (j + 0.5) * step;
    for (let i = 0; i < px; i++) {
      const wx = -half + (i + 0.5) * step;
      const o = (j * px + i) * 4;

      const wl = world.waterLevelAt(wx, wz);
      let r: number;
      let g: number;
      let b: number;

      if (wl !== null) {
        // Water: tint from shallow teal to deep navy by carved depth.
        const depth = clamp((wl - H[j * px + i]) / 5, 0, 1);
        r = lerp(74, 24, depth);
        g = lerp(156, 74, depth);
        b = lerp(206, 128, depth);
      } else {
        const c = world.biomes.sample(wx, wz).color;
        // Central-difference slope from the height grid → directional hillshade.
        const hl = H[j * px + Math.max(0, i - 1)];
        const hr = H[j * px + Math.min(px - 1, i + 1)];
        const hu = H[Math.max(0, j - 1) * px + i];
        const hd = H[Math.min(px - 1, j + 1) * px + i];
        const ex = (hr - hl) / (2 * step);
        const ez = (hd - hu) / (2 * step);
        const shade = clamp(0.62 + (-ex * lx - ez * lz) * 1.7, 0.4, 1.35);
        r = c[0] * 255 * shade;
        g = c[1] * 255 * shade;
        b = c[2] * 255 * shade;
      }

      data[o] = clamp(r, 0, 255);
      data[o + 1] = clamp(g, 0, 255);
      data[o + 2] = clamp(b, 0, 255);
      data[o + 3] = 255;
    }
  }

  ctx.putImageData(img, 0, 0);

  // Highways (A5): draw the road network over the baked terrain as map symbols — a dark
  // casing under a faded-yellow centre line. Fixed pixel widths (the true ~6u carriageway
  // is sub-pixel at this scale) so roads stay legible at any radar zoom.
  const toPx = (wx: number, wz: number): [number, number] => [(wx + half) / step, (wz + half) / step];
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  for (const pass of [
    { color: 'rgba(40,33,24,0.85)', width: 3 }, // dark earth casing
    { color: 'rgba(166,142,104,0.95)', width: 1.2 }, // packed gravel
  ]) {
    ctx.strokeStyle = pass.color;
    ctx.lineWidth = pass.width;
    for (const rd of world.roads) {
      ctx.beginPath();
      for (let i = 0; i < rd.pts.length; i++) {
        const [rx, ry] = toPx(rd.pts[i].x, rd.pts[i].z);
        if (i === 0) ctx.moveTo(rx, ry);
        else ctx.lineTo(rx, ry);
      }
      ctx.stroke();
    }
  }

  // Province outline (anchored maps): mute everything OUTSIDE the real boundary and stroke the border,
  // so the radar reads as the actual province (e.g. Saskatchewan's trapezoid) instead of a filled square.
  const outline = world.provinceOutline();
  if (outline && outline.length >= 3) {
    const poly = outline.map((p) => toPx(p.x, p.z));
    const trace = () => {
      ctx.moveTo(poly[0][0], poly[0][1]);
      for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i][0], poly[i][1]);
      ctx.closePath();
    };
    // Shade the exterior: full-canvas rect MINUS the polygon (even-odd) → only off-province area fills.
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, canvas.width, canvas.height);
    trace();
    ctx.fillStyle = 'rgba(9,13,19,0.8)';
    ctx.fill('evenodd');
    ctx.restore();
    // Provincial boundary: dark casing under a faded-parchment dashed line (an administrative border).
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    trace();
    ctx.strokeStyle = 'rgba(6,9,13,0.9)';
    ctx.lineWidth = 3;
    ctx.setLineDash([]);
    ctx.stroke();
    ctx.beginPath();
    trace();
    ctx.strokeStyle = 'rgba(208,190,150,0.85)';
    ctx.lineWidth = 1.4;
    ctx.setLineDash([6, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  return canvas;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
