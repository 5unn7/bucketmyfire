/**
 * Shared cockpit theme — the one source of the glass-cockpit visual language and
 * the DOM helpers that build it. `HUD.ts` and `Input.ts` used to each carry their
 * own copy of the `UI` token object and these helpers (with a standing comment in
 * Input.ts asking to "lift both into a shared theme module"); this is that module.
 *
 * It also exports `anchor()` — the placement primitive that makes the HUD/controls
 * responsive and notch-safe for free. An anchor is a fixed, safe-area-aware corner
 * container that reads its inset/gap from the CSS vars `layout.ts` maintains, so a
 * new HUD widget is one line: `anchor('top-left').appendChild(widget)`.
 *
 * Zero binary assets — pure DOM + inline styles, matching the project ethos.
 */

// --- Design tokens ----------------------------------------------------------
// Reconciled superset of the two former copies. Where HUD and Input used slightly
// different values for the same idea (panel vs button glass, hairline vs button
// stroke, panel vs button shadow), BOTH are kept under distinct keys so each
// surface renders exactly as it did before — this is a layout refactor, not a
// restyle.
export const UI = {
  accent: '#67e8ff',
  accentSoft: 'rgba(103,232,255,0.55)',
  text: 'rgba(255,255,255,0.94)',
  dim: 'rgba(255,255,255,0.45)',
  warn: '#ff5d4d',
  fire: '#ff7a45',
  warm: '#ff7a45', // Input's name for the DROP / fire accent (== fire)
  water: '#56c4ee',
  // Surfaces
  panel: 'rgba(14,20,27,0.38)', // HUD frosted chip fill
  glass: 'rgba(12,18,25,0.42)', // touch-button fill (a touch more opaque, holds up over bright terrain)
  warmGlass: 'rgba(44,17,13,0.46)', // DROP hero fill
  warmStroke: 'rgba(255,138,110,0.85)',
  stroke: 'rgba(255,255,255,0.12)', // HUD panel hairline
  strokeStrong: 'rgba(255,255,255,0.18)', // touch-button border
  // Effects
  blur: 'blur(12px) saturate(120%)',
  shadow: '0 6px 28px rgba(0,0,0,0.32)', // HUD panels
  shadowBtn: '0 6px 22px rgba(0,0,0,0.40)', // touch buttons
  glow: '0 0 10px rgba(103,232,255,0.45)',
  font: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
};

// --- DOM helpers ------------------------------------------------------------

/** Create an element with inline styles (+ optional text). Generic over tag so
 *  future HUD bits can make spans/buttons; `div()` is the common shorthand. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  style: Partial<CSSStyleDeclaration>,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  Object.assign(node.style, style);
  if (text !== undefined) node.textContent = text;
  return node;
}

export function div(style: Partial<CSSStyleDeclaration>, text?: string): HTMLDivElement {
  return el('div', style, text);
}

/** Add backdrop-blur (with the -webkit- prefix iOS/Safari still needs). */
export function setBlur(node: HTMLElement): void {
  node.style.backdropFilter = UI.blur;
  node.style.setProperty('-webkit-backdrop-filter', UI.blur);
}

/** A frosted-glass panel: translucent fill, hairline border, backdrop blur. */
export function frosted(extra: Partial<CSSStyleDeclaration>): HTMLDivElement {
  const node = div({
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

/** A round frosted touch button (the stick cluster / DROP / eye / help share this). */
export function button(label: string, style: Partial<CSSStyleDeclaration>): HTMLDivElement {
  const node = div({
    position: 'fixed',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '50%',
    background: UI.glass,
    border: `1px solid ${UI.strokeStrong}`,
    color: UI.text,
    fontFamily: UI.font,
    fontSize: '24px',
    fontWeight: '600',
    boxShadow: UI.shadowBtn,
    userSelect: 'none',
    pointerEvents: 'auto',
    touchAction: 'none',
    ...style,
  });
  setBlur(node);
  node.textContent = label;
  return node;
}

/** Create a DPR-crisp 2D canvas positioned via inline styles. Mirrors any
 *  `backdropFilter` into the -webkit- prefix for Safari/iOS. */
export function makeCanvas(
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

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

// --- Anchors (responsive, safe-area-aware placement) ------------------------

export type AnchorPlace =
  | 'top-left'
  | 'top-center'
  | 'top-right'
  | 'left-center'
  | 'right-center'
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right';

/**
 * A fixed, full-safe-area-aware container pinned to one screen region. It reads
 * its edge inset and stack gap from the CSS custom properties `layout.ts` keeps
 * current (`--bmf-edge`, `--bmf-gap`) plus the static `--bmf-safe-*` insets, so
 * everything mounted inside it stays clear of notches/indicators and reflows when
 * the breakpoint changes — with no per-element JS.
 *
 * Top anchors stack downward; bottom anchors stack upward (first child nearest its
 * edge). The container itself is click-through (`pointerEvents:none`); interactive
 * children opt back in. Children align to the anchor's edge so corners read tidy.
 */
export function anchor(place: AnchorPlace): HTMLDivElement {
  const t = 'calc(var(--bmf-safe-t) + var(--bmf-edge))';
  const r = 'calc(var(--bmf-safe-r) + var(--bmf-edge))';
  const b = 'calc(var(--bmf-safe-b) + var(--bmf-edge))';
  const l = 'calc(var(--bmf-safe-l) + var(--bmf-edge))';

  const node = div({
    position: 'fixed',
    display: 'flex',
    gap: 'var(--bmf-gap)',
    pointerEvents: 'none',
    zIndex: '10',
  });

  switch (place) {
    case 'top-left':
      Object.assign(node.style, { top: t, left: l, flexDirection: 'column', alignItems: 'flex-start' });
      break;
    case 'top-center':
      Object.assign(node.style, {
        top: t,
        left: '50%',
        transform: 'translateX(-50%)',
        flexDirection: 'column',
        alignItems: 'center',
      });
      break;
    case 'top-right':
      Object.assign(node.style, { top: t, right: r, flexDirection: 'column', alignItems: 'flex-end' });
      break;
    case 'left-center':
      Object.assign(node.style, {
        left: l,
        top: '50%',
        transform: 'translateY(-50%)',
        flexDirection: 'column',
        alignItems: 'flex-start',
      });
      break;
    case 'right-center':
      Object.assign(node.style, {
        right: r,
        top: '50%',
        transform: 'translateY(-50%)',
        flexDirection: 'column',
        alignItems: 'flex-end',
      });
      break;
    case 'bottom-left':
      Object.assign(node.style, { bottom: b, left: l, flexDirection: 'column-reverse', alignItems: 'flex-start' });
      break;
    case 'bottom-center':
      Object.assign(node.style, {
        bottom: b,
        left: '50%',
        transform: 'translateX(-50%)',
        flexDirection: 'column-reverse',
        alignItems: 'center',
      });
      break;
    case 'bottom-right':
      Object.assign(node.style, { bottom: b, right: r, flexDirection: 'column-reverse', alignItems: 'flex-end' });
      break;
  }
  return node;
}
