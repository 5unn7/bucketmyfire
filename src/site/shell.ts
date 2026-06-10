/**
 * The shared SITE SHELL for the public pages (Home `/`, Campaign `/campaign/`, Prepare `/prepare/`).
 *
 * The three front-door pages are hand-authored static HTML (crawlable, instant paint) that each boot a
 * light controller. This module is the ONE place their common chrome + styling lives, so the appbar,
 * nav, footer, mobile tab bar, and the whole glass-cockpit card vocabulary can't drift across pages:
 *
 *   - `injectShellStyles()` — the shared stylesheet (reads the kit's real theme.ts `var(--*)` tokens
 *     from `injectKitStyles()`, so it's one visual language with the in-game home). Covers the appbar +
 *     nav, the `.fd-card` bento system, section headers, the national-data grid, the readouts, the
 *     Prepare cards, mission cards, the Field Notes carousel, the checklist, the live-map overlay +
 *     fire-detail sheet, the footer (safety disclaimer + policy links), and the mobile bottom tab bar.
 *   - `hydrateChrome({active})` — marks the active nav/tab item and fills the returning-pilot dossier
 *     pill + the settings gear popover. Reads only localStorage + the Three-free rank ladder.
 *
 * Each page keeps a SMALL critical CSS block inline (scene + appbar skeleton + hero) for a styled first
 * paint with zero JS; this injected layer is the full, real component set (the same critical-fallback +
 * real-tokens pattern index.html already uses). Pure DOM, no Three, no heavy imports.
 */
import { cleanCallsign } from '../three/ui/callsign';
import { careerScore, rankFor, nextRankProgress } from '../three/missions/rank';
import { fmtInt } from '../three/livefire/strings';
import { tabbarHtml, footerBrandHtml } from './siteNav.mjs';

export type ShellPage = 'home' | 'campaign' | 'prepare';

/** The mobile bottom tab bar — the shared tab bar (siteNav). Kept as a thin re-export so the front-door
 *  controllers + the live-fire overlay call one name; the markup + `.fd-tabbar` CSS live in siteNav. */
export function tabbarMarkup(active: ShellPage): string {
  return tabbarHtml(active);
}

/** The shared footer — slimmed to the two things every page must carry: the safety disclaimer and the
 *  policy links (Privacy + Terms). */
export function buildFooter(): string {
  return (
    `<footer class="fd-foot">` +
    footerBrandHtml() +
    `<p class="fd-disclaimer">A window onto real data, not an emergency tool. Always follow official sources and local authorities.</p>` +
    `<div class="fd-foot-links">` +
    `<a href="/privacy.html">Privacy</a>` +
    `<a href="/terms.html">Terms</a>` +
    `</div></footer>`
  );
}

/** Inject the shared stylesheet ONCE. Idempotent. Call after injectKitStyles() so the tokens resolve. */
export function injectShellStyles(): void {
  if (document.getElementById('fd-shell-css')) return;
  const s = document.createElement('style');
  s.id = 'fd-shell-css';
  s.textContent = SHELL_CSS;
  document.head.appendChild(s);
}

/** Mark the active nav/tab and fill the returning-pilot dossier pill + the settings popover. Safe to
 *  call on any page; it no-ops on elements that aren't present. */
export function hydrateChrome(opts: { active: ShellPage }): void {
  void opts; // active state is already in the static markup; kept for symmetry / future use
  buildDossierPill();
  wireSettings();
}

/** Read the saved pilot callsign (profile.ts STORAGE_KEY) without dragging in the heavy profile module. */
function savedCallsign(): string {
  try {
    const raw = localStorage.getItem('bmf.profile.v1');
    if (!raw) return '';
    return cleanCallsign((JSON.parse(raw) as { name?: string }).name ?? '');
  } catch {
    return '';
  }
}

/** A returning pilot gets a compact identity pill (callsign + rank) in the appbar that resumes the
 *  fight; a first-run visitor sees nothing (the pill host stays empty). The callsign is set via
 *  textContent — the one user value never touches innerHTML. */
function buildDossierPill(): void {
  const host = document.getElementById('fd-dossier-pill');
  if (!host) return;
  const name = savedCallsign();
  if (!name) {
    host.hidden = true;
    return;
  }
  host.hidden = false;
  const pts = careerScore();
  const tier = rankFor(pts);
  host.innerHTML =
    `<a class="fd-pill" href="/?province=1" aria-label="Resume the fight">` +
    `<span class="fd-pill-rk" style="--rk:${tier.color}"><i></i></span>` +
    `<b class="fd-pill-cs"></b>` +
    `<span class="fd-pill-tier">${tier.name}</span>` +
    `</a>`;
  const cs = host.querySelector('.fd-pill-cs');
  if (cs) cs.textContent = name;
}

/** The settings gear → a small popover (reduce motion + reset pilot). Self-contained, kit-styled. */
function wireSettings(): void {
  const gear = document.getElementById('fd-gear');
  if (!gear) return;
  gear.addEventListener('click', (e) => {
    e.preventDefault();
    if (document.getElementById('fd-settings')) {
      closeSettings();
      return;
    }
    openSettings();
  });
}

function openSettings(): void {
  const name = savedCallsign();
  const pts = name ? careerScore() : 0;
  const prog = name ? nextRankProgress(pts) : null;
  const reduced = localStorage.getItem('bmf.reduceMotion') === '1';

  const back = document.createElement('div');
  back.id = 'fd-settings';
  back.className = 'fd-pop-back';
  back.addEventListener('click', (e) => {
    if (e.target === back) closeSettings();
  });

  const card = document.createElement('div');
  card.className = 'fd-pop fd-card metal';
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-label', 'Settings');
  const pilotLine = name
    ? `<div class="fd-pop-pilot"><span>Pilot</span><b class="fd-pop-cs"></b></div>` +
      `<div class="fd-pop-pilot"><span>Career</span><b>${fmtInt(pts)} pts${prog?.next ? ` · ${rankFor(pts).name}` : ''}</b></div>`
    : `<div class="fd-pop-pilot"><span>Pilot</span><b>Not set</b></div>`;
  card.innerHTML =
    `<div class="fd-pop-head"><h3>Settings</h3><button class="fd-pop-x" type="button" aria-label="Close">✕</button></div>` +
    `<div class="fd-pop-body">` +
    pilotLine +
    `<label class="fd-pop-row"><span>Reduce motion</span><input type="checkbox" id="fd-rm"${reduced ? ' checked' : ''}></label>` +
    `<div class="fd-pop-actions">` +
    (name ? `<button class="btn ghost sm" id="fd-reset" type="button">Reset pilot data</button>` : '') +
    `<a class="btn ghost sm" href="/privacy.html">Privacy</a>` +
    `<a class="btn ghost sm" href="/terms.html">Terms</a>` +
    `</div></div>`;
  const cs = card.querySelector('.fd-pop-cs');
  if (cs) cs.textContent = name;
  back.appendChild(card);
  document.body.appendChild(back);

  card.querySelector('.fd-pop-x')?.addEventListener('click', closeSettings);
  card.querySelector<HTMLInputElement>('#fd-rm')?.addEventListener('change', (e) => {
    const on = (e.target as HTMLInputElement).checked;
    if (on) localStorage.setItem('bmf.reduceMotion', '1');
    else localStorage.removeItem('bmf.reduceMotion');
    document.documentElement.classList.toggle('fd-reduce-motion', on);
  });
  card.querySelector('#fd-reset')?.addEventListener('click', () => {
    if (!confirm('Reset your pilot callsign, rank, and saved progress on this device? This cannot be undone.')) return;
    try {
      localStorage.removeItem('bmf.profile.v1');
      localStorage.removeItem('bmf.progress.v1');
    } catch {
      /* storage blocked — nothing to clear */
    }
    location.reload();
  });
  document.addEventListener('keydown', onSettingsEsc);
}

function onSettingsEsc(e: KeyboardEvent): void {
  if (e.key === 'Escape') closeSettings();
}
function closeSettings(): void {
  document.getElementById('fd-settings')?.remove();
  document.removeEventListener('keydown', onSettingsEsc);
}

/** Apply the saved reduce-motion preference to <html> as early as a page controller runs. */
export function applyMotionPref(): void {
  if (localStorage.getItem('bmf.reduceMotion') === '1') {
    document.documentElement.classList.add('fd-reduce-motion');
  }
}

// ── The shared stylesheet ───────────────────────────────────────────────────────────────────────────
// All values read the kit's real theme.ts tokens (var(--*)); the only literals are layout numbers and
// the local screen cosmetics index.html already defines (--metal*, --bevel-top, --card-bg).

const SHELL_CSS = `
/* ── App shell + appbar skeleton (Home keeps an identical critical copy in index.html). ──────── */
.fd-app { position: relative; z-index: 2; max-width: 1080px; margin: 0 auto;
  padding: 0 max(14px, env(safe-area-inset-left)) calc(40px + env(safe-area-inset-bottom)) max(14px, env(safe-area-inset-right)); }
.fd-scene { position: fixed; inset: 0; z-index: 0; pointer-events: none; background:
  radial-gradient(130% 60% at 50% -8%, rgba(255,106,44,0.2) 0%, rgba(255,106,44,0.05) 30%, transparent 56%),
  radial-gradient(150% 90% at 50% 118%, rgba(255,120,40,0.1) 0%, transparent 52%),
  linear-gradient(180deg, #0a0d10 0%, #0b0e10 42%, #07090b 100%); }
.fd-scene::after { content: ""; position: absolute; inset: 0; box-shadow: inset 0 0 160px 50px rgba(0,0,0,0.7); }
.fd-bar { position: sticky; top: 0; z-index: 20; display: flex; align-items: center; gap: 12px; min-height: 56px; padding: 10px 2px;
  background: linear-gradient(180deg, rgba(7,10,13,0.92), rgba(7,10,13,0.4)); backdrop-filter: blur(10px) saturate(120%);
  -webkit-backdrop-filter: blur(10px) saturate(120%); border-bottom: 1px solid var(--hair); }
.fd-brand { display: inline-flex; align-items: center; gap: 10px; text-decoration: none; color: var(--text); }
.fd-glyph { width: 34px; height: 34px; flex: 0 0 auto; display: grid; place-items: center; border-radius: var(--r-md);
  border: 1px solid var(--warm-stroke); background: radial-gradient(circle at 40% 30%, var(--warm-38), rgba(10,12,14,0.9));
  box-shadow: inset 0 0 10px var(--ember-35), 0 0 14px var(--ember-12); }
.fd-glyph img { width: 17px; height: 17px; display: block; filter: drop-shadow(0 0 4px var(--glow-80)); }
.fd-brand b { font-family: var(--mono); font-weight: 800; font-size: 13px; letter-spacing: 0.16em; text-transform: uppercase; white-space: nowrap; }
@media (max-width: 520px) { .fd-brand b { display: none; } }
.fd-spacer { flex: 1; }
.fd-navlink { text-decoration: none; color: var(--dim); font-family: var(--mono); font-size: 11px; letter-spacing: 0.12em;
  text-transform: uppercase; font-weight: 700; padding: 10px 11px; min-height: 44px; display: inline-flex; align-items: center; }
.fd-navlink:hover { color: var(--ember-hi); }

/* ── Appbar nav + chrome ──────────────────────────────────────────────────── */
.fd-bar .fd-nav { display: none; align-items: center; gap: 2px; }
@media (min-width: 760px) { .fd-bar .fd-nav { display: inline-flex; } }
.fd-navlink[aria-current="page"] { color: var(--text); }
.fd-navlink.shop { color: var(--ember-hi); }
.fd-chrome { display: inline-flex; align-items: center; gap: 8px; }

/* Returning-pilot dossier pill (appbar, top-right). */
.fd-pill { display: inline-flex; align-items: center; gap: 8px; text-decoration: none; padding: 6px 11px 6px 8px;
  border-radius: var(--r-pill); border: 1px solid var(--warm-stroke); background: var(--warm-glass); min-height: 38px; }
.fd-pill:hover { border-color: var(--ember-hi); }
.fd-pill-rk { width: 16px; height: 16px; display: grid; place-items: center; }
.fd-pill-rk i { width: 8px; height: 8px; border-radius: 1px; transform: rotate(45deg); background: var(--rk);
  box-shadow: 0 0 6px color-mix(in srgb, var(--rk) 80%, transparent); }
.fd-pill-cs { font-family: var(--mono); font-size: var(--fs-sm); font-weight: var(--fw-bold); color: #fff;
  letter-spacing: .02em; max-width: 12ch; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fd-pill-tier { font-family: var(--mono); font-size: var(--fs-micro); letter-spacing: .12em; text-transform: uppercase; color: var(--ember-hi); }
@media (max-width: 460px) { .fd-pill-tier { display: none; } }

/* Settings gear. */
.fd-gear { appearance: none; cursor: pointer; width: 40px; height: 40px; flex: 0 0 auto; display: grid; place-items: center;
  border-radius: var(--r-md); border: 1px solid var(--hair); background: rgba(8,16,22,0.5); color: var(--dim); }
.fd-gear:hover { color: var(--ember-hi); border-color: var(--warm-stroke); }
.fd-gear svg { width: 18px; height: 18px; fill: currentColor; }

/* Settings popover. */
.fd-pop-back { position: fixed; inset: 0; z-index: 70; display: flex; align-items: flex-start; justify-content: flex-end;
  padding: 64px 14px; background: rgba(4,8,6,0.5); backdrop-filter: blur(3px); -webkit-backdrop-filter: blur(3px); }
.fd-pop { width: 100%; max-width: 320px; }
.fd-pop-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 10px; }
.fd-pop-head h3 { font-size: var(--fs-title); color: #fff; }
.fd-pop-x { appearance: none; border: 1px solid var(--hair); background: var(--recess); color: var(--text); width: 36px; height: 36px;
  border-radius: var(--r-sm); cursor: pointer; }
.fd-pop-x:hover { border-color: var(--warm-stroke); color: var(--ember-hi); }
.fd-pop-body { display: flex; flex-direction: column; gap: 10px; }
.fd-pop-pilot { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; font-size: var(--fs-sm); }
.fd-pop-pilot span { color: var(--dim); } .fd-pop-pilot b { font-family: var(--mono); color: var(--text); }
.fd-pop-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; font-size: var(--fs-sm); color: var(--text);
  padding: 8px 0; border-top: 1px solid var(--hair); }
.fd-pop-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 4px; }
.fd-pop-actions .btn { text-decoration: none; }

/* ── Card of record + section header (mirrors ui/home/styles.ts .card; also in index.html critical). ── */
.fd-card { position: relative; background: var(--metal-hi); border: 1px solid var(--stroke); border-top-color: var(--bevel-top);
  border-radius: var(--r-md); box-shadow: var(--shadow-card), inset 0 1px 0 rgba(255,255,255,0.05); padding: 16px 17px; }
.fd-card.metal { background: var(--metal); }
.fd-card.warm { background: radial-gradient(120% 140% at 82% 0%, var(--ember-12), transparent 55%), var(--metal-hi); border-color: var(--warm-stroke); }
.fd-card.cut { clip-path: polygon(18px 0, 100% 0, 100% 100%, 0 100%, 0 18px); }
.fd-brackets { position: absolute; inset: 10px; z-index: 2; pointer-events: none; }
.fd-brackets i { position: absolute; width: 14px; height: 14px; border-color: var(--warm-stroke); opacity: .6; }
.fd-brackets i:nth-child(1) { top: 0; left: 0; border-top: 2px solid; border-left: 2px solid; }
.fd-brackets i:nth-child(2) { top: 0; right: 0; border-top: 2px solid; border-right: 2px solid; }
.fd-brackets i:nth-child(3) { bottom: 0; right: 0; border-bottom: 2px solid; border-right: 2px solid; }
.fd-eyebrow { margin: 0 0 13px; font-family: var(--mono); font-size: 10.5px; letter-spacing: .26em; text-transform: uppercase; color: var(--menu); font-weight: 700; }
.fd-eyebrow.cool { color: var(--accent); }
.fd-sec { display: flex; align-items: center; gap: 10px; margin: 0 0 13px; }
.fd-sec-tag { font-family: var(--mono); font-size: var(--fs-label); letter-spacing: .26em; text-transform: uppercase; color: var(--menu); font-weight: var(--fw-bold); white-space: nowrap; }
.fd-sec-line { flex: 1; height: 1px; background: linear-gradient(90deg, var(--gold-32), transparent); }

/* ── National-data GRID (the new glass-cockpit instrument grid). ──────────────── */
.fd-natgrid-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
.fd-natgrid-head .fd-eyebrow { margin: 0; }
.fd-natgrid { display: grid; gap: 8px; grid-template-columns: repeat(2, 1fr); }
@media (min-width: 560px) { .fd-natgrid { grid-template-columns: repeat(4, 1fr); } }
.fd-stat { display: flex; flex-direction: column; gap: 4px; padding: 12px 13px; border-radius: var(--r-md);
  background: var(--bezel); border: 1px solid var(--hair); }
.fd-stat b { font-family: var(--mono); font-size: var(--fs-display); font-weight: var(--fw-bold); color: var(--text); line-height: 1; letter-spacing: -0.01em; }
.fd-stat.is-hot b { color: var(--ember-hi); }
.fd-stat span { font-family: var(--mono); font-size: var(--fs-micro); letter-spacing: .1em; text-transform: uppercase; color: var(--dim); }
.fd-fresh { margin-top: 12px; font-family: var(--mono); font-size: var(--fs-micro); letter-spacing: .04em; color: var(--faint); }
.fd-fresh a { color: var(--ember-hi); }
.fd-bar-live { display: inline-flex; align-items: center; gap: 6px; font-family: var(--mono); font-size: 10px; letter-spacing: .16em;
  text-transform: uppercase; color: var(--ok); padding: 5px 9px; border-radius: 6px; border: 1px solid var(--hair); background: rgba(8,16,22,0.5); }
.fd-bar-live::before { content: ""; width: 7px; height: 7px; border-radius: 50%; background: currentColor; box-shadow: 0 0 7px currentColor; }
.fd-bar-live.is-cached { color: var(--caution); }
.fd-bar-live.is-down { color: var(--warn); }

/* ── Field Notes (our own articles) reuse the mission card (.fd-mcard). ────────── */
/* In a rail they scroll-snap; in a .fd-mgrid they tile like the campaign showcase. */
.fd-rail { display: flex; gap: 12px; overflow-x: auto; scroll-snap-type: x mandatory; -webkit-overflow-scrolling: touch;
  padding-bottom: 4px; scrollbar-width: thin; }
.fd-rail::-webkit-scrollbar { height: 6px; } .fd-rail::-webkit-scrollbar-thumb { background: var(--hair); border-radius: 99px; }
.fd-rail .fd-mcard { flex: 0 0 78%; max-width: 340px; scroll-snap-align: start; }
@media (min-width: 760px) { .fd-rail .fd-mcard { flex-basis: 300px; } }

/* ── Mission cards (the /campaign showcase). ──────────────────────────────────── */
.fd-mgrid { display: grid; gap: 12px; grid-template-columns: 1fr; }
@media (min-width: 620px) { .fd-mgrid { grid-template-columns: repeat(2, 1fr); } }
@media (min-width: 980px) { .fd-mgrid { grid-template-columns: repeat(4, 1fr); } }
/* Poster rule (DESIGN.md → Spacing & Layout): a key-art card is PORTRAIT. The host fixes the WIDTH
   (rail flex-basis / grid track), so --ar-poster derives the height — the card never flattens to a
   landscape letterbox on a wide phone. min-height stays a floor for UAs without aspect-ratio, and
   content taller than the aspect still expands the box (so a long title never clips). */
.fd-mcard { position: relative; display: flex; flex-direction: column; justify-content: flex-end; aspect-ratio: var(--ar-poster); min-height: 230px; overflow: hidden;
  text-decoration: none; color: var(--text); padding: 0;
  clip-path: polygon(18px 0, 100% 0, 100% 100%, 0 100%, 0 18px); }
.fd-mcard .fd-m-art { position: absolute; inset: 0; z-index: 0; }
.fd-mcard .fd-m-art img { width: 100%; height: 100%; object-fit: cover; display: block; }
.fd-mcard .fd-m-art.proc { background: radial-gradient(120% 90% at var(--px, 70%) var(--py, 18%), var(--ember-22), transparent 60%), var(--metal); }
.fd-mcard .fd-m-scrim { position: absolute; inset: 0; z-index: 1; background: linear-gradient(180deg, rgba(6,9,11,0.05) 0%, rgba(6,9,11,0.55) 52%, rgba(6,9,11,0.92) 100%); }
.fd-mcard .fd-m-top { position: absolute; top: 12px; left: 12px; right: 12px; z-index: 2; display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.fd-mcard .fd-m-no { font-family: var(--mono); font-size: var(--fs-micro); letter-spacing: .16em; text-transform: uppercase; color: var(--menu); }
.fd-mcard .fd-m-body { position: relative; z-index: 2; padding: 14px 14px 15px; }
/* Field Notes cards stack the chip above the title in the body (missions keep theirs in .fd-m-top). */
.fd-mcard .fd-m-body .fd-m-no { display: block; margin-bottom: 6px; }
.fd-mcard .fd-m-name { font-size: var(--fs-title); font-weight: var(--fw-black); color: #fff; line-height: 1.08; }
.fd-mcard .fd-m-tag { margin-top: 5px; font-size: var(--fs-sm); line-height: 1.4; color: var(--text-subtle); }
.fd-mcard .fd-m-diff { display: inline-flex; gap: 3px; margin-top: 9px; }
.fd-mcard .fd-m-diff i { width: 7px; height: 7px; border-radius: 1px; transform: rotate(45deg); background: var(--fire); box-shadow: 0 0 6px var(--ember-35); }
.fd-mcard .fd-m-diff i.off { background: var(--recess); box-shadow: none; }
.fd-mcard .fd-m-go { margin-top: 10px; font-family: var(--mono); font-size: var(--fs-micro); letter-spacing: .06em; color: var(--ember-hi); }
.fd-mcard:hover .fd-m-art img { transform: scale(1.03); } .fd-mcard .fd-m-art img { transition: transform .3s ease; }
.fd-mcard.locked { pointer-events: none; }
.fd-mcard.locked .fd-m-art, .fd-mcard.locked .fd-m-body { filter: grayscale(.7); opacity: .72; }

/* ── Interactive readiness checklist — the /prepare TOP card. Its collapsible header reuses the in-game
   .daily card verbatim (injectHomeStyles: .daily-head/.daily-body/.chev/.collapsed); the rules here are
   only the list's OWN widgets — the progress ring + the check rows. ─── */
.fd-ring { --p: 0; position: relative; width: 54px; height: 54px; flex: 0 0 auto; border-radius: 50%;
  background: conic-gradient(var(--ember-hi) calc(var(--p) * 1%), var(--recess) 0); display: grid; place-items: center; }
.fd-ring::after { content: ""; position: absolute; inset: 6px; border-radius: 50%; background: var(--card-bg); border: 1px solid var(--hair); }
.fd-ring b { position: relative; z-index: 1; font-family: var(--mono); font-size: var(--fs-sm); font-weight: var(--fw-bold); color: var(--text); }
.fd-check-list { display: flex; flex-direction: column; gap: 8px; margin-top: 14px; }
.fd-item { display: flex; align-items: flex-start; gap: 12px; padding: 13px 14px; border-radius: var(--r-md);
  background: var(--bezel); border: 1px solid var(--hair); cursor: pointer; transition: border-color .14s, background .14s; }
.fd-item:hover { border-color: var(--warm-stroke); }
.fd-item.done { background: var(--ok-12); border-color: var(--ok-50); }
.fd-box { flex: 0 0 auto; width: 24px; height: 24px; margin-top: 1px; border-radius: var(--r-sm); border: 1.5px solid var(--stroke-strong);
  display: grid; place-items: center; background: var(--recess); }
.fd-item.done .fd-box { background: var(--ok); border-color: var(--ok); }
.fd-box svg { width: 15px; height: 15px; fill: var(--ink); opacity: 0; }
.fd-item.done .fd-box svg { opacity: 1; }
.fd-item-txt { min-width: 0; }
.fd-item-h { font-size: var(--fs-md); font-weight: var(--fw-semibold); color: var(--text); line-height: 1.25; }
.fd-item.done .fd-item-h { text-decoration: line-through; text-decoration-color: var(--ok-50); color: var(--text-subtle); }
.fd-item-b { margin-top: 3px; font-size: var(--fs-sm); line-height: 1.45; color: var(--dim); }

/* ── Live-map overlay + fire-detail sheet (the Map button surface). ───────────── */
.fd-map-over { position: fixed; inset: 0; z-index: 80; display: flex; flex-direction: column; background: rgba(5,8,11,0.96);
  backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); }
.fd-map-bar { display: flex; align-items: center; gap: 12px; padding: 12px max(14px, env(safe-area-inset-left)); border-bottom: 1px solid var(--hair); }
.fd-map-bar h2 { font-size: var(--fs-title); color: #fff; }
.fd-map-bar .fd-map-x { margin-left: auto; appearance: none; border: 1px solid var(--hair); background: var(--recess); color: var(--text);
  width: 40px; height: 40px; border-radius: var(--r-sm); cursor: pointer; }
.fd-map-bar .fd-map-x:hover { border-color: var(--warm-stroke); color: var(--ember-hi); }
.fd-map { position: relative; flex: 1; min-height: 0; background: var(--card-bg); }
.fd-map-skel { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px;
  color: var(--faint); font-family: var(--mono); font-size: var(--fs-meta); text-align: center; padding: 20px; }
.fd-map-note { position: absolute; left: 50%; top: 14px; transform: translateX(-50%); z-index: 500; max-width: 92%; text-align: center;
  padding: 9px 14px; border-radius: var(--r-md); background: rgba(7,10,13,0.88); border: 1px solid var(--hair); color: var(--text);
  font-family: var(--mono); font-size: var(--fs-meta); backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px); }
.fd-map-foot { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px;
  padding: 11px max(14px, env(safe-area-inset-left)) calc(11px + env(safe-area-inset-bottom)); border-top: 1px solid var(--hair); }
.fd-legend { display: flex; flex-wrap: wrap; gap: 12px; font-family: var(--mono); font-size: var(--fs-micro); letter-spacing: .04em; text-transform: uppercase; color: var(--dim); }
.fd-legend span { display: inline-flex; align-items: center; gap: 6px; }
.fd-legend i { width: 9px; height: 9px; border-radius: 50%; display: inline-block; }
.leaflet-container { background: var(--card-bg) !important; font-family: var(--mono); }
/* Sun-readability: lift the dark basemap (contrast > brightness → blacks stay black, grey labels/roads
   sharpen) so the map still reads in direct glare instead of collapsing to uniform black. Tiles only. */
.fd-map .leaflet-tile { filter: contrast(1.14) brightness(1.06); }
.fd-detail-back { position: fixed; inset: 0; z-index: 90; display: flex; align-items: flex-end; justify-content: center;
  background: rgba(4,8,6,0.64); backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px); }
.fd-detail { width: 100%; max-width: 560px; max-height: 78dvh; display: flex; flex-direction: column; background: var(--metal-hi);
  border: 1px solid var(--stroke); border-top-color: var(--bevel-top); border-bottom: 0; border-radius: var(--r-xl) var(--r-xl) 0 0;
  box-shadow: 0 -10px 40px rgba(0,0,0,0.55); overflow: hidden; }
@media (min-width: 620px) { .fd-detail-back { align-items: center; } .fd-detail { border-bottom: 1px solid var(--stroke); border-radius: var(--r-xl); } }
.fd-detail-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding: 16px 18px 12px; border-bottom: 1px solid var(--hair); }
.fd-detail-id { font-weight: var(--fw-heavy); font-size: var(--fs-lg); color: var(--text); }
.fd-detail-stage { margin-top: 3px; font-family: var(--mono); font-size: var(--fs-meta); color: var(--ember-hi); }
.fd-detail-x { appearance: none; border: 1px solid var(--hair); background: var(--recess); color: var(--text); width: 44px; height: 44px;
  border-radius: var(--r-sm); cursor: pointer; font-size: 14px; flex: 0 0 auto; }
.fd-detail-x:hover { border-color: var(--warm-stroke); color: var(--ember-hi); }
.fd-detail-body { overflow-y: auto; padding: 6px 18px 14px; }
.fd-grp { padding: 12px 0; border-bottom: 1px solid var(--hair); } .fd-grp:last-child { border-bottom: 0; }
.fd-grp h4 { margin: 0 0 8px; font-family: var(--mono); font-size: var(--fs-micro); letter-spacing: .14em; text-transform: uppercase; color: var(--faint); font-weight: var(--fw-bold); }
.fd-row { display: flex; align-items: baseline; justify-content: space-between; gap: 14px; padding: 5px 0; font-size: var(--fs-meta); }
.fd-row span { color: var(--dim); } .fd-row b { font-family: var(--mono); color: var(--text); font-weight: var(--fw-semibold); text-align: right; white-space: nowrap; }
.fd-link { display: inline-flex; align-items: center; gap: 6px; text-decoration: none; color: var(--ember-hi); font-weight: 700; font-size: 13.5px;
  min-height: 44px; appearance: none; background: none; border: 0; padding: 0; cursor: pointer; font-family: var(--font); }
.fd-link:hover { color: var(--ember); }

/* ── Footer (shared): a wrapping flex row. The disclaimer takes a full-width line of its own (flex
   basis 100%); the policy links and the brand lockup share the next line (links left, lockup pushed
   right with margin-left:auto). The links carry a 44px tap target, so the row is centre-aligned to keep
   the link text and the wordmark on one line; the links shrink/wrap so the lockup never drops a row. ─ */
.fd-foot { color: var(--dim); padding-top: 8px; margin-top: 6px;
  display: flex; flex-wrap: wrap; align-items: center; column-gap: 20px; row-gap: 8px; }
.fd-foot .fd-disclaimer { order: 1; flex: 1 1 100%; margin: 0; font-size: var(--fs-sm); max-width: 60ch; }
.fd-foot-links { order: 2; flex: 0 1 auto; min-width: 0; display: flex; flex-wrap: wrap; gap: 8px 18px; align-items: center; }
.fd-foot .site-foot-brand { align-self: center; }
.fd-foot-links a { text-decoration: none; color: var(--dim); font-size: var(--fs-sm); font-weight: var(--fw-semibold); min-height: 44px; display: inline-flex; align-items: center; }
.fd-foot-links a:hover { color: var(--text); }

/* ── Mobile bottom tab bar. ───────────────────────────────────────────────────── */
/* The base .fd-tabbar / .fd-tab rules now live in siteNav.mjs (navCss) — ONE source shared with the
   blog + legal pages. Injected by injectFrontShell() → injectNavStyles(). The override below is the
   front-door-only special case. */
/* The live-fire tracker is a front-door surface in a full-screen .bmf-app overlay (openLiveFires, when
   reached from the front door, tags the root .front-nav). On MOBILE the bottom tab bar carries the nav, so
   reserve its height; on DESKTOP (≥760) the tab bar hides (its default) and the merged top bar's own
   .fhome-nav takes over — so the map runs full-bleed to the bottom with no redundant second nav. */
.bmf-app.front-nav .pad:has(> .firewrap) { padding-bottom: calc(58px + env(safe-area-inset-bottom)); }
@media (min-width: 760px) { .bmf-app.front-nav .pad:has(> .firewrap) { padding-bottom: 0; } }
/* Make room above the fixed tab bar on phones so nothing hides behind it. */
@media (max-width: 759px) { .fd-app { padding-bottom: calc(78px + env(safe-area-inset-bottom)) !important; } }

/* Honour the reduce-motion preference (set via the settings gear). */
.fd-reduce-motion *, .fd-reduce-motion *::before, .fd-reduce-motion *::after {
  animation-duration: .001ms !important; animation-iteration-count: 1 !important; transition-duration: .001ms !important; scroll-behavior: auto !important; }
`;
