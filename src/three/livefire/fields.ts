/**
 * CWFIS hotspot FIELD METADATA — the gold-standard detail the map's panel shows when you tap a fire.
 * CWFIS publishes ~35 fields per detection; this maps the meaningful ones to a human label, a unit, and
 * a formatter, grouped the way a fire analyst reads them (detection · behaviour · the FWI System codes ·
 * weather · site). Nothing is invented — these are the real CFFDRS / Fire Weather Index System fields.
 *
 * Pure presentation data (formatters may use Date/Intl) — no Three, no Leaflet.
 */

import { stageLabel } from './strings';

export interface FieldDef {
  key: string;
  label: string;
  fmt: (v: unknown) => string;
}
export interface FieldGroup {
  group: string;
  fields: FieldDef[];
}

const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

function asNum(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? parseFloat(v) : NaN;
  return Number.isFinite(n) ? n : null;
}
/** A number formatter with fixed decimals + optional unit; em-dash for missing/non-numeric. */
function num(decimals: number, unit = ''): (v: unknown) => string {
  return (v) => {
    const n = asNum(v);
    if (n == null) return '—';
    const s = n.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    return unit ? `${s} ${unit}` : s;
  };
}
function text(v: unknown): string {
  return v == null || v === '' ? '—' : String(v);
}
function compass(v: unknown): string {
  const n = asNum(v);
  if (n == null) return '—';
  return `${Math.round(n)}° ${COMPASS[Math.round(((n % 360) / 22.5)) % 16]}`;
}
function yesNo(v: unknown): string {
  const n = asNum(v);
  return n == null ? '—' : n ? 'Yes' : 'No';
}
/** A percentage that uses CIFFC's −1 "unknown" sentinel — anything < 0 reads as a dash. */
function pctOrUnknown(v: unknown): string {
  const n = asNum(v);
  return n == null || n < 0 ? '—' : `${Math.round(n)} %`;
}
/** CIFFC response-type code → readable phrase (unmapped codes pass through verbatim). */
const RESPONSE_LABEL: Record<string, string> = { FUL: 'Full response', MOD: 'Modified response', MON: 'Monitored', NDR: 'No defined response' };
function responseType(v: unknown): string {
  if (v == null || v === '') return '—';
  const k = String(v).toUpperCase();
  return RESPONSE_LABEL[k] ?? String(v);
}
/** CIFFC system fire cause → readable (H human, L lightning, U/Und unknown). */
function fireCause(v: unknown): string {
  if (v == null || v === '') return '—';
  const k = String(v).trim().toUpperCase();
  if (k === 'H') return 'Human';
  if (k === 'L') return 'Lightning';
  if (k === 'U' || k === 'UND' || k === 'UNK') return 'Unknown';
  return String(v);
}
/** rep_date → a readable local datetime. */
export function fmtDate(v: unknown): string {
  if (typeof v !== 'string') return '—';
  const t = Date.parse(v);
  if (!Number.isFinite(t)) return '—';
  return new Date(t).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** The grouped field layout the detail panel renders (in order). */
export const FIELD_GROUPS: FieldGroup[] = [
  {
    group: 'Detection',
    fields: [
      { key: 'rep_date', label: 'Reported', fmt: fmtDate },
      { key: 'agency', label: 'Agency', fmt: text },
      { key: 'satellite', label: 'Satellite', fmt: text },
      { key: 'sensor', label: 'Sensor', fmt: text },
      { key: 'source', label: 'Source', fmt: text },
      { key: 'frp', label: 'Fire radiative power', fmt: num(1, 'MW') },
    ],
  },
  {
    group: 'Fire behaviour',
    fields: [
      { key: 'hfi', label: 'Head fire intensity', fmt: num(0, 'kW/m') },
      { key: 'ros', label: 'Rate of spread', fmt: num(2, 'm/min') },
      { key: 'fuel', label: 'Fuel type', fmt: text },
      { key: 'sfc', label: 'Surface fuel consumption', fmt: num(2, 'kg/m²') },
      { key: 'tfc', label: 'Total fuel consumption', fmt: num(2, 'kg/m²') },
      { key: 'cfb', label: 'Crown fraction burned', fmt: num(0, '%') },
      { key: 'estarea', label: 'Estimated area', fmt: num(1, 'ha') },
      { key: 'pconif', label: 'Conifer cover', fmt: num(0, '%') },
    ],
  },
  {
    group: 'Fire Weather Index System',
    fields: [
      { key: 'ffmc', label: 'Fine Fuel Moisture Code (FFMC)', fmt: num(1) },
      { key: 'dmc', label: 'Duff Moisture Code (DMC)', fmt: num(1) },
      { key: 'dc', label: 'Drought Code (DC)', fmt: num(1) },
      { key: 'isi', label: 'Initial Spread Index (ISI)', fmt: num(1) },
      { key: 'bui', label: 'Buildup Index (BUI)', fmt: num(1) },
      { key: 'fwi', label: 'Fire Weather Index (FWI)', fmt: num(1) },
    ],
  },
  {
    group: 'Weather',
    fields: [
      { key: 'temp', label: 'Temperature', fmt: num(1, '°C') },
      { key: 'rh', label: 'Relative humidity', fmt: num(0, '%') },
      { key: 'ws', label: 'Wind speed', fmt: num(1, 'km/h') },
      { key: 'wd', label: 'Wind direction', fmt: compass },
      { key: 'pcp', label: 'Precipitation (24h)', fmt: num(1, 'mm') },
    ],
  },
  {
    group: 'Site',
    fields: [
      { key: 'elev', label: 'Elevation', fmt: num(0, 'm') },
      { key: 'ecozone', label: 'Ecozone', fmt: text },
      { key: 'pcuring', label: 'Grass curing', fmt: num(0, '%') },
      { key: 'greenup', label: 'Green-up', fmt: yesNo },
    ],
  },
];

/** The grouped layout for a tapped AUTHORITATIVE reported fire (a CIFFC `ytd_fires` record). Different
 *  shape from the satellite hotspot above — this is the agency-reported fire (named, sized, staged). */
export const REPORTED_FIELD_GROUPS: FieldGroup[] = [
  {
    group: 'Status',
    fields: [
      { key: 'field_stage_of_control_status', label: 'Stage of control', fmt: (v) => stageLabel(v) },
      { key: 'field_fire_size', label: 'Size', fmt: num(1, 'ha') },
      { key: 'field_percent_contained', label: 'Contained', fmt: pctOrUnknown },
      { key: 'field_response_type', label: 'Response', fmt: responseType },
    ],
  },
  {
    group: 'Fire',
    fields: [
      { key: 'field_system_fire_id', label: 'Fire ID', fmt: text },
      { key: 'field_agency_fire_id', label: 'Agency fire #', fmt: text },
      { key: 'field_system_fire_cause', label: 'Cause', fmt: fireCause },
      { key: 'field_fire_was_prescribed', label: 'Prescribed burn', fmt: yesNo },
    ],
  },
  {
    group: 'Reported',
    fields: [
      { key: 'field_situation_report_date', label: 'Situation report', fmt: fmtDate },
      { key: 'field_status_date', label: 'Status updated', fmt: fmtDate },
      { key: 'field_agency_data_timezone', label: 'Agency timezone', fmt: text },
    ],
  },
];
