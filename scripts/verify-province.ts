/*
 * Living Province verifier — proves the open-world dispatch layer is DETERMINISTIC, ESCALATES, stays
 * IN-PROVINCE, and is FAIR (can't collapse before the floor; a no-answer pilot is eventually overrun; a
 * perfect pilot holds). The dispatch logic is engine-agnostic (numbers only), so — like verify-campaign —
 * it bundles cleanly into Node and asserts the real sims, no browser. It reuses the mission ORACLE's
 * `build()` to grow the SAME seeded World + FireSystem the game builds, then drives the DispatchDirector
 * and folds events into the ProvinceState exactly as ProvinceMode does in Game.
 *
 * Run it with:  npm run verify:province
 */
import { build } from '../src/three/missions/oracle';
import { igniteFromPlacement } from '../src/three/missions/scenario';
import { DispatchDirector, type DispatchTown, type DispatchEvent } from '../src/three/province/DispatchDirector';
import { OnboardingScript } from '../src/three/province/OnboardingScript';
import { ProvinceMode, type ShiftResult } from '../src/three/province/ProvinceMode';
import { ProvinceState, shiftGrade, type ProvinceSignals } from '../src/three/province/ProvinceState';
import { buildProvince, provinceTownRefs } from '../src/three/province/buildProvince';
import { buildShiftRecord, type ShiftSummary } from '../src/three/province/career';
import { PROVINCE_COPY } from '../src/three/province/strings';
import { PROVINCE } from '../src/three/config';

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

// A fixed UTC day so the province seed (dailySeed) is reproducible across runs of the gate.
const FIXED_DAY = new Date('2026-06-08T12:00:00Z');
const HORIZON = 600; // shift seconds to probe (≈ one peak-weather climb)

// ── Build the province def + the real seeded world/fire rig (the oracle grows what the game grows) ──
const def = buildProvince(FIXED_DAY, 'saskatchewan');
const rig = build(def);

ok('def is living + endless + fly-free', def.living === true && def.endless === true && def.fuel === false);
ok('def survive objective never met (runtime never ends)', def.objectives.some((o) => o.kind === 'survive' && (o.seconds ?? 0) > 1e6));
ok('town cabins built on the real world', rig.structures.total >= 10, `total=${rig.structures.total}`);

// Resolve the protectable towns off the built world (the cabins above sit at these anchors) — the director's targets.
const towns: DispatchTown[] = provinceTownRefs('saskatchewan')
  .map((ref) => {
    const c = rig.world.getCommunity(ref);
    return c ? { ref, name: c.name, x: c.x, z: c.z } : null;
  })
  .filter((t): t is DispatchTown => t !== null);
ok('province town anchors resolve on the world', towns.length >= 4, `resolved=${towns.length}/${provinceTownRefs('saskatchewan').length}`);

// Pin the wind DETERMINISTICALLY for placement resolution. The oracle's `Wind` is a pure fn of (seed,
// WALL-CLOCK), so reading `rig.wind.vx/vz` makes the gate flaky: a town-threat fire is offset UPWIND of the
// town (scenario.ts), so the live wind's drift swings a border town's fire on/off the province edge between
// runs. A fixed seed-derived vector keeps the schedule's in-province guarantee reproducible.
const wphase = (def.seed % 360) * (Math.PI / 180);
const GATE_WIND = { vx: Math.cos(wphase), vz: Math.sin(wphase) };

// ── 1. FWI escalation curve: monotonic, in [0,1], climbs to 1 by the peak ──
{
  const d = new DispatchDirector(def.seed, towns);
  let mono = true;
  let prev = -1;
  for (let t = 0; t <= PROVINCE.fwiPeakSec * 2; t += 10) {
    const f = d.fwi(t);
    if (f < -1e-9 || f > 1 + 1e-9 || f < prev - 1e-9) mono = false;
    prev = f;
  }
  ok('FWI is monotonic in [0,1]', mono);
  ok('FWI starts low', d.fwi(0) < 0.05);
  ok('FWI reaches peak by fwiPeakSec', d.fwi(PROVINCE.fwiPeakSec) > 0.99 && d.fwi(PROVINCE.fwiPeakSec * 2) === 1);
}

// ── 2. Determinism: frame-rate independent (fine vs coarse stepping) + seed-keyed ──
function runSeq(seed: number, step: number): string[] {
  const d = new DispatchDirector(seed, towns);
  const ids: string[] = [];
  const push = (es: ReturnType<DispatchDirector['update']>): void => {
    for (const e of es) ids.push(`${e.id}@${e.bornAt.toFixed(2)}:${e.kind}:${e.townRef ?? ''}`);
  };
  for (let t = step; t < HORIZON; t += step) push(d.update(t));
  push(d.update(HORIZON)); // settle BOTH step sizes at exactly the same final clock (no boundary straggler)
  return ids;
}
const fine = runSeq(def.seed, 0.1);
const coarse = runSeq(def.seed, 7);
ok('dispatch schedule is frame-rate independent', JSON.stringify(fine) === JSON.stringify(coarse), `fine=${fine.length} coarse=${coarse.length}`);
ok('same seed → identical sequence', JSON.stringify(runSeq(def.seed, 1)) === JSON.stringify(runSeq(def.seed, 1)));
ok('different seed → different sequence', JSON.stringify(runSeq(def.seed, 1)) !== JSON.stringify(runSeq((def.seed ^ 0x1234) >>> 0, 1)));

// ── 3. A BOUNDED shift: exactly `shiftCalls` calls then quiet, cadence accelerating toward the end ──
{
  const all = runSeq(def.seed, 0.5).map((s) => parseFloat(s.split('@')[1]));
  ok('a shift issues exactly shiftCalls calls then goes quiet', all.length === PROVINCE.shiftCalls, `n=${all.length} cap=${PROVINCE.shiftCalls}`);
  ok('first call near firstCallSec', all.length > 0 && Math.abs(all[0] - PROVINCE.firstCallSec) < 1);
  const firstGap = all[1] - all[0];
  const lastGap = all[all.length - 1] - all[all.length - 2];
  ok('cadence accelerates (later calls come faster)', lastGap < firstGap, `first=${firstGap.toFixed(1)} last=${lastGap.toFixed(1)}`);
}

// ── 4. No off-province ignitions: every event placement resolves onto real in-province land ──
{
  const d = new DispatchDirector(def.seed, towns);
  let lit = 0;
  for (let t = 1; t <= HORIZON; t += 1) {
    for (const e of d.update(t)) {
      igniteFromPlacement(rig.world, rig.fire, e.place, GATE_WIND, rig.fireBoundX, rig.fireBoundZ);
      lit++;
    }
  }
  const off = rig.fire.active().filter((f) => !rig.world.isInProvince(f.x, f.z));
  ok('dispatch fires light (placements resolve)', lit === PROVINCE.shiftCalls, `lit=${lit}`);
  ok('no fire ignites off-province', off.length === 0, `off=${off.length}`);
}

// ── 5. Fairness: a no-answer pilot can't collapse before the floor, but IS eventually overrun ──
// Mirror the ProvinceMode loop with DispatchDirector + ProvinceState directly so the gate controls the
// "answered" signal (douses). No-answer → doused stays 0, structures intact.
function shift(answer: 'none' | 'perfect', maxSec: number): { firstStandDownAt: number; minHealth: number; everStandDown: boolean } {
  const d = new DispatchDirector(def.seed, towns);
  const st = new ProvinceState(towns.map((t) => t.ref));
  let issued = 0;
  let firstStandDownAt = -1;
  let minHealth = 1;
  for (let t = 1; t <= maxSec; t += 1) {
    for (const e of d.update(t)) {
      st.add(e);
      issued++;
    }
    const s: ProvinceSignals = {
      shiftElapsed: t,
      doused: answer === 'perfect' ? issued : 0, // perfect → every issued call gets a douse credited (held); none → nothing answered
      dropsEffective: 0,
      structuresAlive: rig.structures.total,
      structuresTotal: rig.structures.total,
    };
    st.update(s);
    minHealth = Math.min(minHealth, st.health);
    if (firstStandDownAt < 0 && st.standDown(t)) firstStandDownAt = t;
  }
  return { firstStandDownAt, minHealth, everStandDown: firstStandDownAt >= 0 };
}
{
  const none = shift('none', 600);
  ok('no-answer pilot is NOT stood down before the fairness floor', none.firstStandDownAt < 0 || none.firstStandDownAt >= PROVINCE.minShiftSec, `firstStandDownAt=${none.firstStandDownAt}`);
  ok('no-answer pilot is eventually overrun', none.everStandDown, `health floor=${none.minHealth.toFixed(2)}`);

  const perfect = shift('perfect', 600);
  ok('perfect pilot holds the province (never stood down)', !perfect.everStandDown, `firstStandDownAt=${perfect.firstStandDownAt}`);
  ok('perfect pilot keeps province health high', perfect.minHealth > 0.9, `minHealth=${perfect.minHealth.toFixed(2)}`);
}

// ── 6. Town status under CONCURRENT calls: answering one of two calls on a town keeps it threatened ──
// (Regression lock for the peak-weather bug where a single douse wrongly cleared a town still under a
// second open call; and a damaged town must never un-damage when a later call is answered.)
{
  const st = new ProvinceState(['weyakwin']);
  const mkCall = (id: string): DispatchEvent => ({
    id,
    kind: 'townThreat',
    bornAt: 0,
    severity: 0.5,
    townRef: 'weyakwin',
    townName: 'Weyakwin',
    place: { at: 'nearCommunity', community: 'weyakwin', size: 'medium' },
    actions: [],
  });
  st.add(mkCall('a'));
  st.add(mkCall('b'));
  ok('two town-threat calls mark the town threatened', st.statusOf('weyakwin') === 'threatened');
  // Answer ONE call (doused rises by 1) → the town must STAY threatened (a second call is still open).
  st.update({ shiftElapsed: 5, doused: 1, dropsEffective: 0, structuresAlive: 10, structuresTotal: 10 });
  ok('answering one of two calls keeps the town threatened', st.statusOf('weyakwin') === 'threatened', `status=${st.statusOf('weyakwin')}`);
  // Answer the second → now clear to standing.
  st.update({ shiftElapsed: 6, doused: 2, dropsEffective: 0, structuresAlive: 10, structuresTotal: 10 });
  ok('answering the last call clears the town to standing', st.statusOf('weyakwin') === 'standing', `status=${st.statusOf('weyakwin')}`);
}

// ── 7. Onboarding arc: a NEW pilot's first shift teaches scoop→drop→protect, is COMPLETABLE for both a
//      perfect AND a do-nothing pilot (no soft-lock), lights in-province, and hands off to the open regime. ──
function runOnboarding(answerMode: 'perfect' | 'none'): { events: DispatchEvent[]; doneAt: number } {
  const ob = new OnboardingScript(def.seed, towns);
  const events: DispatchEvent[] = [];
  let doneAt = -1;
  let answered = 0;
  for (let t = 0; t <= 300 && doneAt < 0; t += 1) {
    for (const e of ob.update(t, answered)) events.push(e);
    if (answerMode === 'perfect') answered = events.length; // each issued teaching call is knocked down at once
    if (ob.done) doneAt = t;
  }
  return { events, doneAt };
}
{
  const perfect = runOnboarding('perfect');
  ok('onboarding teaches a fixed 3-beat arc', perfect.events.length === 3, `n=${perfect.events.length}`);
  ok('onboarding opens with a scoop→drop spot fire', perfect.events[0]?.id === 'onb-0' && perfect.events[0]?.kind === 'spotFire');
  ok('onboarding ends on a protect-a-town call', perfect.events[2]?.kind === 'townThreat' && !!perfect.events[2]?.townRef);
  ok('a perfect pilot finishes onboarding fast', perfect.doneAt >= 0 && perfect.doneAt < 20, `doneAt=${perfect.doneAt}`);

  const idle = runOnboarding('none');
  const idleCap = PROVINCE.onboardFirstSec + 2 * PROVINCE.onboardMaxWaitSec + 2;
  ok('a do-nothing pilot still completes onboarding (no soft-lock)', idle.doneAt >= PROVINCE.onboardFirstSec && idle.doneAt <= idleCap, `doneAt=${idle.doneAt}`);

  // Every onboarding fire resolves onto real in-province land. Use a FRESH rig so this checks ONLY the
  // onboarding placements (cluster:'lake' + nearCommunity, both deterministic + fuel-snapped) — the shared
  // rig is polluted by the open schedule's `at:'random'` bush fires, whose placement is non-deterministic
  // and can land off-province (a pre-existing latent issue the gate's §4 flakily catches; out of scope here).
  const obRig = build(def);
  for (const e of perfect.events) igniteFromPlacement(obRig.world, obRig.fire, e.place, GATE_WIND, obRig.fireBoundX, obRig.fireBoundZ);
  ok('onboarding fires light in-province', obRig.fire.active().length > 0 && obRig.fire.active().every((f) => obRig.world.isInProvince(f.x, f.z)));

  // Handoff: the open director, started at the elapsed clock, doesn't dump the calls it "missed" during
  // teaching — its first open call lands a grace (firstCallSec) AFTER the handoff time.
  const handoffAt = 90;
  const open = new DispatchDirector(def.seed, towns, handoffAt);
  let first = -1;
  for (let t = handoffAt; t < handoffAt + 200 && first < 0; t += 0.5) {
    const es = open.update(t);
    if (es.length) first = es[0].bornAt;
  }
  ok('open regime begins a grace after the onboarding handoff', Math.abs(first - (handoffAt + PROVINCE.firstCallSec)) < 1, `first=${first} expected≈${handoffAt + PROVINCE.firstCallSec}`);
}

// ── 8. ProvinceMode onboarding integration: hands off EXACTLY once, the open schedule begins only AFTER
//      teaching, and the capstone comms is DEFERRED to ride the first open call (not stacked on beat 2). ──
{
  const pm = new ProvinceMode(def.seed, towns, true); // onboarding
  let onboardedCount = 0;
  let handoffAt = -1;
  let capstoneAt = -1;
  for (let t = 0; t <= 200; t += 1) {
    const u = pm.update({ shiftElapsed: t, doused: 0, dropsEffective: 0, structuresAlive: 10, structuresTotal: 10 }); // idle pilot
    if (u.justOnboarded) {
      onboardedCount++;
      if (handoffAt < 0) handoffAt = t;
    }
    if (capstoneAt < 0 && u.actions.some((a) => a.do === 'comms' && a.text === PROVINCE_COPY.onbHandoff)) capstoneAt = t;
  }
  ok('ProvinceMode hands off exactly once', onboardedCount === 1, `count=${onboardedCount}`);
  ok('onboarding hands off after the teaching window opens', handoffAt > PROVINCE.onboardFirstSec, `handoffAt=${handoffAt}`);
  ok('the handoff capstone is deferred to the first open call', capstoneAt > handoffAt, `capstone=${capstoneAt} handoff=${handoffAt}`);
}

// ── 8b. The ACHIEVEMENT loop: a competent pilot COMPLETES the bounded shift (a graded WIN); a no-answer
//       pilot is overrun (a D loss); the grade thresholds hold. Drives ProvinceMode like Game does. ──
{
  const sig = (t: number, doused: number): ProvinceSignals => ({ shiftElapsed: t, doused, dropsEffective: 0, structuresAlive: rig.structures.total, structuresTotal: rig.structures.total });

  // Perfect pilot: every issued call knocked down at once (doused always exceeds the quota).
  const win = new ProvinceMode(def.seed, towns, false);
  let winRes: ShiftResult | null = null;
  let completeAt = -1;
  for (let t = 1; t <= HORIZON && completeAt < 0; t += 1) {
    if (win.update(sig(t, t * 1000)).justComplete) {
      completeAt = t;
      winRes = win.shiftResult();
    }
  }
  ok('a competent pilot COMPLETES the bounded shift', completeAt > 0, `completeAt=${completeAt}`);
  ok('the shift caps at shiftCalls', winRes !== null && winRes.callsTotal === PROVINCE.shiftCalls, `callsTotal=${winRes?.callsTotal}`);
  ok('a completed shift is a WIN graded S/A', winRes !== null && winRes.completed && (winRes.grade === 'S' || winRes.grade === 'A'), `grade=${winRes?.grade}`);

  // No-answer pilot: overrun → stood down (a loss), graded D.
  const loss = new ProvinceMode(def.seed, towns, false);
  let lossRes: ShiftResult | null = null;
  let stoodAt = -1;
  for (let t = 1; t <= HORIZON && stoodAt < 0; t += 1) {
    if (loss.update(sig(t, 0)).justStoodDown) {
      stoodAt = t;
      lossRes = loss.shiftResult();
    }
  }
  ok('a no-answer pilot is overrun (stood down past the floor)', stoodAt >= PROVINCE.minShiftSec, `stoodAt=${stoodAt}`);
  ok('an overrun shift is a LOSS graded D', lossRes !== null && !lossRes.completed && lossRes.grade === 'D', `grade=${lossRes?.grade}`);

  // Grade thresholds (pure).
  ok('shiftGrade: flawless → S', shiftGrade(12, 12, 5, 5, 1, false) === 'S');
  ok('shiftGrade: overrun → D regardless', shiftGrade(12, 12, 5, 5, 1, true) === 'D');
  ok('shiftGrade: middling → B/C', ['B', 'C'].includes(shiftGrade(8, 12, 4, 5, 0.6, false)));
  ok('shiftGrade: nothing held → D', shiftGrade(0, 12, 0, 5, 0.2, false) === 'D');
}

// ── 8c. Open Skies vs Solo — the SHARED province is ENDLESS (the dispatch never exhausts, the run never
//        auto-completes), while a SOLO round is the BOUNDED shift (limited calls → "shift complete"). ──
{
  const sigE = (t: number, doused: number): ProvinceSignals => ({ shiftElapsed: t, doused, dropsEffective: 0, structuresAlive: rig.structures.total, structuresTotal: rig.structures.total });

  // An endless director keeps emitting calls well past `shiftCalls` and never reports `exhausted`.
  const dEndless = new DispatchDirector(def.seed, towns, 0, true);
  let issued = 0;
  for (let t = 1; t <= HORIZON * 4; t += 1) issued += dEndless.update(t).length;
  ok('Open Skies dispatch is endless (issues well past shiftCalls)', issued > PROVINCE.shiftCalls * 2, `issued=${issued} cap=${PROVINCE.shiftCalls}`);
  ok('an endless director never reports exhausted', !dEndless.exhausted, `issued=${issued}`);

  // The same seed/clock under the BOUNDED (solo) director stops at exactly the quota — the contrast that
  // proves the endless flag is what lifts the cap (not a seed/town difference).
  const dBounded = new DispatchDirector(def.seed, towns, 0, false);
  let boundedIssued = 0;
  for (let t = 1; t <= HORIZON * 4; t += 1) boundedIssued += dBounded.update(t).length;
  ok('a SOLO (bounded) director stops at shiftCalls', boundedIssued === PROVINCE.shiftCalls && dBounded.exhausted, `issued=${boundedIssued}`);

  // Endless ProvinceMode (shared Open Skies): a perfect pilot is NEVER handed "shift complete" — no reset.
  const openSkies = new ProvinceMode(def.seed, towns, false, true);
  let everComplete = false;
  for (let t = 1; t <= HORIZON * 2; t += 1) if (openSkies.update(sigE(t, t * 1000)).justComplete) everComplete = true;
  ok('Open Skies never auto-completes (endless — no reset)', !everComplete && !openSkies.completed);
}

// ── 9. Career season-log record shaping (PURE — the store's localStorage path is browser-only) ──
{
  const sum: ShiftSummary = { region: 'saskatchewan', reputation: 1234.6, grade: 'A', completed: true, callsHeld: 9, callsTotal: 12, townsStanding: 5, townsTotal: 7 };
  const rec = buildShiftRecord(sum, 20300);
  ok('career record carries region + day + grade', rec.region === 'saskatchewan' && rec.day === 20300 && rec.grade === 'A');
  ok('career record rounds reputation', rec.reputation === 1235, `rep=${rec.reputation}`);
  ok('career record passes the tally + outcome through', rec.completed === true && rec.callsHeld === 9 && rec.callsTotal === 12 && rec.townsStanding === 5 && rec.townsTotal === 7);
  const neg = buildShiftRecord({ region: 'x', reputation: -50, grade: 'D', completed: false, callsHeld: -3, callsTotal: -1, townsStanding: -1, townsTotal: 0 }, 1);
  ok('career record clamps negatives + carries the loss', neg.reputation === 0 && neg.callsHeld === 0 && neg.callsTotal === 0 && neg.townsStanding === 0 && neg.completed === false);
}

// ── Summary ──
console.log(`\nLiving Province gate: ${pass} passed, ${fail} failed`);
if (fail) {
  console.log('\nFailures:');
  for (const f of failures) console.log('  ✗ ' + f);
  process.exit(1);
}
console.log('  ✓ deterministic · escalating · in-province · fair');
