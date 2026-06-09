/**
 * Per-jurisdiction OFFICIAL wildfire viewer links. The live tracker is NATIONAL (CIFFC covers every
 * province + territory), so a fire's "official source" link must point at THAT fire's authority — an
 * Alberta fire must never link to Saskatchewan's SPSA viewer (the bug this fixes: every Canadian fire
 * surfaced the SK-only SPSA link). `officialFor(agency)` resolves a CIFFC agency code to its province's
 * public map, falling back to the CIFFC national situation map for any jurisdiction we don't yet have a
 * province-specific viewer for. Every URL here was verified reachable.
 *
 * Pure data — no DOM, no Three — so it imports anywhere and is trivially unit-checkable.
 */
export interface OfficialSource {
  label: string;
  url: string;
}

/** The authoritative NATIONAL viewer — the fallback for any agency without a province-specific map. */
export const NATIONAL_OFFICIAL: OfficialSource = {
  label: 'CIFFC national wildfire map',
  url: 'https://ciffc.net/situation/',
};

/** CIFFC agency code (province / territory) → that jurisdiction's official public wildfire viewer.
 *  Agencies not listed (NB, NS, PE, NL, YT, NT, NU, PC) fall back to the national map via officialFor. */
export const PROVINCE_OFFICIAL: Record<string, OfficialSource> = {
  BC: { label: 'BC Wildfire Service map', url: 'https://wildfiresituation.nrs.gov.bc.ca/map' },
  AB: { label: 'Alberta Wildfire status', url: 'https://www.alberta.ca/wildfire-status' },
  SK: { label: 'Saskatchewan (SPSA) fire map', url: 'https://gisappl.saskatchewan.ca/Html5Ext/?viewer=wfmpublic' },
  MB: { label: 'Manitoba wildfire', url: 'https://www.manitoba.ca/wildfire/' },
  ON: { label: 'Ontario forest fire map', url: 'https://www.lioapplications.lrc.gov.on.ca/ForestFireInformationMap/index.html' },
  QC: { label: 'SOPFEU (Québec)', url: 'https://sopfeu.qc.ca/' },
};

/** Resolve a fire's CIFFC agency code to its official viewer, or the CIFFC national map as a fallback. */
export function officialFor(agency: string): OfficialSource {
  return PROVINCE_OFFICIAL[(agency || '').toUpperCase()] ?? NATIONAL_OFFICIAL;
}
