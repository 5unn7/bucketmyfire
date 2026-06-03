import type { MissionDef } from '../missions/types';
import { bestScore, isUnlocked, getProgress } from '../missions/progress';
import { HELIS, MAPS, CatalogItem, firstAvailable, findItem, loadProfile, saveProfile, isHeliUnlocked, missionsCleared } from './profile';
import { makeIcon } from './icons';
import { openLeaderboard } from './Leaderboard';
import { openCloudSave } from './CloudSave';
import { validateCallsign, MAX_CALLSIGN } from './callsign';
import { isNameTaken, getClientId } from '../leaderboard/client';
import { isCloudLinked } from '../leaderboard/cloudSave';

/**
 * Campaign mission-select menu — a full-screen DOM overlay in the game's frosted-glass
 * cockpit language (matching HUD.ts / Input.ts).
 *
 * The screen reads as one guided pre-flight FLOW with three numbered steps —
 * ① callsign → ② aircraft → ③ mission — so the eye always knows where to start and
 * what comes next. Utilities (leaderboard / cloud-save) sit in a slim top bar, out of
 * the flow. The accent colour is rationed: it marks only the *active* selection and the
 * primary action (the selected aircraft pill, the next-up mission, every FLY), so it
 * guides the eye instead of flattening everything. Picking an unlocked mission calls
 * `onSelect(id)` and `main.ts` reloads into the Game (page-reload mission switching).
 *
 * Pure DOM, zero assets. Built once at boot when no mission is selected.
 */

const UI = {
  accent: '#67e8ff',
  accentFill: 'rgba(103,232,255,0.10)',
  warm: '#ff7a45',
  ok: '#63d68a',
  text: 'rgba(234,246,255,0.96)',
  dim: 'rgba(255,255,255,0.5)',
  faint: 'rgba(255,255,255,0.34)',
  glass: 'rgba(12,18,25,0.55)',
  cardGlass: 'rgba(16,24,32,0.58)',
  stroke: 'rgba(255,255,255,0.12)',
  hair: 'rgba(255,255,255,0.07)',
  blur: 'blur(14px) saturate(120%)',
  shadow: '0 8px 30px rgba(0,0,0,0.45)',
  font: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
};

const COL = '980px'; // shared content column — everything aligns to one left edge

export class MissionSelect {
  private readonly root: HTMLDivElement;

  constructor(parent: HTMLElement, catalog: MissionDef[], onSelect: (id: string) => void) {
    this.root = div({
      position: 'fixed',
      inset: '0',
      zIndex: '50',
      overflowY: 'auto',
      background: 'radial-gradient(120% 90% at 50% 0%, rgba(20,32,44,0.86), rgba(4,7,11,0.94))',
      fontFamily: UI.font,
      color: UI.text,
      // Safe-area-aware so content clears a side notch / home-indicator in landscape.
      padding:
        'max(16px, env(safe-area-inset-top)) max(20px, env(safe-area-inset-right)) ' +
        'max(56px, env(safe-area-inset-bottom)) max(20px, env(safe-area-inset-left))',
      boxSizing: 'border-box',
    });

    // Slim utility bar: wordmark (brand, neutral) + leaderboard / cloud-save chips.
    // Demoted out of the flow so step ① is the first thing that reads as a *choice*.
    this.root.appendChild(this.topBar(catalog));

    // A quiet one-line intro so the screen still announces itself without a heavy header.
    const intro = section({ margin: '4px auto 22px' });
    intro.appendChild(
      div({ fontSize: '13px', color: UI.dim, lineHeight: '1.5' }, 'Northern Saskatchewan air attack — ten missions, hardest last. Fly them in order.'),
    );
    this.root.appendChild(intro);

    // ① Callsign  ② Aircraft  ③ Mission — the three numbered steps of the pre-flight flow.
    this.root.appendChild(this.callsignStep(catalog));
    this.root.appendChild(this.aircraftStep());
    this.root.appendChild(this.missionStep(catalog, onSelect));

    this.root.appendChild(creditsFooter());
    parent.appendChild(this.root);
  }

  dispose(): void {
    this.root.remove();
  }

  // --- Top bar: wordmark + utility chips (leaderboard / cloud-save) ----------
  private topBar(catalog: MissionDef[]): HTMLDivElement {
    const bar = section({
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '12px',
      margin: '0 auto 6px',
      flexWrap: 'wrap',
    });

    const brand = div(
      { fontSize: '13px', fontWeight: '800', letterSpacing: '4px', color: UI.text, opacity: '0.92' },
      'BUCKETMYFIRE',
    );
    bar.appendChild(brand);

    const tools = div({ display: 'flex', gap: '8px', alignItems: 'center' });
    tools.appendChild(utilityChip('🏆', 'Leaderboard', () => openLeaderboard(catalog)));
    tools.appendChild(utilityChip('☁', isCloudLinked() ? 'Saved' : 'Save', () => openCloudSave()));
    bar.appendChild(tools);

    return bar;
  }

  /**
   * ① Callsign — the editable pilot name (the leaderboard submits under it). Click the
   * chip to rename; validation + async uniqueness check keep the saved profile valid. A
   * returning pilot (cleared ≥ 1 mission) also gets a career-record strip here.
   */
  private callsignStep(catalog: MissionDef[]): HTMLDivElement {
    const wrap = section({ margin: '0 auto 24px' });
    wrap.appendChild(stepHeader(1, 'Callsign', 'tap to rename'));

    const chipCol = div({ display: 'flex', flexDirection: 'column', gap: '6px', maxWidth: '320px' });
    const chip = div({
      display: 'inline-flex',
      alignItems: 'center',
      gap: '10px',
      background: UI.cardGlass,
      border: `1px solid ${UI.stroke}`,
      borderRadius: '12px',
      padding: '11px 16px',
      cursor: 'pointer',
      fontSize: '13px',
      transition: 'border-color 0.12s ease',
    });
    setBlur(chip);
    chip.addEventListener('pointerenter', () => {
      if (!chip.querySelector('input')) chip.style.borderColor = `${UI.accent}55`;
    });
    chip.addEventListener('pointerleave', () => {
      if (!chip.querySelector('input')) chip.style.borderColor = UI.stroke;
    });

    const msg = div({ fontSize: '11px', fontWeight: '600', minHeight: '14px', display: 'none' });
    const showMsg = (text: string, bad: boolean): void => {
      msg.textContent = text;
      msg.style.color = bad ? UI.warm : UI.dim;
      msg.style.display = text ? 'block' : 'none';
    };

    const render = (): void => {
      showMsg('', false);
      const name = loadProfile()?.name ?? 'Pilot';
      chip.style.borderColor = UI.stroke;
      chip.replaceChildren(
        div({ fontSize: '10px', fontWeight: '700', letterSpacing: '2px', color: UI.faint }, 'PILOT'),
        div({ fontSize: '16px', fontWeight: '700', color: UI.text, flex: '1' }, name),
        div({ fontSize: '13px', opacity: '0.6' }, '✎'),
      );
    };

    const beginEdit = (): void => {
      const cur = loadProfile();
      const input = document.createElement('input');
      Object.assign(input.style, {
        background: 'transparent',
        border: 'none',
        outline: 'none',
        color: UI.text,
        font: 'inherit',
        fontSize: '16px',
        fontWeight: '700',
        flex: '1',
        minWidth: '0',
      } as Partial<CSSStyleDeclaration>);
      input.type = 'text';
      input.maxLength = MAX_CALLSIGN;
      input.value = cur?.name ?? '';
      input.placeholder = 'Enter callsign';
      input.autocomplete = 'off';
      input.spellcheck = false;

      // `settled` guards the async path: once we cancel or successfully save we re-render
      // (removing the input → fires blur), and an in-flight duplicate-check must not then save.
      let settled = false;
      const close = (): void => {
        if (settled) return;
        settled = true;
        render();
      };

      const attempt = async (): Promise<void> => {
        if (settled) return;
        const res = validateCallsign(input.value);
        if (!res.ok) {
          showMsg(res.reason ?? 'Invalid name.', true);
          return;
        }
        showMsg('Checking name…', false);
        const taken = await isNameTaken(res.value, getClientId());
        if (settled) return;
        if (taken) {
          showMsg(`"${res.value}" is taken — pick another.`, true);
          return;
        }
        const c = loadProfile();
        saveProfile({
          name: res.value,
          mapId: findItem(MAPS, c?.mapId)?.available ? (c as { mapId: string }).mapId : firstAvailable(MAPS).id,
          heliId: findItem(HELIS, c?.heliId)?.available ? (c as { heliId: string }).heliId : firstAvailable(HELIS).id,
        });
        close();
      };

      input.addEventListener('input', () => showMsg('', false));
      input.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') void attempt();
        if (e.key === 'Escape') close();
      });
      input.addEventListener('blur', () => void attempt());

      chip.style.borderColor = `${UI.accent}88`;
      chip.replaceChildren(
        div({ fontSize: '10px', fontWeight: '700', letterSpacing: '2px', color: UI.accent }, 'PILOT'),
        input,
      );
      input.focus();
      input.select();
    };

    chip.addEventListener('pointerdown', (e) => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return;
      beginEdit();
    });
    render();
    chipCol.appendChild(chip);
    chipCol.appendChild(msg);
    wrap.appendChild(chipCol);

    // Returning pilots see their career record right under the name. New pilots get nothing
    // (no empty zeroes) — the record only appears once there's something to show.
    const record = pilotRecord(catalog);
    if (record) wrap.appendChild(record);
    return wrap;
  }

  /**
   * ② Aircraft — a horizontally SCROLLABLE card carousel (swipe on touch, scroll/drag on
   * desktop) with scroll-snap. Each card carries its art, tagline and spec meters; the
   * selected card holds the accent and locked airframes show their campaign requirement.
   * Selection is on `click` (not pointerdown) so a swipe-to-scroll gesture never selects.
   * The choice persists to the profile so the mission boot flies it.
   */
  private aircraftStep(): HTMLDivElement {
    const saved = loadProfile();
    const cleared = missionsCleared();
    const savedHeli = findItem(HELIS, saved?.heliId);
    let selected = savedHeli && isHeliUnlocked(savedHeli, cleared) ? savedHeli : firstAvailable(HELIS);

    const persist = (heli: CatalogItem): void => {
      const cur = loadProfile();
      saveProfile({
        name: cur?.name ?? 'Pilot',
        mapId: findItem(MAPS, cur?.mapId)?.available ? (cur as { mapId: string }).mapId : firstAvailable(MAPS).id,
        heliId: heli.id,
      });
    };
    persist(selected); // a player who never touches the picker still flies a valid, saved choice

    const wrap = section({ margin: '0 auto 26px' });
    wrap.appendChild(stepHeader(2, 'Aircraft', 'swipe to browse'));

    injectScrollStyles();
    const scroller = div({
      display: 'flex',
      gap: '12px',
      overflowX: 'auto',
      scrollSnapType: 'x mandatory',
      paddingBottom: '8px',
      margin: '0 -2px',
    });
    scroller.className = 'bmf-hscroll';
    wrap.appendChild(scroller);

    const cards: { item: CatalogItem; set: (on: boolean) => void }[] = [];
    let selectedEl: HTMLDivElement | undefined;

    for (const heli of HELIS) {
      const usable = isHeliUnlocked(heli, cleared);
      const card = div({
        position: 'relative',
        flex: '0 0 auto',
        width: '214px',
        scrollSnapAlign: 'start',
        display: 'flex',
        flexDirection: 'column',
        gap: '11px',
        background: UI.cardGlass,
        border: `1px solid ${UI.stroke}`,
        borderRadius: '14px',
        boxShadow: UI.shadow,
        padding: '14px',
        cursor: usable ? 'pointer' : 'default',
        opacity: usable ? '1' : '0.5',
        transition: 'border-color 0.12s ease, background 0.12s ease, box-shadow 0.12s ease',
      });
      setBlur(card);

      // Header: procedural icon on its accent halo + name / tagline.
      const head = div({ display: 'flex', alignItems: 'center', gap: '12px' });
      const art = div({ width: '48px', height: '48px', flex: 'none', borderRadius: '10px' });
      art.style.background = `radial-gradient(120% 100% at 50% 30%, ${heli.accent}3a, transparent 72%)`;
      const icon = makeIcon(heli.id);
      icon.setAttribute('width', '48');
      icon.setAttribute('height', '48');
      art.appendChild(icon);
      const meta = div({ minWidth: '0' });
      meta.appendChild(
        div({ fontSize: '15px', fontWeight: '700', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }, heli.name),
      );
      meta.appendChild(
        div({ fontSize: '10px', letterSpacing: '0.06em', textTransform: 'uppercase', color: UI.accent, opacity: '0.85', marginTop: '2px' }, heli.tagline),
      );
      head.append(art, meta);
      card.appendChild(head);

      // Spec meters — one row per stat, on every card now (the carousel has the room).
      if (heli.specs) {
        const meters = div({ display: 'grid', gap: '7px' });
        for (const s of heli.specs) meters.appendChild(specMeter(s.label, s.value, heli.accent));
        card.appendChild(meters);
      }

      if (!usable) {
        // A full-width footer strip (not a corner badge) so it never overlaps a long name.
        const lockText = heli.available ? `🔒 Unlocks after Mission ${heli.unlockAfter}` : '🔒 Coming soon';
        if (heli.available) card.title = `Unlocks after clearing Mission ${heli.unlockAfter}`;
        card.appendChild(
          div(
            {
              marginTop: '2px',
              fontSize: '10px',
              letterSpacing: '0.06em',
              fontWeight: '700',
              color: UI.text,
              textAlign: 'center',
              background: 'rgba(0,0,0,0.3)',
              borderRadius: '8px',
              padding: '7px',
            },
            lockText,
          ),
        );
      }

      const setSelected = (on: boolean): void => {
        card.style.borderColor = on ? UI.accent : UI.stroke;
        card.style.background = on ? UI.accentFill : UI.cardGlass;
        card.style.boxShadow = on ? `0 0 0 2px ${UI.accent}55, ${UI.shadow}` : UI.shadow;
      };
      const isSel = usable && heli.id === selected.id;
      setSelected(isSel);
      if (isSel) selectedEl = card;

      if (usable) {
        card.addEventListener('pointerenter', () => {
          if (heli.id !== selected.id) card.style.borderColor = `${UI.accent}55`;
        });
        card.addEventListener('pointerleave', () => setSelected(heli.id === selected.id));
        card.addEventListener('click', () => {
          selected = heli;
          persist(heli);
          for (const c of cards) c.set(c.item.id === heli.id);
        });
      }
      cards.push({ item: heli, set: setSelected });
      scroller.appendChild(card);
    }

    // After mount/layout, bring the selected airframe into view (horizontal only — don't scroll
    // the page). rAF runs once the overlay is in the document, so offsetLeft is real.
    if (selectedEl) {
      const target = selectedEl;
      requestAnimationFrame(() => {
        scroller.scrollLeft = Math.max(0, target.offsetLeft - 2);
      });
    }
    return wrap;
  }

  /**
   * ③ Mission — the campaign grid. Cards are trimmed (clamped brief, clear status) so the
   * grid scans fast; the next playable mission is highlighted as the focal point.
   */
  private missionStep(catalog: MissionDef[], onSelect: (id: string) => void): HTMLDivElement {
    const wrap = section({ margin: '0 auto' });
    wrap.appendChild(stepHeader(3, 'Select mission'));

    const completed = new Set(getProgress().completed);
    // Next-up = first unlocked mission not yet cleared — the card we accent as the focal point.
    const nextId = catalog.find((m) => isUnlocked(m, catalog) && !completed.has(m.id))?.id ?? null;

    const grid = div({
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(248px, 1fr))',
      gap: '14px',
    });
    for (const m of catalog) grid.appendChild(this.card(m, catalog, completed, m.id === nextId, onSelect));
    wrap.appendChild(grid);
    return wrap;
  }

  private card(
    m: MissionDef,
    catalog: MissionDef[],
    completed: Set<string>,
    isNext: boolean,
    onSelect: (id: string) => void,
  ): HTMLDivElement {
    const unlocked = isUnlocked(m, catalog);
    const done = completed.has(m.id);
    const best = bestScore(m.id);

    const card = div({
      position: 'relative',
      background: UI.cardGlass,
      border: `1px solid ${isNext ? UI.accent : UI.stroke}`,
      borderRadius: '14px',
      boxShadow: isNext ? `0 0 0 1px ${UI.accent}55, ${UI.shadow}` : UI.shadow,
      padding: '15px 16px 13px',
      cursor: unlocked ? 'pointer' : 'default',
      opacity: unlocked ? '1' : '0.45',
      transition: 'transform 0.12s ease, border-color 0.12s ease',
    });
    setBlur(card);

    const top = div({ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px' });
    top.appendChild(
      div({ fontSize: '10px', fontWeight: '700', letterSpacing: '2px', color: UI.faint }, `MISSION ${m.index + 1}`),
    );
    if (isNext) {
      top.appendChild(
        div(
          { fontSize: '9px', fontWeight: '800', letterSpacing: '1.5px', color: UI.accent, background: UI.accentFill, border: `1px solid ${UI.accent}55`, borderRadius: '99px', padding: '2px 8px' },
          'NEXT',
        ),
      );
    } else {
      top.appendChild(div({ fontSize: '12px', color: UI.warm, letterSpacing: '1px' }, '🔥'.repeat(m.difficulty)));
    }
    card.appendChild(top);

    card.appendChild(div({ fontSize: '18px', fontWeight: '700', margin: '7px 0 6px' }, m.name));

    const brief = div({ fontSize: '12.5px', lineHeight: '1.45', color: 'rgba(231,247,255,0.72)' }, m.brief);
    clamp(brief, 2);
    card.appendChild(brief);

    const footer = div({
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginTop: '12px',
      fontSize: '12px',
    });
    const status = done
      ? div({ color: UI.ok, fontWeight: '600' }, best !== null ? `✓ ${best.toLocaleString()}` : '✓ Cleared')
      : div({ color: UI.dim }, best !== null ? `Best ${best.toLocaleString()}` : 'Not flown');
    footer.appendChild(status);
    footer.appendChild(
      div(
        { fontWeight: '700', letterSpacing: '1px', color: unlocked ? UI.accent : UI.faint },
        unlocked ? (isNext ? 'FLY ▸' : done ? 'REPLAY ▸' : 'FLY ▸') : '🔒 LOCKED',
      ),
    );
    card.appendChild(footer);

    if (unlocked) {
      card.addEventListener('pointerenter', () => {
        card.style.transform = 'translateY(-3px)';
        card.style.borderColor = UI.accent;
      });
      card.addEventListener('pointerleave', () => {
        card.style.transform = 'none';
        card.style.borderColor = isNext ? UI.accent : UI.stroke;
      });
      card.addEventListener('pointerdown', () => onSelect(m.id));
    }
    return card;
  }
}

// --- small building blocks --------------------------------------------------

/** A numbered step label — the visual spine of the callsign → aircraft → mission flow. */
function stepHeader(n: number, label: string, hint?: string): HTMLDivElement {
  const row = div({ display: 'flex', alignItems: 'center', gap: '10px', margin: '0 0 13px' });
  row.appendChild(
    div(
      {
        width: '22px',
        height: '22px',
        flex: 'none',
        borderRadius: '50%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '11px',
        fontWeight: '800',
        color: UI.accent,
        background: UI.accentFill,
        border: `1px solid ${UI.accent}55`,
      },
      String(n),
    ),
  );
  row.appendChild(
    div({ fontSize: '12px', fontWeight: '700', letterSpacing: '2.5px', color: UI.text }, label.toUpperCase()),
  );
  if (hint) row.appendChild(div({ fontSize: '11px', color: UI.faint, marginTop: '1px' }, hint));
  return row;
}

/**
 * Career-record strip for a returning pilot — missions cleared, career score (sum of personal
 * bests), best single mission, and a campaign-progress bar. Returns null for a fresh pilot
 * (nothing cleared) so the home screen stays clean on a first visit.
 */
function pilotRecord(catalog: MissionDef[]): HTMLDivElement | null {
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
    borderRadius: '12px',
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

  const track = div({ marginTop: '13px', height: '5px', borderRadius: '99px', background: 'rgba(255,255,255,0.10)', overflow: 'hidden' });
  track.appendChild(div({ height: '100%', width: `${pct}%`, background: UI.accent, borderRadius: '99px' }));
  panel.appendChild(track);
  panel.appendChild(
    div({ marginTop: '6px', fontSize: '10px', fontWeight: '700', letterSpacing: '1.5px', color: UI.faint }, `CAMPAIGN ${pct}% COMPLETE`),
  );
  return panel;
}

/** A label-over-value stat used in the pilot record. */
function statTile(label: string, value: string): HTMLDivElement {
  const t = div({});
  t.appendChild(div({ fontSize: '18px', fontWeight: '800', color: UI.text, lineHeight: '1.1' }, value));
  t.appendChild(div({ fontSize: '10px', fontWeight: '700', letterSpacing: '1.5px', color: UI.faint, marginTop: '3px' }, label.toUpperCase()));
  return t;
}

/** A slim top-bar utility chip (leaderboard / cloud-save) — icon + label, low weight. */
function utilityChip(icon: string, label: string, onClick: () => void): HTMLDivElement {
  const chip = div({
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    background: UI.cardGlass,
    border: `1px solid ${UI.stroke}`,
    borderRadius: '99px',
    padding: '6px 12px',
    cursor: 'pointer',
    fontSize: '12px',
    fontWeight: '600',
    color: UI.dim,
    transition: 'color 0.12s ease, border-color 0.12s ease',
  });
  setBlur(chip);
  chip.appendChild(div({ fontSize: '13px' }, icon));
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

// One-time scoped styles for the aircraft carousel: a thin, unobtrusive scrollbar and snap
// behaviour that inline styles can't express (::-webkit-scrollbar, scrollbar-width).
let scrollStylesInjected = false;
function injectScrollStyles(): void {
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

/** A compact labelled meter (0..1) for an aircraft spec. */
function specMeter(label: string, value: number, accent: string): HTMLDivElement {
  const box = div({ display: 'flex', alignItems: 'center', gap: '8px' });
  box.appendChild(
    div({ fontSize: '10px', fontWeight: '700', letterSpacing: '1px', color: UI.faint, width: '52px', flex: 'none' }, label.toUpperCase()),
  );
  const track = div({ flex: '1', height: '5px', borderRadius: '99px', background: 'rgba(255,255,255,0.10)', overflow: 'hidden' });
  const fill = div({ height: '100%', width: `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`, background: accent, borderRadius: '99px' });
  track.appendChild(fill);
  box.appendChild(track);
  return box;
}

/** A maxWidth content column so every step aligns to one left edge. */
function section(extra: Partial<CSSStyleDeclaration>): HTMLDivElement {
  return div({ maxWidth: COL, margin: '0 auto', width: '100%', ...extra });
}

/** Clamp text to N lines (with an ellipsis) — keeps mission briefs from sprawling. */
function clamp(node: HTMLElement, lines: number): void {
  node.style.display = '-webkit-box';
  node.style.setProperty('-webkit-line-clamp', String(lines));
  node.style.setProperty('-webkit-box-orient', 'vertical');
  node.style.overflow = 'hidden';
}

/**
 * Credits / attribution footer — required by the asset licenses (CC-BY-4.0 and Sketchfab
 * Standard both mandate visible credit). Collapsed by default to stay out of the way.
 */
function creditsFooter(): HTMLDetailsElement {
  const wrap = document.createElement('details');
  Object.assign(wrap.style, {
    maxWidth: COL,
    margin: '34px auto 0',
    fontSize: '12px',
    color: UI.dim,
    lineHeight: '1.6',
  } as Partial<CSSStyleDeclaration>);

  const summary = document.createElement('summary');
  Object.assign(summary.style, {
    cursor: 'pointer',
    letterSpacing: '2px',
    fontWeight: '700',
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
    div(
      { marginTop: '10px', color: 'rgba(255,255,255,0.35)' },
      'Terrain, water, trees, fire, smoke and UI are procedural / zero-asset.',
    ),
  );
  wrap.appendChild(body);
  return wrap;
}

function div(style: Partial<CSSStyleDeclaration>, text?: string): HTMLDivElement {
  const node = document.createElement('div');
  Object.assign(node.style, style);
  if (text !== undefined) node.textContent = text;
  return node;
}

function setBlur(node: HTMLElement): void {
  node.style.backdropFilter = UI.blur;
  node.style.setProperty('-webkit-backdrop-filter', UI.blur);
}
