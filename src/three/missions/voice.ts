/**
 * Generative dispatch VOICE — turns a MissionDef's scenario data into a complete, REACTIVE radio
 * script in ONE consistent register, with place names filled from the active map. Engine-agnostic:
 * the only import is a type-import from ./types (numbers/strings/POJOs — no Three, no DOM, no
 * dependency on catalog.ts or Game.ts), exactly like MissionRuntime/MissionDirector, so it is
 * headless-testable (scripts/verify-voice.ts → `npm run verify:voice`).
 *
 * WHY: hand-written per-mission comms (catalog.ts `script[]`) don't scale to new maps and drift in
 * tone. This generates dispatch FROM THE DEF — so a new region/mission auto-gets in-voice, reactive,
 * place-aware comms with no hand authoring. Triggers are REACTIVE (player progress / structure
 * threat / fuel / crews), NOT a preset clock, so dispatch responds to the pilot instead of reading
 * a script — the fix for "radio dispatch feels fake".
 *
 * The line-banks ARE the brand voice: dry, direct, calm — the in-game dispatcher. No hype, no
 * cheerleading, no em-dash glue. Variant choice is SEEDED (def.seed) → deterministic + verifiable.
 *
 * WIRING (later, when Game.ts / catalog.ts are free): a mission that omits `script` should get
 * `generateScript(def, { nameOf })`, where Game passes a place-name resolver from the seeded World
 * so names are exact (à-la-Crosse, not the title-cased slug). Until then this module stands alone,
 * proven by verify:voice. `VOICE` can move into config.ts at that point (the project's tuning home).
 */

import type {
  MissionDef,
  MissionBeat,
  MissionAction,
  CommsSpeaker,
  CommsUrgency,
  CommunityRef,
  FirePlacement,
} from './types';

/** The tunable register ("adjust the range properly"). Move to config.ts when this is wired in. */
export const VOICE = {
  callsign: 'Water-1', // the pilot
  encourage: true, // include the mid-mission "you're holding her" beat on multi-fire sorties
  warnThreat: 0.5, // structure-threat level (0..1) that triggers the "fire at the flank" warning
  lowFuel: 0.25, // fuel fraction that triggers the low-fuel call
};

type MissionKind = 'fire' | 'crew' | 'torch';
type EventKey = 'briefing' | 'progress' | 'threat' | 'structureLost' | 'fuelLow' | 'crewProgress' | 'won';

interface Bank {
  speaker: CommsSpeaker;
  urgency: CommsUrgency;
  lines: string[];
}

// The voice, banked per event. {town}/{callsign}/{job} are slots filled at generate time. Dry,
// direct, calm — no hype, no em-dashes (verify:voice enforces both). Several phrasings per event so
// a seeded pick varies the line without repeating "get on it" across every mission/map.
const BANK: Record<EventKey, Bank> = {
  briefing: {
    speaker: 'dispatch',
    urgency: 'info',
    lines: [
      '{callsign}, Dispatch. Fire working at {town}. {job}',
      '{callsign}, Dispatch. We have fire on {town}. {job}',
      '{callsign}, cleared to lift. Fire at {town}. {job}',
    ],
  },
  progress: {
    speaker: 'crew',
    urgency: 'info',
    lines: [
      'Good knockdown. Stay on it.',
      "That's the way, {callsign}. Keep filling and hitting them.",
      "You're holding her. Keep working it.",
    ],
  },
  threat: {
    speaker: 'warning',
    urgency: 'alert',
    lines: [
      "Fire's at {town}'s flank. Push it back.",
      "She's testing the homes at {town}. Get on it.",
      'Smoke at {town}. Knock it down before it takes a roof.',
    ],
  },
  structureLost: {
    speaker: 'warning',
    urgency: 'alert',
    lines: ['We lost a building at {town}. Hold the rest.', "{town}'s taken a cabin. Don't lose another."],
  },
  fuelLow: {
    speaker: 'warning',
    urgency: 'warn',
    lines: ['Fuel is low, {callsign}. Top up at base.', 'Watch your tank. Make the run home count.'],
  },
  crewProgress: {
    speaker: 'crew',
    urgency: 'info',
    lines: ['Crew is down safe. On to the next.', 'Good drop. Keep them moving.'],
  },
  won: {
    speaker: 'dispatch',
    urgency: 'info',
    lines: [], // filled per kind below (the win line depends on whether it was fire / crew / torch)
  },
};

// The win line reads differently per mission kind, so it gets its own per-kind bank.
const WON_BY_KIND: Record<MissionKind, string[]> = {
  fire: ['All out, {town} standing. Good work, {callsign}.', 'Fire is down and the homes held. Textbook.', "That's how it's done, {callsign}."],
  crew: ['Everyone is clear, {callsign}. Well flown.', 'All crews down safe. Good work out there.'],
  torch: ['The head hit your black and lay down. Nothing left to burn.', 'You stopped a fire with fire, {callsign}. They tell stories about that one.'],
};

// The one-clause "what to do" appended to the briefing, by mission kind.
const JOB_BY_KIND: Record<MissionKind, string> = {
  fire: 'Fill from the lake and knock it down.',
  crew: 'Board your crew and lift them clear.',
  torch: 'You are on the torch. Lay the backburn before the head arrives.',
};

// --- helpers ----------------------------------------------------------------

/** Deterministic variant index from the seed + a per-event salt (no Math.random — verifiable). */
const SALT: Record<EventKey, number> = { briefing: 0, progress: 3, threat: 7, structureLost: 11, fuelLow: 13, crewProgress: 17, won: 23 };
function pick(lines: string[], seed: number, ev: EventKey): string {
  if (lines.length === 0) return '';
  return lines[Math.abs(seed + SALT[ev]) % lines.length];
}

function fill(tpl: string, slots: { town: string; job: string }): string {
  return tpl
    .replace(/\{callsign\}/g, VOICE.callsign)
    .replace(/\{town\}/g, slots.town)
    .replace(/\{job\}/g, slots.job);
}

/** Title-case a MapAnchor slug as a fallback name ('denare-beach' → 'Denare Beach'). Game should
 *  pass an exact `nameOf` resolver at wire time so accented names (Île-à-la-Crosse) read right. */
function titleCase(slug: string): string {
  return slug
    .split('-')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
}

function fireCommunity(f: FirePlacement): CommunityRef | undefined {
  if (f.at === 'nearCommunity') return f.community;
  if (f.at === 'line') return f.community;
  if (f.at === 'cluster' && typeof f.anchor === 'object') return f.anchor.community;
  return undefined;
}

/** The settlement this mission is ABOUT — the one dispatch names. Structures first, else the first
 *  community-anchored fire, else the home base. `null` when the def names no place (→ "the area"). */
function primaryRef(def: MissionDef): CommunityRef | null {
  const g = def.structures?.groups?.[0]?.community;
  if (g !== undefined) return g;
  for (const f of def.fires ?? []) {
    const c = fireCommunity(f);
    if (c !== undefined) return c;
  }
  return def.homeBase ?? null;
}

function townName(def: MissionDef, nameOf?: (ref: CommunityRef) => string): string {
  const ref = primaryRef(def);
  if (ref == null) return 'the area';
  if (nameOf) {
    const n = nameOf(ref);
    if (n) return n;
  }
  if (typeof ref === 'string' && ref !== 'base') return titleCase(ref);
  if (ref === 'base' && def.homeBase) return titleCase(def.homeBase);
  return 'the town';
}

function missionKind(def: MissionDef): MissionKind {
  if (def.payload === 'torch' || def.objectives.some((o) => o.kind === 'backburn')) return 'torch';
  const hasFire = (def.fires?.length ?? 0) > 0 || def.objectives.some((o) => o.kind === 'extinguishAll' || o.kind === 'extinguishCount');
  if (hasFire) return 'fire';
  if (def.objectives.some((o) => o.kind === 'deliver' || o.kind === 'evacuate')) return 'crew';
  return 'fire';
}

function fireCount(def: MissionDef): number {
  return (def.fires ?? []).reduce((a, f) => a + ('count' in f && f.count ? f.count : 1), 0);
}

function comms(speaker: CommsSpeaker, text: string, urgency: CommsUrgency): MissionAction {
  return { do: 'comms', speaker, text, urgency };
}

// --- public API -------------------------------------------------------------

/** Generate ONE in-voice comms line for an event, with slots filled. (The primitive `generateScript`
 *  composes.) Returns the speaker/urgency from the bank so Game colours/squelches it correctly. */
export function generateLine(
  event: EventKey,
  ctx: { seed: number; town: string; job?: string; kind?: MissionKind },
): { speaker: CommsSpeaker; text: string; urgency: CommsUrgency } {
  const bank = BANK[event];
  const lines = event === 'won' ? WON_BY_KIND[ctx.kind ?? 'fire'] : bank.lines;
  const text = fill(pick(lines, ctx.seed, event), { town: ctx.town, job: ctx.job ?? '' });
  return { speaker: bank.speaker, text, urgency: bank.urgency };
}

/**
 * Generate a COMPLETE reactive script (briefing → reactive beats → debrief) for a mission from its
 * scenario data. Every comms line is in one voice, place-aware, and SEEDED-deterministic; every
 * trigger except the briefing/win is REACTIVE (player progress / threat / fuel / crews), not a clock.
 * Intended for missions that omit a hand-written `script`, so a new map's missions narrate themselves.
 */
export function generateScript(def: MissionDef, opts?: { nameOf?: (ref: CommunityRef) => string }): MissionBeat[] {
  const kind = missionKind(def);
  const town = townName(def, opts?.nameOf);
  const job = JOB_BY_KIND[kind];
  const seed = def.seed;
  const hasStructures = !!def.structures?.groups?.length;
  const fires = fireCount(def);
  const ctx = { seed, town, job, kind };
  const beats: MissionBeat[] = [];

  // Briefing — always, on start.
  const b = generateLine('briefing', ctx);
  beats.push({ id: 'gen-brief', trigger: { at: 'start' }, actions: [comms(b.speaker, b.text, b.urgency)] });

  // Mid-mission encouragement — REACTIVE on real progress (half the fires down), fire sorties only.
  if (kind === 'fire' && VOICE.encourage && fires >= 2) {
    const p = generateLine('progress', ctx);
    beats.push({ id: 'gen-progress', trigger: { at: 'firesDoused', n: Math.max(1, Math.floor(fires / 2)) }, actions: [comms(p.speaker, p.text, p.urgency)] });
  }

  // Threat warning — REACTIVE on a structure actually in danger (a sharp pilot may never hear it).
  if (hasStructures && kind !== 'crew') {
    const t = generateLine('threat', ctx);
    beats.push({ id: 'gen-threat', trigger: { at: 'threat', min: VOICE.warnThreat }, actions: [comms(t.speaker, t.text, t.urgency)] });
  }

  // Structure-lost — REACTIVE, the moment a building burns.
  if (hasStructures) {
    const s = generateLine('structureLost', ctx);
    beats.push({ id: 'gen-loss', trigger: { at: 'structureLost', n: 1 }, actions: [comms(s.speaker, s.text, s.urgency)] });
  }

  // Low fuel — REACTIVE on the tank, fuel missions only.
  if (def.fuel) {
    const f = generateLine('fuelLow', ctx);
    beats.push({ id: 'gen-fuel', trigger: { at: 'fuelBelow', frac: VOICE.lowFuel }, actions: [comms(f.speaker, f.text, f.urgency)] });
  }

  // Crew progress — REACTIVE on the first delivery, crew sorties.
  if (def.objectives.some((o) => o.kind === 'deliver' || o.kind === 'evacuate')) {
    const c = generateLine('crewProgress', ctx);
    beats.push({ id: 'gen-crew', trigger: { at: 'crewDelivered', n: 1 }, actions: [comms(c.speaker, c.text, c.urgency)] });
  }

  // Debrief — on the win, voiced by mission kind.
  const w = generateLine('won', ctx);
  beats.push({ id: 'gen-won', trigger: { at: 'won' }, actions: [comms(w.speaker, w.text, w.urgency)] });

  return beats;
}
