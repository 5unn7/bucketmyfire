/**
 * Threat triage — the layer that turns a map full of dots into an answer.
 *
 * A live map of ~900 fires is honest but useless to a member of the public: every mark looks equally
 * important, so the only question they actually have ("is anything serious, and is it near people?")
 * goes unanswered. A dispatcher solves that with judgement and local knowledge. This is the civilian
 * stand-in: a transparent, explainable ranking that surfaces the handful of fires worth looking at,
 * which the console then shows as a ranked rail AND as animated halos on the map.
 *
 * Pure functions over POJOs — no DOM, no Leaflet, no fetch — so `verify:livefire` can assert the
 * ranking in plain Node, and the same numbers back both the rail and the map.
 *
 * HONESTY BOUNDARY (important): this is OUR derived reading of public data, not an official
 * assessment. Nobody publishes a "threat score", so the UI must never present it as an agency
 * judgement — the rail shows the INPUTS (size, stage, nearest community + distance) and orders by
 * them; the score itself is an ordering device, never a number shown to the user. Distance is to a
 * curated place list, so it means "near this town", never "this town is being evacuated".
 */
import { STAGE_URGENCY } from './view';
import { PLACES } from './places';
import type { ReportedFire } from './types';

/** Mean Earth radius (km) — great-circle distance is plenty at province scale. */
const EARTH_KM = 6371;

/** Great-circle distance in km between two lat/lon points. */
export function haversineKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const rad = Math.PI / 180;
  const dLat = (bLat - aLat) * rad;
  const dLon = (bLon - aLon) * rad;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** The nearest curated place to a point, with its distance. `null` when the place list is empty. */
export function nearestPlace(lat: number, lon: number): { name: string; km: number } | null {
  let best: { name: string; km: number } | null = null;
  for (const p of PLACES) {
    const km = haversineKm(lat, lon, p.lat, p.lon);
    if (!best || km < best.km) best = { name: p.name, km };
  }
  return best;
}

/** A fire plus the derived facts the rail displays and the ranking is built from. */
export interface ThreatRow {
  fire: ReportedFire;
  /** Ordering device only — never rendered as a number (see the honesty boundary above). */
  score: number;
  /** Nearest curated place, for the "40 km from La Ronge" line. `null` if none could be resolved. */
  near: { name: string; km: number } | null;
}

// The distance at which proximity stops mattering to the ranking. Beyond ~200 km a fire is remote
// enough that its size and stage should decide alone; inside it, closeness lifts a fire up the list.
const PROXIMITY_KM = 200;

/**
 * Rank fires by how much they warrant a look right now.
 *
 * `magnitude · urgency · proximity`, each deliberately simple and explainable:
 *   • magnitude — log10 of hectares, so a 50,000 ha fire outranks a 500 ha one without a single
 *     monster flattening the rest of the list to zero.
 *   • urgency   — stage of control (`STAGE_URGENCY`): out of control counts fully, contained barely.
 *   • proximity — up to a 2× lift as the nearest town approaches, tapering to 1× past PROXIMITY_KM.
 *
 * Fires with an unknown size (`sizeHa < 0`) still rank — they fall back to the smallest magnitude
 * rather than being dropped, because "size not reported" must never read as "no fire".
 */
export function rankThreats(fires: ReportedFire[], limit = 12): ThreatRow[] {
  const rows: ThreatRow[] = [];
  for (const fire of fires) {
    const urgency = STAGE_URGENCY[fire.stage] ?? 0;
    if (urgency <= 0) continue; // an extinguished fire is not a threat, whatever its size
    const near = nearestPlace(fire.lat, fire.lon);
    const magnitude = Math.log10(1 + Math.max(0, fire.sizeHa));
    const proximity = near ? 1 + Math.max(0, (PROXIMITY_KM - near.km) / PROXIMITY_KM) : 1;
    rows.push({ fire, near, score: (magnitude + 0.15) * urgency * proximity });
  }
  rows.sort((a, b) => b.score - a.score || b.fire.sizeHa - a.fire.sizeHa);
  return rows.slice(0, Math.max(0, limit));
}
