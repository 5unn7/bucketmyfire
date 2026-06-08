/**
 * Date / seed helpers — the shared "which day is it" math. The standalone Daily Burn MODE was retired
 * (the province / Open Skies is the one open-world loop now), but its date-seed primitives live on as
 * INFRASTRUCTURE: `dailySeed` is the per-day world seed for Open Skies + the Living Province (everyone
 * flies the same fresh map each day → fair board + shared ghosts), `dayNumberUTC` keys the career day
 * log, `dailyDateLabel` titles the per-day board, and the `daily-` id prefix (`isDailyId`) still marks
 * the factory's generated defs so their wins stay out of campaign progress. Engine-agnostic + pure.
 */

/** Days since the Unix epoch in UTC — the canonical "which day is it" key, shared world-wide so the
 *  per-day world (Open Skies / the province) rolls over at the same instant for everyone, any timezone. */
export function dayNumberUTC(date: Date): number {
  return Math.floor(date.getTime() / 86_400_000);
}

function ymdUTC(date: Date): { y: number; m: number; d: number } {
  return { y: date.getUTCFullYear(), m: date.getUTCMonth() + 1, d: date.getUTCDate() };
}

/** Stable per-day world seed from the UTC day number (integer-hash mixed for good spread). The shared
 *  seed behind Open Skies + the Living Province (salted per-mode in their builders). */
export function dailySeed(date: Date): number {
  let a = (dayNumberUTC(date) ^ 0x9e3779b9) >>> 0;
  a = Math.imul(a ^ (a >>> 16), 0x45d9f3b) >>> 0;
  a = Math.imul(a ^ (a >>> 16), 0x45d9f3b) >>> 0;
  return (a ^ (a >>> 16)) >>> 0;
}

/** True for any factory-generated `daily-`-prefixed id — KEEPS those wins out of campaign progress
 *  (progress.recordWin) the same way the old Daily Burn ids did. */
export function isDailyId(id: string): boolean {
  return id.startsWith('daily-');
}

/** Human-facing date for a per-day board title, e.g. "Jun 4, 2026". */
export function dailyDateLabel(date: Date): string {
  const { y, m, d } = ymdUTC(date);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[m - 1]} ${d}, ${y}`;
}
