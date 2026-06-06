/*
 * Coach state-machine gate — the interactive first-flight tutorial (`ui/coach/CoachDirector`) is a PURE
 * machine, so we prove it in Node (no browser) the way verify:campaign proves the sims: drive synthetic
 * signal traces and assert the step sequence. The live overlay/spotlight can't be dogfooded headlessly
 * (the coach is gated OFF under ?qa), so this is the deterministic confidence anchor for the logic.
 *
 *   esbuild scripts/verify-coach.ts --bundle --platform=node --format=esm ... && node ...
 */
import { CoachDirector, type CoachSignals, type CoachState } from '../src/three/ui/coach/CoachDirector';

let pass = 0;
let fail = 0;
const ok = (name: string, cond: boolean, detail = ''): void => {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`);
  }
};

const DT = 1 / 30;
const base: CoachSignals = {
  dt: DT,
  engineStarted: true,
  inBriefing: false,
  frozen: false,
  speed: 0,
  yawRate: 0,
  overWater: false,
  scooping: false,
  water: 0,
  capacity: 80,
  dropping: false,
  firesLeft: 5,
  won: false,
  lost: false,
};

/** Step the director N frames with a fixed signal, return the last state. */
function run(d: CoachDirector, s: CoachSignals, frames: number): CoachState {
  let st: CoachState = { kind: 'inactive' };
  for (let i = 0; i < frames; i++) st = d.update(s);
  return st;
}
const runningId = (st: CoachState): string | null => (st.kind === 'running' ? st.prompt.id : null);

console.log('Coach state-machine gate\n');

// 1) Disabled director is inert forever.
{
  const d = new CoachDirector(false);
  const st = run(d, { ...base, speed: 30 }, 30);
  ok('disabled director stays inactive', st.kind === 'inactive');
}

// 2) Briefing / not-started → inactive (no coaching before the rotors are up).
{
  const d = new CoachDirector(true);
  const a = d.update({ ...base, inBriefing: true });
  const b = d.update({ ...base, engineStarted: false, frozen: true });
  ok('inactive during briefing / pre-engine', a.kind === 'inactive' && b.kind === 'inactive');
}

// 3) A no-op pilot (never moves) sits on step 'fly' and never advances.
{
  const d = new CoachDirector(true);
  const st = run(d, base, 120);
  ok("no-op pilot stuck on 'fly'", runningId(st) === 'fly', `got ${runningId(st)}`);
}

// 4) A perfect-player trace walks the whole loop to complete.
{
  const d = new CoachDirector(true);
  // fly: moving for > hold(0.3s)
  run(d, { ...base, speed: 12 }, 20);
  ok('advanced past fly', runningId(d.update({ ...base, speed: 12 })) !== 'fly');
  // steer: deliberate yaw (or reaching water) — also satisfies; push yaw
  run(d, { ...base, speed: 12, yawRate: 0.4 }, 12);
  // descend: over water + scooping begins
  run(d, { ...base, speed: 4, overWater: true, scooping: true }, 6);
  // fill: bucket fills to full
  run(d, { ...base, overWater: true, scooping: true, water: 80, capacity: 80 }, 6);
  // dropApproach: off water, carrying water, held 0.4s
  run(d, { ...base, speed: 18, overWater: false, water: 80 }, 20);
  // drop: a drop fires
  run(d, { ...base, speed: 14, water: 0, dropping: true }, 4);
  // repeat: at least one fire knocked down (firesLeft < firesAtStart=5)
  const st = run(d, { ...base, water: 0, firesLeft: 4 }, 4);
  ok('perfect player reaches complete', st.kind === 'complete', `ended ${st.kind}/${runningId(st)}`);
}

// 5) Winning the mission outright completes the coach immediately.
{
  const d = new CoachDirector(true);
  run(d, { ...base, speed: 12 }, 5);
  const st = d.update({ ...base, won: true });
  ok('mission win completes the coach', st.kind === 'complete');
}

// 6) skip() jumps straight to inactive and stays there.
{
  const d = new CoachDirector(true);
  run(d, { ...base, speed: 12 }, 5);
  d.skip();
  const st = run(d, { ...base, speed: 12 }, 5);
  ok('skip() makes it inactive', st.kind === 'inactive' && !d.active);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
