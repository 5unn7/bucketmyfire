/*
 * Campaign playthrough verifier — proves every mission is actually completable and that the
 * latched sub-task ledger fills correctly. The engine-agnostic "perfect player" + scenario sims now
 * live in `src/three/missions/oracle.ts` (shared with the future mission factory); this script is
 * the CI HARNESS around it: it drives each mission's `Rig` to completion via `run()` and asserts:
 *
 *   - the mission reaches state 'won' and `verified` (every GOAL sub-task latched done),
 *   - each goal sub-task has a recorded completedAt,
 *   - the event log ends with a 'won' event,
 *   - a no-op / starve run does NOT win (objectives genuinely require action; fails latch),
 *   - the fire-grid cell constants round-trip to their canonical integers (scale-invariance), and
 *   - a mission is completable on a RECTANGULAR (true-shape) map, not only the square.
 *
 * Lives in scripts/ (outside src, so it's not in the production tsc/vite build). Run it with:
 *   npm run verify:campaign
 */
import { FireSystem, fireGridFor, CELL_U } from '../src/three/sim/FireSystem';
import { MissionRuntime } from '../src/three/missions/MissionRuntime';
import { CAMPAIGN } from '../src/three/missions/catalog';
import { run, build, isCompletable } from '../src/three/missions/oracle';
import { generateMission } from '../src/three/missions/factory';
import { MapContext } from '../src/three/missions/factory/MapContext';
import { World } from '../src/three/World';
import { SIZE_CLASS } from '../src/three/missions/scenario';
import type { MissionDef, MissionSignals } from '../src/three/missions/types';
import { WORLD3D, BUCKET3D, FIRE3D } from '../src/three/config';

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

// A signal snapshot that trips EVERY fail kind at once (structures gone, tank dry, time up) with
// fires still burning so no goal is met — used to verify the lost/fail latching deterministically.
function trippingSignals(elapsed: number): MissionSignals {
  return {
    firesActive: 5,
    firesInitial: 5,
    firesDoused: 0,
    structuresAlive: 0,
    structuresTotal: 6,
    crewsDelivered: 0,
    crewsTotal: 0,
    crewsLost: 6, // trips the `rescue` fail too (this snapshot must latch EVERY constraint kind)
    backburnLit: 0,
    elapsed,
    fuel: 0,
    starved: true,
    threat: 1,
    windAngle: 0,
    tally: {
      firesDoused: 0,
      firesBurnedOut: 0,
      firesInitial: 5,
      structuresSaved: 0,
      structuresTotal: 6,
      structuresLost: 6,
      structuresPristine: 0,
      crewsDelivered: 0,
      crewsTotal: 0,
      drops: 0,
      dropsEffective: 0,
      dropsWasted: 0,
      peakThreat: 1,
      peakFireLoad: 5,
      fuelEnd: 0,
      hardLandings: 0,
      crashed: false,
    },
  };
}

// --- Fire-grid scale-invariance guards: the cell-count game constants are authored in world-units /
// area; prove they ROUND-TRIP to their canonical cell integers at CELL_U, and that the rectangular
// grid math holds (square byte-identical, bounds rectangular, oversized maps capped). tsc can't see
// this numeric drift, so a config edit that broke the fire game would slip past the build gate. ---
{
  const sq = new FireSystem({ rng: () => 0.5, groundHeightAt: () => 0, isOverWater: () => false, fuelAt: () => 1, pickSite: () => null });
  ok('grid: canonical cell size is 13.125u', Math.abs(CELL_U - 13.125) < 1e-9, `CELL_U=${CELL_U}`);
  ok(
    'grid: size classes round-trip to {1,2,3,4,6} cells at CELL_U',
    sq.cellsFromU(SIZE_CLASS.spot.radius) === 1 &&
      sq.cellsFromU(SIZE_CLASS.small.radius) === 2 &&
      sq.cellsFromU(SIZE_CLASS.medium.radius) === 3 &&
      sq.cellsFromU(SIZE_CLASS.large.radius) === 4 &&
      sq.cellsFromU(SIZE_CLASS.mega.radius) === 6,
    `[${[SIZE_CLASS.spot, SIZE_CLASS.small, SIZE_CLASS.medium, SIZE_CLASS.large, SIZE_CLASS.mega].map((c) => sq.cellsFromU(c.radius)).join(',')}]`,
  );
  ok('grid: seedRadiusU round-trips to 1 cell', sq.cellsFromU(FIRE3D.seedRadiusU) === 1, `=${sq.cellsFromU(FIRE3D.seedRadiusU)}`);
  const cellArea = CELL_U * CELL_U;
  ok('grid: fullSizeArea round-trips to 46 cells', Math.round(FIRE3D.fullSizeArea / cellArea) === 46, `=${Math.round(FIRE3D.fullSizeArea / cellArea)}`);
  ok('grid: fireArea round-trips to 8 cells', Math.round(FIRE3D.fireArea / cellArea) === 8, `=${Math.round(FIRE3D.fireArea / cellArea)}`);

  const square = fireGridFor(WORLD3D.size, WORLD3D.size);
  ok('grid: square SK is 160×160 byte-identical', square.nx === 160 && square.nz === 160 && Math.abs(square.cellSize - 13.125) < 1e-9, `${square.nx}×${square.nz}@${square.cellSize}`);
  const bounds = fireGridFor(1060, 2058); // bounds-fit SK
  ok('grid: bounds SK is rectangular ~81×157 at the canonical cell', bounds.nx === 81 && bounds.nz === 157 && Math.abs(bounds.cellSize - 13.125) < 1e-9, `${bounds.nx}×${bounds.nz}@${bounds.cellSize}`);
  const big = fireGridFor(3000, 3000); // oversized province → must coarsen to stay within maxCells
  ok('grid: oversized 3000² is capped at ≤maxCells (coarsened cell)', big.nx * big.nz <= FIRE3D.maxCells && big.cellSize > CELL_U, `${big.nx}×${big.nz}=${big.nx * big.nz}@${big.cellSize.toFixed(2)}`);
}

// --- Suppression-math guards: prove dousing actually EXTINGUISHES and that a drop's footprint is
// BOUNDED (a wide fire needs several passes) on a synthetic max-heat cell (flat, fully-fuelled ground).
// Locks the rebalanced douse model: a full dead-on pass clears its disc → fire shrinks ~1–5 buckets. ---
{
  const mk = () => new FireSystem({ rng: () => 0.5, groundHeightAt: () => 0, isOverWater: () => false, fuelAt: () => 1, pickSite: () => null });
  const litres = 100; // a full tank
  // Drop centered exactly ON a grid cell's CENTER (so the test is robust to dropRadius): that cell sees
  // full coverage (t≈0), a cell out near the rim sees almost none. Cell centers sit at
  // -half + (k+0.5)·cellSize; pick the one nearest the origin. Use the REAL grid cell size (CELL_U),
  // not the old stale WORLD3D.size/128 — the grid is 160² now, so cellSize = 13.125u.
  const cellSize = CELL_U;
  const half = WORLD3D.size / 2;
  const cc = -half + (Math.floor(half / cellSize) + 0.5) * cellSize; // a cell center near the origin

  // (a) a dead-on full pass on a h=1.0 cell EXTINGUISHES it — actively bucketing a fire puts it OUT (the
  // cell is driven to 0 and scorch-locks to mud). This is the rebalanced intent (litresToClear=35, hotResist=0.2,
  // extinguishLock): water that lands dead-on clears the core, it doesn't just grind a re-flare residual.
  const a = mk();
  a.igniteAt(cc, cc, 4, 1.0);
  const before = a.heatAt(cc, cc);
  a.douse(cc, cc, BUCKET3D.dropRadius, litres, 1);
  const centerResidual = a.heatAt(cc, cc);
  ok(
    'suppression: dead-on hot cell is EXTINGUISHED in one full pass (dousing is effective)',
    before > 0.9 && centerResidual <= 0.05,
    `before=${before.toFixed(2)} after=${centerResidual.toFixed(2)}`,
  );
  // (b) a drop's footprint is BOUNDED — a cell well OUTSIDE the ~20u disc keeps its full heat while the
  // centre is cleared, so a fire wider than one disc is walked pass by pass (≈1–5 buckets), not deleted map-wide.
  const b = mk();
  b.igniteAt(cc, cc, 8, 1.0); // a wide patch so there are lit cells both inside AND outside the disc
  b.douse(cc, cc, BUCKET3D.dropRadius, litres, 1);
  const atCenter = b.heatAt(cc, cc);
  const outside = b.heatAt(cc + BUCKET3D.dropRadius + 2 * cellSize, cc); // a couple cells beyond the drop radius
  ok(
    'suppression: the drop footprint is bounded — fire outside the disc survives (multi-pass)',
    outside > 0.9 && atCenter <= 0.05,
    `outside=${outside.toFixed(2)} center=${atCenter.toFixed(2)}`,
  );
}

console.log('Campaign playthrough verification\n');
for (const m of CAMPAIGN) {
  // --- Positive: a perfect player drives every goal to completion ---
  const { r, elapsed, addedZones } = run(m, 'play');
  const goals = r.runtime.tasks.filter((t) => t.kind === 'goal');
  const allGoalsDone = goals.every((t) => t.status === 'done' && t.completedAt !== undefined);
  const events = r.runtime.events;
  const ordered = events.every((e, i) => i === 0 || e.at >= events[i - 1].at);
  const lastWon = events.length > 0 && events[events.length - 1].type === 'won';

  ok(`${m.id}: won`, r.runtime.state === 'won', `state=${r.runtime.state} @${elapsed.toFixed(0)}s`);
  ok(`${m.id}: verified — all goals latched with a time`, r.runtime.verified && allGoalsDone);
  ok(`${m.id}: event log ends 'won' and is time-ordered`, lastWon && ordered);
  ok(`${m.id}: score > 0`, r.runtime.score > 0);
  ok(`${m.id}: completion record complete`, r.runtime.completion().subtasks.length === r.runtime.tasks.length && r.runtime.completion().wonAt >= 0);
  // Crew-zone consistency: the sim's zone list must be EXACTLY the opening zones plus the pop-up
  // rescue zones applied — no runtime double-append. Catches the Game-side array-aliasing bug class.
  if (r.crew) {
    const expectedZones = (m.zones?.length ?? 0) + addedZones;
    ok(`${m.id}: crew zones consistent (no runtime double-append)`, r.crew.views.length === expectedZones, `views=${r.crew.views.length} expected=${expectedZones}`);
  }

  const goalSummary = goals.map((t) => `${t.label}=${t.status}@${t.completedAt?.toFixed(0) ?? '-'}s`).join(', ');
  console.log(`  ${r.runtime.state === 'won' ? '✓' : '✗'} ${m.name.padEnd(16)} won@${elapsed.toFixed(0)}s score ${String(r.runtime.score).padStart(6)} | ${goalSummary}`);

  // --- Slice 2: every RENDERED FIRE (cluster centroid — the flame mesh / smoke / light the player sees) must
  // be IN-PROVINCE on a true-shape (bounds-fit) map. The outline mask drops the off-province GROUND but leaves
  // the biome FUEL, and the completability oracle is province-blind (it douses fire wherever it is), so a fire
  // seeded on the lowered fogged plateau passes the win check yet reads as fire burning in the void past the
  // radar's border. The placement guards (fuelPointNear / fireSite isInProvince) walk seed CENTRES inland; this
  // asserts the resulting rendered fires sit on real land. No-op on square maps (isInProvince → true). ---
  {
    const rig = build(m);
    const reps = rig.fire.active();
    const offFires = reps.filter((f) => !rig.world.isInProvince(f.x, f.z));
    ok(`${m.id}: all rendered fires in-province`, offFires.length === 0, `${offFires.length}/${reps.length} fires off-province`);
  }

  // --- Fail-latching: missions WITH constraints must latch lost when a constraint trips ---
  if ((m.fails ?? []).length > 0) {
    const fr = new MissionRuntime(m);
    fr.update(trippingSignals(1));
    const anyFailed = fr.tasks.some((t) => t.kind === 'constraint' && t.status === 'failed');
    const lostEvent = fr.events.some((e) => e.type === 'lost');
    ok(`${m.id}: constraint trips → lost`, fr.state === 'lost' && anyFailed && lostEvent, `state=${fr.state}`);
  }

  // --- Informational: how the mission resolves with NO player action (natural burn-out etc.) ---
  // Drive the STARVE path only for missions that hard-fail on a dry tank (`fuelOut`); else a true
  // no-op. With fuel now universal, `m.fuel` is no longer the selector — the `fuelOut` fail is.
  const hasFuelFail = (m.fails ?? []).some((f) => f.kind === 'fuelOut');
  const passive = run(m, hasFuelFail ? 'starve' : 'noop');
  console.log(`      (no action → ${passive.r.runtime.state} @${passive.elapsed.toFixed(0)}s)`);
}

// --- Rectangular (true-shape) map completability: SK is now itself a bounds-fit, outline-masked
// rectangular world (Slice 2), so this drives a minimal RANDOM-fire extinguish mission straight on
// `saskatchewan` and proves a perfect player wins AND a do-nothing pilot does NOT. It exercises the
// rect fire grid + the in-province fire-seeding guard on a clean isolated scenario (the 8 campaign
// missions cover the authored placements; this covers the random-seed + rectangular-grid path). ---
console.log('\nRectangular-map completability (saskatchewan, true-shape)\n');
{
  const rectProbe: MissionDef = {
    id: 'rect-probe',
    index: 0,
    name: 'Rect Probe',
    brief: 'Headless rectangular-map completability probe.',
    difficulty: 2,
    seed: 4242,
    map: 'saskatchewan',
    fires: [{ at: 'random', count: 3, size: 'medium', minFromOrigin: 120 }],
    objectives: [{ kind: 'extinguishAll' }],
  };
  const res = isCompletable(rectProbe);
  ok('rect map: fires seeded on the bounds world', res.firesInitial > 0, `firesInitial=${res.firesInitial}`);
  ok('rect map: completable by a perfect player', res.win, `state=${res.state} @${res.elapsed.toFixed(0)}s`);
  ok('rect map: a no-op pilot does NOT win (genuine difficulty)', !res.noopWins);
  console.log(`  ${res.win && !res.noopWins ? '✓' : '✗'} saskatchewan win@${res.elapsed.toFixed(0)}s score ${res.score} (firesInitial=${res.firesInitial}, noopWins=${res.noopWins})`);
}

// (The standalone Daily Burn MODE was retired — the province / Open Skies is the one open-world loop. Its
// completability coverage lived on the `extinguish` archetype, which the FACTORY section below still drives
// across 30 seeds, so nothing is lost. The `dailySeed`/`dayNumberUTC` helpers remain as the per-day world
// seed for Open Skies + the province.)

// --- Mission FACTORY (Slice 3): force each archetype across several seeds and prove construct-correctness:
// a perfect player WINS, fires seed + land IN-PROVINCE, and the extinguish-objective archetypes are
// genuinely hard (a no-op pilot can't clear fires that don't self-extinguish). Then exercise the build-time
// MapContext path (hold-the-line targeting a real defensible town). This is the oracle backstop the spec
// wants — generated missions are winnable by construction, asserted offline (never run on a phone). ---
console.log('\nMission factory archetypes\n');
{
  const SEEDS = Array.from({ length: 30 }, (_, i) => 1009 + i * 137); // 30 seeds — wide enough to catch the ~12% off-province render the review found at 6
  for (const id of ['extinguish', 'mop-up', 'hold-the-line']) {
    let win = 0;
    let seeded = 0;
    let offProv = 0;
    let noopWon = 0;
    for (const seed of SEEDS) {
      const def = generateMission({ kind: 'daily', seed, archetypeId: id });
      const res = isCompletable(def);
      if (res.win) win++;
      if (res.firesInitial > 0) seeded++;
      if (res.noopWins) noopWon++;
      const rig = build(def);
      if (rig.fire.active().some((f) => !rig.world.isInProvince(f.x, f.z))) offProv++;
    }
    ok(`factory ${id}: completable on all seeds`, win === SEEDS.length, `${win}/${SEEDS.length}`);
    ok(`factory ${id}: fires seeded on all seeds`, seeded === SEEDS.length, `${seeded}/${SEEDS.length}`);
    ok(`factory ${id}: rendered fires in-province on all seeds`, offProv === 0, `${offProv} seeds off-province`);
    // extinguishAll archetypes can NEVER be won by a no-op (fires don't self-extinguish) → genuine difficulty.
    if (id !== 'hold-the-line') ok(`factory ${id}: a no-op pilot never wins (genuine difficulty)`, noopWon === 0, `noopWon=${noopWon}/${SEEDS.length}`);
    console.log(`  ${win === SEEDS.length && offProv === 0 && seeded === SEEDS.length ? '✓' : '✗'} ${id.padEnd(14)} win ${win}/${SEEDS.length} · inProv ${SEEDS.length - offProv}/${SEEDS.length} · noopWon ${noopWon}/${SEEDS.length}`);
  }
  // Build-time MapContext path: a real World → defensible towns → hold-the-line targets one and stays winnable.
  const w = new World(777, { regionId: 'saskatchewan' });
  const ctx = new MapContext(w);
  ok('factory MapContext: finds ≥1 defensible town', ctx.defensibleTowns().length > 0, `${ctx.defensibleTowns().length}/${ctx.towns.length} towns defensible`);
  const coopDef = generateMission({ kind: 'coop', seed: 777, archetypeId: 'hold-the-line' }, ctx);
  const coopRes = isCompletable(coopDef);
  ok('factory hold-the-line (MapContext town): completable', coopRes.win, `state=${coopRes.state} @${coopRes.elapsed.toFixed(0)}s`);
  console.log(`  ✓ MapContext: ${ctx.defensibleTowns().length} defensible towns; coop hold-the-line win=${coopRes.win}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (failures.length) {
  console.log('\nFailures:');
  for (const f of failures) console.log('  ✗ ' + f);
  process.exit(1);
}
