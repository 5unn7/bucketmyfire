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
import { tokenBlock } from '../tokens';

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
  s.textContent =
    // Global design tokens (from theme.ts via tokens.ts) on :root, so the canonical .btn — and any
    // future screen migrated onto the string model — resolves var(--cta)/var(--accent)/… ANYWHERE,
    // not only inside the .bmf-app home hub (makeButton is used on TitleScreen/HelpModal/HUD too).
    tokenBlock(':root') +
    `
  .bmf-kit:focus-visible { outline: none; box-shadow: 0 0 0 3px var(--bmf-ring, ${UI.accentSoft}); }
  .bmf-kit[disabled], .bmf-kit[aria-disabled="true"] { cursor: not-allowed; }
  @keyframes bmf-kit-spin { to { transform: rotate(1turn); } }
  @keyframes bmf-kit-in { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }

  /* ===== Canonical button — THE one button of record. Used by makeButton() AND by string-markup
     (class="btn …"). Warm "fight" register is the default; .cockpit switches to the cyan instrument
     register (DESIGN.md two registers). Rugged technical radius (--r-lg), never a round pill. ===== */
  .btn{ display:inline-flex; align-items:center; justify-content:center; gap:9px; box-sizing:border-box;
    cursor:pointer; font-family:var(--font); font-size:var(--fs-md); font-weight:var(--fw-heavy);
    letter-spacing:.06em; text-transform:uppercase; line-height:1; border:1px solid transparent;
    border-radius:var(--r-lg); padding:13px 22px; min-height:48px;
    transition:transform .12s, background .12s, box-shadow .12s, border-color .12s, color .12s; }
  .btn svg{ width:16px; height:16px; }
  .btn.block{ width:100%; }
  .btn.sm{ padding:11px 15px; min-height:44px; font-size:var(--fs-sm); }
  .btn.lg{ padding:16px 26px; min-height:54px; font-size:var(--fs-lg); }
  /* fight (warm) — the default register */
  .btn.primary{ background:var(--cta); color:var(--cta-ink); box-shadow:0 1px 0 rgba(255,255,255,0.5) inset, 0 -2px 0 rgba(0,0,0,0.18) inset, 0 8px 20px var(--cta-glow); }
  .btn.primary svg{ fill:var(--cta-ink); } .btn.primary:hover{ background:var(--cta-hi); transform:translateY(-2px); }
  .btn.ember{ color:var(--ember-hi); background:linear-gradient(180deg, var(--fire-16), var(--fire-06)); border-color:var(--warm-stroke); box-shadow:inset 0 1px 0 rgba(255,255,255,0.06), 0 4px 14px var(--ember-14); }
  .btn.ember svg{ fill:var(--ember-hi); } .btn.ember:hover{ background:linear-gradient(180deg, var(--fire-28), var(--fire-12)); transform:translateY(-1px); }
  .btn.secondary{ background:var(--warm-glass); color:var(--text); border-color:var(--warm-stroke); box-shadow:inset 0 1px 0 rgba(255,255,255,0.06); }
  .btn.secondary svg{ fill:var(--ember-hi); } .btn.secondary:hover{ background:rgba(60,24,18,0.6); transform:translateY(-2px); }
  .btn.ghost{ background:transparent; color:var(--dim); border-color:var(--stroke); } .btn.ghost:hover{ color:var(--text); border-color:var(--stroke-strong); }
  .btn.danger{ color:var(--warn); background:var(--warn-10); border-color:var(--warn-50); font-family:var(--mono); letter-spacing:.1em; } .btn.danger:hover{ background:var(--warn-18); }
  /* cockpit (cyan instrument) — token-only, no new literals */
  .btn.cockpit.primary{ background:var(--accent); color:var(--ink); box-shadow:var(--glow); }
  .btn.cockpit.primary svg{ fill:var(--ink); } .btn.cockpit.primary:hover{ background:var(--accent-hi); }
  .btn.cockpit.secondary{ background:var(--accent-fill); color:var(--accent); border-color:var(--accent-soft); }
  .btn.cockpit.secondary svg{ fill:var(--accent); } .btn.cockpit.secondary:hover{ border-color:var(--accent); }
  .btn.cockpit.ghost{ color:var(--accent); } .btn.cockpit.ghost:hover{ color:var(--accent-hi); }
  /* states — locked (gated content) and disabled both part of the one button */
  .btn:focus-visible{ outline:none; box-shadow:0 0 0 3px var(--bmf-ring, var(--accent-soft)); }
  .btn.locked{ opacity:.55; cursor:default; pointer-events:none; }
  .btn[disabled], .btn.is-disabled, .btn[aria-disabled="true"]{ opacity:.45; filter:grayscale(.4); cursor:not-allowed; }
  .btn.is-loading{ pointer-events:none; }
  @media (prefers-reduced-motion: reduce){ .btn{ transition:background .12s, box-shadow .12s, color .12s, border-color .12s; } .btn:hover{ transform:none; } }

  /* ===== Canonical badge — THE one status pill of record. Used by makeBadge() AND by string-markup
     (class="badge …"). Squared (--r-sm, never a round pill) with ONE fixed height, so every badge in a
     row lines up. Default is the warm "fight" register; tone modifiers map the DESIGN.md semantics. ===== */
  .badge{ display:inline-flex; align-items:center; justify-content:center; gap:5px; box-sizing:border-box;
    height:26px; padding:0 10px; font-family:var(--mono); font-size:var(--fs-tag); font-weight:var(--fw-bold);
    letter-spacing:.1em; text-transform:uppercase; line-height:1; white-space:nowrap;
    color:var(--menu); background:var(--menu-fill); border:1px solid var(--menu-soft); border-radius:var(--r-sm); }
  .badge svg{ width:12px; height:12px; }
  /* tones — token-only, no literals */
  .badge.accent{ color:var(--accent); background:var(--accent-fill); border-color:var(--accent-soft); }
  .badge.ok{ color:var(--ok); background:var(--ok-12); border-color:var(--ok-50); }
  .badge.warn{ color:var(--warn); background:var(--warn-10); border-color:var(--warn-50); }
  .badge.neutral, .badge.locked{ color:var(--dim); background:var(--recess); border-color:var(--hair); }
  .badge.fire{ color:var(--ember-hi); background:var(--warm-glass); border-color:var(--warm-stroke); }
  .badge.fire svg path{ fill:var(--fire); }
  `;
  document.head.appendChild(s);
}
