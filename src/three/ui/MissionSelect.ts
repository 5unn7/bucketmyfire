import type { MissionDef } from '../missions/types';
import { bestScore, isUnlocked } from '../missions/progress';
import { HELIS, MAPS, CatalogItem, firstAvailable, findItem, loadProfile, saveProfile } from './profile';
import { makeIcon } from './icons';
import { openLeaderboard } from './Leaderboard';
import { validateCallsign, MAX_CALLSIGN } from './callsign';
import { isNameTaken, getClientId } from '../leaderboard/client';

/**
 * Campaign mission-select menu — a full-screen DOM overlay in the game's frosted-glass
 * cockpit language (matching HUD.ts / Input.ts). Shows the 10 missions as cards; locked
 * ones (linear unlock) are greyed with a lock, unlocked ones show difficulty, briefing, and
 * best score. Picking an unlocked mission calls `onSelect(id)` — `main.ts` persists the choice
 * and reloads into the `Game` (page-reload mission switching, so there's no Three.js teardown).
 *
 * Pure DOM, zero assets. Built once at boot when no mission is selected.
 */

const UI = {
  accent: '#67e8ff',
  warm: '#ff7a45',
  text: 'rgba(234,246,255,0.96)',
  dim: 'rgba(255,255,255,0.5)',
  glass: 'rgba(12,18,25,0.55)',
  cardGlass: 'rgba(16,24,32,0.62)',
  stroke: 'rgba(255,255,255,0.14)',
  blur: 'blur(14px) saturate(120%)',
  shadow: '0 8px 30px rgba(0,0,0,0.45)',
  font: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
};

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
      // Safe-area-aware so cards clear a side notch / home-indicator in landscape.
      padding:
        'max(40px, env(safe-area-inset-top)) max(22px, env(safe-area-inset-right)) ' +
        'max(60px, env(safe-area-inset-bottom)) max(22px, env(safe-area-inset-left))',
      boxSizing: 'border-box',
    });

    const header = div({ maxWidth: '960px', margin: '0 auto 26px', textAlign: 'center' });
    header.appendChild(
      div(
        { fontSize: '13px', fontWeight: '700', letterSpacing: '5px', color: UI.accent, marginBottom: '8px' },
        'BUCKETMYFIRE',
      ),
    );
    header.appendChild(div({ fontSize: '30px', fontWeight: '800', letterSpacing: '0.5px' }, 'Campaign'));
    header.appendChild(
      div(
        { fontSize: '14px', color: UI.dim, marginTop: '8px' },
        'Northern Saskatchewan air attack — ten sorties, hardest last.',
      ),
    );
    this.root.appendChild(header);

    // Toolbar: editable pilot callsign (the name future leaderboard entries use) + a button
    // into the global leaderboard. Centered under the header, above the aircraft picker.
    this.root.appendChild(this.toolbar(catalog));

    // Helicopter picker — the chosen airframe is persisted to the profile so the
    // mission boot (defaultProfile) flies it. Lives above the sortie grid.
    this.root.appendChild(this.heliPicker());

    const grid = div({
      maxWidth: '960px',
      margin: '0 auto',
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
      gap: '16px',
    });
    this.root.appendChild(grid);

    for (const m of catalog) {
      grid.appendChild(this.card(m, catalog, onSelect));
    }

    this.root.appendChild(creditsFooter());

    parent.appendChild(this.root);
  }

  dispose(): void {
    this.root.remove();
  }

  /**
   * Header toolbar: an editable CALLSIGN chip + a button into the global leaderboard.
   * The callsign is the name the leaderboard submits under — this is where a returning
   * pilot renames themselves (auto-submit uses whatever is saved here). Renaming persists
   * to the profile (preserving the chosen heli/map) so the next win posts under the new name.
   */
  private toolbar(catalog: MissionDef[]): HTMLDivElement {
    const bar = div({
      maxWidth: '960px',
      margin: '0 auto 22px',
      display: 'flex',
      gap: '10px',
      justifyContent: 'center',
      alignItems: 'center',
      flexWrap: 'wrap',
    });

    // --- Callsign chip (click to edit) — wrapped with a status line for validation feedback ---
    const chipCol = div({ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' });
    const chip = div({
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      background: UI.cardGlass,
      border: `1px solid ${UI.stroke}`,
      borderRadius: '99px',
      padding: '8px 14px',
      cursor: 'pointer',
      fontSize: '13px',
    });
    setBlur(chip);
    const msg = div({ fontSize: '11px', fontWeight: '600', minHeight: '14px', display: 'none' });
    const showMsg = (text: string, bad: boolean): void => {
      msg.textContent = text;
      msg.style.color = bad ? UI.warm : UI.dim;
      msg.style.display = text ? 'block' : 'none';
    };

    const render = (): void => {
      showMsg('', false);
      const name = loadProfile()?.name ?? 'Pilot';
      chip.replaceChildren(
        div({ fontSize: '10px', fontWeight: '700', letterSpacing: '2px', color: UI.dim }, 'CALLSIGN'),
        div({ fontSize: '14px', fontWeight: '700', color: UI.text }, name),
        div({ fontSize: '12px', opacity: '0.7' }, '✎'),
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
        fontSize: '14px',
        fontWeight: '700',
        width: '150px',
      } as Partial<CSSStyleDeclaration>);
      input.type = 'text';
      input.maxLength = MAX_CALLSIGN;
      input.value = cur?.name ?? '';
      input.placeholder = 'Enter callsign';
      input.autocomplete = 'off';
      input.spellcheck = false;

      // `settled` guards the async path: once we cancel or successfully save we re-render (which
      // removes the input → fires blur), and any in-flight duplicate-check must not then save.
      let settled = false;
      const close = (): void => {
        if (settled) return;
        settled = true;
        render();
      };

      // Validate (sync) → check uniqueness (async) → save. Invalid / taken keeps the editor open
      // with a reason; a clean, unique name saves and closes. Called on Enter and on blur.
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
          showMsg(`“${res.value}” is taken — pick another.`, true);
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

      chip.replaceChildren(
        div({ fontSize: '10px', fontWeight: '700', letterSpacing: '2px', color: UI.accent }, 'CALLSIGN'),
        input,
      );
      input.focus();
      input.select();
    };

    chip.addEventListener('pointerdown', (e) => {
      // Ignore taps while the input is already open (so caret placement works).
      if ((e.target as HTMLElement).tagName === 'INPUT') return;
      beginEdit();
    });
    render();
    chipCol.appendChild(chip);
    chipCol.appendChild(msg);
    bar.appendChild(chipCol);

    // --- Leaderboard button ---
    const lb = div(
      {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        background: UI.cardGlass,
        border: `1px solid ${UI.accent}66`,
        borderRadius: '99px',
        padding: '9px 16px',
        cursor: 'pointer',
        fontSize: '13px',
        fontWeight: '700',
        letterSpacing: '0.5px',
        color: UI.accent,
        transition: 'border-color 0.12s ease, box-shadow 0.12s ease',
      },
      '🏆 Leaderboard',
    );
    setBlur(lb);
    lb.addEventListener('pointerenter', () => (lb.style.boxShadow = `0 0 0 1px ${UI.accent}66`));
    lb.addEventListener('pointerleave', () => (lb.style.boxShadow = 'none'));
    lb.addEventListener('pointerdown', () => openLeaderboard(catalog));
    bar.appendChild(lb);

    return bar;
  }

  /**
   * Horizontal helicopter selector. Picking a card writes the choice to the saved
   * profile (creating a default one if none exists) — the mission boot reads it back
   * via defaultProfile(), so the selected airframe is what spawns. No reload needed:
   * the first mission pick builds the Game fresh after this has already persisted.
   */
  private heliPicker(): HTMLDivElement {
    const saved = loadProfile();
    let selected = findItem(HELIS, saved?.heliId)?.available
      ? (findItem(HELIS, saved?.heliId) as CatalogItem)
      : firstAvailable(HELIS);

    const persist = (heli: CatalogItem): void => {
      const cur = loadProfile();
      saveProfile({
        name: cur?.name ?? 'Pilot',
        mapId: findItem(MAPS, cur?.mapId)?.available ? (cur as { mapId: string }).mapId : firstAvailable(MAPS).id,
        heliId: heli.id,
      });
    };
    // Persist the resolved default up-front so a player who never touches the picker
    // still flies a valid, saved choice.
    persist(selected);

    const wrap = div({ maxWidth: '960px', margin: '0 auto 26px' });
    wrap.appendChild(
      div({ fontSize: '11px', fontWeight: '700', letterSpacing: '2px', color: UI.dim, margin: '0 0 10px 2px' }, 'AIRCRAFT'),
    );

    const row = div({ display: 'flex', gap: '12px', flexWrap: 'wrap' });
    wrap.appendChild(row);

    const cards: { el: HTMLDivElement; item: CatalogItem; set: (on: boolean) => void }[] = [];
    for (const heli of HELIS) {
      const usable = heli.available;
      const card = div({
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        flex: '1 1 200px',
        minWidth: '180px',
        background: UI.cardGlass,
        border: `1px solid ${UI.stroke}`,
        borderRadius: '14px',
        padding: '10px 14px 10px 10px',
        cursor: usable ? 'pointer' : 'default',
        opacity: usable ? '1' : '0.5',
        transition: 'transform 0.12s ease, border-color 0.12s ease',
      });
      setBlur(card);

      const art = div({ width: '52px', height: '52px', flex: 'none' });
      art.style.background = `radial-gradient(120% 100% at 50% 30%, ${heli.accent}3a, transparent 72%)`;
      art.style.borderRadius = '10px';
      const icon = makeIcon(heli.id);
      icon.setAttribute('width', '52');
      icon.setAttribute('height', '52');
      art.appendChild(icon);

      const meta = div({});
      meta.appendChild(div({ fontSize: '15px', fontWeight: '700' }, heli.name));
      meta.appendChild(
        div({ fontSize: '11px', letterSpacing: '0.06em', textTransform: 'uppercase', color: UI.accent, opacity: '0.85', marginTop: '2px' }, heli.tagline),
      );

      card.appendChild(art);
      card.appendChild(meta);
      if (!usable) {
        const soon = div(
          { position: 'absolute', top: '8px', right: '8px', fontSize: '9px', letterSpacing: '0.12em', fontWeight: '700', color: UI.dim },
          'SOON',
        );
        card.appendChild(soon);
      }

      const setSelected = (on: boolean): void => {
        card.style.borderColor = on ? UI.accent : UI.stroke;
        card.style.boxShadow = on ? `0 0 0 2px ${UI.accent}66, ${UI.shadow}` : 'none';
      };
      setSelected(usable && heli.id === selected.id);

      if (usable) {
        card.addEventListener('pointerenter', () => {
          if (heli.id !== selected.id) card.style.borderColor = UI.accent;
        });
        card.addEventListener('pointerleave', () => setSelected(heli.id === selected.id));
        card.addEventListener('pointerdown', () => {
          selected = heli;
          persist(heli);
          for (const c of cards) c.set(c.item.id === heli.id);
        });
      }
      cards.push({ el: card, item: heli, set: setSelected });
      row.appendChild(card);
    }
    return wrap;
  }

  private card(m: MissionDef, catalog: MissionDef[], onSelect: (id: string) => void): HTMLDivElement {
    const unlocked = isUnlocked(m, catalog);
    const best = bestScore(m.id);

    const card = div({
      position: 'relative',
      background: UI.cardGlass,
      border: `1px solid ${UI.stroke}`,
      borderRadius: '16px',
      boxShadow: UI.shadow,
      padding: '18px 18px 16px',
      cursor: unlocked ? 'pointer' : 'default',
      opacity: unlocked ? '1' : '0.5',
      transition: 'transform 0.12s ease, border-color 0.12s ease',
    });
    setBlur(card);

    const top = div({ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '10px' });
    top.appendChild(
      div({ fontSize: '11px', fontWeight: '700', letterSpacing: '2px', color: UI.dim }, `SORTIE ${m.index + 1}`),
    );
    top.appendChild(div({ fontSize: '13px', color: UI.warm, letterSpacing: '1px' }, '🔥'.repeat(m.difficulty)));
    card.appendChild(top);

    card.appendChild(div({ fontSize: '20px', fontWeight: '700', margin: '6px 0 8px' }, m.name));
    card.appendChild(
      div({ fontSize: '13px', lineHeight: '1.45', color: 'rgba(231,247,255,0.8)', minHeight: '54px' }, m.brief),
    );

    const footer = div({
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginTop: '12px',
      fontSize: '12px',
      color: UI.dim,
    });
    footer.appendChild(div({}, best !== null ? `Best ${best.toLocaleString()}` : 'Not flown'));
    const play = div(
      {
        fontWeight: '700',
        letterSpacing: '1px',
        color: unlocked ? UI.accent : UI.dim,
      },
      unlocked ? 'FLY ▸' : '🔒 LOCKED',
    );
    footer.appendChild(play);
    card.appendChild(footer);

    if (unlocked) {
      card.addEventListener('pointerenter', () => {
        card.style.transform = 'translateY(-3px)';
        card.style.borderColor = UI.accent;
      });
      card.addEventListener('pointerleave', () => {
        card.style.transform = 'none';
        card.style.borderColor = UI.stroke;
      });
      card.addEventListener('pointerdown', () => onSelect(m.id));
    }
    return card;
  }
}

/**
 * Credits / attribution footer — required by the asset licenses (CC-BY-4.0 and Sketchfab
 * Standard both mandate visible credit). Collapsed by default to stay out of the way; the
 * world itself is procedural, so this only covers the few binary models + audio that ship.
 */
function creditsFooter(): HTMLDetailsElement {
  const wrap = document.createElement('details');
  Object.assign(wrap.style, {
    maxWidth: '960px',
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
    color: UI.dim,
    textAlign: 'center',
    listStyle: 'none',
  } as Partial<CSSStyleDeclaration>);
  summary.textContent = 'CREDITS';
  wrap.appendChild(summary);

  const body = div({ marginTop: '12px', textAlign: 'center' });
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
