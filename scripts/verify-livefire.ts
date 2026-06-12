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
  parseReportedFires, normalizeReported, normalizeSummary, parseBurnPolygons, normalizeBurn,
  stageOf, isActiveStage, radiusMetersForHa, filterReportedCountry, parseFwiIssueDate, parseMs, smokeForecastFrames,
  forecastLeadLabel,
  parseRegion, regionValue, regionLabel, filterReportedRegion, filterRegionHotspots, regionOptions, deriveRegionStats,
  deriveFireActivity,
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

const feed = normalizeFeed(ca, { fetchedAt: FETCHED, status: 'live', fromCache: false });
ok('feed totalDetections === parsed count', feed.totalDetections === hs.length);
ok('fireCount clusters down below the raw detections', feed.fireCount > 0 && feed.fireCount <= feed.totalDetections, `${feed.fireCount}/${feed.totalDetections}`);
ok('feed carries the honesty meta (status + fetchedAt)', feed.meta.fetchedAt === FETCHED && feed.meta.status === 'live' && feed.meta.fromCache === false);
ok('feed publishedAt = freshest satellite detection (rep_date), NOT our fetch time', feed.meta.publishedAt === Math.max(...hs.map((h) => h.at)) && feed.meta.publishedAt > 0, `${feed.meta.publishedAt}`);
ok('every hotspot has a valid severity', feed.hotspots.every((h) => ['low', 'moderate', 'high', 'extreme'].includes(h.severity)));

// Determinism
ok('normalize is deterministic', JSON.stringify(normalizeFeed(ca, { fetchedAt: FETCHED, status: 'live', fromCache: false }).hotspots.map((h) => [h.lat, h.lon, h.hfi])) === JSON.stringify(feed.hotspots.map((h) => [h.lat, h.lon, h.hfi])));

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
  emptyFeed = normalizeFeed(fx('livefire-empty.geojson'), { fetchedAt: FETCHED, status: 'live', fromCache: false });
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

const repFeed = normalizeReported(ytd, { fetchedAt: FETCHED, status: 'live', fromCache: false });
ok('normalizeReported maps ONLY active stages (OC/BH/UC, not OUT)', repFeed.fires.length === 5 && repFeed.fires.every((f) => f.stage !== 'OUT'), `active=${repFeed.fires.length}`);
ok('normalizeReported tallies every stage for the legend', repFeed.byStage.OC === 2 && repFeed.byStage.BH === 1 && repFeed.byStage.UC === 2 && repFeed.byStage.OUT === 1);
ok('normalizeReported also keeps the OUT (extinguished) fires for the opt-in "Out fires" layer', repFeed.out.length === 1 && repFeed.out.every((f) => f.stage === 'OUT'), `out=${repFeed.out.length}`);
ok('reported feed carries the honesty meta (status + fetchedAt)', repFeed.meta.fetchedAt === FETCHED && repFeed.meta.status === 'live');
ok('reported publishedAt = latest situation-report date (the CIFFC sitrep cycle), NOT our fetch time', repFeed.meta.publishedAt === Math.max(...rf.map((f) => f.at)) && repFeed.meta.publishedAt > 0, `${repFeed.meta.publishedAt}`);
ok('filterReportedCountry(CA) keeps CA, (US) empties', filterReportedCountry(repFeed.fires, 'CA').length === 5 && filterReportedCountry(repFeed.fires, 'US').length === 0);

// stageOf / isActiveStage / area-accurate radius
ok('stageOf maps codes + blanks', stageOf('OC') === 'OC' && stageOf('bh') === 'BH' && stageOf('UC') === 'UC' && stageOf('OUT') === 'OUT' && stageOf('') === 'UNK' && stageOf(null) === 'UNK' && stageOf('zzz') === 'UNK');
ok('isActiveStage: OC/BH/UC active; OUT/UNK not', isActiveStage('OC') && isActiveStage('BH') && isActiveStage('UC') && !isActiveStage('OUT') && !isActiveStage('UNK'));
ok('radiusMetersForHa is AREA-accurate (1 ha → r ≈ 56.42 m)', Math.abs(radiusMetersForHa(1) - 56.41895835477563) < 1e-6, `${radiusMetersForHa(1)}`);
ok('radiusMetersForHa scales with √area (100 ha = 10× the 1 ha radius)', Math.abs(radiusMetersForHa(100) - 10 * radiusMetersForHa(1)) < 1e-6);
ok('radiusMetersForHa clamps junk to 0', radiusMetersForHa(0) === 0 && radiusMetersForHa(-5) === 0 && radiusMetersForHa(NaN) === 0);

// ── National summary (CIFFC dashboard) ──
const sum = normalizeSummary(fx('livefire-ciffc-summary.json'), { fetchedAt: FETCHED, status: 'live', fromCache: false });
ok('summary maps the dashboard fields', sum.firesToday === 3 && sum.activeFires === 95 && sum.ytdTotal === 1715 && Math.abs(sum.areaBurnedHa - 148939.2) < 1e-6 && sum.prepLevel === 2);
ok('summary derives ytdOut = total − active', sum.ytdOut === 1715 - 95);
ok('summary publishedAt = the CIFFC sitrep date (NOT our fetch time)', sum.meta.publishedAt === parseMs('2026-06-08') && sum.meta.publishedAt > 0, `${sum.meta.publishedAt}`);
let sThrew = false;
let sJunk = null as ReturnType<typeof normalizeSummary> | null;
try {
  sJunk = normalizeSummary(null, { fetchedAt: FETCHED, status: 'live', fromCache: false });
} catch {
  sThrew = true;
}
ok('summary tolerates junk → zeros, no throw', !sThrew && !!sJunk && sJunk.ytdTotal === 0 && sJunk.activeFires === 0 && sJunk.ytdOut === 0);
ok('junk summary has no fabricated publish time (publishedAt === 0)', !!sJunk && sJunk.meta.publishedAt === 0);

// ════════════ Region selection (country + Canadian province) + the HONEST firestats ════════════
// Parse / round-trip / label — illegal combos degrade to Canada-all, never throw.
ok('parseRegion: CA:SK → province', JSON.stringify(parseRegion('CA:SK')) === JSON.stringify({ country: 'CA', agency: 'SK' }));
ok('parseRegion: country values pass through (no agency)', parseRegion('US').country === 'US' && parseRegion('all').country === 'all' && parseRegion('US').agency === undefined);
ok('parseRegion: illegal/junk → Canada-all', JSON.stringify(parseRegion('US:SK')) === JSON.stringify({ country: 'CA' }) && JSON.stringify(parseRegion('CA:ZZ')) === JSON.stringify({ country: 'CA' }) && JSON.stringify(parseRegion('')) === JSON.stringify({ country: 'CA' }));
ok('regionValue round-trips parseRegion', regionValue({ country: 'CA', agency: 'SK' }) === 'CA:SK' && regionValue({ country: 'CA' }) === 'CA' && regionValue({ country: 'US' }) === 'US');
ok('regionLabel names the province / country', regionLabel({ country: 'CA', agency: 'SK' }) === 'Saskatchewan' && regionLabel({ country: 'US' }) === 'United States');

// Filters: a province narrows WITHIN Canada; with no agency the region filter == the country filter.
const skFires = filterReportedRegion(repFeed.fires, { country: 'CA', agency: 'SK' });
ok('filterReportedRegion(SK) returns only SK active fires', skFires.length > 0 && skFires.every((f) => f.agency.toUpperCase() === 'SK'), `sk=${skFires.length}`);
ok('filterReportedRegion(no agency) === filterReportedCountry(CA)', filterReportedRegion(repFeed.fires, { country: 'CA' }).length === filterReportedCountry(repFeed.fires, 'CA').length);
ok('filterRegionHotspots(SK) keeps only SK detections', filterRegionHotspots(feed.hotspots, { country: 'CA', agency: 'SK' }).every((h) => h.agency.toUpperCase() === 'SK'));

// regionOptions: only the provinces PRESENT in the active feed (SK/BC/AB/QC/ON), never the OUT-only MB.
const optVals = regionOptions(repFeed).map((o) => o.value);
ok('regionOptions lists provinces present in the active feed', optVals.includes('CA:SK') && optVals.includes('CA:BC') && optVals.includes('CA:ON'), optVals.join(','));
ok('regionOptions excludes a province with only OUT fires (MB)', !optVals.includes('CA:MB'));
ok('regionOptions always offers CA / US / MX / all', optVals.includes('CA') && optVals.includes('US') && optVals.includes('MX') && optVals.includes('all'));

// deriveRegionStats — the HONESTY LOCKS (what the ticker is allowed to show per scope).
const REGION_NOW = repFeed.meta.publishedAt + 1;
const stProv = deriveRegionStats({ country: 'CA', agency: 'SK' }, repFeed, feed, sum, REGION_NOW);
ok('province scope = ca-province; active = SK count; stage split sums to active', stProv.scope === 'ca-province' && stProv.active === skFires.length && !!stProv.byStage && stProv.byStage.OC + stProv.byStage.BH + stProv.byStage.UC === stProv.active);
ok('HONESTY: province area/prep/season = Data not available (null)', stProv.areaBurnedHa === null && stProv.prepLevel === null && stProv.ytdTotal === null && stProv.ytdOut === null);
const stCA = deriveRegionStats({ country: 'CA' }, repFeed, feed, sum, REGION_NOW);
ok('Canada-all scope = ca-national; uses the AUTHORITATIVE summary', stCA.scope === 'ca-national' && stCA.active === sum.activeFires && stCA.areaBurnedHa === sum.areaBurnedHa && stCA.prepLevel === sum.prepLevel);
const stUS = deriveRegionStats({ country: 'US' }, repFeed, feed, sum, REGION_NOW);
ok('US scope = foreign: NO reported active (null); satellite hotspots are the metric', stUS.scope === 'foreign' && stUS.active === null && stUS.byStage === null && typeof stUS.hotspots === 'number' && (stUS.hotspots ?? -1) >= 0);
const downRep = normalizeReported({ features: [] }, { fetchedAt: FETCHED, status: 'unavailable', fromCache: false });
const downHs = normalizeFeed({ features: [] }, { fetchedAt: FETCHED, status: 'unavailable', fromCache: false });
const stDown = deriveRegionStats({ country: 'CA' }, downRep, downHs, null, REGION_NOW);
ok('all feeds unavailable → scope down; every headline number null', stDown.scope === 'down' && stDown.active === null && stDown.byStage === null && stDown.areaBurnedHa === null && stDown.hotspots === null);

// ── Burn perimeters (CWFIS M3 polygons) ──
const polys = parseBurnPolygons(fx('livefire-m3-polygons.geojson'));
ok('parseBurnPolygons keeps Polygon + MultiPolygon, drops the degenerate (<3 pt) ring', polys.length === 2, `kept ${polys.length}`);
ok('perimeter ring is [lat,lon] order (Leaflet)', polys[0].ring[0][0] === 56.1 && polys[0].ring[0][1] === -103.2);
ok('perimeter carries area (ha)', Math.abs(polys[0].areaHa - 76.218155) < 1e-6);
ok('parseBurnPolygons tolerates junk', parseBurnPolygons(null).length === 0 && parseBurnPolygons({ features: 'no' }).length === 0);

const burn = normalizeBurn(fx('livefire-m3-polygons.geojson'), { fetchedAt: FETCHED, status: 'live', fromCache: false });
ok('normalizeBurn wraps the polygons + honesty meta', burn.polys.length === 2 && burn.meta.status === 'live' && burn.meta.fetchedAt === FETCHED);
ok('burn publishedAt = freshest M3 lastdate', burn.meta.publishedAt === Math.max(...burn.polys.map((p) => p.at)) && burn.meta.publishedAt > 0, `${burn.meta.publishedAt}`);

// ════════════ FWI raster issue date (parse the dated WMS <Title>, never fabricate) ════════════
const fwiCaps =
  '<Layer queryable="1"><Name>public:fwi_current</Name>' +
  '<Title>Fire Weather Index / Indice Forêt-Météo (SCRIBE forecast / Prévisions SCRIBE) - 2026-06-09</Title></Layer>';
ok('parseFwiIssueDate pulls the trailing date out of the fwi_current Title', parseFwiIssueDate(fwiCaps) === parseMs('2026-06-09') && parseFwiIssueDate(fwiCaps) > 0);
ok('parseFwiIssueDate → 0 (no fabricated time) when the Title carries no date', parseFwiIssueDate('<Layer><Name>public:fwi_current</Name><Title>Fire Weather Index</Title></Layer>') === 0);
ok('parseFwiIssueDate tolerates junk', parseFwiIssueDate('') === 0 && parseFwiIssueDate('<nope/>') === 0 && parseFwiIssueDate(null as unknown as string) === 0);

// ════════════ Smoke forecast frame timeline (pure, takes `now` → hourly GeoMet TIME params) ════════════
const NOW = Date.parse('2026-06-09T18:30:00Z');
const frames = smokeForecastFrames(NOW, 48);
ok('smokeForecastFrames spans hours+1 frames', frames.length === 49, `${frames.length}`);
ok('smokeForecastFrames floors to the hour, ISO-Z, no millis', frames[0] === '2026-06-09T18:00:00Z');
ok('smokeForecastFrames steps exactly 1h forward', frames[1] === '2026-06-09T19:00:00Z' && frames[48] === '2026-06-11T18:00:00Z');
ok('smokeForecastFrames defensive (0 / NaN hours → single frame)', smokeForecastFrames(NOW, 0).length === 1 && smokeForecastFrames(NOW, NaN).length === 1);

// forecastLeadLabel: the scrubber's hourly lead chip ("Now" / "+6 h" / "+1 d 2 h"), pure on the frame index.
ok('forecastLeadLabel: frame 0 is "Now"', forecastLeadLabel(0) === 'Now' && forecastLeadLabel(-3) === 'Now');
ok('forecastLeadLabel: hours within a day', forecastLeadLabel(1) === '+1 h' && forecastLeadLabel(6) === '+6 h' && forecastLeadLabel(23) === '+23 h');
ok('forecastLeadLabel: rolls past a day', forecastLeadLabel(24) === '+1 d' && forecastLeadLabel(26) === '+1 d 2 h' && forecastLeadLabel(48) === '+2 d');
ok('forecastLeadLabel: junk → "Now" (never NaN)', forecastLeadLabel(NaN) === 'Now' && forecastLeadLabel(Infinity) === 'Now');

// ════════════ Per-fire satellite activity (the whole-season hotspot archive → daily timeline) ════════════
// Shape mirrors the slim production query (propertyName=rep_date): features carrying ONLY rep_date.
const actFc = (dates: string[]): unknown => ({ type: 'FeatureCollection', features: dates.map((d) => ({ type: 'Feature', properties: { rep_date: d } })) });
const SEASON = Date.parse('2026-01-01T00:00:00Z');
const act = deriveFireActivity(actFc([
  '2026-06-10T04:00:00', '2026-06-09T18:30:00', '2026-06-09T03:00:00', '2026-06-02T19:45:00', // newest-first, like the source
  '2022-08-24T12:00:00', // a PRIOR fire at the same spot — must be fenced off by seasonStart
]), SEASON, 3000);
ok('deriveFireActivity groups in-season detections per UTC day', act !== null && act.days.length === 3 && act.total === 4, JSON.stringify(act?.days));
ok('deriveFireActivity days ascend + multi-pass days count', act?.days[0].day === '2026-06-02' && act?.days[1].day === '2026-06-09' && act?.days[1].count === 2);
ok('deriveFireActivity firstAt = oldest IN-SEASON detection (prior-year fire excluded)', act?.firstAt === parseMs('2026-06-02T19:45:00') && act?.lastAt === parseMs('2026-06-10T04:00:00'));
ok('deriveFireActivity: a pre-season row present → NOT clipped (we reached past the season start)', act?.clipped === false);
const actCapped = deriveFireActivity(actFc(['2026-06-10T04:00:00', '2026-06-09T18:30:00']), SEASON, 2);
ok('deriveFireActivity: row cap hit with everything in-season → clipped (true start may be older)', actCapped?.clipped === true);
ok('deriveFireActivity: nothing in-season → null (no activity ≠ a zero record)', deriveFireActivity(actFc(['2022-08-24T12:00:00']), SEASON, 3000) === null);
ok('deriveFireActivity defensive (junk/empty → null, no throw)', deriveFireActivity(null, SEASON, 3000) === null && deriveFireActivity({}, SEASON, 3000) === null && deriveFireActivity(actFc([]), SEASON, 3000) === null);

// ── Report ──
console.log(`\nverify:livefire — ${pass} passed, ${fail} failed`);
if (fail) {
  console.log('\nFailures:');
  for (const f of failures) console.log('  ✗ ' + f);
  process.exit(1);
}
console.log('✓ live wildfire normalize core is sound (full CWFIS detail preserved, continent-wide)');
