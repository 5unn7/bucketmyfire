/**
 * 3D-tilt helicopter selection card — a faithful port of the React "InteractiveTravelCard"
 * (framer-motion + Tailwind + shadcn) into THIS project's stack: plain DOM, `theme.ts` tokens,
 * and CSS 3D transforms (no React, framer-motion, Tailwind, or new deps). The tilt + selection-ring
 * shell is the shared `tiltCard()` primitive (Card3D.ts); this module adds the heli-specific cover,
 * title/subtitle, reference link, spec meters and the SELECT/SELECTED action button.
 *
 * The source component leaned on three things we reproduce with the platform:
 *   - framer-motion mouse tilt → `tiltCard()` (pointermove → rotateX/rotateY on a preserve-3d layer).
 *   - layered `translateZ(...)` depth → the same translateZ values on the DOM children below.
 *   - a full-bleed cover IMAGE → procedural-first ("zero binary assets" for UI art, icons.ts), so the
 *     cover defaults to the procedural `makeIcon()` airframe on its accent halo. An optional
 *     `imageUrl` is honoured so a real photo can drop in later with no caller change.
 *
 * Maps 1:1 onto the `CatalogItem` heli data (name → title, tagline → subtitle, specs → meters) and
 * honours the campaign gate (locked airframe → dimmed + badge, not selectable).
 */

import type { CatalogItem } from './profile';
import { makeIcon } from './icons';
import { UI, FS, FW, R, el, div, clamp01 } from './theme';
import { tiltCard } from './Card3D';

export interface HeliCard3DOptions {
  /** Is this airframe flyable right now? false → dimmed + lock badge, not selectable. */
  usable: boolean;
  /** Is this the currently-chosen card? Drives the cyan ring + the "SELECTED" button state. */
  selected: boolean;
  /** Badge text shown in place of the action button when `usable` is false. */
  lockText?: string;
  /** Top-right "learn more" link target. Defaults to a per-airframe reference (REFERENCE). */
  href?: string;
  /** Optional real cover photo. Omitted → procedural `makeIcon()` cover (the default, on-ethos). */
  imageUrl?: string;
  /** Click-to-pick. Only wired when `usable` is true. */
  onSelect: () => void;
}

export interface HeliCard3DHandle {
  /** The card element to mount (fills its parent's width; give the parent the column/slot width). */
  el: HTMLDivElement;
  /** Light or unlight this card as the active choice. */
  setSelected: (on: boolean) => void;
}

/** External reference per airframe for the top-right link (opens a NEW tab so it never tears down a menu). */
const REFERENCE: Record<string, string> = {
  'bell-205a1': 'https://en.wikipedia.org/wiki/Bell_205',
  'bell-212': 'https://en.wikipedia.org/wiki/Bell_212',
  'uh-60': 'https://en.wikipedia.org/wiki/Sikorsky_UH-60_Black_Hawk',
};

/** A lucide-style "arrow up-right" glyph as inline SVG (no icon dependency). */
function arrowUpRight(): SVGElement {
  const doc = new DOMParser().parseFromString(
    `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none"` +
      ` stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">` +
      `<line x1="7" y1="17" x2="17" y2="7"/><polyline points="7 7 17 7 17 17"/></svg>`,
    'image/svg+xml',
  );
  return doc.documentElement as unknown as SVGElement;
}

/** A compact spec meter (label + cyan fill). */
function meter(label: string, value: number): HTMLDivElement {
  const row = div({ display: 'grid', gridTemplateColumns: '48px 1fr', alignItems: 'center', gap: '8px' });
  row.appendChild(
    el(
      'span',
      { fontSize: FS.tag, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.72)', textShadow: '0 1px 2px rgba(0,0,0,0.55)' },
      label,
    ),
  );
  const track = div({ height: '5px', borderRadius: R.xs, background: 'rgba(255,255,255,0.18)', overflow: 'hidden' });
  track.appendChild(
    div({ height: '100%', width: `${Math.round(clamp01(value) * 100)}%`, borderRadius: R.xs, background: `linear-gradient(90deg, ${UI.accent}, #9fe9f7)` }),
  );
  row.appendChild(track);
  return row;
}

/** Build a 3D-tilt helicopter card for `heli`. */
export function buildHeliCard3D(heli: CatalogItem, opts: HeliCard3DOptions): HeliCard3DHandle {
  // The action button doubles as the selected indicator; track state so hover + selection agree.
  let btn: HTMLButtonElement | undefined;
  let isSel = opts.selected;
  let hover = false;
  const paintBtn = (): void => {
    if (!btn) return;
    if (isSel) {
      btn.textContent = '✓ SELECTED';
      btn.style.background = `linear-gradient(180deg, #8df0ff, ${UI.accent})`;
      btn.style.color = '#04181d';
      btn.style.boxShadow = `0 6px 18px ${UI.accent}44`;
    } else {
      btn.textContent = 'SELECT';
      btn.style.background = hover ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.12)';
      btn.style.color = '#fff';
      btn.style.boxShadow = 'inset 0 0 0 1px rgba(255,255,255,0.22)';
    }
  };

  const card = tiltCard({
    width: '100%',
    usable: opts.usable,
    selected: opts.selected,
    ariaLabel: `${heli.name} — ${heli.tagline}`,
    onSelect: opts.usable ? opts.onSelect : undefined,
    onSelectedChange: (on) => {
      isSel = on;
      paintBtn();
    },
  });
  const tilt = card.tilt;

  // --- Cover: procedural accent halo + floating isometric icon (or a real photo) ---
  const cover = div({
    position: 'absolute',
    inset: '0',
    borderRadius: R.xl,
    overflow: 'hidden', // FLAT layer (no preserve-3d children) — safe to clip
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  });
  if (opts.imageUrl) {
    const img = el('img', { position: 'absolute', inset: '0', width: '100%', height: '100%', objectFit: 'cover' }) as HTMLImageElement;
    img.src = opts.imageUrl;
    img.alt = `${heli.name} — ${heli.tagline}`;
    cover.appendChild(img);
  } else {
    cover.style.background =
      `radial-gradient(120% 95% at 50% 30%, ${heli.accent}59, ${heli.accent}1f 46%, transparent 72%),` +
      ` linear-gradient(180deg, rgba(12,18,25,0.25), rgba(6,10,14,0.62))`;
  }
  tilt.appendChild(cover);

  if (!opts.imageUrl) {
    const iconWrap = div({
      position: 'absolute',
      inset: '0',
      display: 'flex',
      alignItems: 'flex-start',
      justifyContent: 'center',
      paddingTop: '16%',
      pointerEvents: 'none',
      transform: 'translateZ(55px)',
      filter: 'drop-shadow(0 16px 22px rgba(0,0,0,0.5))',
    });
    const icon = makeIcon(heli.id);
    icon.setAttribute('width', '164');
    icon.setAttribute('height', '164');
    iconWrap.appendChild(icon);
    tilt.appendChild(iconWrap);
  }

  // Contrast overlay (top-light → bottom-dark).
  tilt.appendChild(
    div({
      position: 'absolute',
      inset: '0',
      borderRadius: R.xl,
      pointerEvents: 'none',
      transform: 'translateZ(2px)',
      background: 'linear-gradient(180deg, rgba(0,0,0,0.16) 0%, rgba(0,0,0,0) 40%, rgba(0,0,0,0.64) 100%)',
    }),
  );

  // --- Content (header + footer), each child parallaxing at its own depth ---
  const content = div({
    position: 'absolute',
    inset: '0',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'space-between',
    padding: '16px',
    transformStyle: 'preserve-3d',
    color: '#fff',
  });
  tilt.appendChild(content);

  const header = div({ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '10px' });
  const titles = div({ minWidth: '0', transformStyle: 'preserve-3d' });
  titles.appendChild(
    el(
      'h2',
      { margin: '0', fontSize: FS.title, fontWeight: FW.bold, letterSpacing: '0.01em', lineHeight: '1.12', transform: 'translateZ(38px)', textShadow: '0 2px 12px rgba(0,0,0,0.55)' },
      heli.name,
    ),
  );
  titles.appendChild(
    el(
      'p',
      { margin: '4px 0 0', fontSize: FS.meta, letterSpacing: '0.08em', textTransform: 'uppercase', color: UI.accent, opacity: '0.9', fontWeight: FW.semibold, transform: 'translateZ(28px)', textShadow: '0 1px 8px rgba(0,0,0,0.55)' },
      heli.tagline,
    ),
  );
  header.appendChild(titles);

  const href = opts.href ?? REFERENCE[heli.id];
  if (href) {
    const link = el('a', {
      flex: 'none',
      width: '36px',
      height: '36px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: R.round,
      background: 'rgba(255,255,255,0.16)',
      color: '#fff',
      textDecoration: 'none',
      transform: 'translateZ(48px)',
      boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.28)',
      transition: 'background 0.16s ease, transform 0.16s ease',
    }) as HTMLAnchorElement;
    link.href = href;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.title = `About the ${heli.name}`;
    link.setAttribute('aria-label', `Learn more about the ${heli.name}`);
    link.style.setProperty('-webkit-backdrop-filter', 'blur(6px)');
    link.style.backdropFilter = 'blur(6px)';
    link.appendChild(arrowUpRight());
    link.addEventListener('click', (e) => e.stopPropagation());
    link.addEventListener('pointerenter', () => {
      link.style.background = 'rgba(255,255,255,0.3)';
      link.style.transform = 'translateZ(48px) scale(1.08) rotate(2.5deg)';
    });
    link.addEventListener('pointerleave', () => {
      link.style.background = 'rgba(255,255,255,0.16)';
      link.style.transform = 'translateZ(48px) scale(1)';
    });
    header.appendChild(link);
  }
  content.appendChild(header);

  const footer = div({ display: 'flex', flexDirection: 'column', gap: '12px', transformStyle: 'preserve-3d' });
  if (heli.specs) {
    const specs = div({ display: 'grid', gap: '6px', transform: 'translateZ(22px)' });
    for (const s of heli.specs) specs.appendChild(meter(s.label, s.value));
    footer.appendChild(specs);
  }

  if (opts.usable) {
    btn = el(
      'button',
      {
        width: '100%',
        padding: '12px',
        borderRadius: R.md,
        border: 'none',
        cursor: 'pointer',
        fontFamily: UI.font,
        fontSize: FS.md,
        fontWeight: FW.bold,
        letterSpacing: '0.05em',
        color: '#fff',
        transform: 'translateZ(30px)',
        transition: 'background 0.16s ease, box-shadow 0.16s ease, color 0.16s ease, transform 0.12s ease',
      },
      'SELECT',
    );
    btn.type = 'button';
    btn.style.setProperty('-webkit-backdrop-filter', 'blur(8px)');
    btn.style.backdropFilter = 'blur(8px)';
    paintBtn();
    footer.appendChild(btn);
  } else {
    footer.appendChild(
      div(
        {
          width: '100%',
          padding: '11px',
          borderRadius: R.md,
          textAlign: 'center',
          fontSize: FS.label,
          fontWeight: FW.bold,
          letterSpacing: '0.06em',
          color: UI.text,
          background: 'rgba(0,0,0,0.42)',
          boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.12)',
          transform: 'translateZ(28px)',
        },
        opts.lockText ?? '🔒 Locked',
      ),
    );
  }
  content.appendChild(footer);

  // Button hover follows the card (the ring hover lives in tiltCard; mirror it onto the button).
  card.root.addEventListener('pointerenter', () => {
    hover = true;
    paintBtn();
  });
  card.root.addEventListener('pointerleave', () => {
    hover = false;
    paintBtn();
  });

  return { el: card.root, setSelected: card.setSelected };
}
