/**
 * Small HUD helpers shared by more than one sub-module — kept here so there's exactly
 * ONE definition of each (the in-world green const, the m:ss formatter, the end/briefing
 * pill button) rather than the drifting inline copies the UI-component pass consolidated.
 */

import { makeButton, type ButtonOpts } from '../ui/components';

/** Healthy-airframe / engine-ready green. One source of truth — used by the airframe gauge
 *  bar (HUD), the cold-start dial's READY state (engineStart), and anywhere "good, in-world"
 *  green is needed (distinct from the cyan cockpit accent). */
export const AIRFRAME_OK = '#46d17a';

/** Seconds → m:ss for survive / time-limit / debrief readouts. */
export function fmtTime(sec: number): string {
  const s = Math.max(0, Math.ceil(sec));
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
}

/**
 * Personalize a radio/briefing line: the mission catalog + hardcoded callouts use "Water-1" as the
 * pilot callsign placeholder (see missions/catalog.ts), so swap in the player's own callsign and
 * Dispatch addresses them by name. No name (e.g. headless ?autostart) → the "Water-1" default rides
 * through unchanged. Shared by the in-flight comms (HUD) and the pre-flight briefing (ui/Briefing).
 */
export function personalize(text: string, name?: string): string {
  if (!name) return text;
  return text.replace(/Water-1/g, () => name); // fn form: a "$"-bearing callsign can't trigger replace's special patterns
}

/** A pill button for the mission end banner + the pre-flight briefing. */
export type BannerKind = 'primary' | 'secondary' | 'ghost' | 'store';
/**
 * End-screen / briefing action button — a kit `Button`. The mission-end + pre-flight briefing
 * are the warm "fight" register (DESIGN.md → two registers), so there is ONE hierarchy instead of
 * the old five-colour rainbow: the hero action (advance / retry / begin) is fight-gold `primary`,
 * the merch hook is a fight `secondary`, info actions (leaderboard / share) are quiet cockpit
 * `secondary`, and the back-out (menu) is a `ghost`.
 */
export function bannerButton(text: string, kind: BannerKind, onClick: () => void): HTMLButtonElement {
  const cfg: ButtonOpts =
    kind === 'primary'
      ? { variant: 'primary', register: 'fight' }
      : kind === 'store'
        ? { variant: 'secondary', register: 'fight' }
        : kind === 'ghost'
          ? { variant: 'ghost' }
          : { variant: 'secondary', register: 'cockpit' };
  return makeButton({ label: text, ...cfg, onClick }).el;
}
