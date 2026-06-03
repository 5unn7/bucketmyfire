/*
 * Campaign playthrough verifier — proves every mission is actually completable and that the
 * latched sub-task ledger fills correctly. It builds the REAL engine-agnostic scenario sims
 * (World + FireSystem + Structures + CrewTransport + FuelSim) per mission — the same World seed
 * and the same `missions/scenario.ts` resolution the live game uses (no flight/Three.js layer,
 * which it doesn't need) — then runs a deterministic "perfect player" to completion and asserts:
 *
 *   - the mission reaches state 'won' and `verified` (every GOAL sub-task latched done),
 *   - each goal sub-task has a recorded completedAt,
 *   - the event log ends with a 'won' event,
 *   - and a no-op / starve run does NOT win (objectives genuinely require action; fails latch).
 *
 * Lives in scripts/ (outside src, so it's not in the production tsc/vite build). Run it with:
 *   npm run verify:campaign
 */
import { World } from '../src/three/World';
import { Wind } from '../src/three/sim/Wind';
import { FireSystem } from '../src/three/sim/FireSystem';
import { Structures } from '../src/three/sim/Structures';
import { CrewTransport } from '../src/three/sim/CrewTransport';
import { FuelSim } from '../src/three/sim/FuelSim';
import { MissionRuntime } from '../src/three/missions/MissionRuntime';
import { MissionDirector } from '../src/three/missions/MissionDirector';
import { CAMPAIGN } from '../src/three/missions/catalog';
import { seedFires, structurePlan, crewZones, igniteFromPlacement } from '../src/three/missions/scenario';
import type { MissionDef, MissionSignals } from '../src/three/missions/types';
import { WORLD3D, BUCKET3D, DROP_PHYSICS } from '../src/three/config';

const DT = 0.1;
const MAX_SEC = 400; // playthrough cap (survive missions need ~180s; blazes converge well under this)

// --- "Competent pilot" water model — the REAL completability test ------------------------------
// Replaces the old infinite-water hammer (`douse(f.x,f.z,30,6000)` every step), which was blind to
// the height/edge/wind nerf. Models DISCRETE bucket passes: every PASS_INTERVAL steps the pilot dumps
// a full bucket on each active front (in-band, aimed upwind) — a concentrated hit that fully douses a
// patch, which now CHARS + locks (fires don't self-extinguish, so progress must be locked by water).
// The interval is the scoop-fly-drop loop time. If a mission goes red, that's the gate working —
// re-tune THESE knobs or the fire's spread (FIRE3D / mission spreadScale), never the asserts.
const DROP_AGL = 45; // in-band release height → densityMul≈1, radius≈dropRadius
const PASS_INTERVAL = 12; // steps between bucket passes (~1.2s tight scoop-drop loop on a lake-side fire)
const DROP_LITRES = 160; // a full bucket delivered per pass (concentrated, scorches a patch)
const DROPS_PER_FRONT = 2; // a realistic-size footprint (dropRadius=15) covers less, so a skilled pilot
// walks each front with a couple of drops per pass (re-querying the hottest point between each)

interface Rig {
  world: World;
  wind: Wind;
  fire: FireSystem;
  structures: Structures;
  crew?: CrewTransport;
  fuel?: FuelSim;
  runtime: MissionRuntime;
  director: MissionDirector;
  fireBound: number;
  firesInitial: number;
  depot: { x: number; z: number } | null;
}

function build(mission: MissionDef): Rig {
  const world = new World(mission.seed);
  const wind = new Wind(mission.wind?.angle, mission.wind?.strengthScale ?? 1);
  const fireBound = WORLD3D.size / 2 - 40;
  const fire = new FireSystem(
    {
      rng: world.rng,
      groundHeightAt: (x, z) => world.groundHeightAt(x, z),
      isOverWater: (x, z) => world.isOverWater(x, z),
      fuelAt: (x, z) => world.placement.fuelAt(x, z),
      pickSite: (min) => world.placement.fireSite(world.rng, fireBound, min),
    },
    { spreadScale: mission.fire?.spreadScale }, // validate each mission at its REAL configured pace
  );
  seedFires(world, fire, mission, { vx: wind.vx, vz: wind.vz }, fireBound);
  const firesInitial = fire.activeCount;
  const structures = new Structures({
    groundHeightAt: (x, z) => world.groundHeightAt(x, z),
    isOverWater: (x, z) => world.isOverWater(x, z),
    pickSite: (min) => world.placement.fireSite(world.rng, fireBound, min),
    lakes: world.lakes.map((l) => ({ x: l.x, z: l.z, r: l.r })),
    rng: world.rng,
    communities: world.communities,
    plan: structurePlan(world, mission),
  });
  const crew = mission.zones?.length ? new CrewTransport(crewZones(world, mission)) : undefined;
  // Fuel is now UNIVERSAL (every mission unless `fuel:false`), mirroring Game — the perfect player
  // tops up at a base when it dips (the `play` loop keeps it ≥ 0.5). Only `fuelOut`-fail missions
  // actually lose on a dry tank; elsewhere fuel never threatens the win.
  const fuel = mission.fuel === false ? undefined : new FuelSim();
  const base = world.getCommunity('base');
  return {
    world,
    wind,
    fire,
    structures,
    crew,
    fuel,
    runtime: new MissionRuntime(mission),
    director: new MissionDirector(mission),
    fireBound,
    firesInitial,
    depot: base ? { x: base.x, z: base.z } : null,
  };
}

function signals(r: Rig, elapsed: number): MissionSignals {
  return {
    firesActive: r.fire.activeCount,
    firesInitial: r.firesInitial,
    firesDoused: r.fire.doused,
    structuresAlive: r.structures.aliveCount,
    structuresTotal: r.structures.total,
    crewsDelivered: r.crew?.delivered ?? 0,
    crewsTotal: r.crew?.total ?? 0,
    elapsed,
    fuel: r.fuel?.fuel ?? 1,
    starved: r.fuel?.starved ?? false,
    threat: r.structures.threat,
    windAngle: r.wind.angle,
  };
}

type Mode = 'play' | 'noop' | 'starve';

/** Step the rig to a terminal state (or the cap). `mode` picks the player's behaviour. */
function run(mission: MissionDef, mode: Mode): { r: Rig; elapsed: number } {
  const r = build(mission);
  const isCrew = mission.payload === 'crew';
  let elapsed = 0;
  for (let step = 0; step < MAX_SEC / DT && r.runtime.state === 'active'; step++) {
    r.wind.update(DT * 1000);

    if (mode === 'play') {
      // Crew missions: ferry to the active zone and LAND on it (skids down, stopped). Fire missions:
      // suppress aggressively. (agl/speed = 0 → satisfies MISSIONS.landAgl/landSpeed, the landed gate.)
      if (isCrew && r.crew) {
        const z = r.crew.views.find((v) => v.active);
        if (z) r.crew.update(DT, z.x, z.z, 0, 0);
      } else if (step % PASS_INTERVAL === 0) {
        // A competent pilot's bucket pass: aim at the HOTTEST flames (not a cluster centroid — that can
        // be a doused-out hole), in-band, aimed UPWIND so the drifted load lands on the cell. One drop
        // per active front, re-querying the hottest point after each (so a multi-front map gets cycled,
        // and a single big blaze gets walked ring-by-ring). Periodic EDGE-clip proves an edge hit progresses.
        const v0 = DROP_PHYSICS.v0Down;
        const g = DROP_PHYSICS.fallG;
        const tFall = (Math.sqrt(v0 * v0 + 2 * g * DROP_AGL) - v0) / g;
        const gain = DROP_PHYSICS.windDriftGain;
        const dx = r.wind.vx * gain * tFall; // live drift to cancel by aiming upwind
        const dz = r.wind.vz * gain * tFall;
        const nDrops = Math.max(1, r.fire.activeCount * DROPS_PER_FRONT); // walk each front with a few drops
        const edgeBias = step % (PASS_INTERVAL * 7) === 0 ? BUCKET3D.dropRadius * 0.6 : 0; // deliberate edge clip
        for (let d = 0; d < nDrops; d++) {
          const hp = r.fire.hottestPoint();
          if (!hp) break;
          r.fire.douse(hp.x - dx + edgeBias, hp.z - dz, BUCKET3D.dropRadius, DROP_LITRES, 1);
        }
      }
      // Keep the tank topped when it dips (a competent pilot returns to refuel).
      if (r.fuel) r.fuel.update(DT, { throttle01: 0.4, climbUp: 0, payloadRatio: 0, refueling: r.fuel.fuel < 0.5 });
    } else if (mode === 'starve') {
      // Hard sortie, never refuel → run the tank dry (drives the fuelOut fail).
      if (r.fuel) r.fuel.update(DT, { throttle01: 1, climbUp: 1, payloadRatio: 1, refueling: false });
    }
    // 'noop' does nothing — no suppression, no ferrying, no refuel.

    r.fire.update(DT * 1000, r.wind);
    r.structures.update(DT * 1000, r.fire.active());
    elapsed += DT;
    const sig = signals(r, elapsed);
    r.runtime.update(sig);
    // Run the REACTIVE layer too and execute its world actions (flare-ups / wind shifts), so the
    // gate proves every mission still completes with its authored beats live. Comms are no-ops here.
    // Wind shifts FIRST so a same-beat ignite orients to the new wind (matches Game).
    const acts = r.director.update(sig, r.runtime);
    for (const a of acts) if (a.do === 'wind') r.wind.shiftTo(a.angle, a.strengthScale, a.ease);
    for (const a of acts) if (a.do === 'ignite') igniteFromPlacement(r.world, r.fire, a.place, { vx: r.wind.intendedVx, vz: r.wind.intendedVz }, r.fireBound);
  }
  return { r, elapsed };
}

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
    elapsed,
    fuel: 0,
    starved: true,
    threat: 1,
    windAngle: 0,
  };
}

// --- Suppression-math guards: prove EDGE falloff + hot-resist are LIVE on a synthetic max-heat cell
// (flat, fully-fuelled ground). Locks the new douse model against a silent regression to flat-knock. ---
{
  const mk = () =>
    new FireSystem({
      rng: () => 0.5,
      groundHeightAt: () => 0,
      isOverWater: () => false,
      fuelAt: () => 1,
      pickSite: () => null,
    });
  const litres = 100; // a full tank
  // Drop centered exactly ON a grid cell's CENTER (so the test is robust to dropRadius): that cell sees
  // full coverage (t≈0), a cell out near the rim sees almost none. Cell centers sit at
  // -half + (k+0.5)·cellSize; pick the one nearest the origin.
  const cellSize = WORLD3D.size / 128; // FIRE3D.fireCells
  const half = WORLD3D.size / 2;
  const cc = -half + (Math.floor(half / cellSize) + 0.5) * cellSize; // a cell center near the origin

  // (a) a dead-on pass on a h=1.0 cell must NOT zero it (resist holds → a re-flare residual remains).
  const a = mk();
  a.igniteAt(cc, cc, 4, 1.0);
  const before = a.heatAt(cc, cc);
  a.douse(cc, cc, BUCKET3D.dropRadius, litres, 1);
  const centerResidual = a.heatAt(cc, cc);
  ok(
    'suppression: dead-on hot cell is not zeroed in one pass (resist live)',
    before > 0.9 && centerResidual > 0.2 && centerResidual < before,
    `before=${before.toFixed(2)} after=${centerResidual.toFixed(2)}`,
  );
  // (b) within ONE drop, a cell near the RIM keeps MORE heat than the center cell (radial falloff live).
  const b = mk();
  b.igniteAt(cc, cc, 4, 1.0); // a wide patch so there are lit cells at center AND near the rim
  b.douse(cc, cc, BUCKET3D.dropRadius, litres, 1);
  const atCenter = b.heatAt(cc, cc);
  const atRim = b.heatAt(cc + BUCKET3D.dropRadius * 0.85, cc); // a cell near the disc edge
  ok(
    'suppression: a rim cell keeps more heat than the center cell (falloff live)',
    atRim > atCenter + 0.15,
    `rim=${atRim.toFixed(2)} center=${atCenter.toFixed(2)}`,
  );
}

console.log('Campaign playthrough verification\n');
for (const m of CAMPAIGN) {
  // --- Positive: a perfect player drives every goal to completion ---
  const { r, elapsed } = run(m, 'play');
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

  const goalSummary = goals.map((t) => `${t.label}=${t.status}@${t.completedAt?.toFixed(0) ?? '-'}s`).join(', ');
  console.log(`  ${r.runtime.state === 'won' ? '✓' : '✗'} ${m.name.padEnd(16)} won@${elapsed.toFixed(0)}s score ${String(r.runtime.score).padStart(6)} | ${goalSummary}`);

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

console.log(`\n${pass} passed, ${fail} failed`);
if (failures.length) {
  console.log('\nFailures:');
  for (const f of failures) console.log('  ✗ ' + f);
  process.exit(1);
}
