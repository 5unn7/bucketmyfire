/**
 * Pre-flight TODAY'S BRIEFING — the standalone briefing screen, hoisted out of the HUD so it can paint
 * INSTANTLY when a run launches, BEFORE the heavy `new Game()` (World gen + terrain mesh + minimap) runs.
 * It reads like a friendly fire morning meeting for the open, endless province (no mission number, no
 * level): a warm header naming the PLACE + time of day, then TODAY'S CONDITIONS at the top (the day's
 * escalating fire-danger ALERT — a two-phase Y../R.. code — plus the seeded weather as icon + value
 * specs), the one plain JOB ("Hold the province." — DERIVED from the objective so it can't drift from
 * the win rule) with a simple line under it, and a Fly button. Warm/"fight" register chrome, cyan action.
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
  dawn: 'Dawn',
  day: 'Daytime',
  noon: 'Midday',
  overcast: 'Overcast',
  golden: 'Golden hour',
  dusk: 'Dusk',
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

/** WINDS phrase from the mission's wind-strength scale (1 = the config baseline when unset). */
function briefWindPhrase(scale: number | undefined): string {
  const s = scale ?? 1;
  if (s <= 0.4) return 'light, variable';
  if (s <= 0.8) return 'light';
  if (s <= 1.1) return 'moderate';
  if (s <= 1.4) return 'strong, gusting';
  return 'extreme, gusting hard';
}

/** A fire-weather snapshot + the day's escalating danger ALERT, the heart of the morning briefing. It is
 *  DERIVED deterministically from the mission seed (mulberry32, the world-gen PRNG family) so the slip
 *  reads like a real fire-weather meeting and can never drift across replays. The alert is a two-phase day
 *  code — e.g. "Y13 R18" = YELLOW (elevated) danger through 13:00, then RED (extreme) through 18:00. */
interface FireWeather {
  tempC: number;
  rhPct: number; // relative humidity — lower = drier = worse
  danger: string; // LOW / MODERATE / HIGH / EXTREME
  dangerColor: string;
  yellowUntil: number; // hour (24h) the yellow phase holds to
  redUntil: number; // hour (24h) the red phase holds to
}
function fireWeather(def: MissionDef): FireWeather {
  let a = ((def.seed >>> 0) ^ 0x1f3d5b79) >>> 0;
  const rnd = (): number => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const d = def.difficulty; // 1..5
  const windScale = def.wind?.strengthScale ?? 1;
  // Hotter + drier as the fight gets harder; a small seeded jitter keeps each day distinct.
  const tempC = Math.round(20 + d * 2.2 + (rnd() - 0.5) * 4);
  const rhPct = Math.round(Math.max(12, 48 - d * 5 - (rnd() - 0.3) * 10));
  // Fire danger from the dryness + the wind energy.
  const energy = d + windScale * 1.2 + (40 - rhPct) / 20;
  const [danger, dangerColor]: [string, string] =
    energy >= 7 ? ['EXTREME', UI.warn] : energy >= 5 ? ['HIGH', UI.commsAmber] : energy >= 3 ? ['MODERATE', UI.caution] : ['LOW', UI.ok];
  // Two-phase day: yellow now, red by early/mid afternoon, standing down by evening. Worse weather → red
  // runs later and yellow yields to it sooner.
  const redUntil = Math.min(20, 17 + Math.round(windScale));
  const yellowUntil = Math.min(redUntil - 2, Math.max(11, 14 - Math.floor(d / 2) - Math.round(rnd())));
  return { tempC, rhPct, danger, dangerColor, yellowUntil, redUntil };
}

// Spec glyphs (exact Lucide paths — thermometer / droplet / wind), stroked in a muted instrument tone so
// the bold value beside each reads first. Sized 15px to sit inline with the FS.sm value.
function specSvg(path: string): string {
  return `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="${UI.dim}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
}
const TEMP_ICON = specSvg('<path d="M14 14.76V5a2 2 0 0 0-4 0v9.76a4 4 0 1 0 4 0z"/>');
const HUMIDITY_ICON = specSvg('<path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z"/>');
const WIND_ICON = specSvg('<path d="M12.8 19.6A2 2 0 1 0 14 16H2"/><path d="M17.5 8a2.5 2.5 0 1 1 2 4H2"/><path d="M9.8 4.4A2 2 0 1 1 11 8H2"/>');

/** One spec: a Lucide glyph + its value (temperature / humidity / winds). */
function specChip(iconSvg: string, value: string): HTMLElement {
  const chip = el('div', { display: 'flex', alignItems: 'center', gap: '6px' });
  const ic = el('div', { display: 'flex', alignItems: 'center', flexShrink: '0' });
  ic.innerHTML = iconSvg;
  chip.append(ic, el('div', { fontSize: FS.sm, fontWeight: FW.semibold, color: UI.text }, value));
  return chip;
}

/** The weather spec row — icon + value chips for temperature, humidity, and winds. */
function weatherRow(fw: FireWeather, windScale: number | undefined): HTMLElement {
  const row = el('div', { display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap', marginTop: '10px' });
  row.append(specChip(TEMP_ICON, `${fw.tempC}°C`), specChip(HUMIDITY_ICON, `${fw.rhPct}%`), specChip(WIND_ICON, briefWindPhrase(windScale)));
  return row;
}

/** A filled day-code chip (Y13 / R18) — bright fill, dark ink, mono, terse. */
function codeChip(text: string, bg: string): HTMLElement {
  return el(
    'div',
    { fontFamily: MONO, fontSize: FS.tag, fontWeight: FW.bold, letterSpacing: '0.5px', color: UI.ink, background: bg, padding: '2px 7px', borderRadius: R.xs, lineHeight: '1.25' },
    text,
  );
}

/** The DANGER rating pill — outlined in the danger colour (it's the rating, not a coded time). */
function dangerPill(fw: FireWeather): HTMLElement {
  return el(
    'div',
    { fontFamily: MONO, fontSize: FS.tag, fontWeight: FW.bold, letterSpacing: '1px', color: fw.dangerColor, border: `1px solid ${fw.dangerColor}`, padding: '2px 8px', borderRadius: R.pill, lineHeight: '1.25' },
    `DANGER ${fw.danger}`,
  );
}

/** The FIRE ALERT row — the day's danger rating + the two-phase Y../R.. code, as chips. The section
 *  kicker labels it above; the codes speak for themselves (Y = yellow phase hour, R = red phase hour). */
function alertBlock(fw: FireWeather): HTMLElement {
  const chips = el('div', { display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' });
  chips.append(dangerPill(fw), codeChip(`Y${fw.yellowUntil}`, UI.caution), codeChip(`R${fw.redUntil}`, UI.warn));
  return chips;
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
  // Flex column + a viewport height cap so the now-richer slip (conditions + tasking) never clips its Fly
  // button on a short phone; the header stays pinned and the body takes any overflow as a bounded scroll.
  const card = frosted({ maxWidth: '420px', maxHeight: '92svh', display: 'flex', flexDirection: 'column', padding: '0', borderRadius: R.xl, overflow: 'hidden' });

  // Header band — warm "fight" tint. The PLACE is the banner identity; a small kicker frames it as today's
  // briefing, with the time-of-day on the right for ambiance. (No mission number, no level: the province is
  // one open, endless shift.)
  // flex-end so the time-of-day PILL bottom-aligns with the place name (not floating against the 2-line
  // column). The pill is a warm outlined mono tag — the brand's chip idiom, matching the conditions chips
  // below — not plain grey text.
  const head = el('div', { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: '12px', padding: '13px 18px', background: HOME.ember10, borderBottom: `1px solid ${UI.stroke}` });
  const headL = el('div', { display: 'flex', flexDirection: 'column', gap: '2px', minWidth: '0' });
  headL.appendChild(el('div', { fontFamily: MONO, fontSize: FS.micro, fontWeight: FW.bold, letterSpacing: '2.5px', color: UI.ember }, "TODAY'S BRIEFING"));
  headL.appendChild(el('div', { fontSize: FS.title, fontWeight: FW.heavy, letterSpacing: '0.3px', color: UI.emberHi }, def.name));
  head.appendChild(headL);
  if (def.timeOfDay) {
    head.appendChild(
      el(
        'div',
        { flexShrink: '0', fontFamily: MONO, fontSize: FS.micro, fontWeight: FW.bold, letterSpacing: '1.5px', textTransform: 'uppercase', color: UI.emberHi, border: `1px solid ${UI.warmStroke}`, borderRadius: R.pill, padding: '3px 10px', lineHeight: '1.2' },
        TIME_OF_DAY_LABEL[def.timeOfDay] ?? '',
      ),
    );
  }
  card.appendChild(head);

  const body = el('div', { padding: '16px 18px 16px', flex: '1 1 auto', overflowY: 'auto', minHeight: '0' });

  // A small section kicker (reused for "Today's conditions" + "Your job").
  const kicker = (text: string): HTMLElement =>
    el('div', { fontFamily: MONO, fontSize: FS.micro, fontWeight: FW.bold, letterSpacing: '2px', color: UI.ember, marginBottom: '7px' }, text);

  // TODAY'S CONDITIONS — the specs, at the TOP: the escalating danger ALERT (Y../R.. code) + the weather
  // (icon + value chips for temperature / humidity / winds).
  const fw = fireWeather(def);
  body.appendChild(kicker("TODAY'S CONDITIONS"));
  body.appendChild(alertBlock(fw));
  body.appendChild(weatherRow(fw, def.wind?.strengthScale));

  body.appendChild(el('div', { height: '1px', background: UI.stroke, margin: '16px 0 14px' }));

  // YOUR JOB — the one task, plain and big. DERIVED from the objective so it can't drift from the win rule
  // ("Hold the province."), then a simple plain-language line under it.
  body.appendChild(kicker('YOUR JOB'));
  body.appendChild(el('div', { fontSize: FS.lg, fontWeight: FW.heavy, color: UI.text, marginBottom: '6px' }, def.objectives.map(briefTaskPhrase).join('  ·  ')));
  body.appendChild(el('div', { fontSize: FS.sm, lineHeight: '1.5', color: UI.textCool }, personalize(def.situation ?? def.tagline ?? def.brief, pilotName)));
  const protect = briefProtectPhrase(def);
  if (protect) body.appendChild(el('div', { fontSize: FS.sm, lineHeight: '1.5', color: UI.textCool, marginTop: '8px' }, protect));

  const begin = bannerButton('Fly ▸', 'primary', () => onBegin());
  const actions = el('div', { display: 'flex', justifyContent: 'flex-end', marginTop: '18px' });
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
