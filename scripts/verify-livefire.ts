/*
 * Live wildfire tracker verifier — proves the PURE normalize core (src/three/livefire/normalize.ts)
 * turns a raw CWFIS hotspots GeoJSON into plottable hotspots that KEEP the full CWFIS field record (the
 * gold-standard detail), counts distinct fires by clustering, and NEVER throws on empty / malformed /
 * junk input. Network-free: it runs against committed fixtures (scripts/fixtures/livefire-*), so CI
 * never depends on the live CWFIS service.
 *
 * Run it with:  npm run verify:livefire
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  normalizeFeed, parseHotspots, countFires, severityFor, countryOf, filterCountry,
  parseReportedFires, normalizeReported, normalizeSummary, parseBurnPolygons,
  stageOf, isActiveStage, radiusMetersForHa, filterReportedCountry,
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

// ── Real continent-wide fixture (subsampled CWFIS hotspots, many agencies/provinces+states) ──
const ca = fx('livefire-cwfis-canada.geojson') as { features: unknown[] };
const hs = parseHotspots(ca);
ok('continent fixture parses all features (no geographic filter)', hs.length === ca.features.length, `parsed ${hs.length}/${ca.features.length}`);
ok('every parsed hotspot has lat/lon', hs.every((h) => Number.isFinite(h.lat) && Number.isFinite(h.lon)));
ok('GOLD STANDARD: full CWFIS field record kept in props (≥30 fields)', hs.every((h) => Object.keys(h.props).length >= 30), `min=${Math.min(...hs.map((h) => Object.keys(h.props).length))}`);
ok('the FWI System codes survive in props', hs.every((h) => 'fwi' in h.props && 'ffmc' in h.props && 'dmc' in h.props && 'isi' in h.props && 'bui' in h.props && 'dc' in h.props));
ok('multiple agencies present (continental, not one province)', new Set(hs.map((h) => h.agency)).size >= 5, `agencies=${new Set(hs.map((h) => h.agency)).size}`);

// ── Country classification + filter (the default-Canada dropdown) ──
ok('countryOf: province codes → CA', countryOf('SK') === 'CA' && countryOf('BC') === 'CA' && countryOf('ON') === 'CA');
ok('countryOf: CA the agency = California (US), not Canada', countryOf('CA') === 'US');
ok('countryOf: MX → MX, FL → US, empty → OT', countryOf('MX') === 'MX' && countryOf('FL') === 'US' && countryOf('') === 'OT');
ok('every parsed hotspot has a country', hs.every((h) => ['CA', 'US', 'MX', 'OT'].includes(h.country)));
const caOnly = filterCountry(hs, 'CA');
ok('filterCountry(CA) returns only Canadian detections', caOnly.length > 0 && caOnly.every((h) => h.country === 'CA'), `ca=${caOnly.length}`);
ok("filterCountry('all') is the whole set", filterCountry(hs, 'all').length === hs.length);
ok('CA + US + MX + OT partition the feed', filterCountry(hs, 'CA').length + filterCountry(hs, 'US').length + filterCountry(hs, 'MX').length + filterCountry(hs, 'OT').length === hs.length);

const feed = normalizeFeed(ca, { fetchedAt: FETCHED, source: 'live' });
ok('feed totalDetections === parsed count', feed.totalDetections === hs.length);
ok('fireCount clusters down below the raw detections', feed.fireCount > 0 && feed.fireCount <= feed.totalDetections, `${feed.fireCount}/${feed.totalDetections}`);
ok('feed carries fetchedAt + source', feed.fetchedAt === FETCHED && feed.source === 'live');
ok('every hotspot has a valid severity', feed.hotspots.every((h) => ['low', 'moderate', 'high', 'extreme'].includes(h.severity)));

// Determinism
ok('normalize is deterministic', JSON.stringify(normalizeFeed(ca, { fetchedAt: FETCHED, source: 'live' }).hotspots.map((h) => [h.lat, h.lon, h.hfi])) === JSON.stringify(feed.hotspots.map((h) => [h.lat, h.lon, h.hfi])));

// countFires sanity: two far-apart points → 2 fires; two within 6km → 1 fire.
const far = parseHotspots({ type: 'FeatureCollection', features: [
  { type: 'Feature', properties: { lat: 55, lon: -106, hfi: 100 } },
  { type: 'Feature', properties: { lat: 49, lon: -120, hfi: 100 } },
] });
ok('countFires: far-apart detections = 2 fires', countFires(far) === 2, `${countFires(far)}`);
const near = parseHotspots({ type: 'FeatureCollection', features: [
  { type: 'Feature', properties: { lat: 55.0, lon: -106.0, hfi: 100 } },
  { type: 'Feature', properties: { lat: 55.02, lon: -106.02, hfi: 100 } },
] });
ok('countFires: detections within 6km = 1 fire', countFires(near) === 1, `${countFires(near)}`);

// ── Empty fixture → empty feed, no throw ──
let threw = false;
let emptyFeed = null as ReturnType<typeof normalizeFeed> | null;
try {
  emptyFeed = normalizeFeed(fx('livefire-empty.geojson'), { fetchedAt: FETCHED, source: 'live' });
} catch {
  threw = true;
}
ok('empty fixture never throws', !threw);
ok('empty fixture → 0 hotspots / 0 fires', !!emptyFeed && emptyFeed.hotspots.length === 0 && emptyFeed.fireCount === 0);

// ── Malformed fixture → defensive parse keeps ONLY the one valid-coord feature, never throws ──
threw = false;
let bad = [] as ReturnType<typeof parseHotspots>;
try {
  bad = parseHotspots(fx('livefire-malformed.json'));
} catch {
  threw = true;
}
ok('malformed fixture never throws', !threw);
ok('malformed fixture → only the 1 well-formed feature survives', bad.length === 1, `kept ${bad.length}`);

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

// ════════════ AUTHORITATIVE reported-fire layer (CIFFC ytd_fires) ════════════
const ytd = fx('livefire-ciffc-ytd.geojson');
const rf = parseReportedFires(ytd);
ok('parseReportedFires drops the no-coordinate feature', rf.length === 6, `kept ${rf.length}/7`);
ok('reported fire reads geometry coords when lat/lon props absent (ON_201)', rf.some((f) => f.fireId === '2026_ON_201' && Math.abs(f.lat - 50.1) < 1e-9 && Math.abs(f.lon + 89.7) < 1e-9));
ok('reported fire keeps the full prop bag', rf.every((f) => 'field_stage_of_control_status' in f.props));
ok('stage normalized (lowercase uc → UC)', rf.find((f) => f.fireId === '2026_ON_201')!.stage === 'UC');
ok('reported fires classified to Canada from agency code', rf.every((f) => f.country === 'CA'));
ok('reported size kept verbatim (SK_042 = 15230.5 ha)', rf.find((f) => f.fireId === '2026_SK_042')!.sizeHa === 15230.5);

const repFeed = normalizeReported(ytd, { fetchedAt: FETCHED, source: 'live' });
ok('normalizeReported maps ONLY active stages (OC/BH/UC, not OUT)', repFeed.fires.length === 5 && repFeed.fires.every((f) => f.stage !== 'OUT'), `active=${repFeed.fires.length}`);
ok('normalizeReported tallies every stage for the legend', repFeed.byStage.OC === 2 && repFeed.byStage.BH === 1 && repFeed.byStage.UC === 2 && repFeed.byStage.OUT === 1);
ok('reported feed carries fetchedAt + source', repFeed.fetchedAt === FETCHED && repFeed.source === 'live');
ok('filterReportedCountry(CA) keeps CA, (US) empties', filterReportedCountry(repFeed.fires, 'CA').length === 5 && filterReportedCountry(repFeed.fires, 'US').length === 0);

// stageOf / isActiveStage / area-accurate radius
ok('stageOf maps codes + blanks', stageOf('OC') === 'OC' && stageOf('bh') === 'BH' && stageOf('UC') === 'UC' && stageOf('OUT') === 'OUT' && stageOf('') === 'UNK' && stageOf(null) === 'UNK' && stageOf('zzz') === 'UNK');
ok('isActiveStage: OC/BH/UC active; OUT/UNK not', isActiveStage('OC') && isActiveStage('BH') && isActiveStage('UC') && !isActiveStage('OUT') && !isActiveStage('UNK'));
ok('radiusMetersForHa is AREA-accurate (1 ha → r ≈ 56.42 m)', Math.abs(radiusMetersForHa(1) - 56.41895835477563) < 1e-6, `${radiusMetersForHa(1)}`);
ok('radiusMetersForHa scales with √area (100 ha = 10× the 1 ha radius)', Math.abs(radiusMetersForHa(100) - 10 * radiusMetersForHa(1)) < 1e-6);
ok('radiusMetersForHa clamps junk to 0', radiusMetersForHa(0) === 0 && radiusMetersForHa(-5) === 0 && radiusMetersForHa(NaN) === 0);

// ── National summary (CIFFC dashboard) ──
const sum = normalizeSummary(fx('livefire-ciffc-summary.json'), { fetchedAt: FETCHED, source: 'live' });
ok('summary maps the dashboard fields', sum.firesToday === 3 && sum.activeFires === 95 && sum.ytdTotal === 1715 && Math.abs(sum.areaBurnedHa - 148939.2) < 1e-6 && sum.prepLevel === 2);
ok('summary derives ytdOut = total − active', sum.ytdOut === 1715 - 95);
let sThrew = false;
let sJunk = null as ReturnType<typeof normalizeSummary> | null;
try {
  sJunk = normalizeSummary(null, { fetchedAt: FETCHED, source: 'live' });
} catch {
  sThrew = true;
}
ok('summary tolerates junk → zeros, no throw', !sThrew && !!sJunk && sJunk.ytdTotal === 0 && sJunk.activeFires === 0 && sJunk.ytdOut === 0);

// ── Burn perimeters (CWFIS M3 polygons) ──
const polys = parseBurnPolygons(fx('livefire-m3-polygons.geojson'));
ok('parseBurnPolygons keeps Polygon + MultiPolygon, drops the degenerate (<3 pt) ring', polys.length === 2, `kept ${polys.length}`);
ok('perimeter ring is [lat,lon] order (Leaflet)', polys[0].ring[0][0] === 56.1 && polys[0].ring[0][1] === -103.2);
ok('perimeter carries area (ha)', Math.abs(polys[0].areaHa - 76.218155) < 1e-6);
ok('parseBurnPolygons tolerates junk', parseBurnPolygons(null).length === 0 && parseBurnPolygons({ features: 'no' }).length === 0);

// ── Report ──
console.log(`\nverify:livefire — ${pass} passed, ${fail} failed`);
if (fail) {
  console.log('\nFailures:');
  for (const f of failures) console.log('  ✗ ' + f);
  process.exit(1);
}
console.log('✓ live wildfire normalize core is sound (full CWFIS detail preserved, continent-wide)');
