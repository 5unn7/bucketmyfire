/**
 * 3D-tilt MAP card — the Screen 3 (Choose map) counterpart to HeliCard3D, sharing the same
 * `tiltCard()` shell so the heli, map and mission carousels speak one visual language. The cover is
 * the procedural isometric `makeIcon(map.id)` diorama by default; an optional `imageUrl` (the
 * forthcoming isometric map render) drops in with no caller change. Where the heli card shows spec
 * meters, the map card shows a big **N MISSIONS** stat. Unavailable maps render dimmed with a
 * "Coming soon" badge (same gating grammar as locked airframes).
 */

import type { CatalogItem } from './profile';
import { makeIcon } from './icons';
import { UI, FS, FW, R, el, div } from './theme';
import { tiltCard } from './Card3D';

export interface MapCard3DOptions {
  /** Is this map playable now? false → dimmed + "Coming soon" badge, not selectable. */
  usable: boolean;
  /** Is this the currently-chosen map? */
  selected: boolean;
  /** Mission count shown as the headline stat ("6 MISSIONS"). */
  missionCount: number;
  /** Badge text when `usable` is false. */
  lockText?: string;
  /** Click-to-pick. Only wired when `usable` is true. */
  onSelect: () => void;
}

export interface MapCard3DHandle {
  el: HTMLDivElement;
  setSelected: (on: boolean) => void;
}

export function buildMapCard3D(map: CatalogItem, opts: MapCard3DOptions): MapCard3DHandle {
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
    ariaLabel: `${map.name} — ${map.tagline}`,
    onSelect: opts.usable ? opts.onSelect : undefined,
    onSelectedChange: (on) => {
      isSel = on;
      paintBtn();
    },
  });
  const tilt = card.tilt;

  // --- Cover: the map's accent halo is always the backdrop; the subject FLOATS over it ---
  // The isometric map render is a transparent PNG (and the procedural fallback an SVG diorama),
  // so both read best CONTAINED and floating on the halo — not full-bleed cropped.
  const cover = div({ position: 'absolute', inset: '0', borderRadius: R.xl, overflow: 'hidden' });
  cover.style.background =
    `radial-gradient(120% 95% at 50% 32%, ${map.accent}59, ${map.accent}1f 46%, transparent 72%),` +
    ` linear-gradient(180deg, rgba(12,18,25,0.25), rgba(6,10,14,0.64))`;
  tilt.appendChild(cover);

  const subject = div({
    position: 'absolute',
    inset: '0',
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'center',
    paddingTop: map.imageUrl ? '10%' : '15%',
    pointerEvents: 'none',
    transform: 'translateZ(52px)',
    filter: 'drop-shadow(0 16px 22px rgba(0,0,0,0.5))',
  });
  if (map.imageUrl) {
    const img = el('img', { width: '94%', maxHeight: '64%', objectFit: 'contain' }) as HTMLImageElement;
    img.src = map.imageUrl;
    img.alt = `${map.name} — ${map.tagline}`;
    subject.appendChild(img);
  } else {
    const icon = makeIcon(map.id);
    icon.setAttribute('width', '172');
    icon.setAttribute('height', '172');
    subject.appendChild(icon);
  }
  tilt.appendChild(subject);

  tilt.appendChild(
    div({
      position: 'absolute',
      inset: '0',
      borderRadius: R.xl,
      pointerEvents: 'none',
      transform: 'translateZ(2px)',
      background: 'linear-gradient(180deg, rgba(0,0,0,0.16) 0%, rgba(0,0,0,0) 40%, rgba(0,0,0,0.66) 100%)',
    }),
  );

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

  // Header — the missions stat sits up top as a pill, like a poster's rating chip.
  const header = div({ display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-end' });
  header.appendChild(
    div(
      {
        transform: 'translateZ(44px)',
        fontSize: FS.tag,
        fontWeight: FW.heavy,
        letterSpacing: '0.12em',
        color: '#fff',
        background: 'rgba(0,0,0,0.4)',
        boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.22)',
        borderRadius: R.pill,
        padding: '5px 10px',
      },
      opts.usable ? `${opts.missionCount} MISSION${opts.missionCount === 1 ? '' : 'S'}` : 'COMING SOON',
    ),
  );
  content.appendChild(header);

  // Footer — title/subtitle then the action.
  const footer = div({ display: 'flex', flexDirection: 'column', gap: '12px', transformStyle: 'preserve-3d' });
  const titles = div({ transformStyle: 'preserve-3d' });
  titles.appendChild(
    el(
      'h2',
      { margin: '0', fontSize: FS.title, fontWeight: FW.bold, lineHeight: '1.12', transform: 'translateZ(36px)', textShadow: '0 2px 12px rgba(0,0,0,0.6)' },
      map.name,
    ),
  );
  titles.appendChild(
    el(
      'p',
      { margin: '4px 0 0', fontSize: FS.meta, letterSpacing: '0.08em', textTransform: 'uppercase', color: UI.accent, opacity: '0.9', fontWeight: FW.semibold, transform: 'translateZ(26px)', textShadow: '0 1px 8px rgba(0,0,0,0.6)' },
      map.tagline,
    ),
  );
  footer.appendChild(titles);

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
        transform: 'translateZ(28px)',
        transition: 'background 0.16s ease, box-shadow 0.16s ease, color 0.16s ease',
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
          transform: 'translateZ(26px)',
        },
        opts.lockText ?? '🔒 Coming soon',
      ),
    );
  }
  content.appendChild(footer);

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
