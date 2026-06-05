/**
 * Mission completability ORACLE — the shared "perfect player" that proves a `MissionDef` is
 * actually winnable on the real engine-agnostic scenario sims (World + FireSystem + Structures +
 * CrewTransport + Backburn + FuelSim), the SAME World seed + `scenario.ts` resolution the live game
 * uses (no flight/Three.js layer, which it doesn't need).
 *
 * Extracted from `scripts/verify-campaign.ts` so it is reused by BOTH the CI gate (verify-campaign
 * runs the rich per-mission assertions on the `Rig` this returns) AND, later, the mission FACTORY
 * (Slice 3), which calls `isCompletable()` to keep generated missions winnable by construction.
 *
 * Engine-agnostic (numbers + sims only — no `Scene`, no DOM) like the sims it drives, so it bundles
 * cleanly into Node. The fire grid + fire-site bounds are resolved PER AXIS from `world.sizeX/sizeZ`
 * so a rectangular (true-shape) map is validated against the world it actually grows, not the square.
 */
import { World } from '../World';
import { Wind } from '../sim/Wind';
import { FireSystem } from '../sim/FireSystem';
import { Structures } from '../sim/Structures';
import { CrewTransport, CrewZone } from '../sim/CrewTransport';
import { Backburn } from '../sim/Backburn';
import { FuelSim } from '../sim/FuelSim';
import { MissionRuntime } from './MissionRuntime';
import { MissionDirector } from './MissionDirector';
import { seedFires, structurePlan, crewZones, resolveCrewZone, igniteFromPlacement, backburnLine } from './scenario';
import type { MissionDef, MissionSignals, MissionState } from './types';
import { BUCKET3D, DROP_PHYSICS, SCORE, MISSIONS } from '../config';

export const DT = 0.1;
export const MAX_SEC = 400; // playthrough cap (survive missions need ~180s; blazes converge well under this)

// --- "Competent pilot" water model — the REAL completability test ------------------------------
// Models DISCRETE bucket passes: every PASS_INTERVAL steps the pilot dumps a full bucket on each
// active front (in-band, aimed upwind) — a concentrated hit that fully douses a patch, which CHARS +
// locks (fires don't self-extinguish, so progress must be locked by water). The interval is the
// scoop-fly-drop loop time. If a mission goes red, that's the gate working — re-tune THESE knobs or
// the fire's spread (FIRE3D / mission spreadScale), never the asserts.
const DROP_AGL = 45; // in-band release height → densityMul≈1, radius≈dropRadius
const PASS_INTERVAL = 12; // steps between bucket passes (~1.2s tight scoop-drop loop on a lake-side fire)
const DROP_LITRES = 160; // a full bucket delivered per pass (concentrated, scorches a patch)
const DROPS_PER_FRONT = 2; // a realistic-size footprint (dropRadius=15) covers less, so a skilled pilot
// walks each front with a couple of drops per pass (re-querying the hottest point between each)
const BACKBURN_PASS = 8; // steps between lighting successive control-line segments (idealised fly-the-line)

export interface Rig {
  world: World;
  wind: Wind;
  fire: FireSystem;
  structures: Structures;
  crew?: CrewTransport;
  // The SAME array Game holds (`Game.crewZones`) and feeds into CrewTransport — held here so the
  // oracle mirrors Game's exact crew-array handling: on an `addZone` beat it pushes to BOTH this and
  // `crew.addZone`, just like Game. With CrewTransport's defensive copy this is correct; if that copy
  // were ever removed (re-aliasing the arrays), the double-append would inflate `crew.views` and trip
  // verify-campaign's post-run consistency assertion — so this whole bug CLASS is caught headlessly.
  crewZonesRef?: CrewZone[];
  backburn?: Backburn; // the backburn control line (torch missions) — laid by the perfect player below
  fuel?: FuelSim;
  runtime: MissionRuntime;
  director: MissionDirector;
  fireBoundX: number;
  fireBoundZ: number;
  firesInitial: number;
  depot: { x: number; z: number } | null;
}

/** Build the real engine-agnostic scenario sims for a mission (the same world + resolution the game builds). */
export function build(mission: MissionDef): Rig {
  // Build the SAME world the game builds: pass the mission's map (region) + name pins. Without the
  // regionId the oracle would grow a NON-anchored world while the game grows the anchored one — the
  // completability gate would test a different map than ships. (Anchored-placement parity.)
  const world = new World(mission.seed, { regionId: mission.map, pins: mission.places, homeBase: mission.homeBase });
  const wind = new Wind(mission.wind?.angle, mission.wind?.strengthScale ?? 1);
  // Per-axis fire-site bounds + rectangular fire grid (square map → both = WORLD3D.size/2−40, byte-identical).
  const fireBoundX = world.sizeX / 2 - 40;
  const fireBoundZ = world.sizeZ / 2 - 40;
  const fire = new FireSystem(
    {
      rng: world.rng,
      groundHeightAt: (x, z) => world.groundHeightAt(x, z),
      isOverWater: (x, z) => world.isOverWater(x, z),
      fuelAt: (x, z) => world.placement.fuelAt(x, z),
      pickSite: (min) => world.placement.fireSite(world.rng, fireBoundX, min, fireBoundZ),
      sizeX: world.sizeX,
      sizeZ: world.sizeZ,
    },
    { spreadScale: mission.fire?.spreadScale }, // validate each mission at its REAL configured pace
  );
  seedFires(world, fire, mission, { vx: wind.vx, vz: wind.vz }, fireBoundX, fireBoundZ);
  const firesInitial = fire.activeCount;
  const structures = new Structures({
    groundHeightAt: (x, z) => world.groundHeightAt(x, z),
    isOverWater: (x, z) => world.isOverWater(x, z),
    pickSite: (min) => world.placement.fireSite(world.rng, fireBoundX, min, fireBoundZ),
    lakes: world.lakes.map((l) => ({ x: l.x, z: l.z, r: l.r })),
    rng: world.rng,
    communities: world.communities,
    plan: structurePlan(world, mission),
  });
  // Hold the resolved crew-zone array (as Game holds `this.crewZones`) and feed THE SAME array into
  // CrewTransport — mirroring Game's exact handling so the addZone path is faithfully modelled.
  const crewZonesRef = mission.zones?.length ? crewZones(world, mission) : undefined;
  const crew = crewZonesRef ? new CrewTransport(crewZonesRef, mission.startLoaded ?? false) : undefined;
  // Fuel is now UNIVERSAL (every mission unless `fuel:false`), mirroring Game — the perfect player tops
  // up at a base when it dips (the `play` loop keeps it ≥ 0.5). Only `fuelOut`-fail missions lose on a
  // dry tank; elsewhere fuel never threatens the win.
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
    fireBoundX,
    fireBoundZ,
    firesInitial,
    depot: base ? { x: base.x, z: base.z } : null,
  };
}

/** The per-frame signals snapshot Game feeds MissionRuntime — built here with idealised precision. */
export function signals(r: Rig, elapsed: number): MissionSignals {
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

export type Mode = 'play' | 'noop' | 'starve';

/** Step the rig to a terminal state (or the cap). `mode` picks the player's behaviour. */
export function run(mission: MissionDef, mode: Mode, maxSec: number = MAX_SEC): { r: Rig; elapsed: number; addedZones: number } {
  const r = build(mission);
  // Whether the pilot can put water on fire this mission: a pure-crew sortie carries NO bucket, so
  // the perfect player must NOT douse (its fires can only be outrun / threaten structures). A mixed
  // crew+water sortie lists 'water' among its loadouts → the player re-rigs and can douse.
  const loadouts = mission.loadouts?.length ? mission.loadouts : [mission.payload ?? 'water'];
  const canWater = loadouts.includes('water');
  let elapsed = 0;
  let addedZones = 0; // count of pop-up rescue zones actually applied (for the consistency assertion)
  for (let step = 0; step < maxSec / DT && r.runtime.state === 'active'; step++) {
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
        if (z) {
          // Model the AGL the perfect player holds over this zone:
          //   lowHover — near-ground drill: hold at mid-band (just above floor, under ceiling)
          //   hover    — crew-delivery hover: mid-band between landAgl and hoverAglMax
          //   normal   — skids down (agl 0)
          const agl = z.lowHover
            ? MISSIONS.lowHoverAglMax / 2
            : z.hover
              ? (MISSIONS.landAgl + MISSIONS.hoverAglMax) / 2
              : 0;
          r.crew.update(DT, z.x, z.z, agl, 0);
        }
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
      for (const a of acts) if (a.do === 'ignite') igniteFromPlacement(r.world, r.fire, a.place, { vx: r.wind.intendedVx, vz: r.wind.intendedVz }, r.fireBoundX, r.fireBoundZ);
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

/** A finished completability probe — winnable by a perfect player AND genuinely non-trivial. */
export interface CompletabilityResult {
  win: boolean; // the perfect player reached 'won' AND verified (every goal latched)
  state: MissionState; // the runtime's final state
  elapsed: number; // seconds at the terminal frame
  firesInitial: number; // fires active at the start (0 ⇒ an empty/degenerate map)
  score: number; // the perfect run's score
  addedZones: number; // pop-up rescue zones applied during the run
  noopWins: boolean; // a NO-OP/starve run ALSO wins → the mission is trivially winnable (a fidelity red flag)
}

/**
 * Is this mission completable? Drives the perfect player to a terminal state and reports both that a
 * skilled pilot WINS and that a do-nothing pilot does NOT (so a generated mission is genuinely hard,
 * not a freebie). The shared trust anchor for the CI gate and the Slice-3 mission factory.
 */
export function isCompletable(def: MissionDef, opts: { maxSec?: number } = {}): CompletabilityResult {
  const maxSec = opts.maxSec ?? MAX_SEC;
  const play = run(def, 'play', maxSec);
  const hasFuelFail = (def.fails ?? []).some((f) => f.kind === 'fuelOut');
  const passive = run(def, hasFuelFail ? 'starve' : 'noop', maxSec);
  return {
    win: play.r.runtime.state === 'won' && play.r.runtime.verified,
    state: play.r.runtime.state,
    elapsed: play.elapsed,
    firesInitial: play.r.firesInitial,
    score: play.r.runtime.score,
    addedZones: play.addedZones,
    noopWins: passive.r.runtime.state === 'won',
  };
}
