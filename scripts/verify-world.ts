/*
 * World determinism digest — proves world generation is a PURE function of the seed. `World` is the
 * single source of ground/water truth and is meant to be deterministic from `WORLD3D.seed` (mulberry32),
 * so the same seed must grow a byte-identical world every time — on this machine and in CI. That
 * property is load-bearing twice over: it's what makes `verify:campaign` trustworthy (the gate tests
 * the same world the game ships), and it's a HARD prerequisite for co-op netcode (docs/COOP-PLAN.md —
 * peers must re-derive the identical map from a shared seed).
 *
 * We sample the locked World API (groundHeightAt / waterLevelAt / flightFloorAt / isOverWater / slopeAt
 * + placement.fuelAt) over a fixed (x,z) lattice and reduce to a rounded digest, then assert:
 *   (a) two constructions of the SAME seed are byte-identical (no hidden global / per-call RNG drift), and
 *   (b) the digest matches the committed baseline (scripts/world-baseline.json) — so an accidental
 *       Math.random() creeping into world-gen (which tsc can't see) fails the gate.
 *
 * KNOWN, DELIBERATE boundary (NOT covered here): `sim/Wind.ts` uses Math.random() for its drift — a
 * documented non-determinism flagged for co-op (it'll need seeding before peers can share wind). World
 * GENERATION itself must stay clean; this file is the living record of that line.
 *
 * Regenerate the baseline after an INTENTIONAL world-gen change:  npm run verify:world -- --update
 * Lives in scripts/ (outside src → not in the production build). Run: npm run verify:world
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { World } from '../src/three/World';

const SEEDS = [4242, 1337]; // 4242 is the campaign rect-probe seed; 1337 a second independent world
const N = 12; // lattice resolution per axis → N*N sample points
const SPAN = 0.92; // sample within ±SPAN·(size/2) so points stay inside the playfield, off the very edge
const NO_WATER = -9999; // sentinel for waterLevelAt → null (land), so the digest is all-numeric
const R = (v: number): number => Math.round(v * 1000) / 1000;
const BASELINE = fileURLToPath(new URL('./world-baseline.json', import.meta.url));

/** Sample the locked World read-API over a fixed lattice → a flat rounded digest array. */
function digest(seed: number): number[] {
  const w = new World(seed, { regionId: 'saskatchewan' });
  const out: number[] = [];
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      const x = (i / (N - 1) - 0.5) * w.sizeX * SPAN;
      const z = (j / (N - 1) - 0.5) * w.sizeZ * SPAN;
      const wl = w.waterLevelAt(x, z);
      out.push(
        R(w.groundHeightAt(x, z)),
        wl === null ? NO_WATER : R(wl),
        R(w.flightFloorAt(x, z)),
        w.isOverWater(x, z) ? 1 : 0,
        R(w.slopeAt(x, z)),
        R(w.placement.fuelAt(x, z)),
      );
    }
  }
  return out;
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

console.log('World determinism digest\n');

const current: Record<string, number[]> = {};
for (const seed of SEEDS) current[seed] = digest(seed);

// (a) Same-seed replay is byte-identical — rebuild seed[0] and compare to its first digest.
const replay = digest(SEEDS[0]);
const sameSeedStable = replay.length === current[SEEDS[0]].length && replay.every((v, i) => v === current[SEEDS[0]][i]);
ok(`world: seed ${SEEDS[0]} is byte-identical across two constructions`, sameSeedStable);

// Sanity: every sampled value is finite (a NaN in the heightfield would corrupt terrain + the fire grid).
const allFinite = SEEDS.every((s) => current[s].every((v) => Number.isFinite(v)));
ok('world: all sampled fields are finite (no NaN/Inf)', allFinite);

// --update: rewrite the committed baseline and exit (the deliberate "I changed world-gen" path).
if (process.argv.includes('--update')) {
  writeFileSync(BASELINE, JSON.stringify(current) + '\n');
  console.log(`world: baseline UPDATED → ${BASELINE} (${SEEDS.length} seeds × ${current[SEEDS[0]].length} values)`);
  process.exit(0);
}

// (b) Cross-run determinism — every seed's digest matches the committed baseline.
let golden: Record<string, number[]> | null = null;
try {
  golden = JSON.parse(readFileSync(BASELINE, 'utf8'));
} catch {
  console.error(`world: no baseline at ${BASELINE} — generate it once with:  npm run verify:world -- --update`);
  process.exit(1);
}

for (const seed of SEEDS) {
  const want = golden![seed];
  const got = current[seed];
  if (!want) {
    ok(`world: seed ${seed} present in baseline`, false, 're-run with --update');
    continue;
  }
  const diffs: string[] = [];
  const n = Math.min(want.length, got.length);
  for (let i = 0; i < n && diffs.length < 5; i++) {
    if (want[i] !== got[i]) diffs.push(`#${i}: want ${want[i]}, got ${got[i]}`);
  }
  ok(`world: seed ${seed} matches baseline`, want.length === got.length && diffs.length === 0, diffs.join(' | ') || `len ${got.length} vs ${want.length}`);
  console.log(`  ${diffs.length === 0 && want.length === got.length ? '✓' : '✗'} seed ${seed} — ${got.length} sampled values`);
}

if (failures.some((f) => f.includes('matches baseline'))) {
  console.log('\n  If this change to world-gen was INTENTIONAL, re-baseline:  npm run verify:world -- --update');
}

console.log(`\n${pass} passed, ${fail} failed`);
if (failures.length) {
  console.log('\nFailures:');
  for (const f of failures) console.log('  ✗ ' + f);
  process.exit(1);
}
