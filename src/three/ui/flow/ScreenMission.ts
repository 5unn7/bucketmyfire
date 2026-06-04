/**
 * Screen 4 — Select a mission. A snap carousel of poster cards (the shared 3D-tilt shell), one per
 * campaign sortie, with the next-up mission accent-ringed. Each card shows the brief, the best-run
 * star medal + score, and a FLY action that navigates into the game (`ctx.flyMission` → page reload,
 * the existing router path). A co-op "coming soon" teaser closes the row. Posters fall back to a
 * procedural cover (missionArt seam) until art lands. The footer's primary button is hidden here —
 * advancing is per-card via FLY.
 */

import type { MissionDef } from '../../missions/types';
import { bestScore, bestStars, isUnlocked, getProgress } from '../../missions/progress';
import { missionPoster } from '../missionArt';
import { tiltCard } from '../Card3D';
import { injectScrollStyles, section, starPips, clamp, coopTeaserCard } from '../menuShared';
import { screenHeading } from './chrome';
import { UI, FS, FW, R, el, div } from '../theme';
import type { FlowCtx } from './types';

function buildMissionCard(ctx: FlowCtx, m: MissionDef, completed: Set<string>, isNext: boolean): HTMLDivElement {
  const unlocked = isUnlocked(m, ctx.catalog);
  const done = completed.has(m.id);
  const best = bestScore(m.id);
  const poster = missionPoster(m.id);

  const card = tiltCard({
    width: '100%',
    aspectRatio: '5 / 6',
    usable: unlocked,
    selected: isNext, // the accent ring marks the next-up sortie (not a toggle selection)
    ariaLabel: `Mission ${m.index + 1}: ${m.name}`,
    onSelect: unlocked ? () => ctx.flyMission(m.id) : undefined,
  });
  const tilt = card.tilt;

  // Cover — real poster (full-bleed) or a procedural ember-over-dusk fallback with a ghost number.
  const cover = div({ position: 'absolute', inset: '0', borderRadius: R.xl, overflow: 'hidden' });
  if (poster) {
    const img = el('img', { position: 'absolute', inset: '0', width: '100%', height: '100%', objectFit: 'cover' }) as HTMLImageElement;
    img.src = poster;
    img.alt = m.name;
    cover.appendChild(img);
  } else {
    const heat = Math.min(1, (m.difficulty ?? 1) / 4);
    cover.style.background =
      `radial-gradient(130% 85% at 50% 118%, rgba(255,${Math.round(140 - 70 * heat)},${Math.round(60 - 40 * heat)},0.55), transparent 62%),` +
      ` linear-gradient(180deg, #14202a, #0a1218)`;
    cover.appendChild(
      div(
        { position: 'absolute', inset: '0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '108px', fontWeight: FW.black, color: 'rgba(255,255,255,0.06)' },
        String(m.index + 1),
      ),
    );
  }
  tilt.appendChild(cover);

  tilt.appendChild(
    div({ position: 'absolute', inset: '0', borderRadius: R.xl, pointerEvents: 'none', transform: 'translateZ(2px)', background: 'linear-gradient(180deg, rgba(0,0,0,0.18) 0%, rgba(0,0,0,0) 36%, rgba(0,0,0,0.72) 100%)' }),
  );

  const content = div({ position: 'absolute', inset: '0', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: '15px', transformStyle: 'preserve-3d', color: '#fff' });
  tilt.appendChild(content);

  // Header — "MISSION n" + NEXT badge / difficulty flames.
  const header = div({ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' });
  header.appendChild(
    div({ transform: 'translateZ(30px)', fontSize: FS.label, fontWeight: FW.bold, letterSpacing: '2px', color: 'rgba(255,255,255,0.82)', textShadow: '0 1px 6px rgba(0,0,0,0.6)' }, `MISSION ${m.index + 1}`),
  );
  if (isNext) {
    header.appendChild(
      div({ transform: 'translateZ(34px)', fontSize: FS.tag, fontWeight: FW.heavy, letterSpacing: '1.5px', color: UI.accent, background: UI.accentFill, border: `1px solid ${UI.accent}55`, borderRadius: R.pill, padding: '2px 8px' }, 'NEXT'),
    );
  } else {
    header.appendChild(div({ transform: 'translateZ(30px)', fontSize: FS.sm, color: UI.warm, letterSpacing: '1px', textShadow: '0 1px 6px rgba(0,0,0,0.6)' }, '🔥'.repeat(m.difficulty ?? 1)));
  }
  content.appendChild(header);

  // Footer — title, brief, then the status/action row.
  const foot = div({ transformStyle: 'preserve-3d' });
  foot.appendChild(
    el('h3', { margin: '0 0 5px', fontSize: FS.title, fontWeight: FW.bold, lineHeight: '1.14', transform: 'translateZ(34px)', textShadow: '0 2px 10px rgba(0,0,0,0.6)' }, m.name),
  );
  const brief = div({ fontSize: FS.sm, lineHeight: '1.4', color: 'rgba(231,247,255,0.82)', transform: 'translateZ(24px)', textShadow: '0 1px 6px rgba(0,0,0,0.6)' }, m.tagline ?? m.brief);
  clamp(brief, 2);
  foot.appendChild(brief);

  const statusRow = div({ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '11px', transform: 'translateZ(28px)', fontSize: FS.sm });
  const left = div({ display: 'flex', alignItems: 'center', gap: '8px' });
  left.appendChild(
    done
      ? div({ color: UI.ok, fontWeight: FW.semibold, textShadow: '0 1px 6px rgba(0,0,0,0.6)' }, best !== null ? `✓ ${best.toLocaleString()}` : '✓ Cleared')
      : div({ color: 'rgba(255,255,255,0.72)' }, best !== null ? `Best ${best.toLocaleString()}` : 'Not flown'),
  );
  if (done) left.appendChild(starPips(bestStars(m.id)));
  statusRow.appendChild(left);
  statusRow.appendChild(
    div({ fontWeight: FW.heavy, letterSpacing: '0.06em', color: unlocked ? UI.accent : UI.faint, textShadow: '0 1px 6px rgba(0,0,0,0.6)' }, unlocked ? (done ? 'REPLAY ▸' : 'FLY ▸') : '🔒'),
  );
  foot.appendChild(statusRow);
  content.appendChild(foot);

  return card.root;
}

export function buildMissionScreen(ctx: FlowCtx): HTMLElement {
  injectScrollStyles();
  const root = section({});
  root.appendChild(
    screenHeading('Select a mission', `Flying the ${ctx.currentHeli().name} over ${ctx.currentMap().name}. Six sorties — hardest last. Fly them in order.`),
  );

  const completed = new Set(getProgress().completed);
  const nextId = ctx.catalog.find((m) => isUnlocked(m, ctx.catalog) && !completed.has(m.id))?.id ?? null;

  const scroller = div({ display: 'flex', alignItems: 'stretch', gap: '14px', overflowX: 'auto', scrollSnapType: 'x mandatory', paddingBottom: '10px', margin: '0 -2px' });
  scroller.className = 'bmf-hscroll';
  root.appendChild(scroller);

  let nextEl: HTMLDivElement | undefined;
  for (const m of ctx.catalog) {
    const slot = div({ flex: '0 0 auto', width: '250px', scrollSnapAlign: 'start' });
    slot.appendChild(buildMissionCard(ctx, m, completed, m.id === nextId));
    if (m.id === nextId) nextEl = slot;
    scroller.appendChild(slot);
  }
  // Co-op teaser closes the row (flat card; stretches to the carousel height).
  const teaserSlot = div({ flex: '0 0 auto', width: '250px', scrollSnapAlign: 'start', display: 'flex' });
  const teaser = coopTeaserCard(ctx.catalog.length + 1);
  teaser.style.flex = '1';
  teaserSlot.appendChild(teaser);
  scroller.appendChild(teaserSlot);

  if (nextEl) {
    const target = nextEl;
    requestAnimationFrame(() => {
      scroller.scrollLeft = Math.max(0, target.offsetLeft - 2);
    });
  }

  ctx.footer.hidePrimary();
  return root;
}
