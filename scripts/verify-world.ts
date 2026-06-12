/*
 * World determinism digest — proves world generation is a PURE function of the seed. `World` is the
 * single source of ground/water truth and is meant to be deterministic from `WORLD3D.seed` (mulberry32),
 * so the same seed must grow a byte-identical world every time — on this machine and in CI. That
 * property is load-bearing twice over: it's what makes `verify:campaign` trustworthy (the gate tests
 * the same world the game ships), and it's what lets Open Skies peers re-derive the identical map
 * from a shared daily seed.
 *
 * We sample the locked World API (groundHeightAt / waterLevelAt / flightFloorAt / isOverWater / slopeAt
 * + placement.fuelAt) over a fixed (x,z) lattice and reduce to a rounded digest, then assert:
 *   (a) two constructions of the SAME seed are byte-identical (no hidden global / per-call RNG drift), and
 *   (b) the digest matches the committed baseline (scripts/world-baseline.json) — so an accidental
 *       Math.random() creeping into world-gen (which tsc can't see) fails the gate.
 *
 * `sim/Wind.ts` USED to be the one deliberate non-determinism here (a Math.random drift, flagged for
 * co-op). It is now a pure function of (seed, clock), so this gate also covers the two properties Open
 * Skies' shared wind actually needs (see the Wind section below): (1) byte-identical wind for the SAME
 * seed+clock regardless of frame pacing (dt-independence), and (2) a realistic sub-second device-clock
 * SKEW keeps wind within a tight tolerance (it must — peers read their own wall clocks). Exact cross-device
 * identity would need a negotiated clock (not implemented; unnecessary while douses broadcast resolved
 * coords). World GENERATION itself must stay clean either way.
 *
 * Regenerate the baseline after an INTENTIONAL world-gen change:  npm run verify:world -- --update
 * Lives in scripts/ (outside src → not in the production build). Run: npm run verify:world
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { World } from '../src/three/World';
import { Wind } from '../src/three/sim/Wind';

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

// --- Wind shared-determinism (Open Skies) -----------------------------------------------------------
// Wind is now a PURE function of (seed, clock). The free-for-all needs every peer to see the SAME wind so
// fire fronts drift identically across screens. Prove it: drive two Wind(seed) with DIFFERENT, jittery dt
// step sequences but the SAME shared absolute clock, and assert identical vx/vz/strength at every step —
// i.e. the wind depends on the shared clock, NOT on a client's frame pacing.
function windSharedAcrossPeers(): boolean {
  const seed = 4242;
  const a = new Wind(seed);
  const b = new Wind(seed);
  const dtA = [16, 16, 16, 16, 16, 16, 16, 16, 16, 16]; // steady 60fps peer
  const dtB = [40, 8, 33, 5, 50, 11, 16, 7, 25, 17]; // stuttering peer
  let clock = 1_700_000_000; // an arbitrary shared wall-clock origin (seconds) — both peers advance it alike
  for (let i = 0; i < dtA.length; i++) {
    clock += 0.05 + i * 0.01; // the shared clock ticks the same for both, independent of their local dt
    a.update(dtA[i], clock);
    b.update(dtB[i], clock);
    if (a.vx !== b.vx || a.vz !== b.vz || a.strength !== b.strength) return false;
  }
  return true;
}
ok('wind: same seed + shared clock → byte-identical across peers (dt-independent)', windSharedAcrossPeers());

// And the meander must actually vary by seed (not a degenerate constant) — else "shared" would be trivial.
function windVariesBySeed(): boolean {
  const a = new Wind(4242);
  const b = new Wind(1337);
  let clock = 1_700_000_000;
  let differ = false;
  for (let i = 0; i < 64; i++) {
    clock += 1.0;
    a.update(16, clock);
    b.update(16, clock);
    if (a.vx !== b.vx || a.vz !== b.vz) differ = true;
  }
  return differ;
}
ok('wind: distinct seeds produce distinct wind (meander is not degenerate)', windVariesBySeed());

// No Math.random leaked in: a fresh pair on the SAME local-elapsed clock (no absSeconds) must also match.
function windDeterministicSolo(): boolean {
  const a = new Wind(99);
  const b = new Wind(99);
  for (let i = 0; i < 64; i++) {
    a.update(16);
    b.update(16);
    if (a.vx !== b.vx || a.vz !== b.vz || a.strength !== b.strength) return false;
  }
  return true;
}
ok('wind: solo local-elapsed clock is deterministic from the seed (no Math.random)', windDeterministicSolo());

// Skew-robustness: peers read their OWN wall clocks, which differ by the device time error. Model a
// generous sub-second skew between two same-seed peers and assert the wind stays within a tight tolerance
// — i.e. the slow integer-noise gust can't be swung by realistic skew. (A regression to a fast Math.sin
// gust would blow past this.) Tolerance is ~3% of the [0.25..1.0] vector range — imperceptible.
function windSkewBounded(): boolean {
  const a = new Wind(4242);
  const b = new Wind(4242);
  const SKEW = 0.25; // seconds — a generous NTP-class device-clock skew between two peers
  let clock = 1_700_000_000;
  let maxDiff = 0;
  for (let i = 0; i < 256; i++) {
    clock += 0.1;
    a.update(16, clock); // peer A on its clock
    b.update(16, clock + SKEW); // peer B's clock runs SKEW seconds ahead
    maxDiff = Math.max(maxDiff, Math.hypot(a.vx - b.vx, a.vz - b.vz), Math.abs(a.strength - b.strength));
  }
  return maxDiff < 0.03;
}
ok('wind: sub-second device clock-skew keeps peers within tolerance (slow gust, not skew-sensitive)', windSkewBounded());

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
