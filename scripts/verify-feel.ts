/*
 * Control-feel golden-trace verifier — locks how the aircraft HANDLES, which `verify:campaign`
 * (completability) is blind to. A stray edit to a FLIGHT/BUCKET3D constant or to the integrator in
 * `sim/HelicopterSim.ts` / `sim/BucketSim.ts` silently changes the feel; the perfect player still
 * wins, so nothing catches it. Both sims are engine-agnostic + RNG-free (they import only three's
 * math + config.ts — no Scene, no DOM), so we drive them through a SCRIPTED MANEUVER at a fixed dt
 * and assert the resulting trajectory DIGEST matches a committed baseline (scripts/feel-baseline.json).
 *
 * Feel is emergent from ~30 interacting constants; a recorded trajectory is sensitive to all of them
 * at once. When you change the feel ON PURPOSE, regenerate the baseline:
 *
 *   npm run verify:feel -- --update      (or: node scripts/.verify-feel.mjs --update)
 *
 * …and the diff in feel-baseline.json is the reviewable record of what the change did.
 *
 * Lives in scripts/ (outside src → not in the production tsc/vite build). Run: npm run verify:feel
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { HelicopterSim, type FlightInput } from '../src/three/sim/HelicopterSim';
import { BucketSim } from '../src/three/sim/BucketSim';
import { HELI_CLASSES } from '../src/three/config';

const DT = 1 / 30; // fixed step — deterministic; finer than the campaign verifier's 0.1 so banks/dives read
const FLOOR = 0; // flat floor under the whole maneuver (no terrain coupling — we're testing the airframe)
const NO_OBSTACLE = -1e6; // bucket never collides — we're testing the free pendulum, not terrain drag
const SAMPLE_EVERY = 5; // record a digest row every N frames (keeps the baseline compact)
const EPS = 1e-4; // per-value tolerance on replay vs. baseline
const ROUND = (v: number): number => Math.round(v * 1000) / 1000;

const BASELINE = fileURLToPath(new URL('./feel-baseline.json', import.meta.url));

/** One scripted leg of the maneuver. Each is chosen to exercise a different cluster of constants. */
interface Leg {
  name: string;
  frames: number;
  turn: number;
  throttle: number;
  lift: number;
  fill: number; // bucket fill 0..1 — doubles as the heli payload ratio (a full bucket flies heavy)
  submerged: boolean; // bucket dipped in a lake → physical scoop tip/dip
  windX: number; // world units/s of crosswind air-mass drift
}

const L = (name: string, frames: number, p: Partial<Leg> = {}): Leg => ({
  name,
  frames,
  turn: 0,
  throttle: 0,
  lift: 0,
  fill: 0,
  submerged: false,
  windX: 0,
  ...p,
});

// The maneuver: spool/hover → climb → accelerate to the cap → hard banked right turn → committed
// nose-down dive → flare + reverse to a stop → heavy full-bucket cruise → crosswind cruise → a scoop
// dip. Between them this touches yaw/bank/steerBank, drag/speed-cap/cruisePitch, pitchThrust/pitchDive/
// diveSpeedBoost/diveCommand, flareBrake/flareCommand, the payload penalties + bucket sag/lag, the
// wind→ground-velocity coupling, and the scoop tip/dip — i.e. almost every feel constant.
const MANEUVER: Leg[] = [
  L('hover', 30),
  L('climb', 30, { lift: 1 }),
  L('accel', 90, { throttle: 1 }),
  L('hard-right', 60, { throttle: 1, turn: 1 }),
  L('dive', 45, { throttle: 1, lift: -1 }),
  L('flare-stop', 45, { throttle: -1, lift: 1 }),
  L('heavy-cruise', 75, { throttle: 1, fill: 1 }),
  L('crosswind', 60, { throttle: 1, windX: 6 }),
  L('scoop-dip', 30, { lift: -1, submerged: true, fill: 0.5 }),
];

type Row = number[];

/** Run the full maneuver for one heli class and return the sampled trajectory digest. */
function trace(classId: string): Row[] {
  const cls = HELI_CLASSES[classId];
  const heli = new HelicopterSim(0, 0, cls);
  const bucket = new BucketSim(0, heli.position.y, 0);
  const rows: Row[] = [];
  let frame = 0;
  for (const leg of MANEUVER) {
    const input: FlightInput = { turn: leg.turn, throttle: leg.throttle, lift: leg.lift };
    for (let i = 0; i < leg.frames; i++) {
      heli.update(DT, input, FLOOR, leg.fill, leg.windX, 0);
      bucket.update(DT * 1000, heli.position, heli.velX, heli.velZ, leg.fill, leg.submerged, NO_OBSTACLE);
      if (frame % SAMPLE_EVERY === 0) {
        rows.push([
          ROUND(heli.position.x), ROUND(heli.position.y), ROUND(heli.position.z),
          ROUND(heli.yaw), ROUND(heli.bank), ROUND(heli.pitch),
          ROUND(heli.speed), ROUND(heli.vertSpeed),
          ROUND(bucket.position.x), ROUND(bucket.position.y), ROUND(bucket.position.z),
          ROUND(bucket.tip), ROUND(bucket.dragSpeed),
        ]);
      }
      frame++;
    }
  }
  return rows;
}

/** Peak horizontal speed reached over the maneuver — used for the per-class handling-spread check. */
function peakSpeed(classId: string): number {
  const cls = HELI_CLASSES[classId];
  const heli = new HelicopterSim(0, 0, cls);
  let peak = 0;
  for (const leg of MANEUVER) {
    const input: FlightInput = { turn: leg.turn, throttle: leg.throttle, lift: leg.lift };
    for (let i = 0; i < leg.frames; i++) {
      heli.update(DT, input, FLOOR, leg.fill, leg.windX, 0);
      peak = Math.max(peak, heli.speed);
    }
  }
  return peak;
}

const FIELDS = ['x', 'y', 'z', 'yaw', 'bank', 'pitch', 'speed', 'vsi', 'bx', 'by', 'bz', 'tip', 'drag'];

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

const baseTrace = trace('bell-205a1');

// --- Sanity: no NaN/Inf anywhere in the trace (a divide-by-zero or bad clamp would surface here) ---
const allFinite = baseTrace.every((r) => r.every((v) => Number.isFinite(v)));
ok('feel: trace is all finite (no NaN/Inf)', allFinite);

// --- --update: rewrite the golden baseline and exit (the deliberate "I re-tuned the feel" path) ---
if (process.argv.includes('--update')) {
  writeFileSync(BASELINE, JSON.stringify(baseTrace) + '\n');
  console.log(`feel: baseline UPDATED → ${BASELINE} (${baseTrace.length} rows × ${FIELDS.length} fields)`);
  process.exit(0);
}

// --- Golden compare: every sampled value must match the committed baseline within EPS ---
let golden: Row[] | null = null;
try {
  golden = JSON.parse(readFileSync(BASELINE, 'utf8'));
} catch {
  console.error(`feel: no baseline at ${BASELINE} — generate it once with:  npm run verify:feel -- --update`);
  process.exit(1);
}

ok('feel: row count matches baseline', golden!.length === baseTrace.length, `got ${baseTrace.length}, want ${golden!.length}`);

const diffs: string[] = [];
const n = Math.min(golden!.length, baseTrace.length);
for (let r = 0; r < n && diffs.length < 5; r++) {
  for (let c = 0; c < FIELDS.length && diffs.length < 5; c++) {
    const want = golden![r][c];
    const got = baseTrace[r][c];
    if (Math.abs(want - got) > EPS) diffs.push(`row ${r} ${FIELDS[c]}: want ${want}, got ${got}`);
  }
}
ok('feel: trajectory matches the golden baseline', diffs.length === 0, diffs.join(' | '));
if (diffs.length) {
  console.log('\nFeel drift (first divergences):');
  for (const d of diffs) console.log('  ~ ' + d);
  console.log('  If this change to the feel was INTENTIONAL, re-baseline:  npm run verify:feel -- --update\n');
}

// --- Per-class handling spread: the three airframes must NOT collapse to identical handling. The
// speedMul table orders 205 < 212 < UH-60, so peak speed must too — a class-table edit that flattens
// the roster (or swaps the ordering) is caught here without baselining all three traces. ---
const s205 = peakSpeed('bell-205a1');
const s212 = peakSpeed('bell-212');
const s60 = peakSpeed('uh-60');
ok('feel: heli classes stay distinct (205 < 212 < UH-60 peak speed)', s205 < s212 && s212 < s60, `205=${s205.toFixed(2)} 212=${s212.toFixed(2)} uh60=${s60.toFixed(2)}`);

console.log(
  `\nControl-feel golden trace — ${baseTrace.length} rows × ${FIELDS.length} fields @ dt=${DT.toFixed(4)}\n` +
    `  peak speed: 205=${s205.toFixed(1)}  212=${s212.toFixed(1)}  UH-60=${s60.toFixed(1)} u/s`,
);
console.log(`\n${pass} passed, ${fail} failed`);
if (failures.length) {
  console.log('\nFailures:');
  for (const f of failures) console.log('  ✗ ' + f);
  process.exit(1);
}
