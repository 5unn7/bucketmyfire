/**
 * Component-kit foundation — the shared primitives every kit component builds on.
 *
 * The kit sits ONE layer above `theme.ts`: tokens describe colour/size; components describe
 * behaviour (a Button knows its variants, states, focus ring, touch target). Screens compose
 * components, never raw `div` + inline styles. See `docs/specs/ui-component-system.md`.
 *
 * `tone()` encodes the DESIGN.md "two registers" law in code: the cockpit register is cyan
 * (interactive / live), the fight register is gold-ember (brand). A component takes a `register`
 * and gets the right accent family for free — so the law can't drift per screen.
 */

import { UI } from '../theme';

export type Register = 'cockpit' | 'fight';

/** The accent family for a register — used by every component that paints an accent. */
export interface RegisterTone {
  fg: string; // the accent colour itself
  hi: string; // brighter hover / active / peak
  fill: string; // low-alpha wash behind a selected / secondary surface
  ring: string; // :focus-visible ring colour
  glow: string; // ambient glow shadow
}

export function tone(register: Register): RegisterTone {
  return register === 'fight'
    ? { fg: UI.menu, hi: UI.emberHi, fill: UI.menuFill, ring: UI.menuSoft, glow: UI.emberGlow }
    : { fg: UI.accent, hi: UI.accentHi, fill: UI.accentFill, ring: UI.accentSoft, glow: UI.glow };
}

let injected = false;
/** Inject the kit's one shared stylesheet (focus-visible ring, disabled affordance, keyframes). Idempotent. */
export function injectKitStyles(): void {
  if (injected) return;
  injected = true;
  const s = document.createElement('style');
  s.id = 'bmf-kit';
  s.textContent = `
  .bmf-kit:focus-visible { outline: none; box-shadow: 0 0 0 3px var(--bmf-ring, ${UI.accentSoft}); }
  .bmf-kit[disabled], .bmf-kit[aria-disabled="true"] { cursor: not-allowed; opacity: 0.42; filter: grayscale(0.35); }
  @keyframes bmf-kit-spin { to { transform: rotate(1turn); } }
  @keyframes bmf-kit-in { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
  `;
  document.head.appendChild(s);
}
