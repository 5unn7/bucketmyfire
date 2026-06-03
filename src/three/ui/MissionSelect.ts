import type { MissionDef } from '../missions/types';
import { bestScore, isUnlocked } from '../missions/progress';

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
      padding: '40px 22px 60px',
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

    const grid = div({
      maxWidth: '960px',
      margin: '0 auto',
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
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
