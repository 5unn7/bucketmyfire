/**
 * Headless verification for the generative dispatch voice (src/three/missions/voice.ts).
 *
 * Run: `npm run verify:voice` (esbuild-bundles this to Node, like verify:campaign).
 *
 * The engine is pure (type-only import from types.ts), so we exercise it directly with synthetic
 * MissionDefs — deliberately NOT importing catalog.ts, so this stays decoupled from in-progress
 * campaign edits. We assert the brand-voice + generative invariants: deterministic from the seed,
 * place names filled (no leftover slots), REACTIVE triggers (not a preset clock), one voice per
 * mission kind, and NO em-dash / slop in any generated line.
 */
import { generateScript, generateLine, VOICE } from '../src/three/missions/voice';
import type { MissionDef } from '../src/three/missions/types';

let failures = 0;
function ok(cond: boolean, msg: string): void {
  if (!cond) {
    failures++;
    console.error('  ✗ ' + msg);
  }
}

// Minimal-but-valid synthetic defs covering each mission kind the engine branches on.
const fireDef: MissionDef = {
  id: 'syn-fire', index: 0, name: 'Hold the Line', brief: '', difficulty: 3, seed: 233,
  homeBase: 'denare-beach', payload: 'water',
  fires: [{ at: 'nearCommunity', community: 'denare-beach', size: 'medium', count: 3 }],
  structures: { depot: true, groups: [{ community: 'denare-beach', cabins: 6 }] },
  objectives: [{ kind: 'extinguishAll' }],
  fails: [{ kind: 'protect', min: 4 }],
};
const crewDef: MissionDef = {
  id: 'syn-crew', index: 1, name: 'Hover Training', brief: '', difficulty: 1, seed: 987,
  homeBase: 'la-ronge', payload: 'crew',
  fires: [],
  objectives: [{ kind: 'deliver', n: 5 }],
};
const torchDef: MissionDef = {
  id: 'syn-torch', index: 3, name: 'Backburn', brief: '', difficulty: 3, seed: 89,
  homeBase: 'missinipe', payload: 'torch',
  fires: [{ at: 'line', community: 'missinipe', size: 'mega', length: 150, offset: 95 }],
  structures: { depot: true, groups: [{ community: 'missinipe', cabins: 5 }] },
  objectives: [{ kind: 'backburn', n: 5 }],
  fails: [{ kind: 'protect', min: 4 }],
};
const fuelDef: MissionDef = {
  id: 'syn-fuel', index: 6, name: 'After Burn', brief: '', difficulty: 3, seed: 144,
  homeBase: 'denare-beach', payload: 'water', fuel: true,
  fires: [{ at: 'cluster', anchor: { community: 'denare-beach' }, distance: 95, spread: 120, count: 5, size: 'small' }],
  structures: { depot: true, groups: [{ community: 'denare-beach', cabins: 5 }] },
  objectives: [{ kind: 'extinguishAll' }],
  fails: [{ kind: 'protect', min: 4 }, { kind: 'fuelOut' }],
};

const ALL: { def: MissionDef; expectTown: string }[] = [
  { def: fireDef, expectTown: 'Denare Beach' },
  { def: crewDef, expectTown: 'La Ronge' },
  { def: torchDef, expectTown: 'Missinipe' },
  { def: fuelDef, expectTown: 'Denare Beach' },
];

const BANNED = ['simulator', 'immersive', 'epic', 'stunning', 'seamless', 'awesome', 'unleash'];

for (const { def, expectTown } of ALL) {
  const beats = generateScript(def);
  const ids = beats.map((b) => b.id);

  ok(beats.length >= 2, `${def.id}: produced a script`);
  ok(new Set(ids).size === ids.length, `${def.id}: beat ids unique (${ids.join(', ')})`);
  ok(ids.includes('gen-brief'), `${def.id}: has a briefing beat`);
  ok(ids.includes('gen-won'), `${def.id}: has a debrief beat`);

  // Determinism — same def → byte-identical script.
  ok(JSON.stringify(generateScript(def)) === JSON.stringify(beats), `${def.id}: deterministic from seed`);

  // At least one REACTIVE trigger (not the start briefing, not a clock).
  const reactive = beats.some((b) => b.trigger.at !== 'start' && b.trigger.at !== 'time' && b.trigger.at !== 'won');
  ok(reactive, `${def.id}: has a reactive (non-clock) trigger`);

  // Every line: filled, non-empty, no em-dash, no slop.
  for (const b of beats) {
    ok(b.actions.length > 0, `${def.id}/${b.id}: has an action`);
    for (const a of b.actions) {
      if (a.do !== 'comms') continue;
      ok(a.text.length > 0, `${def.id}/${b.id}: comms text non-empty`);
      ok(!a.text.includes('{'), `${def.id}/${b.id}: slots filled (no leftover {…}) — "${a.text}"`);
      ok(!a.text.includes('—'), `${def.id}/${b.id}: no em-dash in shipped copy — "${a.text}"`);
      const lc = a.text.toLowerCase();
      for (const w of BANNED) ok(!lc.includes(w), `${def.id}/${b.id}: no slop word "${w}" — "${a.text}"`);
    }
  }

  // Place-awareness — the briefing names the real town.
  const brief = beats.find((b) => b.id === 'gen-brief')!;
  const briefText = brief.actions.find((a) => a.do === 'comms')!;
  ok(briefText.do === 'comms' && briefText.text.includes(expectTown), `${def.id}: briefing names "${expectTown}"`);
}

// Kind-specific win lines.
ok(generateScript(fuelDef).some((b) => b.id === 'gen-fuel'), 'fuel mission gets a low-fuel beat');
ok(generateScript(crewDef).some((b) => b.id === 'gen-crew'), 'crew mission gets a crew-progress beat');
const torchWon = generateLine('won', { seed: torchDef.seed, town: 'Missinipe', kind: 'torch' }).text.toLowerCase();
ok(torchWon.includes('black') || torchWon.includes('fire with fire'), 'torch win line is the torch variant');
const crewWon = generateLine('won', { seed: crewDef.seed, town: 'La Ronge', kind: 'crew' }).text.toLowerCase();
ok(crewWon.includes('clear') || crewWon.includes('crews'), 'crew win line is the crew variant');

// Sanity: the register is exported and usable.
ok(typeof VOICE.callsign === 'string' && VOICE.lowFuel > 0, 'VOICE register exported');

if (failures > 0) {
  console.error(`\nverify:voice — ${failures} assertion(s) FAILED`);
  process.exit(1);
}
console.log(`verify:voice — OK. ${ALL.length} synthetic missions; deterministic, place-aware, reactive, slop-free.`);
