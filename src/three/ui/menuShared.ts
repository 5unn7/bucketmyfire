/**
 * Shared menu building blocks — extracted from the old single-page MissionSelect so the new
 * guided flow (ui/flow/*) and the mission carousel can reuse them without duplication. These are
 * the small, presentation-only pieces (step labels, stat tiles, star pips, the pilot career strip,
 * the co-op teaser, the credits footer, the horizontal-scroll styles) that several screens share.
 *
 * Everything reads the one cockpit palette from ./theme; no second token set. Pure DOM, no assets.
 */

import { div, setBlur, UI, FS, FW, R } from './theme';
import { getProgress } from '../missions/progress';
import type { MissionDef } from '../missions/types';

/** Shared content-column width — every screen aligns to one centred column. */
export const COL = '980px';

/** A maxWidth content column so a screen's content aligns to one centred edge. */
export function section(extra: Partial<CSSStyleDeclaration>): HTMLDivElement {
  return div({ maxWidth: COL, margin: '0 auto', width: '100%', ...extra });
}

/** A numbered step label — the visual spine of a screen ("① CALLSIGN", etc.). */
export function stepHeader(n: number | string, label: string, hint?: string): HTMLDivElement {
  const row = div({ display: 'flex', alignItems: 'center', gap: '10px', margin: '0 0 13px' });
  row.appendChild(
    div(
      {
        width: '22px',
        height: '22px',
        flex: 'none',
        borderRadius: R.round,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: FS.meta,
        fontWeight: FW.heavy,
        color: UI.accent,
        background: UI.accentFill,
        border: `1px solid ${UI.accent}55`,
      },
      String(n),
    ),
  );
  row.appendChild(div({ fontSize: FS.sm, fontWeight: FW.bold, letterSpacing: '2.5px', color: UI.text }, label.toUpperCase()));
  if (hint) row.appendChild(div({ fontSize: FS.meta, color: UI.faint, marginTop: '1px' }, hint));
  return row;
}

/** A slim utility chip (leaderboard / cloud-save) — icon + label, low weight. */
export function utilityChip(icon: string, label: string, onClick: () => void): HTMLDivElement {
  const chip = div({
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    background: UI.cardGlass,
    border: `1px solid ${UI.stroke}`,
    borderRadius: R.pill,
    padding: '6px 12px',
    cursor: 'pointer',
    fontSize: FS.sm,
    fontWeight: FW.semibold,
    color: UI.dim,
    transition: 'color 0.12s ease, border-color 0.12s ease',
  });
  setBlur(chip);
  chip.appendChild(div({ fontSize: FS.body }, icon));
  chip.appendChild(div({}, label));
  chip.addEventListener('pointerenter', () => {
    chip.style.color = UI.text;
    chip.style.borderColor = `${UI.accent}55`;
  });
  chip.addEventListener('pointerleave', () => {
    chip.style.color = UI.dim;
    chip.style.borderColor = UI.stroke;
  });
  chip.addEventListener('pointerdown', onClick);
  return chip;
}

/** Three star pips (1..3 filled) — a cleared mission's best-run medal. */
export function starPips(stars: number): HTMLDivElement {
  const row = div({ display: 'inline-flex', gap: '1px', fontSize: FS.sm, lineHeight: '1' });
  row.title = `${stars} / 3 stars`;
  for (let i = 1; i <= 3; i++) {
    row.appendChild(div({ color: i <= stars ? UI.warm : UI.faint }, i <= stars ? '★' : '☆'));
  }
  return row;
}

/** A label-over-value stat used in the pilot record. */
export function statTile(label: string, value: string): HTMLDivElement {
  const t = div({});
  t.appendChild(div({ fontSize: FS.title, fontWeight: FW.heavy, color: UI.text, lineHeight: '1.1' }, value));
  t.appendChild(
    div({ fontSize: FS.label, fontWeight: FW.bold, letterSpacing: '1.5px', color: UI.faint, marginTop: '3px' }, label.toUpperCase()),
  );
  return t;
}

/**
 * Career-record strip for a returning pilot — missions cleared, career score (sum of personal
 * bests), best single mission, and a campaign-progress bar. Returns null for a fresh pilot.
 */
export function pilotRecord(catalog: MissionDef[]): HTMLDivElement | null {
  const prog = getProgress();
  const cleared = prog.completed.length;
  if (cleared === 0) return null;

  const total = catalog.length;
  const bests = Object.values(prog.best);
  const careerScore = bests.reduce((a, b) => a + b, 0);
  const topMission = bests.reduce((m, b) => Math.max(m, b), 0);
  const pct = total ? Math.round((cleared / total) * 100) : 0;

  const panel = div({
    marginTop: '12px',
    maxWidth: '440px',
    background: UI.cardGlass,
    border: `1px solid ${UI.stroke}`,
    borderRadius: R.md,
    padding: '13px 16px 14px',
  });
  setBlur(panel);

  const stats = div({ display: 'flex', gap: '24px', flexWrap: 'wrap' });
  stats.append(
    statTile('Missions', `${cleared}/${total}`),
    statTile('Career score', careerScore.toLocaleString()),
    statTile('Best mission', topMission.toLocaleString()),
  );
  panel.appendChild(stats);

  const track = div({ marginTop: '13px', height: '5px', borderRadius: R.pill, background: UI.track, overflow: 'hidden' });
  track.appendChild(div({ height: '100%', width: `${pct}%`, background: UI.accent, borderRadius: R.pill }));
  panel.appendChild(track);
  panel.appendChild(
    div({ marginTop: '6px', fontSize: FS.label, fontWeight: FW.bold, letterSpacing: '1.5px', color: UI.faint }, `CAMPAIGN ${pct}% COMPLETE`),
  );
  return panel;
}

/**
 * The co-op "coming soon" teaser — a card after the solo campaign. Not selectable; an honest
 * "in development" note with no CTA (co-op isn't built, so there's nothing to sign up for yet).
 */
export function coopTeaserCard(number: number): HTMLDivElement {
  const card = div({
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    background: UI.cardGlass,
    border: `1px dashed ${UI.accentSoft}`,
    borderRadius: R.lg,
    boxShadow: UI.shadowCard,
    padding: '15px 16px 13px',
    opacity: '0.92',
  });
  setBlur(card);

  const top = div({ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px' });
  top.appendChild(div({ fontSize: FS.label, fontWeight: FW.bold, letterSpacing: '2px', color: UI.faint }, `MISSION ${number}`));
  top.appendChild(
    div(
      { fontSize: FS.tag, fontWeight: FW.heavy, letterSpacing: '1.5px', color: UI.accent, background: UI.accentFill, border: `1px solid ${UI.accent}55`, borderRadius: R.pill, padding: '2px 8px' },
      'SOON',
    ),
  );
  card.appendChild(top);

  card.appendChild(div({ fontSize: FS.title, fontWeight: FW.bold, margin: '7px 0 6px' }, '🤝 Co-op'));
  const blurb = div(
    { fontSize: FS.sm, lineHeight: '1.45', color: 'rgba(231,247,255,0.72)' },
    '2–4 players against one fire too big to fly alone — more towns, crews and rescues than a single pilot can hold. Bring friends.',
  );
  clamp(blurb, 2);
  card.appendChild(blurb);

  const footer = div({ display: 'flex', justifyContent: 'flex-start', alignItems: 'center', marginTop: '12px', fontSize: FS.sm });
  footer.appendChild(div({ color: UI.dim }, 'In development'));
  card.appendChild(footer);
  return card;
}

/** Clamp text to N lines (with an ellipsis) — keeps briefs from sprawling. */
export function clamp(node: HTMLElement, lines: number): void {
  node.style.display = '-webkit-box';
  node.style.setProperty('-webkit-line-clamp', String(lines));
  node.style.setProperty('-webkit-box-orient', 'vertical');
  node.style.overflow = 'hidden';
}

// One-time scoped styles for horizontal carousels: a thin scrollbar + snap that inline can't express.
let scrollStylesInjected = false;
export function injectScrollStyles(): void {
  if (scrollStylesInjected) return;
  scrollStylesInjected = true;
  const tag = document.createElement('style');
  tag.textContent = `
  .bmf-hscroll { scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.22) transparent; -webkit-overflow-scrolling: touch; scroll-padding-left: 2px; }
  .bmf-hscroll::-webkit-scrollbar { height: 6px; }
  .bmf-hscroll::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.18); border-radius: 99px; }
  .bmf-hscroll::-webkit-scrollbar-track { background: transparent; }
  `;
  document.head.appendChild(tag);
}

/**
 * Credits / attribution footer — required by the asset licenses (CC-BY-4.0 and Sketchfab Standard
 * both mandate visible credit). Collapsed by default to stay out of the way.
 */
export function creditsFooter(): HTMLElement {
  const wrap = document.createElement('details');
  Object.assign(wrap.style, {
    maxWidth: COL,
    margin: '34px auto 0',
    fontSize: FS.sm,
    color: UI.dim,
    lineHeight: '1.6',
  } as Partial<CSSStyleDeclaration>);

  const summary = document.createElement('summary');
  Object.assign(summary.style, {
    cursor: 'pointer',
    letterSpacing: '2px',
    fontWeight: FW.bold,
    color: UI.faint,
    listStyle: 'none',
  } as Partial<CSSStyleDeclaration>);
  summary.textContent = 'CREDITS';
  wrap.appendChild(summary);

  const body = div({ marginTop: '12px' });
  const credits: Array<[string, string]> = [
    ['Bell UH-1 Iroquois (Huey)', 'helijah — Sketchfab Standard'],
    ['Bell 212', 'Vahid Heidari — CC-BY-4.0'],
    ['UH-60M Black Hawk (low poly)', 'Yi Tsung Lee — CC-BY-4.0'],
    ['Ultimate 3D Animal Pack', 'WildMesh 3D — CC-BY-4.0'],
    ['Rotor audio loop', 'Mixkit (no-attribution license)'],
  ];
  for (const [title, by] of credits) {
    body.appendChild(div({ marginBottom: '4px' }, `${title} — ${by}`));
  }
  body.appendChild(
    div({ marginTop: '10px', color: 'rgba(255,255,255,0.35)' }, 'Terrain, water, trees, fire, smoke and UI are procedural / zero-asset.'),
  );
  wrap.appendChild(body);

  // Always-visible policy links (a monetized product must not hide its Privacy/Terms behind the
  // collapsed credits). The <details> + this links row share a centred container.
  const container = div({ maxWidth: COL, margin: '0 auto', display: 'flex', flexDirection: 'column', alignItems: 'center' });
  container.appendChild(wrap);
  const policies = div({ marginTop: '12px', fontSize: FS.sm, display: 'flex', gap: '16px' });
  const policyLink = (label: string, href: string): HTMLAnchorElement => {
    const a = document.createElement('a');
    a.textContent = label;
    a.href = href;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    Object.assign(a.style, { color: UI.faint, textDecoration: 'underline', cursor: 'pointer' } as Partial<CSSStyleDeclaration>);
    return a;
  };
  policies.append(policyLink('Privacy', '/privacy.html'), policyLink('Terms', '/terms.html'));
  container.appendChild(policies);
  return container;
}
