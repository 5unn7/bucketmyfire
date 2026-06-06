import { signalFirstFrame } from '../splashSignal';

/**
 * Dev tools hub — the `?dev` route. ONE place to launch the creator / inspector tools:
 *   • Map Editor      (`?editor`)   — sculpt the live 3D map, export region.ts
 *   • Helicopter Viewer (`?heliview`) — turntable showroom of the airframes + class stats
 *   • Config Panel    (the live tuning overlay) — mounted here; the card + its launcher chip both open it
 *
 * Pure DOM, lazy-loaded from main.ts so none of it ships in a player's bundle. Self-contained styling (the
 * dev tools don't pull the player theme). Cards navigate by setting `location.search`, which reloads into
 * that route's branch in main.ts.
 */

interface ToolCard {
  glyph: string;
  title: string;
  desc: string;
  action: () => void;
}

export function bootDevHub(container: HTMLElement): void {
  // Make the Config panel reachable from the hub: mount it now (its launcher chip appears top-left) so the
  // "Config Panel" card just toggles it open. Persisted overrides apply when you then open a tool/the game.
  void import('./ConfigPanel').then((m) => m.mountConfigPanel()).catch(() => {});

  const cards: ToolCard[] = [
    {
      glyph: '🗺️',
      title: 'Map Editor',
      desc: 'Sculpt terrain, paint/clear forest, drop buildings, draw rivers & dig lakes on the live 3D map. Exports paste-ready region.ts.',
      action: () => (location.search = '?editor'),
    },
    {
      glyph: '🚁',
      title: 'Helicopter Viewer',
      desc: 'Turntable showroom of the three airframes — real models + fire-bomber livery, spinning rotors, class stats & spec bars.',
      action: () => (location.search = '?heliview'),
    },
    {
      glyph: '🎛️',
      title: 'Config Panel',
      desc: 'Live-tune every gameplay + visual value — flight, fire, water, camera, world-gen. Persists and applies on the next load.',
      action: () => void import('./ConfigPanel').then((m) => m.mountConfigPanel()),
    },
  ];

  container.replaceChildren();
  Object.assign(container.style, {
    position: 'fixed',
    inset: '0',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    background: 'radial-gradient(120% 120% at 50% 0%, #1a2530 0%, #0b0f13 70%)',
    color: '#e8eef4',
    font: '14px system-ui, sans-serif',
    overflow: 'auto',
  });

  container.appendChild(el('div', '🔥 BUCKET MY FIRE', { font: '800 14px system-ui, sans-serif', letterSpacing: '3px', color: '#ff8a1e' }));
  container.appendChild(el('div', 'Dev Tools', { font: '700 30px system-ui, sans-serif', color: '#fff', marginBottom: '4px' }));
  container.appendChild(el('div', 'Creator & inspector tools, in one place', { color: '#9fb2c4', marginBottom: '26px' }));

  const row = el('div', '', { display: 'flex', flexWrap: 'wrap', gap: '18px', justifyContent: 'center', maxWidth: '900px', padding: '0 16px' });
  for (const c of cards) row.appendChild(buildCard(c));
  container.appendChild(row);

  const back = el('button', '← Back to game', {
    marginTop: '30px', padding: '9px 18px', font: '600 13px system-ui, sans-serif', color: '#cdd8e2',
    background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.14)', borderRadius: '8px', cursor: 'pointer',
  });
  back.addEventListener('click', () => (location.search = ''));
  container.appendChild(back);

  container.appendChild(el('div', 'Direct links:  ?dev · ?editor · ?heliview · ?tune', { marginTop: '18px', fontSize: '11px', color: '#5d6b78', letterSpacing: '0.5px' }));

  signalFirstFrame(); // no game frame renders on this route — hand the static splash off so the hub shows
}

/** One tool card: glyph, title, description; lifts + highlights on hover; runs `action` on click. */
function buildCard(c: ToolCard): HTMLElement {
  const card = el('div', '', {
    width: '250px',
    padding: '22px 20px',
    background: 'rgba(18,24,30,0.9)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '14px',
    cursor: 'pointer',
    transition: 'transform 0.12s ease, border-color 0.12s ease, box-shadow 0.12s ease',
  });
  card.appendChild(el('div', c.glyph, { fontSize: '34px', marginBottom: '10px' }));
  card.appendChild(el('div', c.title, { font: '700 17px system-ui, sans-serif', color: '#fff', marginBottom: '6px' }));
  card.appendChild(el('div', c.desc, { fontSize: '12.5px', color: '#b6c3cf', lineHeight: '1.5' }));
  card.addEventListener('mouseenter', () => {
    card.style.transform = 'translateY(-3px)';
    card.style.borderColor = 'rgba(255,138,30,0.6)';
    card.style.boxShadow = '0 12px 28px rgba(0,0,0,0.45)';
  });
  card.addEventListener('mouseleave', () => {
    card.style.transform = '';
    card.style.borderColor = 'rgba(255,255,255,0.1)';
    card.style.boxShadow = '';
  });
  card.addEventListener('click', c.action);
  return card;
}

/** Minimal styled-element helper (self-contained — the dev tools don't pull the player theme). */
function el(tag: string, text: string, style: Partial<CSSStyleDeclaration>): HTMLElement {
  const e = document.createElement(tag);
  if (text) e.textContent = text;
  Object.assign(e.style, style);
  return e;
}
