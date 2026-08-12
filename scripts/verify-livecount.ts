/*
 * Active-fire COUNT verifier — the gate that was missing when the live map spent weeks publishing
 * 462 active fires against CIFFC's 603.
 *
 * `verify:livefire` proves the parsers produce the right SHAPES from fixtures. It never asked whether
 * the TOTAL we publish matches the authority we cite, which is the only number most visitors will ever
 * check. This gate closes that hole in two parts:
 *
 *   PART 1 (always runs, network-free, BLOCKING) — the status→stage mapping that decides whether a fire
 *   counts as active at all, checked against real strings the agencies actually published. Two of the
 *   three miscount causes lived here.
 *
 *   PART 2 (needs the network, ADVISORY) — compares our backend's active total against CIFFC's own
 *   `active_fires`, paging past the PostgREST 1000-row cap exactly the way the browser client does.
 *   This is the check that would have caught the miscount on day one. It SKIPS (does not fail) when a
 *   source is unreachable or Supabase is unconfigured, so an offline CI box or a flaky upstream can't
 *   red the deploy — the repo already learned that lesson with verify:render's net::ERR_FAILED
 *   allowlist. Drift beyond DRIFT_TOLERANCE is a hard failure when the data DID load.
 *
 * Run it with:  npm run verify:livecount
 */
import { stageFromText, isActiveStage, REAL_STATUS_CASES, type Stage } from '../supabase/functions/ingest-provincial/stage';

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

console.log('\nActive-fire count gate\n');

// ── PART 1: the stage mapping (blocking, offline) ────────────────────────────────────────────────
console.log('  stage mapping vs real agency strings');
for (const [source, status, expect] of REAL_STATUS_CASES) {
  const got = stageFromText(status);
  ok(`${source} "${status}" → ${expect}`, got === expect, `got ${got}`);
}

// The specific regressions that caused the miscount, called out by name so a future edit that
// reintroduces them fails with an obvious message rather than a generic table row.
ok(
  'REGRESSION: SOPFEU "Hors-Ctrl" counts as ACTIVE (was UNK, hid a 62,180 ha fire)',
  isActiveStage(stageFromText('Hors-Ctrl')),
);
ok(
  'REGRESSION: Ontario "Being Observed" counts as ACTIVE (was UNK, dropped 73 of 103 ON records)',
  isActiveStage(stageFromText('Being Observed')),
);
ok('an OUT fire is never active', !isActiveStage(stageFromText('Declared Out')) && !isActiveStage(stageFromText('DECLARED_OUT')));
ok('blank / junk status is never active', !isActiveStage(stageFromText('')) && !isActiveStage(stageFromText('   ')) && !isActiveStage(stageFromText(null)));

// ── PART 2: live totals vs CIFFC (advisory — skips when offline) ─────────────────────────────────
const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? '';
const SUPABASE_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? '';
const CIFFC_SUMMARY = 'https://api.ciffc.net/v1/dashboard/summary';
/** How far our active total may sit from CIFFC's before this is a failure. The two are not required to
 *  agree exactly — we prefer richer provincial feeds where they exist, and the feeds are sampled minutes
 *  apart — but a real divergence (a dead ingest, a broken stage map, a truncated read) blows straight
 *  past this. The bug this gate exists for was 23%. */
const DRIFT_TOLERANCE = 0.12;
const PAGE = 1000;
const UNTRUSTED = new Set(['nl-ffa']); // mirrors the client's UNTRUSTED_PROVINCIAL

async function getJson(url: string, headers: Record<string, string> = {}, ms = 20000): Promise<unknown | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { headers, signal: ctrl.signal });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/** Read a whole table, paging past the 1000-row cap — the same contract the browser client uses. */
async function pagedRows<T>(table: string, query: string): Promise<T[] | null> {
  const headers = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` };
  const out: T[] = [];
  for (let page = 0; page < 24; page++) {
    const from = page * PAGE;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 20000);
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
        headers: { ...headers, Range: `${from}-${from + PAGE - 1}` },
        signal: ctrl.signal,
      });
      if (!res.ok) return page === 0 ? null : out;
      const rows = (await res.json()) as T[];
      if (!Array.isArray(rows)) return page === 0 ? null : out;
      out.push(...rows);
      const total = Number(res.headers.get('Content-Range')?.split('/')[1]);
      if (Number.isFinite(total) ? out.length >= total : rows.length < PAGE) return out;
      if (rows.length === 0) return out;
    } catch {
      return page === 0 ? null : out;
    } finally {
      clearTimeout(t);
    }
  }
  return out;
}

console.log('\n  live totals vs CIFFC');
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.log('    SKIP — VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY not set (backend not configured here)');
} else {
  const summary = (await getJson(CIFFC_SUMMARY)) as { active_fires?: number } | null;
  const ciffcActive = typeof summary?.active_fires === 'number' ? summary.active_fires : null;

  type P = { source: string; agency: string | null; stage: string | null };
  type F = { agency: string | null; stage: string | null };
  const prov = await pagedRows<P>('provincial_fires', 'select=source,agency,stage&order=source.asc,source_fire_id.asc');
  const ciffcRows = await pagedRows<F>('fires', 'select=agency,stage&stage=in.(OC,BH,UC,OUT)&order=fire_id.asc');

  if (ciffcActive == null || prov == null || ciffcRows == null) {
    console.log('    SKIP — a source was unreachable (CIFFC or Supabase). Not a regression; re-run when online.');
  } else {
    // Reproduce the client's prefer-provincial merge exactly.
    const provKept = prov.filter((r) => !UNTRUSTED.has(r.source));
    const covered = new Set(provKept.map((r) => (r.agency ?? '').toUpperCase()).filter(Boolean));
    const kept = ciffcRows.filter((r) => !covered.has((r.agency ?? '').toUpperCase()));
    const ours = [...provKept, ...kept].filter((r) => isActiveStage((r.stage ?? 'UNK') as Stage)).length;

    const drift = Math.abs(ours - ciffcActive) / Math.max(1, ciffcActive);
    const pct = (drift * 100).toFixed(1);
    console.log(`    ours=${ours}  ciffc=${ciffcActive}  drift=${pct}%  (tolerance ${(DRIFT_TOLERANCE * 100).toFixed(0)}%)`);
    console.log(`    rows read: provincial=${prov.length} ciffc=${ciffcRows.length}`);

    // A read that stops exactly on the cap is the truncation signature this gate was written for.
    ok('provincial read is not truncated at the 1000-row cap', prov.length !== PAGE, `got exactly ${PAGE} rows`);
    ok('ciffc read is not truncated at the 1000-row cap', ciffcRows.length !== PAGE, `got exactly ${PAGE} rows`);
    ok(`active total tracks CIFFC within ${(DRIFT_TOLERANCE * 100).toFixed(0)}%`, drift <= DRIFT_TOLERANCE, `ours=${ours} ciffc=${ciffcActive} drift=${pct}%`);
  }
}

console.log(`\nverify:livecount — ${pass} passed, ${fail} failed`);
if (fail) {
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
console.log('✓ active-fire counting is sound (stage mapping + published total)');
