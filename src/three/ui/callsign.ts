/**
 * Callsign hygiene — shared sanitize + validation for the pilot name (the string the
 * leaderboard submits under). Used by the pre-flight identity screen (blocks bad names
 * before saving) and by the leaderboard client (a final clean on the auto-submit path).
 *
 * Four layers, all "basic" by design (a casual arcade board, not a moderation system):
 *   1. Sanitize    — NFC normalize, strip control/zero-width/bidi chars, collapse whitespace, length.
 *   2. Charset     — keep letters/numbers/space/`- _ . '` + emoji; drop oddball unicode.
 *   3. Reserved    — reject the default 'Pilot' and obvious impersonation handles.
 *   4. Profanity   — small leet-aware blocklist so the public board stays presentable.
 *
 * Duplicate-name enforcement is separate (it needs the network) — see leaderboard/client.ts
 * `isNameTaken`, which the editor calls after a name passes validation here.
 *
 * NB: invisible characters are matched by CODE POINT (numeric), never as literal glyphs, so this
 * source file stays plain-text in git — embedding literal zero-width/bidi bytes makes git treat
 * the file as binary (no diffs).
 */

export const MAX_CALLSIGN = 24;
const MIN_CALLSIGN = 2;

export interface CallsignResult {
  ok: boolean;
  value: string; // the sanitized name (always returned, even when !ok, for live preview)
  reason?: string; // why it was rejected (shown in the editor)
}

// Exact (normalized) reserved handles — the default name + impersonation terms. Matched against
// the letters-only normalized form, so 'Pilot', 'P1L0T', 'admin ' all collapse to a reserved hit.
const RESERVED = new Set([
  'pilot',
  'admin',
  'administrator',
  'moderator',
  'mod',
  'system',
  'root',
  'owner',
  'staff',
  'support',
  'official',
  'bucketmyfire',
  'null',
  'undefined',
  'anonymous',
  'anon',
]);

// Profanity stems — substring-matched against the leet-normalized form. Curated + small; this is
// a courtesy filter, not exhaustive (and the classic "Scunthorpe" over-blocks are accepted as basic).
const PROFANITY = [
  'fuck',
  'shit',
  'cunt',
  'bitch',
  'bastard',
  'asshole',
  'piss',
  'whore',
  'slut',
  'nigger',
  'nigga',
  'faggot',
  'retard',
  'rape',
  'nazi',
];

const ZWJ = 0x200d; // zero-width joiner — binds multi-part emoji sequences, kept so they survive
const VS16 = 0xfe0f; // emoji variation selector — kept for the same reason

/**
 * Control, zero-width, soft-hyphen, and bidi-override code points that can hide or spoof text.
 * Checked numerically (no literal invisibles in source). Deliberately excludes ZWJ (U+200D) and
 * the variation selector (U+FE0F) so multi-codepoint emoji survive — those are re-admitted below.
 */
function isInvisible(cp: number): boolean {
  return (
    cp <= 0x1f || // C0 control characters
    (cp >= 0x7f && cp <= 0x9f) || // DEL + C1 control characters
    cp === 0x00ad || // soft hyphen
    cp === 0x200b || // zero-width space
    cp === 0x200c || // zero-width non-joiner
    cp === 0x200e || // left-to-right mark
    cp === 0x200f || // right-to-left mark
    (cp >= 0x202a && cp <= 0x202e) || // bidi embeddings / overrides
    cp === 0x2060 || // word joiner
    cp === 0xfeff // zero-width no-break space / BOM
  );
}

/** Allowed visible characters: any unicode letter/number, space, `- _ . '`. */
const ALLOWED = /[\p{L}\p{N} _.'-]/u;
/** Emoji pictographs (the joiners ZWJ/VS16 are re-admitted by code point alongside this). */
const EMOJI = /\p{Extended_Pictographic}/u;

/** Normalize, strip invisibles, collapse whitespace, filter to the allowed charset, clamp length. */
export function cleanCallsign(raw: string): string {
  // Strip invisibles by code point first.
  let s = '';
  for (const ch of (raw ?? '').normalize('NFC')) {
    if (!isInvisible(ch.codePointAt(0) ?? 0)) s += ch;
  }
  s = s.replace(/\s+/g, ' ').trim();
  // Keep only visible allowed chars + emoji (and the emoji joiners we preserved above).
  s = Array.from(s)
    .filter((ch) => {
      const cp = ch.codePointAt(0) ?? 0;
      return ALLOWED.test(ch) || EMOJI.test(ch) || cp === ZWJ || cp === VS16;
    })
    .join('');
  return Array.from(s).slice(0, MAX_CALLSIGN).join('');
}

/** Letters-only, leet-folded form used for reserved/profanity comparison (a@4→a, i1!|→i, …). */
function fold(s: string): string {
  return s
    .toLowerCase()
    .replace(/[@4]/g, 'a')
    .replace(/[!1|]/g, 'i')
    .replace(/3/g, 'e')
    .replace(/0/g, 'o')
    .replace(/[$5]/g, 's')
    .replace(/7/g, 't')
    .replace(/8/g, 'b')
    .replace(/9/g, 'g')
    .replace(/[^a-z]/g, '');
}

/** Sanitize + validate a raw callsign. `ok:false` carries a human reason for the editor. */
export function validateCallsign(raw: string): CallsignResult {
  const value = cleanCallsign(raw);
  if (Array.from(value).length < MIN_CALLSIGN) {
    return { ok: false, value, reason: `At least ${MIN_CALLSIGN} characters.` };
  }
  // Fold the RAW input (not the charset-cleaned value) for the blocklists, so punctuation-based
  // leet evasion like "n!gger" — where '!' is stripped during cleaning before it can fold to 'i' —
  // is still caught. fold() drops every non-letter after the leet substitution anyway.
  const folded = fold((raw ?? '').normalize('NFC'));
  if (folded.length === 0) {
    // All-emoji / all-symbol names have no letters to vet — allow, they're harmless and fun.
    return { ok: true, value };
  }
  if (RESERVED.has(folded)) return { ok: false, value, reason: 'That name is reserved — pick another.' };
  if (PROFANITY.some((w) => folded.includes(w))) {
    return { ok: false, value, reason: 'Keep it clean — choose another name.' };
  }
  return { ok: true, value };
}

/** True when a folded name is reserved (used by the submit path to replace the silent default). */
export function isReservedCallsign(name: string): boolean {
  return RESERVED.has(fold(cleanCallsign(name)));
}

// Themed words for an auto-generated "Quick Fly" callsign (audit FIX #10 — let first-timers fly
// instantly instead of hitting the required-name wall; they can rename at score-submit). All are
// clean and non-reserved, so the result always passes validateCallsign.
const QUICK_WORDS = [
  'Tanker',
  'Bucket',
  'Scoop',
  'Rotor',
  'Ember',
  'Cinder',
  'Maverick',
  'Ripcord',
  'Blaze',
  'Skid',
  'Drift',
  'Halon',
  'Ridgeline',
  'Spotter',
  'Waterdog',
  'Firefly',
  'Northstar',
  'Bushpilot',
];

/**
 * A fun, always-valid auto callsign for the "Quick Fly" path (e.g. "Rotor-7C2"). Lets a brand-new
 * player launch a mission without the naming gate; the menu can offer a rename later. Uses Math.random
 * (UI-side, not the deterministic world sim) and a short base-36 suffix to keep collisions rare.
 */
export function randomCallsign(): string {
  const word = QUICK_WORDS[Math.floor(Math.random() * QUICK_WORDS.length)];
  const suffix = Math.floor(Math.random() * 1296)
    .toString(36)
    .toUpperCase()
    .padStart(2, '0'); // two base-36 chars: 00..ZZ
  return cleanCallsign(`${word}-${suffix}`);
}
