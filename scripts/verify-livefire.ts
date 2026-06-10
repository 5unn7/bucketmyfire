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
  parseAlerts, normalizeAlerts, alertLevel, isWildfireAlert, parseBans, normalizeBans, parseYmd, banType, safeUrl,
  forecastLeadLabel,
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

// ════════════ Public alerts (SaskAlert) — surface verbatim, filter to wildfire, never re-classify ════════════
const saFx = fx('livefire-saskalert.json');
const parsedAlerts = parseAlerts(saFx);
ok('parseAlerts drops cancelled/ended + bad-point alerts (keeps the 2 active valid)', parsedAlerts.alerts.length === 2, `kept ${parsedAlerts.alerts.length}`);
ok('alertLevel maps codes + blanks', alertLevel('critical') === 'critical' && alertLevel('ADVISORY') === 'advisory' && alertLevel('') === 'unknown');
ok('isWildfireAlert: the fire/evac alert yes, the tornado no', isWildfireAlert(parsedAlerts.alerts[0], parsedAlerts.codes[0]) === true && isWildfireAlert(parsedAlerts.alerts[1], parsedAlerts.codes[1]) === false);
const alertFeed = normalizeAlerts(saFx, { fetchedAt: FETCHED, status: 'live', fromCache: false });
ok('normalizeAlerts filters to WILDFIRE-relevant (the evac alert, not the tornado)', alertFeed.alerts.length === 1 && alertFeed.alerts[0].event === 'evacuation order', `kept ${alertFeed.alerts.length}`);
ok('alert keeps the issuer verbatim (level/coverage/url) — never re-classified', alertFeed.alerts[0].level === 'critical' && alertFeed.alerts[0].coverage === 'Northern Saskatchewan' && alertFeed.alerts[0].url.includes('emergencyalert'));
ok('alert publishedAt = the feed updated time (NOT our fetch time)', alertFeed.meta.publishedAt === parseMs('2026-06-09T14:30:00-06:00') && alertFeed.meta.status === 'live');
let aThrew = false;
try { parseAlerts(null); parseAlerts({ entries: 'no' }); normalizeAlerts(42, { fetchedAt: FETCHED, status: 'live', fromCache: false }); } catch { aThrew = true; }
ok('alert parsers tolerate junk', !aThrew && parseAlerts(null).alerts.length === 0);
ok('safeUrl passes http(s), blocks javascript:/data:/junk (the alert html_link href guard)', safeUrl('https://x.test/a') === 'https://x.test/a' && safeUrl('http://x.test') === 'http://x.test' && safeUrl('javascript:alert(1)') === '' && safeUrl('data:text/html,x') === '' && safeUrl('  HTTPS://x.test  ') === 'HTTPS://x.test' && safeUrl('') === '' && safeUrl(null) === '');

// ════════════ Fire bans (SK SPSA) — empty = "no ban", a valid state ════════════
const banFx = fx('livefire-firebans.geojson');
const parsedBans = parseBans(banFx);
ok('parseBans keeps Polygon + MultiPolygon rings, drops the <3-pt ring (1 Ban + 2 Restriction = 3)', parsedBans.length === 3, `kept ${parsedBans.length}`);
ok('ban ring is [lat,lon] order', parsedBans[0].ring[0][0] === 55 && parsedBans[0].ring[0][1] === -106);
ok('parseBans keeps both Restriction rings from the MultiPolygon', parsedBans.filter((b) => b.type === 'Restriction').length === 2);
ok('banType maps Ban/Restriction/Advisory/other', banType('Ban') === 'Ban' && banType('restriction') === 'Restriction' && banType('advisory') === 'Advisory' && banType('zzz') === 'Other');
ok('parseYmd parses YYYYMMDD (+ tolerates ISO, junk → 0)', parseYmd('20260527') === parseMs('2026-05-27') && parseYmd('2026-05-27') === parseMs('2026-05-27') && parseYmd('') === 0);
const banFeed = normalizeBans(banFx, { fetchedAt: FETCHED, status: 'live', fromCache: false });
ok('normalizeBans publishedAt = freshest Start_Date', banFeed.meta.publishedAt === parseYmd('20260601'), `${banFeed.meta.publishedAt}`);
ok('an empty ban feed is a VALID "no ban" state (status live, 0 bans, no throw)', normalizeBans({ type: 'FeatureCollection', features: [] }, { fetchedAt: FETCHED, status: 'live', fromCache: false }).bans.length === 0);
ok('parseBans tolerates junk', parseBans(null).length === 0 && parseBans({ features: 'no' }).length === 0);

// ── Report ──
console.log(`\nverify:livefire — ${pass} passed, ${fail} failed`);
if (fail) {
  console.log('\nFailures:');
  for (const f of failures) console.log('  ✗ ' + f);
  process.exit(1);
}
console.log('✓ live wildfire normalize core is sound (full CWFIS detail preserved, continent-wide)');
