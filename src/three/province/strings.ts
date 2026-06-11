/**
 * The ONE home for every player-facing Living Province string. ("Living Province" is the mode's
 * INTERNAL code name — the package, the `living` flag, the verifier. Nothing here ever says it to a
 * player; the public framing is plain: the place you picked, on fire, and the fires keep coming.)
 *
 * Voice law (DESIGN.md): warm "fight" register on the brand surfaces (the lobby hero); dry, calm
 * dispatcher voice in-world (the briefing + the stand-down). No em-dashes in shipped copy.
 */
export const PROVINCE_COPY = {
  // --- Brand line (warm "fight" register) — the umbrella over the whole hub. The GAME is the fight;
  //     the live wildfire tracker (livefire/strings.ts → LIVEFIRE_COPY) is the learning. Honest by
  //     design: you are not fighting real fires from a phone, you are learning how the real fire
  //     behaves. The brand line of record: sits by the brand mark, never on a CTA. ---
  brandLine: 'Fight the fire. Learn the fire.',

  // --- Home-hub / lobby hero (warm "fight" register) ---
  headline: 'The fires keep coming.', // the hub/lobby hero line
  sub: "You're the only pilot up here.", // hero sub
  cta: 'Fly', // the button into the world
  chip: 'Open patrol', // the lobby context chip (replaces "Free-for-all")
  what: 'Dispatch calls as fires break out. Get there before they reach the towns.',
  feat: 'The longer you fly, the harder it burns.', // the one feature line (hints the FWI climb)

  // --- Pre-flight briefing (dry dispatcher voice; the title is the place you picked) ---
  tagline: 'The fires keep coming.',
  brief:
    'New fires keep breaking out. Dispatch will call you to each one. Scoop from the nearest lake and put them out before they reach the towns.',
  situation: 'Fires keep breaking out. Dispatch will call you to each one. Put them out before they reach the towns.',

  // --- Shift complete (rode out the whole quota of calls) — the achievement beat ---
  shiftComplete: "That's the shift, Water-1. The province held. Good flying.",
  shiftReportTitle: 'SHIFT REPORT',
  // --- Stand-down (overrun) — dispatcher closes the loop straight, no sugar ---
  standDown: 'Too many got past us. Stand down, Water-1. We fly again tomorrow.',

  // --- Onboarding (a new pilot's first shift — dispatcher voice, matches the campaign's "Water-1, Dispatch"
  //     register, kept em-dash-free; the protect line interpolates the town in OnboardingScript) ---
  onbIntro: 'Water-1, Dispatch. Smoke just out from base. Dip your bucket in the nearest lake, then drop it on the fire.',
  onbReinforce: 'Good drop, Water-1. Another spot has flared up. Same again.',
  onbHandoff: "You've got the hang of it, Water-1. The calls won't stop now. Hold the towns.",
} as const;

/** A plain display name for a region id — the briefing title ("the place you picked"). "saskatchewan"
 *  → "Saskatchewan", "british-columbia" → "British Columbia". Dependency-free title-case. */
export function regionDisplayName(regionId: string): string {
  return regionId
    .split('-')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
}
