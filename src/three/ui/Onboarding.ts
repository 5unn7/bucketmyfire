/**
 * Boot helpers for the campaign router (main.ts).
 *
 * The interactive first-run flow that used to live here (the `runWelcome` identity gate and the
 * legacy `runOnboarding` picker) has moved into the guided pre-flight wizard, `ui/flow/MenuFlow.ts`
 * — Screen 1 of that flow IS the identity gate now. What remains here are the two tiny pure helpers
 * the router still needs: whether to bypass the menu for headless QA, and the profile to fly with
 * when it does.
 */

import { Profile, MAPS, HELIS, firstAvailable, loadProfile } from './profile';

/** Bypass the home screen for headless QA / deep links: /?autostart */
export function shouldAutostart(): boolean {
  try {
    return new URLSearchParams(window.location.search).has('autostart');
  } catch {
    return false;
  }
}

/** The profile used when the menu is skipped (saved if present, else sensible defaults). */
export function defaultProfile(): Profile {
  return (
    loadProfile() ?? {
      name: 'Pilot',
      mapId: firstAvailable(MAPS).id,
      heliId: firstAvailable(HELIS).id,
    }
  );
}
