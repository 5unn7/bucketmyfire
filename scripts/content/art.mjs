/**
 * Procedural Field Notes art — deterministic, infinitely-consistent blog imagery with zero binary
 * assets and zero per-article authoring. One pure function, `scene({ seed, pillar })`, draws an
 * on-brand northern-Saskatchewan boreal wildfire scene (warm "fight" register — see DESIGN.md) as
 * standalone SVG. Everything (ridgelines, treeline, smoke drift, embers, the slung-bucket helicopter,
 * which side it banks) is derived from the article slug via a seeded mulberry32 PRNG, exactly like the
 * game world is seeded from `WORLD3D.seed`. Same slug ⇒ byte-identical art forever; a new slug ⇒ a new
 * scene in the same family. No fonts, no `<style>`, no external refs — presentation attributes only —
 * so it renders identically inline in the page, as an `<img src=hero.svg>`, and rasterized to PNG by
 * `sharp` for the social OG card.
 *
 * Brand palette (from src/three/ui/theme.ts): ember #ff6a2c · emberHi #ffc24a · fire #ff7a45 ·
 * gold #ffd66b · night #07090b / #0a0d10. The fire is the light source: it glows at the horizon and
 * rim-lights the ridges, the smoke, and the top edge of the aircraft.
 */

export const ART_W = 1200;
export const ART_H = 630;

/* ── seeded PRNG (mulberry32 + FNV-1a string hash; mirrors the game's deterministic-from-seed law) ─ */
function hashStr(s) {
  let h = 2166136261 >>> 0;
  s = String(s);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function makeRng(seed) {
  const r = mulberry32(hashStr(seed));
  const rng = () => r();
  rng.range = (lo, hi) => lo + (hi - lo) * r();
  rng.int = (lo, hi) => Math.floor(lo + (hi - lo + 1) * r());
  rng.pick = (arr) => arr[Math.floor(r() * arr.length)];
  rng.chance = (p) => r() < p;
  rng.sign = () => (r() < 0.5 ? -1 : 1);
  return rng;
}
const n1 = (v) => Math.round(v * 10) / 10; // 1-decimal, keeps the markup small

/** Smooth 1-D value noise from `count` seeded control points (smoothstep interpolation). */
function makeNoise(rng, count) {
  const pts = Array.from({ length: count + 1 }, () => rng());
  return (t) => {
    const x = t * count;
    const i = Math.floor(x);
    const f = x - i;
    const a = pts[i] ?? pts[count];
    const b = pts[i + 1] ?? pts[0];
    const s = f * f * (3 - 2 * f);
    return a + (b - a) * s;
  };
}

/* ── shape builders ──────────────────────────────────────────────────────────── */

/** A filled ridge silhouette across the full width, closed to the canvas floor. */
function ridgePath(noise, baseY, amp, W = ART_W, H = ART_H, steps = 40) {
  let d = '';
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = t * W;
    const y = baseY - noise(t) * amp;
    d += (i ? ' L' : 'M') + n1(x) + ' ' + n1(y);
  }
  return `${d} L${W} ${H} L0 ${H} Z`;
}

/** A single spruce silhouette (two stacked tapered tiers) standing at (x, baseY). */
function spruce(x, baseY, h, w, fill) {
  const half = w / 2;
  const t1 = baseY - h; // tip
  const m = baseY - h * 0.42; // mid shoulder
  const trunk = baseY + 1;
  return (
    `<path d="M${n1(x)} ${n1(t1)} L${n1(x + half * 0.62)} ${n1(m)} L${n1(x - half * 0.62)} ${n1(m)} Z` +
    ` M${n1(x)} ${n1(baseY - h * 0.66)} L${n1(x + half)} ${n1(trunk)} L${n1(x - half)} ${n1(trunk)} Z" fill="${fill}"/>`
  );
}

/** A dense seeded treeline along a ridge top — the boreal foreground/midground. */
function treeline(rng, baseFn, fromX, toX, count, hLo, hHi, fill) {
  let out = '';
  for (let i = 0; i < count; i++) {
    const x = rng.range(fromX, toX);
    const h = rng.range(hLo, hHi);
    out += spruce(x, baseFn(x), h, h * rng.range(0.34, 0.46), fill);
  }
  return out;
}

/** A soft fire at (x, y): a smooth radial glow (no hard rings) with a small hot spark at its heart. */
function fireCore(x, y, scale) {
  return (
    `<ellipse cx="${n1(x)}" cy="${n1(y)}" rx="${n1(52 * scale)}" ry="${n1(24 * scale)}" fill="url(#fire)"/>` +
    `<ellipse cx="${n1(x)}" cy="${n1(y - 1)}" rx="${n1(5 * scale)}" ry="${n1(3 * scale)}" fill="#fff0c4" opacity="0.85"/>`
  );
}

/**
 * A drifting smoke column rooted at the fire (x, y) — a stack of overlapping translucent puffs that
 * grow, lean, and fade as they rise. Soft billows read as smoke; a single filled wedge reads as a
 * searchlight, so this is deliberately puff-based.
 */
function smoke(rng, x, y, scale) {
  let out = fireCore(x, y, scale);
  const puffs = 11;
  const rise = rng.range(190, 250) * scale;
  const drift = rng.range(-1, 1) * 9 * scale; // wind lean per step
  const wob = rng.range(0.6, 1.1);
  for (let i = 0; i < puffs; i++) {
    const t = i / (puffs - 1);
    const r = (9 + t * 58) * scale;
    const py = y - t * rise;
    const px = x + drift * i + Math.sin(i * 0.9 + wob) * 11 * scale * t;
    const op = n1(0.3 * (1 - t) + 0.05);
    const col = i < 3 ? '#5a3a2a' : '#46434c'; // fire-lit brown at the base → cool grey aloft
    out += `<ellipse cx="${n1(px)}" cy="${n1(py)}" rx="${n1(r)}" ry="${n1(r * 0.82)}" fill="${col}" opacity="${op}"/>`;
  }
  return out;
}

/**
 * The brand hero: a Bell-utility helicopter silhouette banking, with a slung Bambi bucket on a rope.
 * Drawn nose-right in a local frame, then placed/rotated/flipped. Near-black with a thin ember
 * rim-light on the top edges (the fire is the light). Disc rotor (not separate blades) — avoids the
 * "extra rotor blade" / toy-helicopter failure mode in the bmf-art negative list.
 */
function helicopter(cx, cy, scale, faceLeft, bank, full) {
  const ink = '#08090a';
  const rim = '#ff8a4a';
  const body =
    // cabin + tapering tail boom to a small vertical fin
    `<path d="M-44 2 C-46 -10 -30 -16 -14 -16 C2 -16 16 -12 26 -6` +
    ` L58 -3 L66 -12 L69 -3 L60 4 L24 7 C10 12 -8 12 -26 10 C-40 9 -44 7 -44 2 Z" fill="${ink}"/>`;
  const mast = `<rect x="-8" y="-25" width="5" height="11" fill="${ink}"/>`;
  const rotor = `<ellipse cx="-5" cy="-26" rx="74" ry="3.4" fill="${ink}"/><ellipse cx="-5" cy="-27.2" rx="74" ry="1.1" fill="${rim}" opacity="0.55"/>`;
  const tailRotor = `<ellipse cx="66" cy="-7" rx="3" ry="10" fill="${ink}"/>`;
  const skids =
    `<path d="M-34 22 L20 22 M-30 12 L-26 22 M10 12 L14 22" stroke="${ink}" stroke-width="3.2" fill="none" stroke-linecap="round"/>`;
  const rimLight = `<path d="M-14 -16 C2 -16 16 -12 26 -6" stroke="${rim}" stroke-width="1.4" fill="none" opacity="0.5"/>`;
  // slung bucket on a rope from the belly
  const bucket = full
    ? `<line x1="-6" y1="11" x2="-6" y2="42" stroke="${ink}" stroke-width="1.4"/>` +
      `<path d="M-13 42 L1 42 L-2 60 L-10 60 Z" fill="${ink}"/>` +
      `<rect x="-13.5" y="40.5" width="15" height="3.2" rx="1.4" fill="${ink}"/>` +
      `<rect x="-13.5" y="40.5" width="15" height="1.3" fill="${rim}" opacity="0.4"/>`
    : '';
  const flip = faceLeft ? ' scale(-1,1)' : '';
  return (
    `<g transform="translate(${n1(cx)} ${n1(cy)}) rotate(${n1(bank)}) scale(${n1(scale)})${flip}">` +
    rotor +
    mast +
    tailRotor +
    body +
    rimLight +
    skids +
    bucket +
    `</g>`
  );
}

/** A small cabin/home silhouette on a ridge — "the stakes" motif for the preparedness pillar. */
function cabin(x, baseY, w, fill) {
  const h = w * 0.62;
  const wallTop = baseY - h * 0.55;
  const ridge = baseY - h;
  const hw = w / 2;
  return (
    `<path d="M${n1(x - hw)} ${n1(baseY)} L${n1(x - hw)} ${n1(wallTop)} L${n1(x)} ${n1(ridge)} L${n1(x + hw)} ${n1(wallTop)} L${n1(x + hw)} ${n1(baseY)} Z" fill="${fill}"/>` +
    `<rect x="${n1(x - hw * 0.55)} " y="${n1(wallTop + h * 0.18)}" width="${n1(w * 0.22)}" height="${n1(h * 0.42)}" fill="#ffb24a" opacity="0.85"/>` // lit window
  );
}

/** A fire-lookout tower silhouette — a tapered lattice with a small lit cab. (foreground motif) */
function lookoutTower(x, baseY, h, fill) {
  const w = h * 0.3,
    tw = h * 0.12,
    top = baseY - h;
  const sw = Math.max(1.2, h * 0.022);
  let g =
    `<line x1="${n1(x - w)}" y1="${n1(baseY)}" x2="${n1(x - tw)}" y2="${n1(top)}" stroke="${fill}" stroke-width="${n1(sw)}"/>` +
    `<line x1="${n1(x + w)}" y1="${n1(baseY)}" x2="${n1(x + tw)}" y2="${n1(top)}" stroke="${fill}" stroke-width="${n1(sw)}"/>`;
  const seg = 4;
  for (let i = 0; i < seg; i++) {
    const t0 = i / seg,
      t1 = (i + 1) / seg;
    const y0 = baseY - (baseY - top) * t0,
      y1 = baseY - (baseY - top) * t1;
    const lw0 = w + (tw - w) * t0,
      lw1 = w + (tw - w) * t1;
    g += `<line x1="${n1(x - lw1)}" y1="${n1(y1)}" x2="${n1(x + lw1)}" y2="${n1(y1)}" stroke="${fill}" stroke-width="${n1(sw * 0.7)}"/>`;
    g += `<line x1="${n1(x - lw0)}" y1="${n1(y0)}" x2="${n1(x + lw1)}" y2="${n1(y1)}" stroke="${fill}" stroke-width="${n1(sw * 0.5)}"/>`;
    g += `<line x1="${n1(x + lw0)}" y1="${n1(y0)}" x2="${n1(x - lw1)}" y2="${n1(y1)}" stroke="${fill}" stroke-width="${n1(sw * 0.5)}"/>`;
  }
  const cw = tw * 2.6,
    ch = h * 0.13;
  g += `<rect x="${n1(x - cw / 2)}" y="${n1(top - ch)}" width="${n1(cw)}" height="${n1(ch)}" fill="${fill}"/>`;
  g += `<path d="M${n1(x - cw / 2 - 2)} ${n1(top - ch)} L${n1(x)} ${n1(top - ch - h * 0.09)} L${n1(x + cw / 2 + 2)} ${n1(top - ch)} Z" fill="${fill}"/>`;
  g += `<rect x="${n1(x - cw * 0.22)}" y="${n1(top - ch * 0.84)}" width="${n1(cw * 0.44)}" height="${n1(ch * 0.5)}" fill="#ffb24a" opacity="0.7"/>`;
  return g;
}

/** A charred dead tree (burned-over scorch motif): a thin tapering trunk with a couple of stubs. */
function snag(x, baseY, h, fill) {
  const sw = Math.max(1, h * 0.05);
  return (
    `<line x1="${n1(x)}" y1="${n1(baseY)}" x2="${n1(x + h * 0.06)}" y2="${n1(baseY - h)}" stroke="${fill}" stroke-width="${n1(sw)}" stroke-linecap="round"/>` +
    `<line x1="${n1(x + h * 0.03)}" y1="${n1(baseY - h * 0.55)}" x2="${n1(x + h * 0.2)}" y2="${n1(baseY - h * 0.62)}" stroke="${fill}" stroke-width="${n1(sw * 0.7)}" stroke-linecap="round"/>` +
    `<line x1="${n1(x + h * 0.04)}" y1="${n1(baseY - h * 0.72)}" x2="${n1(x - h * 0.16)}" y2="${n1(baseY - h * 0.8)}" stroke="${fill}" stroke-width="${n1(sw * 0.6)}" stroke-linecap="round"/>`
  );
}

/** Scoop run effects: expanding ripple rings + a burst of bright spray at the dipping bucket. */
function scoopFx(rng, x, waterY, scale) {
  let g = '';
  for (let i = 0; i < 3; i++) {
    const rr = (10 + i * 16) * scale;
    g += `<ellipse cx="${n1(x)}" cy="${n1(waterY)}" rx="${n1(rr)}" ry="${n1(rr * 0.34)}" fill="none" stroke="#ffd9a8" stroke-width="${n1(1.2 * scale)}" opacity="${n1(0.34 - i * 0.09)}"/>`;
  }
  for (let i = 0; i < 11; i++) {
    const dx = rng.range(-20, 20) * scale;
    const dy = -rng.range(2, 22) * scale;
    g += `<circle cx="${n1(x + dx)}" cy="${n1(waterY + dy)}" r="${n1(rng.range(0.7, 2) * scale)}" fill="#eaf4ff" opacity="${n1(rng.range(0.4, 0.75))}"/>`;
  }
  return g;
}

/** A water-drop curtain falling from the bucket at (x0,topY) toward a fire at (xBot,botY), + steam. */
function waterCurtain(x0, topY, xBot, botY, scale) {
  const tw = 7 * scale,
    bw = 30 * scale;
  let g = `<path d="M${n1(x0 - tw)} ${n1(topY)} L${n1(x0 + tw)} ${n1(topY)} L${n1(xBot + bw)} ${n1(botY)} L${n1(xBot - bw)} ${n1(botY)} Z" fill="url(#water)" opacity="0.45"/>`;
  for (let i = 0; i < 5; i++) {
    const t = i / 4;
    const sxT = x0 + (t - 0.5) * tw * 1.6;
    const sxB = xBot + (t - 0.5) * bw * 1.6;
    g += `<line x1="${n1(sxT)}" y1="${n1(topY)}" x2="${n1(sxB)}" y2="${n1(botY)}" stroke="#dcebff" stroke-width="${n1(1.1 * scale)}" opacity="0.5"/>`;
  }
  g += `<ellipse cx="${n1(xBot)}" cy="${n1(botY)}" rx="${n1(28 * scale)}" ry="${n1(11 * scale)}" fill="#cfd6da" opacity="0.3"/>`;
  return g;
}

/** A subtle aurora band high in the northern sky (calm pillars only). */
function auroraBand(rng, W, horizon) {
  let g = '';
  const bands = 2 + (rng() < 0.5 ? 1 : 0);
  for (let b = 0; b < bands; b++) {
    const baseY = horizon * 0.34 + b * horizon * 0.12;
    const amp = 14 + b * 6;
    const th = 26 - b * 5;
    const nz = makeNoise(rng, 5);
    let top = '',
      bot = '';
    for (let i = 0; i <= 28; i++) {
      const t = i / 28;
      top += (i ? ' L' : 'M') + n1(t * W) + ' ' + n1(baseY - nz(t) * amp);
    }
    for (let i = 28; i >= 0; i--) {
      const t = i / 28;
      bot += ' L' + n1(t * W) + ' ' + n1(baseY - nz(t) * amp + th);
    }
    g += `<path d="${top}${bot} Z" fill="url(#aurora)" opacity="${n1(0.11 - b * 0.025)}"/>`;
  }
  return g;
}

/* ── pillar archetypes — the seed picks ONE per article, so siblings in a pillar differ ─────────
   time-of-day shifts the whole sky; action is what the helicopter is doing; fg is the foreground
   subject; fire is an active blaze vs a burned-over scar. Each pillar allows a curated set. */
const TIMES = {
  night: { s0: '#06090b', s1: '#0b0c10', s2: '#1a0f0d', s3: '#2a130c', glow: 1.0, stars: 1.0, haze: '#ff7a2a' },
  dusk: { s0: '#0a0a14', s1: '#181018', s2: '#3a1a12', s3: '#5e2a12', glow: 1.05, stars: 0.45, haze: '#ff8a3a' },
  dawn: { s0: '#16213a', s1: '#2b2733', s2: '#5a3722', s3: '#9a5526', glow: 0.78, stars: 0.16, haze: '#ffb060' },
};
const PILLAR = {
  'how-wildfires-are-fought': {
    time: ['night', 'night', 'dusk'],
    action: ['patrol', 'scoop', 'drop', 'patrol'],
    fg: ['lake', 'lake', 'tower'],
    fire: ['spot', 'front', 'spot'],
    embers: 1.0,
  },
  'wildfire-preparedness': {
    time: ['night', 'dusk', 'dawn'],
    action: ['none'],
    fg: ['cabin', 'cabin', 'tower'],
    fire: ['spot', 'out'],
    embers: 0.5,
  },
  'wildfire-data-explainers': {
    time: ['night', 'dawn'],
    action: ['patrolfar', 'none'],
    fg: ['lake', 'scorch'],
    fire: ['spot', 'out'],
    embers: 0.5,
    contour: true,
    aurora: ['none', 'none', 'aurora'],
  },
  'the-cause': {
    time: ['night', 'dawn'],
    action: ['none', 'patrolfar'],
    fg: ['lake', 'scorch'],
    fire: ['spot', 'out'],
    embers: 0.4,
    calm: true,
    aurora: ['none', 'aurora', 'aurora'],
  },
};
const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];
function chooseVariant(rng, pillar) {
  const p = PILLAR[pillar] || PILLAR['how-wildfires-are-fought'];
  return {
    time: pick(rng, p.time),
    action: pick(rng, p.action),
    fg: pick(rng, p.fg),
    fire: pick(rng, p.fire),
    embers: p.embers ?? 1,
    contour: !!p.contour,
    calm: !!p.calm,
    aurora: p.aurora ? pick(rng, p.aurora) === 'aurora' : false,
  };
}

/* ── the scene ───────────────────────────────────────────────────────────────── */

/**
 * Build the inner SVG markup (defs + layers) for one article's scene. Pure + deterministic.
 * Returns the contents BETWEEN <svg> tags so callers can either wrap it bare (hero.svg) or compose
 * title text over it (the OG card).
 */
export function scene({ seed = 'field-notes', pillar = '' } = {}) {
  const rng = makeRng(seed);
  const v = chooseVariant(rng, pillar);
  const T = TIMES[v.time] || TIMES.night;
  const W = ART_W,
    H = ART_H;
  const fireActive = v.fire !== 'out';

  // where the fire sits on the horizon (drives glow, smoke, ember origin, where the heli looks)
  const fireX = rng.range(0.24, 0.76) * W;
  const horizon = rng.range(0.52, 0.6) * H;
  const lakeTop = rng.range(0.7, 0.76) * H;
  const glowBase = (v.calm ? 0.42 : 0.62) * T.glow * (fireActive ? 1 : 0.42);

  const defs =
    `<defs>` +
    `<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0" stop-color="${T.s0}"/><stop offset="0.5" stop-color="${T.s1}"/>` +
    `<stop offset="0.82" stop-color="${T.s2}"/><stop offset="1" stop-color="${T.s3}"/>` +
    `</linearGradient>` +
    `<radialGradient id="fireglow" cx="${n1((fireX / W) * 100)}%" cy="${n1((horizon / H) * 100)}%" r="60%">` +
    `<stop offset="0" stop-color="#ff7a2a" stop-opacity="${n1(glowBase)}"/>` +
    `<stop offset="0.4" stop-color="#ff6a2c" stop-opacity="${n1(glowBase * 0.26)}"/>` +
    `<stop offset="1" stop-color="#ff6a2c" stop-opacity="0"/>` +
    `</radialGradient>` +
    `<linearGradient id="lake" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0" stop-color="#2a1c18"/><stop offset="1" stop-color="#070a0d"/>` +
    `</linearGradient>` +
    `<radialGradient id="refl" cx="50%" cy="0%" r="85%">` +
    `<stop offset="0" stop-color="#ff8a3a" stop-opacity="0.32"/>` +
    `<stop offset="1" stop-color="#ff8a3a" stop-opacity="0"/>` +
    `</radialGradient>` +
    `<radialGradient id="fire" cx="50%" cy="50%" r="50%">` +
    `<stop offset="0" stop-color="#ffe08a" stop-opacity="0.95"/>` +
    `<stop offset="0.22" stop-color="#ff9a3a" stop-opacity="0.7"/>` +
    `<stop offset="0.55" stop-color="#ff6a2c" stop-opacity="0.26"/>` +
    `<stop offset="1" stop-color="#ff6a2c" stop-opacity="0"/>` +
    `</radialGradient>` +
    `<linearGradient id="water" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0" stop-color="#bfe0ff" stop-opacity="0.55"/><stop offset="1" stop-color="#7fb6e8" stop-opacity="0.18"/>` +
    `</linearGradient>` +
    `<linearGradient id="aurora" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0" stop-color="#6affc0" stop-opacity="0"/><stop offset="0.5" stop-color="#57f0b0" stop-opacity="0.85"/><stop offset="1" stop-color="#3ad0ff" stop-opacity="0"/>` +
    `</linearGradient>` +
    `<radialGradient id="vig" cx="50%" cy="42%" r="75%">` +
    `<stop offset="0.62" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.4"/>` +
    `</radialGradient>` +
    `</defs>`;

  // sky + fire uplight
  let s = `<rect width="${W}" height="${H}" fill="url(#sky)"/>`;
  s += `<rect width="${W}" height="${H}" fill="url(#fireglow)"/>`;

  // aurora ribbon high in the northern sky (calm pillars)
  if (v.aurora) s += auroraBand(rng, W, horizon);

  // stars (upper sky, away from the glow) — sparse at dawn, dense on a calm clear night
  const starN = Math.round((v.calm ? 46 : 28) * T.stars);
  for (let i = 0; i < starN; i++) {
    s += `<circle cx="${n1(rng.range(0, W))}" cy="${n1(rng.range(0, horizon - 60))}" r="${n1(rng.range(0.4, 1.3))}" fill="#fff" opacity="${n1(rng.range(0.12, 0.5))}"/>`;
  }

  // optional data-explainer motif: faint contour lines low in the sky
  if (v.contour) {
    const cn = makeNoise(rng, 7);
    for (let k = 0; k < 4; k++) {
      const by = horizon - 30 - k * 26;
      let d = '';
      for (let i = 0; i <= 32; i++) {
        const t = i / 32;
        d += (i ? ' L' : 'M') + n1(t * W) + ' ' + n1(by - cn(t + k * 0.3) * 16);
      }
      s += `<path d="${d}" fill="none" stroke="#ffc24a" stroke-width="0.8" opacity="0.1"/>`;
    }
  }

  // distant ridges (hazy, warm-lit) → near ridges (dark). Each its own seeded noise.
  const ridges = [
    { base: horizon - 6, amp: 34, fill: '#5e3622', op: 0.5, nodes: 6 },
    { base: horizon + 30, amp: 46, fill: '#3a2117', op: 0.72, nodes: 7 },
    { base: horizon + 70, amp: 58, fill: '#20140f', op: 0.9, nodes: 8 },
  ];
  for (const rg of ridges) {
    const nz = makeNoise(rng, rg.nodes);
    s += `<path d="${ridgePath(nz, rg.base, rg.amp)}" fill="${rg.fill}" opacity="${rg.op}"/>`;
    let rim = '';
    for (let i = 0; i <= 40; i++) {
      const t = i / 40;
      rim += (i ? ' L' : 'M') + n1(t * W) + ' ' + n1(rg.base - nz(t) * rg.amp);
    }
    s += `<path d="${rim}" fill="none" stroke="#ff8a3a" stroke-width="1" opacity="${n1(rg.op * 0.18 * (fireActive ? 1 : 0.5))}"/>`;
  }

  // the fire(s): a lone spot, a wider running front (several cores), or none (burned out)
  const cores = [];
  if (v.fire === 'spot') {
    cores.push({ x: fireX, y: horizon + rng.range(10, 34), sc: rng.range(0.85, 1.1) });
  } else if (v.fire === 'front') {
    for (let i = 0; i < 3; i++) {
      cores.push({ x: fireX + (i - 1) * rng.range(120, 180), y: horizon + rng.range(8, 32), sc: rng.range(0.8, 1.15) });
    }
  }
  for (const c of cores) s += smoke(rng, c.x, c.y, c.sc);
  if (!fireActive) {
    // burned out: a thin residual wisp + a couple of dim smoulders down on the scar
    s += smoke(rng, fireX, horizon + rng.range(12, 28), rng.range(0.5, 0.7));
  }

  // the lake band (scoop water) + a soft ember reflection feathering down under an active fire
  s += `<rect x="0" y="${n1(lakeTop)}" width="${W}" height="${n1(H - lakeTop)}" fill="url(#lake)"/>`;
  s += `<rect x="0" y="${n1(lakeTop)}" width="${W}" height="1.5" fill="#ff9a4a" opacity="${fireActive ? 0.26 : 0.12}"/>`;
  if (fireActive) {
    s += `<ellipse cx="${n1(fireX)}" cy="${n1(lakeTop)}" rx="${n1(rng.range(30, 46))}" ry="${n1((H - lakeTop) * 0.55)}" fill="url(#refl)"/>`;
  }

  // midground treeline (thinner over a burn scar)
  s += treeline(rng, () => horizon + 64, -10, W + 10, v.fg === 'scorch' ? 12 : 26, 16, 40, '#160f0c');

  // near-shore foreground: living forest, or a charred scar of snags
  if (v.fg === 'scorch') {
    s += `<rect x="0" y="${n1(lakeTop - 30)}" width="${W}" height="${n1(H - lakeTop + 30)}" fill="#1a0e0a" opacity="0.5"/>`;
    for (let i = 0; i < 22; i++) {
      s += snag(rng.range(-10, W + 10), lakeTop + 2 + rng.range(0, 6), rng.range(22, 46), '#0a0706');
    }
    for (let i = 0; i < 5; i++) {
      s += `<ellipse cx="${n1(rng.range(0.1, 0.9) * W)}" cy="${n1(lakeTop + rng.range(2, 14))}" rx="${n1(rng.range(14, 26))}" ry="${n1(rng.range(6, 11))}" fill="url(#fire)" opacity="0.4"/>`;
    }
  } else {
    s += treeline(rng, () => lakeTop + 2, -10, W + 10, 30, 20, 52, '#0a0807');
  }

  // foreground subject motif
  if (v.fg === 'cabin') s += cabin(rng.range(0.16, 0.84) * W, lakeTop - 4, rng.range(46, 64), '#0c0a09');
  if (v.fg === 'tower') s += lookoutTower(rng.range(0.2, 0.8) * W, lakeTop + 2, rng.range(70, 100), '#0a0807');

  // drifting embers from an active fire (warm sparks)
  const emN = Math.round(26 * v.embers * (fireActive ? 1 : 0.35));
  for (let i = 0; i < emN; i++) {
    const x = fireX + rng.range(-260, 260);
    const y = rng.range(horizon - 110, lakeTop - 10);
    s += `<circle cx="${n1(x)}" cy="${n1(y)}" r="${n1(rng.range(0.8, 2.4))}" fill="${rng.chance(0.5) ? '#ffc24a' : '#ff7a2a'}" opacity="${n1(rng.range(0.3, 0.85))}"/>`;
  }

  // the helicopter (the brand hero) — patrolling, scooping from the lake, or running a drop
  if (v.action !== 'none') {
    const tgt = cores.length ? cores[0] : { x: fireX, y: horizon + 18 };
    if (v.action === 'scoop') {
      const onLeft = tgt.x > W * 0.5;
      const faceLeft = !onLeft;
      const hx = onLeft ? rng.range(0.2, 0.34) * W : rng.range(0.66, 0.8) * W;
      const sc = rng.range(0.9, 1.1);
      const waterY = lakeTop + (H - lakeTop) * 0.28;
      const hy = waterY - 58 * sc; // bucket just reaches the water
      const bucketX = hx + (faceLeft ? 6 : -6) * sc;
      s += scoopFx(rng, bucketX, waterY, sc);
      s += helicopter(hx, hy, sc, faceLeft, (onLeft ? 1 : -1) * rng.range(2, 6), true);
    } else if (v.action === 'drop') {
      const onLeft = tgt.x > W * 0.5;
      const faceLeft = !onLeft;
      const hx = onLeft ? rng.range(0.2, 0.32) * W : rng.range(0.68, 0.8) * W;
      const hy = rng.range(0.26, 0.36) * H;
      const sc = rng.range(0.92, 1.12);
      const bucketX = hx + (faceLeft ? 6 : -6) * sc;
      s += waterCurtain(bucketX, hy + 22 * sc, tgt.x, tgt.y, sc);
      s += helicopter(hx, hy, sc, faceLeft, (onLeft ? 1 : -1) * rng.range(4, 9), true);
    } else {
      const far = v.action === 'patrolfar';
      const onLeft = fireX > W * 0.5;
      const hx = onLeft ? rng.range(0.16, 0.3) * W : rng.range(0.7, 0.84) * W;
      const hy = rng.range(0.2, 0.34) * H;
      const sc = far ? rng.range(0.55, 0.7) : rng.range(0.95, 1.2);
      s += helicopter(hx, hy, sc, !onLeft, (onLeft ? 1 : -1) * rng.range(6, 13), !far);
    }
  }

  // atmospheric haze over the horizon + a soft vignette to seat everything
  s += `<rect x="0" y="${n1(horizon - 40)}" width="${W}" height="90" fill="${T.haze}" opacity="0.05"/>`;
  s += `<rect width="${W}" height="${H}" fill="url(#vig)"/>`;

  return defs + s;
}

/** A complete standalone scene SVG (the per-article hero.svg / card art). */
export function heroSvg(opts) {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${ART_W}" height="${ART_H}" viewBox="0 0 ${ART_W} ${ART_H}" preserveAspectRatio="xMidYMid slice" role="img">` +
    scene(opts) +
    `</svg>`
  );
}
