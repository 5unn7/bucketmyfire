/**
 * The shared SITE SHELL for the public pages (Home `/`, Campaign `/campaign/`, Hall of Fame
 * `/hall-of-fame/`).
 *
 * The front-door pages are hand-authored static HTML (crawlable, instant paint) that each boot a
 * light controller. This module is the ONE place their common chrome + styling lives, so the appbar,
 * nav, footer, mobile tab bar, and the whole glass-cockpit card vocabulary can't drift across pages:
 *
 *   - `injectShellStyles()` — the shared stylesheet (reads the kit's real theme.ts `var(--*)` tokens
 *     from `injectKitStyles()`, so it's one visual language with the in-game home). Covers the appbar +
 *     nav, the `.fd-card` bento system, section headers, the national-data grid, the readouts,
 *     mission/poster cards, the live-map overlay + fire-detail sheet, the footer (safety disclaimer +
 *     policy links), and the mobile bottom tab bar.
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
import { submitContact, submitLead } from '../three/leaderboard/client';
import { openModal } from '../three/ui/components/Modal';
import { tabbarHtml, footerBrandHtml } from './siteNav.mjs';

export type ShellPage = 'home' | 'campaign' | 'halloffame';

/** The mobile bottom tab bar — the shared tab bar (siteNav). Kept as a thin re-export so the front-door
 *  controllers + the live-fire overlay call one name; the markup + `.fd-tabbar` CSS live in siteNav. */
export function tabbarMarkup(active: ShellPage): string {
  return tabbarHtml(active);
}

/** The shared footer. It LEADS with the safety disclaimer; below it, the policy links (Contact +
 *  Privacy + Terms) share the base line with the brand lockup. */
export function buildFooter(): string {
  return (
    `<footer class="fd-foot">` +
    `<p class="fd-disclaimer">A window onto real data, not an emergency tool. Always follow official sources and local authorities.</p>` +
    `<div class="fd-foot-links">` +
    `<button type="button" class="fd-foot-contact" data-front="contact">Contact</button>` +
    `<a href="/privacy.html" data-front="legal" data-legal="privacy">Privacy</a>` +
    `<a href="/terms.html" data-front="legal" data-legal="terms">Terms</a>` +
    `</div>` +
    footerBrandHtml() +
    `</footer>`
  );
}

/** Inject the shared stylesheet ONCE. Idempotent. Call after injectKitStyles() so the tokens resolve. */
export function injectShellStyles(): void {
  injectShellDefs();
  if (document.getElementById('fd-shell-css')) return;
  const s = document.createElement('style');
  s.id = 'fd-shell-css';
  s.textContent = SHELL_CSS;
  document.head.appendChild(s);
}

/** Inject the SVG filter <defs> the liquified-glass card texture (.fd-glasstex) references, ONCE. These are real
 *  turbulence-displacement filters (referenced cross-browser only via a same-document `url(#id)`,
 *  which is why they're inline DOM rather than a data-URI in CSS): `#fd-liquid-glass` warps the ember
 *  streak into a flowing liquid ribbon (low frequency, big waves), `#fd-lens` ripples the glass sheen
 *  into tiny refracting lenses (high frequency, small waves). Both rasterize ONCE — the layers that
 *  use them never animate — so there's no per-frame filter cost. */
function injectShellDefs(): void {
  if (document.getElementById('fd-shell-defs')) return;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.id = 'fd-shell-defs';
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none';
  svg.innerHTML =
    `<defs>` +
    `<filter id="fd-liquid-glass" x="-30%" y="-30%" width="160%" height="160%" color-interpolation-filters="sRGB">` +
    `<feTurbulence type="fractalNoise" baseFrequency="0.008 0.013" numOctaves="2" seed="7" result="n"/>` +
    `<feDisplacementMap in="SourceGraphic" in2="n" scale="38" xChannelSelector="R" yChannelSelector="G"/>` +
    `</filter>` +
    `<filter id="fd-lens" x="-6%" y="-6%" width="112%" height="112%" color-interpolation-filters="sRGB">` +
    // High frequency, sub-pixel scale: just enough jitter to set the 2px mosaic tiles off the grid
    // like hand-laid glass tesserae, without dissolving them (a big scale would smear 2px to mush).
    `<feTurbulence type="fractalNoise" baseFrequency="0.42 0.44" numOctaves="1" seed="3" result="n"/>` +
    `<feDisplacementMap in="SourceGraphic" in2="n" scale="1.4" xChannelSelector="R" yChannelSelector="G"/>` +
    `</filter>` +
    `</defs>`;
  (document.body || document.documentElement).appendChild(svg);
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

/**
 * The agency "work with us" contact modal — a short enquiry form (name + email + optional phone + a short
 * project description) opened from the footer Contact link (wired by wireFrontAppbar's
 * `[data-front="contact"]`). It posts to the locked `contacts` table via the `submit_contact` RPC
 * (best-effort + env-gated in the leaderboard client). Built on the shared kit `openModal` component, so
 * the scrim, frosted card, titlebar/close, ESC + scrim-click close, and focus-trap are all the one
 * implementation. No user text is ever `innerHTML`-d: the form is static markup and values are read off
 * the inputs; the states swapped in are static copy.
 */
export function openContact(): void {
  const m = openModal({ title: 'Work with us', width: '440px' });
  m.body.innerHTML =
    `<form class="fd-cform" novalidate>` +
    `<p class="fd-cform-lead">We build software, sites, and live-data tools. Like this one.</p>` +
    `<label class="fd-field"><span>Name</span><input type="text" name="name" autocomplete="name" maxlength="80" required></label>` +
    `<label class="fd-field"><span>Email</span><input type="email" name="email" autocomplete="email" inputmode="email" maxlength="254" required></label>` +
    `<label class="fd-field"><span>Phone <i>(optional)</i></span><input type="tel" name="phone" autocomplete="tel" inputmode="tel" maxlength="32"></label>` +
    `<label class="fd-field"><span>Tell us something about the project</span><textarea name="description" rows="3" maxlength="2000" required></textarea></label>` +
    `<p class="fd-cform-msg" role="status" aria-live="polite"></p>` +
    `<button class="btn primary fd-cform-go" type="submit">Send enquiry</button>` +
    `</form>`;
  const form = m.body.querySelector('form') as HTMLFormElement;
  const msg = m.body.querySelector('.fd-cform-msg') as HTMLElement;
  const go = m.body.querySelector('.fd-cform-go') as HTMLButtonElement;
  // The kit modal focuses the close ✕ first; pull focus to the first field instead.
  setTimeout(() => (m.body.querySelector('input[name="name"]') as HTMLInputElement | null)?.focus(), 0);

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = (form.elements.namedItem('name') as HTMLInputElement).value.trim();
    const desc = (form.elements.namedItem('description') as HTMLTextAreaElement).value.trim();
    const email = (form.elements.namedItem('email') as HTMLInputElement).value.trim();
    const phone = (form.elements.namedItem('phone') as HTMLInputElement).value.trim();
    msg.className = 'fd-cform-msg';
    if (!name || !desc) {
      msg.classList.add('err');
      msg.textContent = 'Please add your name and a note about the project.';
      return;
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      msg.classList.add('err');
      msg.textContent = 'Please enter a valid email.';
      return;
    }
    go.disabled = true;
    go.textContent = 'Sending…';
    void submitContact(name, desc, email, phone).then((ok) => {
      if (ok) {
        // Static success panel (no user text echoed). The form is replaced wholesale.
        form.innerHTML =
          `<p class="fd-cform-msg ok">Thanks — we'll be in touch.</p>` +
          `<button class="btn ghost fd-cform-go" type="button">Close</button>`;
        form.querySelector('button')?.addEventListener('click', () => m.close());
      } else {
        go.disabled = false;
        go.textContent = 'Send enquiry';
        msg.className = 'fd-cform-msg err';
        msg.textContent = "Couldn't send right now — please try again in a moment.";
      }
    });
  });
}

/**
 * "Under Production" capture for an UPCOMING (not-yet-live) map — the SAME front-door modal as the contact
 * form (the shared kit `openModal` shell + the `.fd-cform`/`.fd-field` chrome). Two fields: a required
 * email and an optional "feature request" note. On submit the email goes on the leadlist via `submitLead`
 * tagged `notify:<mapId>` (validated, deduped + throttled server-side, callsign linked when set), and the
 * feature note rides along in the `leads.note` column. Honest: a failed signup says so and never throws.
 */
export function openNotify(mapId: string): void {
  const m = openModal({ title: 'Under Production', width: '440px' });
  m.body.innerHTML =
    `<form class="fd-cform" novalidate>` +
    `<p class="fd-cform-lead">Leave your mail and some cool things you'd like to see that we can build.</p>` +
    `<label class="fd-field"><span>Email</span><input type="email" name="email" autocomplete="email" inputmode="email" maxlength="254" required></label>` +
    `<label class="fd-field"><span>Feature request <i>(optional)</i></span><textarea name="feature" rows="3" maxlength="2000" placeholder="Maps, aircraft, modes you'd love to fly…"></textarea></label>` +
    `<p class="fd-cform-msg" role="status" aria-live="polite"></p>` +
    `<button class="btn primary fd-cform-go" type="submit">Notify me</button>` +
    `</form>`;
  const form = m.body.querySelector('form') as HTMLFormElement;
  const msg = m.body.querySelector('.fd-cform-msg') as HTMLElement;
  const go = m.body.querySelector('.fd-cform-go') as HTMLButtonElement;
  // The kit modal focuses the close ✕ first; pull focus to the email field instead.
  setTimeout(() => (m.body.querySelector('input[name="email"]') as HTMLInputElement | null)?.focus(), 0);

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const email = (form.elements.namedItem('email') as HTMLInputElement).value.trim();
    const feature = (form.elements.namedItem('feature') as HTMLTextAreaElement).value.trim();
    msg.className = 'fd-cform-msg';
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      msg.classList.add('err');
      msg.textContent = 'Please enter a valid email.';
      return;
    }
    go.disabled = true;
    go.textContent = 'Signing up…';
    const callsign = savedCallsign() || undefined;
    // Email → the waitlist (tagged by which upcoming map drew them); the feature note rides along in the
    // leads.note column, and the saved callsign links a signup to a board pilot.
    void submitLead(email, `notify:${mapId}`, callsign, feature || undefined).then((ok) => {
      if (ok) {
        form.innerHTML =
          `<p class="fd-cform-msg ok">You're on the list — thanks, we'll keep you posted.</p>` +
          `<button class="btn ghost fd-cform-go" type="button">Close</button>`;
        form.querySelector('button')?.addEventListener('click', () => m.close());
      } else {
        go.disabled = false;
        go.textContent = 'Notify me';
        msg.className = 'fd-cform-msg err';
        msg.textContent = "Couldn't sign you up right now — please try again in a moment.";
      }
    });
  });
}

/**
 * Open a legal page (Privacy / Terms) inside the SAME kit modal, embedding the already-built, fully-styled
 * `/privacy.html` · `/terms.html` via an iframe (one source of truth — no prose duplicated into the app).
 * The pages read `#embed` and hide their own chrome (appbar/footer/breadcrumb) so only the legal text
 * shows inside the modal. The footer links stay real anchors, so a modified click still opens the page.
 */
export function openLegal(slug: 'privacy' | 'terms'): void {
  const title = slug === 'terms' ? 'Terms of Use' : 'Privacy Policy';
  const m = openModal({ title, width: '760px' });
  m.body.style.padding = '0';
  const frame = document.createElement('iframe');
  frame.className = 'fd-legal-frame';
  frame.src = `/${slug}.html#embed`;
  frame.title = title;
  m.body.appendChild(frame);
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
.fd-glyph img { width: 17px; height: 17px; display: block; }
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

/* ── Agency "work with us" contact modal — the short enquiry form. Reuses the .fd-pop popover shell; these
   rules are only the centred placement + the form-field widgets (all values are theme tokens). ── */
/* The scrim + frosted card now come from the shared kit openModal (Modal.ts); these rules are only the
   form-field widgets + the legal-page iframe (all values are theme tokens). */
/* Embedded legal page (Privacy / Terms) — the iframe fills the modal body; the page hides its own chrome
   in #embed mode so only the legal text shows. */
.fd-legal-frame { width: 100%; height: 72vh; max-height: 72vh; border: 0; display: block; background: transparent; }
.fd-cform { display: flex; flex-direction: column; gap: 12px; }
.fd-cform-lead { margin: 0 0 2px; font-size: var(--fs-md); line-height: 1.4; color: var(--text); font-weight: var(--fw-semibold); }
.fd-field { display: flex; flex-direction: column; gap: 5px; }
.fd-field > span { font-family: var(--mono); font-size: var(--fs-micro); letter-spacing: .1em; text-transform: uppercase; color: var(--dim); }
.fd-field > span i { font-style: normal; color: var(--faint); text-transform: none; letter-spacing: 0; }
.fd-field input, .fd-field textarea { width: 100%; box-sizing: border-box; background: var(--recess); border: 1px solid var(--stroke);
  border-radius: var(--r-sm); color: var(--text); font-family: var(--font); font-size: var(--fs-md); padding: 10px 12px; }
.fd-field textarea { resize: vertical; min-height: 82px; line-height: 1.45; }
.fd-field input:focus, .fd-field textarea:focus { outline: none; border-color: var(--warm-stroke); box-shadow: 0 0 0 3px var(--ember-12); }
.fd-cform-msg { margin: 0; min-height: 1.1em; font-size: var(--fs-sm); line-height: 1.4; }
.fd-cform-msg.ok { color: var(--ok); }
.fd-cform-msg.err { color: var(--warn); }
.fd-cform-go { width: 100%; justify-content: center; }
.fd-cform-go[disabled] { opacity: .6; pointer-events: none; }

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

/* ── Mission/poster cards (the /campaign showcase + the gameplay pick posters). ── */
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
/* A card may stack the chip above the title in the body (missions keep theirs in .fd-m-top). */
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

/* ── Liquified-ember + distorted-GLASS 2px-mosaic texture (the branded card finish). ─────────────
   A liquified ember STREAK under a 2px glass-mosaic sheen, as one standalone layer:
     • .fd-glasstex — a self-contained layer dropped into ANY card (live-map tile, hero cards, …).
       It paints only the ember WELLS (transparent elsewhere) so the host card's own fill shows
       through — a texture OVER the card, not a replacement. Mark the host .fd-glass (relative
       + clipped + its real content lifted above the z:0 texture); the live-map tile already lifts its
       own content, so it just gets the layer + a hover hook.
   The SVG turbulence filters (#fd-liquid-glass / #fd-lens, injected once by injectShellDefs) do the
   warping; every layer is STATIC so the filter rasterizes once — no per-frame cost. Only literals are
   the neutral glass specular, same convention as .fd-m-scrim above. */
.fd-glasstex {
  position: absolute; inset: 0; z-index: 0; pointer-events: none; overflow: hidden; border-radius: inherit;
  /* WELLS ONLY (no --metal floor) — the host card's fill shows between them. */
  background:
    radial-gradient(120% 90% at 74% 10%, var(--ember-20), transparent 58%),
    radial-gradient(96% 120% at 8% 110%, var(--fire-12), transparent 56%);
}
/* The host marker: clip the inset streak to the card + lift the card's real content above the texture. */
.fd-glass { position: relative; overflow: hidden; isolation: isolate; }
.fd-glass > :not(.fd-glasstex) { position: relative; z-index: 1; }

/* The liquified gradient streak — a diagonal ember sweep the low-frequency filter pulls into a
   flowing ribbon, then a soft mask fades it to one corner so it reads as a STREAK, not a wash. Inset
   past the edge so the warp never reveals a transparent fringe inside the host's overflow:hidden. */
.fd-glasstex::before {
  content: ""; position: absolute; inset: -26%; z-index: 0; pointer-events: none;
  background:
    conic-gradient(from 208deg at 32% 16%, transparent 0deg, var(--ember-40) 64deg,
      var(--glow-80) 126deg, var(--ember-30) 188deg, transparent 286deg),
    linear-gradient(116deg, transparent 32%, var(--fire-28) 50%, transparent 72%);
  filter: url(#fd-liquid-glass) blur(6px);
  mix-blend-mode: screen; opacity: .92;
  -webkit-mask-image: linear-gradient(124deg, #000 30%, transparent 86%);
          mask-image: linear-gradient(124deg, #000 30%, transparent 86%);
  transition: opacity .3s ease;
}
/* The distorted-glass overlay — a 2px MOSAIC of glass tesserae: a faceted micro-glint tiled into
   every 2px cell (the tile that catches light) over a 2px grout grid (the seams), which the lens
   filter nudges off-grid so the tiles sit like hand-laid glass rather than a printed screen. Blended
   soft-light so it refracts the ember beneath rather than tinting it. A larger soft sheen sits on top
   un-tiled so the whole pane still reads as one sheet of glass. Static; opacity-only hover. */
.fd-glasstex::after {
  content: ""; position: absolute; inset: 0; z-index: 0; pointer-events: none;
  background:
    radial-gradient(120% 90% at 28% 16%, rgba(255,255,255,0.10), transparent 52%),
    radial-gradient(circle at 30% 30%, rgba(255,255,255,0.16) 0%, transparent 62%),
    repeating-linear-gradient(0deg,  rgba(0,0,0,0.16) 0 .5px, transparent .5px 2px),
    repeating-linear-gradient(90deg, rgba(0,0,0,0.16) 0 .5px, transparent .5px 2px);
  background-size: auto, 2px 2px, 2px 2px, 2px 2px;
  filter: url(#fd-lens);
  mix-blend-mode: soft-light; opacity: .8;
  transition: opacity .3s ease;
}
.fd-glass:hover .fd-glasstex::before,
.fhome-map:hover .fd-glasstex::before { opacity: 1; }
.fd-glass:hover .fd-glasstex::after,
.fhome-map:hover .fd-glasstex::after { opacity: .9; }

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
/* Ghost site-category row leads the footer: a full-width line above a hairline, then the disclaimer +
   policy links + brand share the base line below it. */
.fd-foot .fd-disclaimer { order: 1; flex: 1 1 100%; margin: 0; font-size: var(--fs-sm); max-width: 60ch; }
.fd-foot-links { order: 2; flex: 0 1 auto; min-width: 0; display: flex; flex-wrap: wrap; gap: 8px 18px; align-items: center; }
.fd-foot .site-foot-brand { align-self: center; }
.fd-foot-links a, .fd-foot-links .fd-foot-contact { text-decoration: none; color: var(--dim); font-size: var(--fs-sm); font-weight: var(--fw-semibold); min-height: 44px; display: inline-flex; align-items: center; }
.fd-foot-links a:hover, .fd-foot-links .fd-foot-contact:hover { color: var(--text); }
/* The Contact link is a <button> (opens the modal) — strip the native chrome so it reads as a link. */
.fd-foot-links .fd-foot-contact { appearance: none; background: none; border: 0; padding: 0; cursor: pointer; font-family: var(--font); }

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
