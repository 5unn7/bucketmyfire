/**
 * Brand logo — the official bucketmyfire icon (the bucket-drop flame mark) and the
 * "BUCKET MY FIRE" wordmark. The vector source of truth is the brand's own SVG files,
 * served from `public/brand/` (copied from `brand/logo/SVG/`), so this module just
 * references them as <img> — no inlined path data to drift from the brand.
 *
 * Two ink variants ship (white for dark surfaces / over the fire art, black for light
 * ones). Each builder returns a fresh <img> ready to appendChild; the parent box sizes
 * it (set a `height` + matching `aspectRatio`, the img fills width:100%/height:100%).
 *
 * BASE_URL-prefixed so the path resolves under any deploy base (root or /bucketmyfire/).
 */

const BASE = import.meta.env.BASE_URL;

const ICON = { white: `${BASE}brand/icon_white.svg`, black: `${BASE}brand/icon_black.svg` } as const;
const WORDMARK = { white: `${BASE}brand/wordmark_white.svg`, black: `${BASE}brand/wordmark_black.svg` } as const;

export type BrandInk = 'white' | 'black';

function makeImg(src: string, label: string): HTMLImageElement {
  const img = document.createElement('img');
  img.src = src;
  img.alt = label;
  img.decoding = 'async';
  img.style.cssText = 'display:block;width:100%;height:100%;object-fit:contain;pointer-events:none';
  return img;
}

/** The bucket-drop flame icon mark (aspect ~0.81:1). */
export function makeBrandIcon(ink: BrandInk = 'white', label = 'Bucket My Fire'): HTMLImageElement {
  return makeImg(ICON[ink], label);
}

/** The raw icon-SVG URL — for using the mark's SHAPE as a CSS mask (e.g. the title's burn fill). */
export function brandIconUrl(ink: BrandInk = 'white'): string {
  return ICON[ink];
}

/** The "BUCKET MY FIRE" wordmark (aspect ~1.87:1). */
export function makeBrandWordmark(ink: BrandInk = 'white', label = 'Bucket My Fire'): HTMLImageElement {
  return makeImg(WORDMARK[ink], label);
}
