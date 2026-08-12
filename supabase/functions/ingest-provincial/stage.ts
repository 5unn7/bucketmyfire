/**
 * Provincial fire STATUS → CIFFC stage-of-control code. Imported by BOTH the `ingest-provincial` Edge
 * Function (Deno, as `./stage.ts`) and the Node verifier (`scripts/verify-livecount.ts`), so the mapping
 * that decides whether a fire counts as ACTIVE is testable offline instead of only being observable in
 * production. One file, no copy to drift.
 *
 * Pure: no Deno APIs, no imports, no clock. Keep it that way — both runtimes load this file directly.
 *
 * Why this file exists: on 2026-08-12 the live map disagreed with CIFFC by 23%, and two of the three
 * causes were in this function. Quebec abbreviates out-of-control as "Hors-Ctrl", which matched none of
 * the long-form spellings, so the province's most dangerous fires (one at 62,180 ha) fell through to UNK
 * and went uncounted. Ontario's "Being Observed" was treated as unmapped, dropping 73 of its 103 records
 * including a 38,306 ha fire. Both are covered by the table at the bottom of this file now.
 */
export type Stage = 'OC' | 'BH' | 'UC' | 'OUT' | 'UNK';

/**
 * Generic status text → stage. Handles English phrases, CIFFC letter codes, ON/enum codes, French
 * (SOPFEU) long AND abbreviated forms, and YT "CODE - Label" strings.
 *
 * ORDER MATTERS. `OUT` is tested first so "declared out"/"éteint" can't be swallowed by a looser rule,
 * and "not under control"/"out of control" precede the bare "under control"/"control" checks, which
 * would otherwise match them as substrings.
 */
export function stageFromText(v: unknown): Stage {
  const s = String(v ?? '').trim().toLowerCase().replace(/_/g, ' ');
  if (!s) return 'UNK';
  // NOTE the ANCHOR on the "- out" form. Yukon publishes "CODE - Label" strings, so its statuses read
  // "EX - Out" (out) but also "OC - Out of Control" (very much not out). An unanchored `includes('- out')`
  // matches BOTH and quietly retires 21 of Yukon's 25 active fires. Only a trailing "- out" is OUT.
  if (s.includes('declared out') || s.includes('extinguish') || /-\s*out$/.test(s)
    || s === 'out' || s === 'ex' || s === 'éteint' || s === 'eteint') return 'OUT';
  if (s.includes('out of control') || s.includes('not under control') || s === 'oc' || s === 'nuc'
    || s.startsWith('hors') // hors contrôle / hors controle / hors-ctrl / hors ctrl (SOPFEU abbreviates)
    || s.includes('en activité') || s.includes('en activite')) return 'OC';
  // A brand-new report has not been actioned yet, so it is neither "held" nor "under control".
  if (s === 'nouveau' || s === 'new') return 'OC';
  if (s.includes('being held') || s.includes('contained') || s === 'bh' || s === 'bhe' || s.includes('contenu')) return 'BH';
  if (s.includes('under control') || s === 'uc' || s === 'uco' || s.includes('maîtrisé') || s.includes('maitrise')) return 'UC';
  // MONITORED but still burning. Ontario's "Being Observed" and SOPFEU's "Sous-Observ" are ACTIVE states
  // in their agencies' own taxonomies (a fire watched rather than fought), not finished ones. UC is the
  // honest fit among the four CIFFC codes: active, but not the alarm state.
  if (s.includes('being observed') || s.includes('sous-observ') || s.includes('sous observ') || s.includes('being monitored')) return 'UC';
  // Deliberately NOT mapped: SOPFEU "Recensé" (literally "recorded"). Its operational meaning is not
  // publicly documented well enough to place on the OC/BH/UC scale, and guessing would fabricate a
  // control status the agency never stated. It stays UNK (uncounted) until someone confirms it.
  return 'UNK';
}

/**
 * Newfoundland STATUS codes, per the FFA_Wildfire layer's coded-value DOMAIN (verified 2026-06):
 * O = Out, OC = Out-of-Control, BH = Being Held, UC = Under Control. OC/BH/UC share the CIFFC codes so
 * `stageFromText` maps them; only a bare 'O' needs the override (it would otherwise be UNK).
 */
export function nlStage(v: unknown): Stage {
  if (String(v ?? '').trim().toUpperCase() === 'O') return 'OUT';
  return stageFromText(v);
}

/** The three stages CIFFC counts as an ACTIVE wildfire. OUT and UNK are not active. */
export function isActiveStage(s: Stage): boolean {
  return s === 'OC' || s === 'BH' || s === 'UC';
}

/**
 * Real status strings observed in the live provincial feeds on 2026-08-12, with the stage each MUST
 * map to. This is the regression table for the miscount: every row here is a string an agency actually
 * published, not an invented example. Extend it when a new source or spelling appears.
 */
export const REAL_STATUS_CASES: ReadonlyArray<readonly [source: string, status: string, expect: Stage]> = [
  // Quebec (SOPFEU) — abbreviated French. 'Hors-Ctrl' was the one that silently broke.
  ['qc-sopfeu', 'Hors-Ctrl', 'OC'],
  ['qc-sopfeu', 'Maîtrisé', 'UC'],
  ['qc-sopfeu', 'Contenu', 'BH'],
  ['qc-sopfeu', 'Sous-Observ', 'UC'],
  ['qc-sopfeu', 'Nouveau', 'OC'],
  ['qc-sopfeu', 'Recensé', 'UNK'], // deliberately unmapped, see stageFromText
  // Ontario (MNRF) — 'Being Observed' is an ACTIVE state in Ontario's taxonomy.
  ['on-mnrf', 'Being Observed', 'UC'],
  ['on-mnrf', 'Not Under Control', 'OC'],
  ['on-mnrf', 'Under Control', 'UC'],
  ['on-mnrf', 'Being Held', 'BH'],
  ['on-mnrf', 'Out', 'OUT'],
  // Alberta
  ['ab-wildfire', 'Out of Control', 'OC'],
  ['ab-wildfire', 'Being Held', 'BH'],
  ['ab-wildfire', 'Under Control', 'UC'],
  // Yukon — "CODE - Label". The two rows that matter: an unanchored "- out" match sends the second one
  // to OUT and silently retires most of the territory's active fires.
  ['yt-wildfire', 'EX - Out', 'OUT'],
  ['yt-wildfire', 'OC - Out of Control', 'OC'],
  ['yt-wildfire', 'BH - Being Held', 'BH'],
  ['yt-wildfire', 'UC - Under Control', 'UC'],
  // British Columbia
  ['bc-wildfire', 'Out of Control', 'OC'],
  ['bc-wildfire', 'Out', 'OUT'],
  // Northwest Territories — underscored enum.
  ['nt-ecc', 'OUT_OF_CONTROL', 'OC'],
  ['nt-ecc', 'BEING_HELD', 'BH'],
  ['nt-ecc', 'UNDER_CONTROL', 'UC'],
  ['nt-ecc', 'DECLARED_OUT', 'OUT'],
  // Junk / absent must never become an active fire.
  ['*', '', 'UNK'],
  ['*', '   ', 'UNK'],
];
