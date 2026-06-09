/*
 * Live wildfire tracker verifier — proves the PURE normalize core (src/three/livefire/normalize.ts)
 * turns a raw CWFIS hotspots GeoJSON into a sane, sorted, capped, in-province list of active fires, and
 * NEVER throws on empty / malformed / out-of-bbox input. Network-free: it runs against committed
 * fixtures (scripts/fixtures/livefire-*), so CI never depends on the live CWFIS service.
 *
 * Run it with:  npm run verify:livefire
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  normalizeFeed,
  parseHotspots,
  clusterFires,
  severityFor,
  nearestPlace,
  SK_BBOX,
} from '../src/three/livefire/normalize';

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

const here = dirname(fileURLToPath(import.meta.url));
const fx = (name: string): unknown => JSON.parse(readFileSync(join(here, 'fixtures', name), 'utf8'));
const FETCHED = 1_700_000_000_000; // fixed clock — the pure core never reads Date.now()

// ── Real SK fixture (7 hotspots, incl. a 3-detection trio @56.78 and a 2-detection pair @55.28) ──
const sk = fx('livefire-cwfis-sk.geojson');
const dets = parseHotspots(sk);
ok('real fixture parses 7 SK detections', dets.length === 7, `got ${dets.length}`);
ok('every parsed detection is inside the SK bbox', dets.every((d) => d.lat >= SK_BBOX.latMin && d.lat <= SK_BBOX.latMax && d.lon >= SK_BBOX.lonMin && d.lon <= SK_BBOX.lonMax));

const feed = normalizeFeed(sk, { fetchedAt: FETCHED, source: 'live' });
ok('feed reports 7 total detections', feed.totalDetections === 7, `got ${feed.totalDetections}`);
ok('detections collapse into 3–5 fires (clustering works)', feed.fires.length >= 3 && feed.fires.length <= 5, `got ${feed.fires.length}`);
ok('feed carries through fetchedAt + source', feed.fetchedAt === FETCHED && feed.source === 'live');
ok('a multi-detection cluster formed (the @56.78 trio)', feed.fires.some((f) => f.detections >= 2), `max=${Math.max(...feed.fires.map((f) => f.detections))}`);
ok('every fire has a non-empty SK place label', feed.fires.every((f) => typeof f.place === 'string' && f.place.length > 1));
ok('every fire has a valid severity', feed.fires.every((f) => ['low', 'moderate', 'high', 'extreme'].includes(f.severity)));
ok('every fire id is a rounded "lat,lon" key', feed.fires.every((f) => /^-?\d+\.\d{2},-?\d+\.\d{2}$/.test(f.id)));
// Sorted: severity rank non-increasing.
const rank = { low: 0, moderate: 1, high: 2, extreme: 3 } as const;
ok('fires sorted by severity desc', feed.fires.every((f, i) => i === 0 || rank[feed.fires[i - 1].severity] >= rank[f.severity]));

// ── Determinism: same input → byte-identical fires ──
const a = normalizeFeed(sk, { fetchedAt: FETCHED, source: 'live' });
const b = normalizeFeed(sk, { fetchedAt: FETCHED, source: 'live' });
ok('normalize is deterministic', JSON.stringify(a.fires) === JSON.stringify(b.fires));

// ── Empty fixture → empty feed, no throw ──
let threw = false;
let emptyFeed = null as ReturnType<typeof normalizeFeed> | null;
try {
  emptyFeed = normalizeFeed(fx('livefire-empty.geojson'), { fetchedAt: FETCHED, source: 'live' });
} catch {
  threw = true;
}
ok('empty fixture never throws', !threw);
ok('empty fixture → 0 fires / 0 detections', !!emptyFeed && emptyFeed.fires.length === 0 && emptyFeed.totalDetections === 0);

// ── Malformed fixture → empty feed (defensive parse + bbox drop of the lone India feature), no throw ──
threw = false;
let badFeed = null as ReturnType<typeof normalizeFeed> | null;
try {
  badFeed = normalizeFeed(fx('livefire-malformed.json'), { fetchedAt: FETCHED, source: 'live' });
} catch {
  threw = true;
}
ok('malformed fixture never throws', !threw);
ok('malformed fixture → 0 fires (bad fields dropped, out-of-bbox dropped)', !!badFeed && badFeed.fires.length === 0);

// ── Hard non-objects never throw ──
for (const junk of [null, undefined, 42, 'nope', {}, { features: 'no' }, []] as unknown[]) {
  try {
    parseHotspots(junk);
  } catch {
    ok(`parseHotspots tolerates ${JSON.stringify(junk)}`, false);
  }
}
ok('parseHotspots tolerates all junk inputs', true);

// ── severityFor boundaries (CFFDRS-ish kW/m bands) ──
ok('severity boundaries', severityFor(0) === 'low' && severityFor(499) === 'low' && severityFor(500) === 'moderate' && severityFor(3999) === 'moderate' && severityFor(4000) === 'high' && severityFor(9999) === 'high' && severityFor(10000) === 'extreme');

// ── nearestPlace: an exact anchor returns itself ──
ok('nearestPlace(La Ronge anchor) === La Ronge', nearestPlace(55.3076, -105.605) === 'La Ronge', nearestPlace(55.3076, -105.605));

// ── bbox filter: a cross-border (US) detection is dropped ──
const mixed = {
  type: 'FeatureCollection',
  features: [
    { type: 'Feature', properties: { lat: 55.0, lon: -106.0, hfi: 800, rep_date: '2026-06-08T12:00:00Z', agency: 'SK' } },
    { type: 'Feature', properties: { lat: 35.96, lon: -78.73, hfi: 4595, rep_date: '2026-06-08T02:34:14Z', agency: 'NC' } },
  ],
};
ok('out-of-province (NC) detection dropped by bbox', parseHotspots(mixed).length === 1);

// ── Cap: many spread-out detections cap the rendered list at MAX_FIRES (24) ──
const many = {
  type: 'FeatureCollection',
  features: Array.from({ length: 60 }, (_, i) => ({
    type: 'Feature',
    properties: { lat: 49.5 + (i % 10) * 0.9, lon: -109 + Math.floor(i / 10) * 1.2, hfi: 100 + i, rep_date: '2026-06-08T12:00:00Z', agency: 'SK' },
  })),
};
const capped = clusterFires(parseHotspots(many));
ok('rendered fire list is capped at 24', capped.length === 24, `got ${capped.length}`);

// ── Report ──
console.log(`\nverify:livefire — ${pass} passed, ${fail} failed`);
if (fail) {
  console.log('\nFailures:');
  for (const f of failures) console.log('  ✗ ' + f);
  process.exit(1);
}
console.log('✓ live wildfire normalize core is sound');
