/**
 * ONE injected stylesheet for the in-flight HUD + touch controls — the responsive-CSS layer that
 * replaced the old imperative `applyLayout()` pixel-arithmetic and the `getBoundingClientRect()`
 * measure-and-nudge in `HUD.positionMessages()`. It mirrors `ui/home/styles.ts`: everything is scoped
 * under `.bmf-hud` and the CSS custom properties are generated FROM `theme.ts` via `tokenDecls()` (the
 * single token source — DESIGN.md), so the cockpit reads the same palette/scale as the rest of the UI.
 *
 * Both overlay roots carry `class="bmf-hud"` (HUD.ts's root AND Input.ts's touch-UI root), so the token
 * vars + the fluid sizing vars below are in scope on each — and reliably present on the in-game/autostart
 * path, where the global `:root` kit inject is NOT guaranteed to have fired.
 *
 * LAYOUT MODEL (the point of the file):
 *   - The TOP BAND is a CSS grid (`.hud-top`): `[strip | comms | radar]`. The comms bar lives in a
 *     bounded centre column, so it can NEVER overlap the strip or radar — no JS measuring. A portrait /
 *     narrow `@media` restacks comms onto its own row beneath strip+radar (the old "drop below the band"
 *     behaviour, now declarative).
 *   - Every instrument cell, tape, stick and button is sized by a `clamp()` var (`--pod`, `--tape-*`,
 *     `--stick`, `--drop`, …) with a couple of breakpoint overrides — fluid, reflows for free on resize.
 *   - The ONLY thing still sized in JS is the radar's canvas backing store (a canvas needs real pixels +
 *     its pinch/zoom math reads them) — see `Radar.setLayout` / `HUD.radarSize`.
 */
import { tokenDecls } from '../ui/tokens';

// Token vars (the ONE source) + the HUD-local fluid sizing vars. The sizing vars are `clamp(min, vw, max)`
// so the cockpit scales smoothly from a 320px phone to desktop; the few @media blocks below only nudge the
// values that don't read well as a single fluid curve (tape scale, desktop calm-down).
const VARS = `.bmf-hud{
  ${tokenDecls()}
  --pod: clamp(26px, 6.4vw, 38px);            /* instrument-cell scale; icon + number derive from it */
  --pod-ic: calc(var(--pod) * 0.46);
  --pod-fs: calc(var(--pod) * 0.52);
  --tape-scale: 0.82;                          /* flight-tape CSS scale (backing store stays crisp) */
  --tape-gap: clamp(50px, 9vw, 84px);          /* px from screen centre to each tape's inner edge */
  --stick: clamp(116px, 33vw, 140px);          /* joystick DISH diameter (pointer math reads it live) */
  --drop: clamp(86px, 25vw, 104px);            /* DROP hero diameter */
  --detach: clamp(46px, 13vw, 56px);           /* RELEASE-bucket button */
  --help: max(44px, 11vw);                      /* "?" help — floored at the 44px touch target */
  --comms-max: min(520px, 92vw);               /* advisory / comms bar max width */
  --dispatch-w: min(190px, 60vw);              /* DISPATCH / objective panel width cap in the left column */
}`;

const CSS = `
/* Both overlay roots: a click-through layer carrying the cockpit type + tokens. */
.bmf-hud{ font-family:var(--font); color:var(--text); -webkit-tap-highlight-color:transparent; }
.bmf-hud *{ box-sizing:border-box; }

/* ===== TOP BAND — a CSS grid frame. The comms column is structurally bounded between the strip and the
   radar, so the advisory bar can never overlap a corner (this is what retired positionMessages()). ===== */
.bmf-hud .hud-top{ position:fixed; top:0; left:0; right:0; z-index:10; pointer-events:none;
  padding: calc(var(--bmf-safe-t) + var(--bmf-edge)) calc(var(--bmf-safe-r) + var(--bmf-edge)) 0 calc(var(--bmf-safe-l) + var(--bmf-edge));
  display:grid; grid-template-columns:auto minmax(0,1fr) auto; grid-template-areas:"strip comms radar";
  align-items:start; column-gap:var(--bmf-gap); }
.bmf-hud .hud-left{ grid-area:strip; display:flex; flex-direction:column; gap:var(--bmf-gap); align-items:flex-start; min-width:0; }
.bmf-hud .hud-comms{ grid-area:comms; display:flex; justify-content:center; align-items:flex-start; min-width:0; }
.bmf-hud .hud-right{ grid-area:radar; display:flex; flex-direction:column; align-items:flex-end; gap:var(--bmf-gap); }

/* NARROW viewports only (phones): comms drops to its OWN full-width row under strip+radar so the dispatch
   sentence has room. WIDER viewports — incl. a short LANDSCAPE phone (740×360) and tablets/desktop — keep
   the 3-column inline layout, where comms rides top-centre between strip and radar (it has the room, and a
   short landscape must NOT stack or comms lands on the bottom DROP cluster). */
@media (max-width:600px){
  .bmf-hud .hud-top{ grid-template-columns:auto auto; grid-template-areas:"strip radar" "comms comms"; justify-content:space-between; }
  .bmf-hud .hud-comms{ margin-top:var(--bmf-gap); }
}

/* ===== Instrument strip — one frosted pill of bezelled chambers. flex-wrap is the graceful fallback if a
   runtime readout widens it (a named threatened town); clamp() keeps it one row on phones ≥360px. ===== */
.bmf-hud .strip{ display:flex; flex-flow:row wrap; align-items:stretch; padding:0; border-radius:var(--r-md);
  max-width:100%; background:var(--panel); border:1px solid var(--stroke); box-shadow:var(--shadow);
  backdrop-filter:var(--blur); -webkit-backdrop-filter:var(--blur); }

/* Bezelled CHAMBER — a recessed well grouping gauge pods (AIRCRAFT / FIRE / WIND). */
.bmf-hud .chamber{ display:flex; flex-direction:row; align-items:stretch; margin:3px; overflow:hidden;
  background:var(--bezel); border:1px solid var(--hair); border-radius:var(--r-sm); }

/* One gauge POD — a stroked icon + a bold numeric readout. The hairline divider lives on the cell's left
   edge; the chamber edge separates the first cell, so the leading pod drops its divider (was a JS write). */
.bmf-hud .pod{ position:relative; display:flex; align-items:center; line-height:1;
  gap:calc(var(--pod) * 0.16); padding:calc(var(--pod) * 0.21) calc(var(--pod) * 0.28);
  box-shadow:inset 1px 0 0 var(--stroke); }
.bmf-hud .chamber > .pod:first-child{ box-shadow:none; }
.bmf-hud .pod[hidden]{ display:none; }
.bmf-hud .pod .icon{ flex:0 0 auto; display:flex; align-items:center; justify-content:center; }
.bmf-hud .pod .icon svg{ width:var(--pod-ic); height:var(--pod-ic); display:block; }
.bmf-hud .pod .num{ font-weight:var(--fw-semibold); color:var(--text); line-height:1; text-align:left;
  font-size:var(--pod-fs); min-width:calc(var(--pod) * 0.5); font-variant-numeric:tabular-nums; }
/* FIRE is the mission HERO — a step bigger + heavier so "how many are left" reads first. */
.bmf-hud .pod.fire .icon svg{ width:calc(var(--pod-ic) * 1.18); height:calc(var(--pod-ic) * 1.18); }
.bmf-hud .pod.fire .num{ font-size:calc(var(--pod-fs) * 1.28); font-weight:var(--fw-heavy); }

/* The ☰ menu control styled as the strip's leading cell (campaign only). */
.bmf-hud .menu-cell{ display:flex; align-items:center; justify-content:center; line-height:1; cursor:pointer;
  pointer-events:auto; color:var(--dim); padding:calc(var(--pod) * 0.21) calc(var(--pod) * 0.3);
  font-size:calc(var(--pod) * 0.5); transition:color .15s ease; }
.bmf-hud .menu-cell:hover{ color:var(--accent); }

/* The thin animated base fill bar on the resource pods (airframe / fuel / threat / crew). */
.bmf-hud .pod .bar{ position:absolute; left:8px; right:8px; bottom:2px; height:2.5px; border-radius:var(--r-xs);
  background:var(--track); overflow:hidden; }
.bmf-hud .pod .bar > .fill{ display:block; width:100%; height:100%; border-radius:var(--r-xs); background:var(--accent);
  transform-origin:left center; transform:scaleX(1); transition:transform .18s ease, background-color .2s ease, box-shadow .2s ease; }

/* Portrait phones: drop the secondary WIND chamber so the AIRCRAFT + FIRE gauges keep ONE tidy row instead
   of orphaning a lone chamber onto a second line (the original screenshot's eyesore). A phone's top band
   can't hold AIRCRAFT + FIRE + WIND beside the radar at a glanceable size; wind is the most situational
   gauge (the on-screen smoke plume reads its drift), so it yields here and returns on tablet/landscape/
   desktop where there's room. Keyed to the phone-portrait boundary, the wide side of the fit crossover. */
@media (max-width:480px){ .bmf-hud .chamber.wind{ display:none; } }

/* ===== DISPATCH / objective panel + crew-board bar — frosted cards under the strip, bounded to the left
   column so they can't collide with the radar. ===== */
.bmf-hud .dispatch, .bmf-hud .crew-bar{ display:none; width:max-content; min-width:min(170px,56vw); max-width:var(--dispatch-w);
  padding:7px 11px 8px; border-radius:var(--r-md); background:var(--panel); border:1px solid var(--stroke);
  box-shadow:var(--shadow); backdrop-filter:var(--blur); -webkit-backdrop-filter:var(--blur); }
.bmf-hud .dispatch.show, .bmf-hud .crew-bar.show{ display:block; }

/* ===== Comms / advisory bar (hud/MessageBar.ts) — one frosted pill; colour + edge are state-driven in JS. ===== */
.bmf-hud .comms{ display:none; align-items:baseline; gap:8px; max-width:var(--comms-max); padding:6px 14px;
  border-radius:var(--r-pill); text-align:left; opacity:0; pointer-events:none;
  background:var(--panel); border:1px solid var(--stroke); border-left:2px solid var(--accent);
  box-shadow:var(--shadow); backdrop-filter:var(--blur); -webkit-backdrop-filter:var(--blur);
  transition:opacity .35s ease; }
.bmf-hud .comms .tag{ flex:0 0 auto; font-size:var(--fs-micro); font-weight:var(--fw-bold); letter-spacing:1.4px; color:var(--accent); }
.bmf-hud .comms .body{ font-size:var(--fs-sm); font-weight:var(--fw-medium); line-height:1.3; color:var(--instrument); }
@media (prefers-reduced-motion:reduce){ .bmf-hud .comms{ transition:none; } }

/* ===== Flight tapes — fixed-size canvases flanking the heli, placed + scaled purely by CSS vars. ===== */
.bmf-hud .tape{ position:absolute; top:52%; transform:translateY(-50%) scale(var(--tape-scale)); }
.bmf-hud .tape.spd{ left:calc(50% - var(--tape-gap) - 78px); transform-origin:right center; }
.bmf-hud .tape.alt{ left:calc(50% + var(--tape-gap)); transform-origin:left center; }
@media (min-width:740px){ .bmf-hud{ --tape-scale:1; } }

/* ===== Touch controls (Input.ts) — sized by vars; LOOK stays inline in Input (this is layout only). ===== */
.bmf-hud .stick{ width:var(--stick); height:var(--stick); }
.bmf-hud .stick-thumb{ width:calc(var(--stick) * 0.46); height:calc(var(--stick) * 0.46);
  margin-left:calc(var(--stick) * -0.23); margin-top:calc(var(--stick) * -0.23); }
.bmf-hud .stick-tick{ transform-origin:1px calc(var(--stick) / 2 - 6px); }
.bmf-hud .drop{ width:var(--drop); height:var(--drop); }
.bmf-hud .drop .drop-label{ font-size:calc(var(--drop) * 0.18); }
.bmf-hud .drop .drop-pct{ font-size:calc(var(--drop) * 0.15); }
.bmf-hud .detach-btn{ width:var(--detach); height:var(--detach); }
.bmf-hud .help-btn{ width:var(--help); height:var(--help); } /* font-size set inline (theme.button() pins one a class can't beat) */

/* GPWS-style hazard caption flash (was HUD.ensureAlertStyles). Reduced-motion gets a steady caption. */
@keyframes bmf-alert-pulse{ 0%,100%{ opacity:1; } 50%{ opacity:0.45; } }
`;

let injected = false;
/** Inject the HUD stylesheet once (idempotent). Called from both overlay roots' constructors. */
export function injectHudStyles(): void {
  if (injected) return;
  injected = true;
  const style = document.createElement('style');
  style.id = 'bmf-hud-styles';
  style.textContent = VARS + CSS;
  document.head.appendChild(style);
}
