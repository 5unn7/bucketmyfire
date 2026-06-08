/**
 * Pre-flight DISPATCH SLIP — the standalone briefing screen, hoisted out of the HUD so it can paint
 * INSTANTLY when a mission launches, BEFORE the heavy `new Game()` (World gen + terrain mesh +
 * minimap) runs. The card reads like a fireline dispatch slip: a mono header strip, the mission no. +
 * name + threat pips, then fielded SITUATION / TASK / WINDS rows (TASK + WINDS DERIVED from the def so
 * they can never drift from the real win rule / seeded wind), and a Fly button. Warm/"fight" register
 * chrome, cyan action.
 *
 * It is driven purely by the `MissionDef` (+ the pilot callsign) — it never reads the World, the
 * minimap, or any HUD state — which is exactly why it can be shown before the game exists. `main.ts`
 * paints this first, builds the Game behind it, and only thaws the sim when `onBegin` fires (the
 * caller then calls the returned `dismiss()` once the scene is ready).
 */

import { UI, FS, FW, R, el, frosted, scrim, HOME } from './theme';
import { bannerButton, personalize } from '../hud/common';
import type { MissionDef, Objective } from '../missions/types';

const MONO = UI.fontMono; // the cockpit instrument face (JetBrains Mono) — one source via theme.ts

const TIME_OF_DAY_LABEL: Record<string, string> = {
  dawn: 'DAWN',
  day: 'DAY',
  noon: 'NOON',
  overcast: 'OVERCAST',
  golden: 'GOLDEN HR',
  dusk: 'DUSK',
};

/** One terse TASK phrase per objective — derived so the slip can't contradict the real win rule. */
function briefTaskPhrase(o: Objective): string {
  switch (o.kind) {
    case 'extinguishAll':
      return 'Put every fire out.';
    case 'extinguishCount':
      return `Knock down ${o.n ?? 0} fires.`;
    case 'deliver':
      return o.label ?? `Work ${o.n ?? 0} zones.`;
    case 'evacuate':
      return o.label ?? `Lift ${o.n ?? 0} families clear.`;
    case 'survive':
      // Authored label wins (Open Skies' "Fly free…" reads better than a 1e9-second hold). Else the timer.
      return o.label ?? (o.seconds ? `Hold the line ${Math.round(o.seconds)}s.` : 'Hold the line.');
    case 'backburn':
      return 'Lay the backburn line.';
  }
}

/** PROTECT row — only present when the mission has a `protect` lose-condition. Label-first (authored),
 *  else derived from the structures-min so the slip never invents the stake. */
function briefProtectPhrase(def: MissionDef): string | undefined {
  const p = def.fails?.find((f) => f.kind === 'protect');
  if (!p) return undefined;
  if (p.label) return /[.!?]$/.test(p.label) ? p.label : `${p.label}.`;
  if (p.all) return 'Keep every structure standing.';
  return `Keep ${p.min ?? 1} structures standing.`;
}

/** WINDS row from the mission's wind-strength scale (1 = the config baseline when unset). */
function briefWindPhrase(scale: number | undefined): string {
  const s = scale ?? 1;
  if (s <= 0.4) return 'Light, variable.';
  if (s <= 0.8) return 'Light.';
  if (s <= 1.1) return 'Moderate.';
  if (s <= 1.4) return 'Strong, gusting.';
  return 'Extreme — gusting hard.';
}

/**
 * Mount the pre-flight DISPATCH SLIP over `parent` and return a `dismiss()` to tear it down. `onBegin`
 * fires when the pilot taps Fly (or the scrim) — it does NOT auto-remove the card, so the caller can
 * keep it up until the scene is ready and then call `dismiss()`. `dismiss()` is idempotent.
 */
export function showBriefing(
  parent: HTMLElement,
  def: MissionDef,
  pilotName: string | undefined,
  onBegin: () => void,
): () => void {
  // The shared modal backdrop — the same "dim + blur the frozen world so the slip is the focus"
  // primitive the mission-end banner uses (theme.ts `scrim()`), so the briefing reads consistently.
  const backdrop = scrim();
  const card = frosted({ maxWidth: '420px', padding: '0', borderRadius: R.xl, overflow: 'hidden' });

  // Header strip — the dispatch banner. Mono, warm tint, ruled off from the body.
  const head = el('div', {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '11px 18px',
    background: HOME.ember10, // warm fight-register tint (the canonical ember ramp; see theme.ts HOME)
    borderBottom: `1px solid ${UI.stroke}`,
    fontFamily: MONO,
    fontSize: FS.tag,
    fontWeight: FW.bold,
    letterSpacing: '2px',
  });
  head.appendChild(el('div', { color: UI.emberHi }, 'DISPATCH BRIEFING'));
  head.appendChild(el('div', { color: UI.dim }, def.timeOfDay ? (TIME_OF_DAY_LABEL[def.timeOfDay] ?? '') : ''));
  card.appendChild(head);

  const body = el('div', { padding: '15px 18px 16px' });

  // Mission number (mono, dim) over the title + threat pips.
  body.appendChild(
    el('div', { fontFamily: MONO, fontSize: FS.tag, fontWeight: FW.bold, letterSpacing: '2px', color: UI.dim, marginBottom: '3px' }, `MISSION ${String(def.index + 1).padStart(2, '0')}`),
  );
  const titleRow = el('div', { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' });
  titleRow.appendChild(el('div', { fontSize: FS.title, fontWeight: FW.heavy, letterSpacing: '0.4px', textTransform: 'uppercase' }, def.name));
  const pips = el('div', { display: 'flex', gap: '3px', flexShrink: '0' });
  for (let i = 0; i < 5; i++) {
    pips.appendChild(el('div', { width: '14px', height: '4px', borderRadius: R.pill, background: i < def.difficulty ? UI.fire : UI.track }));
  }
  titleRow.appendChild(pips);
  body.appendChild(titleRow);

  // Hairline-ruled fielded rows — the "document" feel: a mono label gutter, dry value.
  const rule = (): HTMLElement => el('div', { height: '1px', background: UI.stroke, margin: '12px 0' });
  const field = (key: string, value: string): HTMLElement => {
    const row = el('div', { display: 'flex', gap: '12px', alignItems: 'baseline', marginBottom: '9px' });
    row.appendChild(el('div', { flex: '0 0 62px', fontFamily: MONO, fontSize: FS.tag, fontWeight: FW.bold, letterSpacing: '1.5px', color: UI.ember }, key));
    row.appendChild(el('div', { flex: '1', fontSize: FS.sm, lineHeight: '1.42', color: UI.text }, value));
    return row;
  };

  body.appendChild(rule());
  body.appendChild(field('SITUATION', personalize(def.situation ?? def.tagline ?? def.brief, pilotName)));
  body.appendChild(field('TASK', def.objectives.map(briefTaskPhrase).join('  ·  ')));
  const protect = briefProtectPhrase(def);
  if (protect) body.appendChild(field('PROTECT', protect));
  body.appendChild(field('WINDS', briefWindPhrase(def.wind?.strengthScale)));
  body.appendChild(rule());

  const begin = bannerButton('Fly ▸', 'primary', () => onBegin());
  const actions = el('div', { display: 'flex', justifyContent: 'flex-end', marginTop: '2px' });
  actions.appendChild(begin);
  body.appendChild(actions);

  card.appendChild(body);
  backdrop.appendChild(card);
  // Tapping the backdrop (outside the card) also begins — forgiving on mobile.
  backdrop.addEventListener('pointerdown', (e) => {
    if (e.target === backdrop) onBegin();
  });
  parent.appendChild(backdrop);

  let dismissed = false;
  return (): void => {
    if (dismissed) return;
    dismissed = true;
    backdrop.remove();
  };
}
