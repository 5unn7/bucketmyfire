/*
 * Crash / explosion path verifier — pure-sim Node assertions for the crash feature
 * (HelicopterSim.beginCrash/updateCrash + HealthSim's explode gate / overWater cushioning).
 *
 * Both sims are engine-agnostic (they import only three's math + config.ts — no Scene, no DOM), so we
 * bundle them with esbuild and assert the NUMBERS in Node, no browser. This locks the crash physics
 * and the explode gate BEFORE the feature is committed; it does NOT exercise Game's checkHazards/
 * detonate wiring (a tree strike reaching the canopy) — that needs the live headless run, see the
 * recipe in docs/AUDIT-P1P2-HANDOFF.md.
 *
 * Kept SEPARATE from verify-campaign.ts on purpose: the campaign gate's "perfect player never
 * crashes" invariant must stay intact, so the crash path gets its own gate. Lives in scripts/ (outside
 * src → not in the production tsc/vite build). Run with:  npm run verify:crash
 *
 * Asserts only through the PUBLIC surface (altitude/altVel are private): position.y, agl, vertSpeed,
 * crashing, crashLanded, landingImpact for the airframe; health/dead/fatalImpact for the hull. All
 * inputs are derived from the CRASH/HEALTH/FLIGHT config so a re-tune can't silently invalidate them.
 */
import { HelicopterSim } from '../src/three/sim/HelicopterSim';
import { HealthSim } from '../src/three/sim/HealthSim';
import { CRASH, HEALTH, FLIGHT } from '../src/three/config';

const DT = 0.1; // the same fixed step the campaign verifier uses
const EPS = 1e-6;

let pass = 0;
let fail = 0;
const failures: string[] = [];
function ok(name: string, cond: boolean, detail = ''): void {
  if (cond) pass++;
  else {
    fail++;
    failures.push(`${name}${detail ? ' — ' + detail : ''}`);
  }
}

console.log('Crash / explosion path verification\n');

// === (1) Crash fall: beginCrash kicks it down; updateCrash gravity-falls and settles on the floor ===
// FLIGHT.minClearance is the rest height above the floor; with floorY = 0 the wreck settles at y = it.
{
  const FLOOR = 0;
  const settle = FLOOR + FLIGHT.minClearance;
  const h = new HelicopterSim(0, 0); // starts at FLIGHT.startAltitude, well above the floor
  h.bank = 0.25; // a slight lean so the tumble-direction seeding (sign(bank+turnInput)) runs

  ok('crash: not crashing before beginCrash', h.crashing === false && h.crashLanded === false);
  const startY = h.position.y;
  ok('crash: starts airborne above the floor', startY > settle + 1, `y=${startY}`);

  h.beginCrash();
  ok('crash: crashing latches on beginCrash', h.crashing === true);
  ok(
    'crash: an immediate downward kick (vertSpeed <= -initialDrop)',
    h.vertSpeed <= -CRASH.initialDrop + EPS,
    `vertSpeed=${h.vertSpeed.toFixed(3)} initialDrop=${CRASH.initialDrop}`,
  );

  // beginCrash must be idempotent — a second call cannot re-seed the kick (no double drop).
  const vsAfter = h.vertSpeed;
  h.beginCrash();
  ok('crash: beginCrash is idempotent', h.vertSpeed === vsAfter && h.crashing === true);

  // Fall to the deck. Loop EXITS on the first crashLanded (which is how Game reacts), capped so a
  // never-landing regression fails loudly instead of hanging.
  let steps = 0;
  let impactWasZero = true;
  let neverExceedTerminal = true;
  while (!h.crashLanded && steps < 5000) {
    h.updateCrash(DT, FLOOR);
    if (h.landingImpact !== 0) impactWasZero = false; // crash path must never feed the hard-landing model
    if (h.vertSpeed < -CRASH.maxFall - EPS) neverExceedTerminal = false; // capped at terminal sink
    steps++;
  }
  ok('crash: reaches the ground within the cap', h.crashLanded === true && steps < 5000, `steps=${steps}`);
  ok('crash: it actually fell (descended toward the floor)', h.position.y < startY, `y=${h.position.y.toFixed(2)}`);
  ok('crash: settles exactly on the floor', Math.abs(h.position.y - settle) < 1e-4, `y=${h.position.y} want=${settle}`);
  ok('crash: agl resolves to the rest clearance', Math.abs(h.agl - FLIGHT.minClearance) < 1e-4, `agl=${h.agl}`);
  ok('crash: vertical speed arrested at touchdown', Math.abs(h.vertSpeed) < EPS, `vertSpeed=${h.vertSpeed}`);
  ok('crash: never fed the hard-landing model (landingImpact stayed 0)', impactWasZero);
  ok('crash: fall never exceeded terminal sink (-maxFall)', neverExceedTerminal);
}

// === (2) Determinism: the crash fall uses no RNG, so two identical strikes trace identical paths ====
{
  const trace = (): number[] => {
    const h = new HelicopterSim(0, 0);
    h.bank = 0.25;
    h.beginCrash();
    const ys: number[] = [];
    for (let i = 0; i < 60; i++) {
      h.updateCrash(DT, 0);
      ys.push(h.position.y);
    }
    return ys;
  };
  const a = trace();
  const b = trace();
  ok('crash: deterministic fall (byte-identical replays, no hidden RNG)', a.every((y, i) => y === b[i]));
}

// === (3) HealthSim explode gate / overWater cushioning / toughness rules ============================
// severity ramps 0→1 across [hardLandingSink … fatalSink]; >= explodeSeverity on the GROUND = explode.
const span = HEALTH.fatalSink - HEALTH.hardLandingSink;
const explodeImpact = HEALTH.hardLandingSink + HEALTH.explodeSeverity * span; // exactly at the threshold
const dentImpact = HEALTH.hardLandingSink + 0.25 * span; // a survivable hard landing (severity 0.25)
const safeImpact = HEALTH.hardLandingSink - 2; // below the safe-settle line → no damage at all

{
  // A gentle-enough arrival does nothing.
  const hs = new HealthSim(1);
  hs.update(DT, { impact: safeImpact, repairing: false });
  ok('health: a soft touchdown does no damage', hs.health === 1 && !hs.dead && !hs.fatalImpact);
}
{
  // A survivable hard landing dents (no explosion), divided by toughness.
  const hs = new HealthSim(1);
  hs.update(DT, { impact: dentImpact, repairing: false });
  ok('health: a survivable hard landing dents but does not explode', hs.health < 1 && !hs.dead && !hs.fatalImpact, `health=${hs.health.toFixed(3)}`);
}
{
  // On the GROUND, severity >= explodeSeverity is unsurvivable — destroyed outright, fatalImpact latches.
  const hs = new HealthSim(1);
  hs.update(DT, { impact: explodeImpact, repairing: false, overWater: false });
  ok('health: a ground slam past the explode threshold detonates', hs.health === 0 && hs.dead && hs.fatalImpact);
}
{
  // The SAME slam on the WATER floor (a scoop) is cushioned — it can dent, but never explodes.
  const hs = new HealthSim(1);
  hs.update(DT, { impact: explodeImpact, repairing: false, overWater: true });
  ok('health: the same slam over water never explodes (cushioned)', !hs.dead && !hs.fatalImpact && hs.health < 1, `health=${hs.health.toFixed(3)}`);
}
{
  // Toughness must NOT save you from a vertical slam — the explode gate ignores it.
  const tank = new HealthSim(5);
  tank.update(DT, { impact: explodeImpact, repairing: false, overWater: false });
  ok('health: toughness does not save you from the explode gate', tank.health === 0 && tank.dead && tank.fatalImpact);
}
{
  // fatalImpact is a one-shot — it clears the frame after the detonation (still dead, health 0).
  const hs = new HealthSim(1);
  hs.update(DT, { impact: explodeImpact, repairing: false, overWater: false });
  hs.update(DT, { impact: 0, repairing: false });
  ok('health: fatalImpact is a one-shot (clears next frame)', hs.fatalImpact === false && hs.dead && hs.health === 0);
}
{
  // Toughness DOES soften a survivable dent — a tougher hull keeps more health from the same landing.
  const tough = new HealthSim(5);
  const frail = new HealthSim(1);
  tough.update(DT, { impact: dentImpact, repairing: false });
  frail.update(DT, { impact: dentImpact, repairing: false });
  ok('health: toughness divides a survivable dent', tough.health > frail.health, `tough=${tough.health.toFixed(3)} frail=${frail.health.toFixed(3)}`);
}
{
  // Repairing at a base heals and tallies no damage.
  const hs = new HealthSim(1);
  hs.update(DT, { impact: dentImpact, repairing: false }); // dent first
  const dented = hs.health;
  hs.update(DT, { impact: 0, repairing: true });
  ok('health: repairing at a base heals', hs.health > dented && hs.health <= 1, `dented=${dented.toFixed(3)} healed=${hs.health.toFixed(3)}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (failures.length) {
  console.log('\nFailures:');
  for (const f of failures) console.log('  ✗ ' + f);
  process.exit(1);
}
