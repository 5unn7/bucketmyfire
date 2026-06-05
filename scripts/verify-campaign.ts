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
import { CrewTransport, CrewZone } from '../src/three/sim/CrewTransport';
import { Backburn } from '../src/three/sim/Backburn';
import { FuelSim } from '../src/three/sim/FuelSim';
import { MissionRuntime } from '../src/three/missions/MissionRuntime';
import { MissionDirector } from '../src/three/missions/MissionDirector';
import { CAMPAIGN } from '../src/three/missions/catalog';
import { buildDailyMission, dailyMissionId } from '../src/three/missions/daily';
import { seedFires, structurePlan, crewZones, resolveCrewZone, igniteFromPlacement, backburnLine } from '../src/three/missions/scenario';
import type { MissionDef, MissionSignals } from '../src/three/missions/types';
import { WORLD3D, BUCKET3D, DROP_PHYSICS, SCORE, MISSIONS } from '../src/three/config';

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
const BACKBURN_PASS = 8; // steps between lighting successive control-line segments (idealised fly-the-line)

interface Rig {
  world: World;
  wind: Wind;
  fire: FireSystem;
  structures: Structures;
  crew?: CrewTransport;
  // The SAME array Game holds (`Game.crewZones`) and feeds into CrewTransport — held here so the
  // verifier mirrors Game's exact crew-array handling: on an `addZone` beat it pushes to BOTH this
  // and `crew.addZone`, just like Game. With CrewTransport's defensive copy this is correct; if that
  // copy were ever removed (re-aliasing the arrays), the double-append would inflate `crew.views`
  // and trip the post-run consistency assertion below — so this whole bug CLASS is caught headlessly.
  crewZonesRef?: CrewZone[];
  backburn?: Backburn; // the backburn control line (torch missions) — laid by the perfect player below
  fuel?: FuelSim;
  runtime: MissionRuntime;
  director: MissionDirector;
  fireBound: number;
  firesInitial: number;
  depot: { x: number; z: number } | null;
}

function build(mission: MissionDef): Rig {
  // Build the SAME world the game builds: pass the mission's map (region) + name pins. Without the
  // regionId the verifier would grow a NON-anchored world while the game grows the anchored one —
  // the completability gate would test a different map than ships. (Anchored-placement parity.)
  const world = new World(mission.seed, { regionId: mission.map, pins: mission.places, homeBase: mission.homeBase });
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
  // Hold the resolved crew-zone array (as Game holds `this.crewZones`) and feed THE SAME array into
  // CrewTransport — mirroring Game's exact handling so the addZone path is faithfully modelled.
  const crewZonesRef = mission.zones?.length ? crewZones(world, mission) : undefined;
  const crew = crewZonesRef ? new CrewTransport(crewZonesRef, mission.startLoaded ?? false) : undefined;
  // Fuel is now UNIVERSAL (every mission unless `fuel:false`), mirroring Game — the perfect player
  // tops up at a base when it dips (the `play` loop keeps it ≥ 0.5). Only `fuelOut`-fail missions
  // actually lose on a dry tank; elsewhere fuel never threatens the win.
  const fuel = mission.fuel === false ? undefined : new FuelSim();
  // The backburn control line (torch missions) — resolved through the SAME scenario code the game uses.
  const backburnPts = backburnLine(world, mission, { vx: wind.vx, vz: wind.vz });
  const backburn = backburnPts.length ? new Backburn(backburnPts) : undefined;
  const base = world.getCommunity('base');
  return {
    world,
    wind,
    fire,
    structures,
    crew,
    crewZonesRef,
    backburn,
    fuel,
    runtime: new MissionRuntime(mission),
    director: new MissionDirector(mission),
    fireBound,
    firesInitial,
    depot: base ? { x: base.x, z: base.z } : null,
  };
}

function signals(r: Rig, elapsed: number): MissionSignals {
  // The perfect player flies clean: every fire water-killed with an on-target drop, no hard landings,
  // no crash — so the score tally mirrors the rig's real state with idealised precision/handling.
  const saved = r.structures.aliveCount;
  const pristine = r.structures.list.reduce((n, s) => n + (s.health >= SCORE.pristineHealth ? 1 : 0), 0);
  const doused = r.fire.doused;
  return {
    firesActive: r.fire.activeCount,
    firesInitial: r.firesInitial,
    firesDoused: doused,
    structuresAlive: r.structures.aliveCount,
    structuresTotal: r.structures.total,
    crewsDelivered: r.crew?.delivered ?? 0,
    crewsTotal: r.crew?.total ?? 0,
    crewsLost: r.crew?.lostCount ?? 0,
    backburnLit: r.backburn?.lit ?? 0,
    elapsed,
    fuel: r.fuel?.fuel ?? 1,
    starved: r.fuel?.starved ?? false,
    threat: r.structures.threat,
    windAngle: r.wind.angle,
    tally: {
      firesDoused: doused,
      firesBurnedOut: r.fire.burnedOut,
      firesInitial: r.firesInitial,
      structuresSaved: saved,
      structuresTotal: r.structures.total,
      structuresLost: r.structures.total - saved,
      structuresPristine: pristine,
      crewsDelivered: r.crew?.delivered ?? 0,
      crewsTotal: r.crew?.total ?? 0,
      drops: doused,
      dropsEffective: doused,
      dropsWasted: 0,
      peakThreat: r.structures.threat,
      peakFireLoad: r.firesInitial,
      fuelEnd: r.fuel?.fuel ?? 1,
      hardLandings: 0,
      crashed: false,
    },
  };
}

type Mode = 'play' | 'noop' | 'starve';

/** Step the rig to a terminal state (or the cap). `mode` picks the player's behaviour. */
function run(mission: MissionDef, mode: Mode): { r: Rig; elapsed: number; addedZones: number } {
  const r = build(mission);
  // Whether the pilot can put water on fire this mission: a pure-crew sortie carries NO bucket, so
  // the perfect player must NOT douse (its fires can only be outrun / threaten structures). A mixed
  // crew+water sortie lists 'water' among its loadouts → the player re-rigs and can douse.
  const loadouts = mission.loadouts?.length ? mission.loadouts : [mission.payload ?? 'water'];
  const canWater = loadouts.includes('water');
  let elapsed = 0;
  let addedZones = 0; // count of pop-up rescue zones actually applied (for the consistency assertion)
  for (let step = 0; step < MAX_SEC / DT && r.runtime.state === 'active'; step++) {
    r.wind.update(DT * 1000);

    if (mode === 'play') {
      // The perfect player does BOTH jobs the mission demands (a MIXED crew+water sortie re-rigs at
      // base; here we idealise the swap away and prove the objectives are jointly satisfiable in time):
      // ferry any pending crew by LANDING on the active zone (skids down, stopped → the landed gate),
      // AND suppress fires with discrete bucket passes. Pure-crew missions have no fires; pure-water
      // missions have no crew — so each half no-ops where it doesn't apply.
      if (r.crew) {
        const z = r.crew.views.find((v) => v.active);
        // A HOVER zone is satisfied by an airborne hold (agl in the hover band); a normal zone by skids down
        // (agl 0). Model whichever the active zone wants so a hover-training drop actually completes here.
        if (z) r.crew.update(DT, z.x, z.z, z.hover ? (MISSIONS.landAgl + MISSIONS.hoverAglMax) / 2 : 0, 0);
      }
      if (canWater && r.fire.activeCount > 0 && step % PASS_INTERVAL === 0) {
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
      // BACKBURN: the perfect player flies the control line and torches each segment in turn — the
      // idealised "fly to the next marker, light it" (mirrors Game lighting + seeding a real backfire,
      // via the SAME Backburn tracker + igniteAt). Laying the whole line meets the `backburn` objective;
      // the head can't be doused (no water this sortie), so the win is the lay, won before it arrives.
      if (r.backburn && !r.backburn.complete && step % BACKBURN_PASS === 0) {
        const next = r.backburn.views.find((p) => !p.lit);
        if (next) {
          const lit = r.backburn.tryLight(next.x, next.z, MISSIONS.torchLightRadius);
          if (lit) r.fire.igniteAt(lit.x, lit.z, MISSIONS.torchIgniteRadius, MISSIONS.torchIgniteHeat);
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
    // Parity with Game: a trapped family the fire overruns is lost (drives the `rescue` fail). Running
    // it here proves the perfect player rescues everyone in time — if a mission's spread could overrun a
    // family before the optimal route reaches them, this gate goes red (re-tune CRASH/casualtyGrace, not the assert).
    if (r.crew) r.crew.checkCasualties((x, z) => r.fire.heatAt(x, z), DT);
    elapsed += DT;
    let sig = signals(r, elapsed);
    // Run the REACTIVE layer and execute its world actions (flare-ups / wind shifts / pop-up rescues)
    // BEFORE the runtime's win-check. Game douses GRADUALLY, so a `firesDoused`-gated rescue is added
    // while its extinguish goal is still far off; here the idealised instant-douse would leap PAST the
    // trigger and "win" before the rescue ever appeared. Applying the director first — then re-reading
    // the signals — keeps the pop-up REQUIRED for the win, so the gate actually proves its path.
    // Wind shifts first so a same-beat ignite orients to the new wind (matches Game's ordering).
    if (!r.director.spent) {
      const acts = r.director.update(sig, r.runtime);
      for (const a of acts) if (a.do === 'wind') r.wind.shiftTo(a.angle, a.strengthScale, a.ease);
      for (const a of acts) if (a.do === 'ignite') igniteFromPlacement(r.world, r.fire, a.place, { vx: r.wind.intendedVx, vz: r.wind.intendedVz }, r.fireBound);
      for (const a of acts) if (a.do === 'addObjective') r.runtime.addObjective(a.objective);
      for (const a of acts)
        if (a.do === 'addZone' && r.crew && r.crewZonesRef) {
          // Mirror Game EXACTLY: push to the held array AND tell the sim. With CrewTransport's
          // defensive copy these are independent (one net append); if that copy regressed, the shared
          // array would double-append and the post-run views.length assertion would catch it.
          const z = resolveCrewZone(r.world, a.zone);
          r.crewZonesRef.push(z);
          r.crew.addZone(z);
          addedZones++;
        }
      if (acts.length) sig = signals(r, elapsed); // re-snapshot: ignites / new zones changed the counts
    }
    r.runtime.update(sig);
  }
  return { r, elapsed, addedZones };
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

// --- Suppression-math guards: prove dousing actually EXTINGUISHES and that a drop's footprint is
// BOUNDED (a wide fire needs several passes) on a synthetic max-heat cell (flat, fully-fuelled ground).
// Locks the rebalanced douse model: a full dead-on pass clears its disc → fire shrinks ~1–5 buckets. ---
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

  // (a) a dead-on full pass on a h=1.0 cell EXTINGUISHES it — actively bucketing a fire puts it OUT (the
  // cell is driven to 0 and scorch-locks to mud). This is the rebalanced intent (litresToClear=45, hotResist=0.2,
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

// --- Daily Burn completability: a runtime-built daily challenge must be clearable on EVERY seed (it
// reuses the same World+FireSystem+scorer). A perfect player has to seed fires and drive extinguishAll
// to a verified win across a month of seeds — proving the procedural daily never grows an impossible or
// empty map. Baked into the gate so a tuning change to buildDailyMission can't silently break it. ---
console.log('\nDaily Burn completability (30 seeds)\n');
const DAILY_DAYS = 30;
const dailyEpoch = Date.UTC(2026, 0, 1); // fixed start → deterministic probe
let dailyWon = 0;
for (let i = 0; i < DAILY_DAYS; i++) {
  const date = new Date(dailyEpoch + i * 86_400_000);
  const dm = buildDailyMission(date);
  const { r, elapsed } = run(dm, 'play');
  const seeded = r.firesInitial > 0;
  const won = r.runtime.state === 'won' && r.runtime.verified;
  if (won && seeded) dailyWon++;
  ok(`${dailyMissionId(date)}: fires seeded`, seeded, `firesInitial=${r.firesInitial}`);
  ok(`${dailyMissionId(date)}: completable`, won && seeded, `state=${r.runtime.state} @${elapsed.toFixed(0)}s`);
}
console.log(`  ${dailyWon}/${DAILY_DAYS} daily seeds cleared by a perfect player`);

console.log(`\n${pass} passed, ${fail} failed`);
if (failures.length) {
  console.log('\nFailures:');
  for (const f of failures) console.log('  ✗ ' + f);
  process.exit(1);
}
