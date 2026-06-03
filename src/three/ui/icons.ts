/**
 * Procedural 3D ISOMETRIC icons for the onboarding cards (maps + helicopters).
 *
 * Zero binary assets (the project rule): these are built as inline SVG — vector
 * data, not image files — from a tiny low-poly isometric engine. Every icon is a
 * little diorama on a platform tile, assembled from shaded boxes / pyramids in a
 * true 2:1 dimetric projection (top face brightest, +x face mid, +z face dark),
 * so they read as chunky 3D game-asset icons rather than flat glyphs.
 *
 * makeIcon(id) returns a fresh <svg> element (100×100 viewBox) for the catalog id;
 * unknown ids fall back to a generic crate so a future map/heli never renders blank.
 */

// --- isometric projection ---------------------------------------------------
// Tile space is (x, z) on the ground with y up. A point projects to screen with
// x stepping right+down, z stepping left+down, y straight up. OX/OY center it.
const U = 11; // pixels per tile unit along a screen axis
const OX = 50;
const OY = 50;

function P(x: number, z: number, y: number): string {
  const sx = OX + (x - z) * U;
  const sy = OY + (x + z) * U * 0.5 - y * U;
  return `${sx.toFixed(1)},${sy.toFixed(1)}`;
}

/** Multiply a #rrggbb hex by a brightness factor → an rgb() face shade. */
function shade(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, Math.round(((n >> 16) & 255) * f));
  const g = Math.min(255, Math.round(((n >> 8) & 255) * f));
  const b = Math.min(255, Math.round((n & 255) * f));
  return `rgb(${r},${g},${b})`;
}

function poly(points: string[], fill: string): string {
  return `<polygon points="${points.join(' ')}" fill="${fill}"/>`;
}

interface BoxColors {
  top?: string;
  right?: string;
  left?: string;
}

/** An isometric box: footprint w(x)×d(z) at height y, rising h. Three lit faces. */
function box(x: number, z: number, y: number, w: number, d: number, h: number, base: string, c: BoxColors = {}): string {
  const top = c.top ?? shade(base, 1.22);
  const right = c.right ?? shade(base, 0.9); // +x face (renders right)
  const left = c.left ?? shade(base, 0.62); // +z face (renders left)
  const fLeft = poly([P(x, z + d, y), P(x + w, z + d, y), P(x + w, z + d, y + h), P(x, z + d, y + h)], left);
  const fRight = poly([P(x + w, z, y), P(x + w, z + d, y), P(x + w, z + d, y + h), P(x + w, z, y + h)], right);
  const fTop = poly([P(x, z, y + h), P(x + w, z, y + h), P(x + w, z + d, y + h), P(x, z + d, y + h)], top);
  return fLeft + fRight + fTop;
}

/** A square-based isometric pyramid (cone stand-in for trees / peaks). */
function pyramid(cx: number, cz: number, baseY: number, half: number, h: number, base: string): string {
  const apex = P(cx, cz, baseY + h);
  const left = poly([P(cx - half, cz + half, baseY), P(cx + half, cz + half, baseY), apex], shade(base, 0.62));
  const right = poly([P(cx + half, cz - half, baseY), P(cx + half, cz + half, baseY), apex], shade(base, 0.92));
  return left + right;
}

/** Soft contact shadow on the ground at (cx,cz). */
function shadow(cx: number, cz: number, r: number): string {
  const sx = OX + (cx - cz) * U;
  const sy = OY + (cx + cz) * U * 0.5;
  return `<ellipse cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" rx="${(r * U).toFixed(1)}" ry="${(r * U * 0.5).toFixed(1)}" fill="rgba(0,0,0,0.22)"/>`;
}

/** The 3×3 ground tile every diorama sits on. */
function tile(topCol: string, sideBase: string): string {
  return box(0, 0, 0, 3, 3, 0.5, sideBase, { top: topCol });
}

// --- subjects ---------------------------------------------------------------

function pine(cx: number, cz: number, sc: number): string {
  let s = box(cx - 0.13, cz - 0.13, 0.5, 0.26, 0.26, 0.3 * sc, '#6b4a2c');
  const baseY = 0.5 + 0.3 * sc;
  s += pyramid(cx, cz, baseY, 0.52 * sc, 0.72 * sc, '#2f6d34');
  s += pyramid(cx, cz, baseY + 0.46 * sc, 0.38 * sc, 0.62 * sc, '#3c8240');
  return s;
}

function mapBoreal(): string {
  let s = tile('#5f8a3e', '#6b5536');
  // a cold lake inset into the grass (flat quad just above the top face)
  s += poly([P(1.65, 1.65, 0.51), P(2.92, 1.65, 0.51), P(2.92, 2.92, 0.51), P(1.65, 2.92, 0.51)], '#3d7fa6');
  s += poly([P(1.9, 1.9, 0.515), P(2.6, 1.9, 0.515), P(2.6, 2.6, 0.515), P(1.9, 2.6, 0.515)], '#4f93b8');
  // pines, emitted back (low x+z) → front (high x+z) for correct overlap
  s += pine(0.65, 0.55, 1.15);
  s += pine(1.45, 0.45, 0.95);
  s += pine(0.5, 1.55, 1.3);
  s += pine(1.2, 1.25, 1.05);
  return s;
}

function mapEmber(): string {
  let s = tile('#4a3f30', '#332a1d');
  // charred ground patch + logs
  s += poly([P(0.9, 0.9, 0.51), P(2.4, 0.9, 0.51), P(2.4, 2.4, 0.51), P(0.9, 2.4, 0.51)], '#241d14');
  s += box(0.9, 1.5, 0.5, 1.4, 0.2, 0.16, '#2c2118');
  s += box(1.4, 0.9, 0.5, 0.2, 1.4, 0.16, '#2c2118');
  // layered flame rising from the seat of the fire (amorphous → flat facing layers)
  const fx = 1.55,
    fz = 1.55;
  s += `<ellipse cx="${(OX + (fx - fz) * U).toFixed(1)}" cy="${(OY + (fx + fz) * U * 0.5).toFixed(1)}" rx="14" ry="7" fill="rgba(255,120,40,0.22)"/>`;
  s += poly([P(fx - 0.55, fz, 0.5), P(fx + 0.55, fz, 0.5), P(fx, fz, 2.05)], '#e0501c');
  s += poly([P(fx - 0.38, fz, 0.5), P(fx + 0.42, fz, 0.5), P(fx + 0.05, fz, 1.65)], '#f5882a');
  s += poly([P(fx - 0.2, fz, 0.5), P(fx + 0.24, fz, 0.5), P(fx + 0.02, fz, 1.15)], '#ffd24a');
  return s;
}

function mapGlacier(): string {
  let s = tile('#2f6f9e', '#384a58'); // water top, rock sides
  s += poly([P(0.2, 0.2, 0.51), P(1.3, 0.2, 0.51), P(1.3, 1.3, 0.51), P(0.2, 1.3, 0.51)], '#3f86b0');
  // main granite peak with a snow cap
  s += pyramid(1.55, 1.6, 0.5, 1.05, 1.75, '#6f7682');
  s += pyramid(1.55, 1.6, 1.7, 0.44, 0.6, '#eef4f8');
  // a small iceberg floating front-right
  s += box(2.25, 0.55, 0.5, 0.55, 0.55, 0.42, '#bfe0ef', { top: '#eef7fc' });
  return s;
}

// Helicopters share a grey landing pad. Nose points +x (front-right); the tail
// boom + rotor make each silhouette read as a chopper, sized to its character.
function heliPad(): string {
  return tile('#8a8f96', '#565b62');
}

function heliBell(): string {
  let s = heliPad();
  s += shadow(1.6, 1.55, 1.0);
  // skids
  s += box(0.7, 1.02, 0.55, 1.85, 0.16, 0.1, '#33373d');
  s += box(0.7, 1.92, 0.55, 1.85, 0.16, 0.1, '#33373d');
  // tail boom + fin (behind the cabin → drawn first)
  s += box(0.2, 1.42, 0.98, 0.95, 0.2, 0.2, '#dad8d2');
  s += box(0.08, 1.36, 1.0, 0.18, 0.32, 0.55, '#c8362a');
  // cabin (red flanks, white roof) + nose + glass
  s += box(1.05, 0.98, 0.65, 1.45, 1.1, 0.92, '#c8362a', { top: '#e6e5e0' });
  s += box(2.45, 1.12, 0.65, 0.42, 0.82, 0.62, '#c8362a', { top: '#e6e5e0' });
  s += poly([P(2.5, 1.18, 1.18), P(2.5, 1.86, 1.18), P(2.5, 1.86, 0.78), P(2.5, 1.18, 0.78)], '#27333d');
  // mast + two-blade rotor on top (drawn last → over everything)
  s += box(1.66, 1.44, 1.57, 0.2, 0.2, 0.2, '#3a3e44');
  s += box(0.15, 1.49, 1.77, 3.05, 0.12, 0.07, '#2b2f35');
  s += box(1.7, 0.0, 1.77, 0.12, 3.05, 0.07, '#2b2f35');
  s += box(1.6, 1.44, 1.76, 0.2, 0.2, 0.08, '#50555c');
  return s;
}

// Bell 212 — the twin-engine sister: same Bell silhouette as the 205, amber livery,
// with a fatter engine deck (the twin-pac hump) behind the mast.
function heliBell212(): string {
  let s = heliPad();
  s += shadow(1.6, 1.55, 1.0);
  // skids
  s += box(0.7, 1.02, 0.55, 1.85, 0.16, 0.1, '#33373d');
  s += box(0.7, 1.92, 0.55, 1.85, 0.16, 0.1, '#33373d');
  // tail boom + fin
  s += box(0.2, 1.42, 0.98, 0.95, 0.2, 0.2, '#e3dccb');
  s += box(0.08, 1.36, 1.0, 0.18, 0.32, 0.55, '#caa233');
  // cabin (amber flanks, cream roof) + nose + glass
  s += box(1.05, 0.98, 0.65, 1.45, 1.1, 0.92, '#d8a12a', { top: '#efe6cf' });
  s += box(2.45, 1.12, 0.65, 0.42, 0.82, 0.62, '#d8a12a', { top: '#efe6cf' });
  s += poly([P(2.5, 1.18, 1.18), P(2.5, 1.86, 1.18), P(2.5, 1.86, 0.78), P(2.5, 1.18, 0.78)], '#27333d');
  // twin-pac engine hump on the roof (what tells it apart from the 205)
  s += box(1.0, 1.22, 1.55, 0.85, 0.58, 0.26, '#9aa0a6', { top: '#c2c7cc' });
  // mast + two-blade rotor on top
  s += box(1.66, 1.44, 1.79, 0.2, 0.2, 0.2, '#3a3e44');
  s += box(0.15, 1.49, 1.99, 3.05, 0.12, 0.07, '#2b2f35');
  s += box(1.7, 0.0, 1.99, 0.12, 3.05, 0.07, '#2b2f35');
  s += box(1.6, 1.44, 1.98, 0.2, 0.2, 0.08, '#50555c');
  return s;
}

// UH-60 Black Hawk — bigger, olive-drab, with stub wings, a long body and a wide
// FOUR-blade rotor (drawn as a denser disc of bars).
function heliHawk(): string {
  let s = heliPad();
  s += shadow(1.62, 1.58, 1.15);
  // wheeled gear stance (Hawks roll, not skid) — short stubs
  s += box(1.2, 0.92, 0.5, 0.22, 0.22, 0.2, '#2b2f35');
  s += box(1.2, 2.02, 0.5, 0.22, 0.22, 0.2, '#2b2f35');
  s += box(0.35, 1.42, 0.5, 0.22, 0.22, 0.18, '#2b2f35');
  // long low tail boom + swept fin + canted stabilator
  s += box(-0.05, 1.42, 0.86, 1.05, 0.2, 0.2, '#5b6b50');
  s += box(-0.12, 1.36, 0.86, 0.16, 0.32, 0.66, '#46523d');
  s += box(0.2, 0.95, 0.92, 0.16, 1.5, 0.08, '#46523d');
  // big slab cabin (olive, darker roof) + sloped nose + windscreen
  s += box(0.9, 0.86, 0.6, 1.55, 1.3, 0.86, '#5b6b50', { top: '#46523d' });
  s += box(2.35, 1.06, 0.6, 0.5, 0.9, 0.5, '#5b6b50', { top: '#46523d' });
  s += poly([P(2.6, 1.12, 1.12), P(2.6, 1.92, 1.12), P(2.6, 1.92, 0.74), P(2.6, 1.12, 0.74)], '#222a30');
  // stub wings / ESSS pylons either side
  s += box(1.2, 0.4, 0.92, 0.5, 0.45, 0.12, '#46523d');
  s += box(1.2, 2.18, 0.92, 0.5, 0.45, 0.12, '#46523d');
  // mast + WIDE four-blade rotor (two crossed bars + two diagonals)
  s += box(1.62, 1.36, 1.5, 0.24, 0.24, 0.22, '#3a3e44');
  s += box(-0.1, 1.43, 1.71, 3.6, 0.12, 0.06, '#23272c');
  s += box(1.66, -0.25, 1.71, 0.12, 3.6, 0.06, '#23272c');
  s += box(1.56, 1.3, 1.69, 0.24, 0.24, 0.08, '#50555c');
  return s;
}

const BUILDERS: Record<string, () => string> = {
  'boreal-shield': mapBoreal,
  'ember-flats': mapEmber,
  'glacier-coast': mapGlacier,
  'bell-205a1': heliBell,
  'bell-212': heliBell212,
  'uh-60': heliHawk,
};

function genericCrate(): string {
  return tile('#7c828a', '#4f545b') + box(0.9, 0.9, 0.5, 1.2, 1.2, 1.0, '#9aa0a6', { top: '#c2c7cc' });
}

/** Build a fresh isometric SVG icon element for a catalog id. */
export function makeIcon(id: string): SVGElement {
  const inner = (BUILDERS[id] ?? genericCrate)();
  const doc = new DOMParser().parseFromString(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" shape-rendering="geometricPrecision">${inner}</svg>`,
    'image/svg+xml',
  );
  return doc.documentElement as unknown as SVGElement;
}
