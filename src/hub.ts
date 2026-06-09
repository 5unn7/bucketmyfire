/**
 * The FRONT DOOR controller — the light entry point `index.html` boots instead of the heavy game.
 *
 * Position (see docs/FRONT-DOOR-PLAN.md): bucketmyfire is a credible public wildfire WINDOW you engage
 * with through play. The served `index.html` is hand-authored static markup (a real, crawlable document)
 * so a search crawler and a cold first paint both see real words with zero JS. This module then:
 *
 *   1. Front-controls: a game/dev deep link (?province / ?ffa / ?m= / ?autostart / ?qa / ?editor / …)
 *      is handed STRAIGHT to the 3D game, preserving every existing entry + the headless QA harness.
 *   2. Hydrates the hero headline + the live data strip with the real CIFFC numbers (national active +
 *      a Saskatchewan count derived from the reported roll) — honest in-season, off-season, and down.
 *   3. Lazy-mounts the existing Leaflet fire map (a Three-decoupled chunk) into the hero's map card.
 *   4. Wires "Fight the fire" to lazy-`import('./three/main')` — the ~1 MB game bundle downloads ONLY
 *      when someone chooses to fly, so an info-seeker never pays for it.
 *
 * Best-effort like the home screen: the live data degrades to an honest fallback and NEVER throws into
 * the page. Tiny initial JS (this + the Three-free livefire fetch/normalize layer); Leaflet + the game
 * are both lazy chunks. Returning from the game is a page reload back to this front door (the existing
 * "mission switch = page reload" invariant), so we never tear down WebGL to re-mount the HTML shell.
 */
import { injectFonts } from './three/ui/fonts';
import { injectKitStyles } from './three/ui/components/base';
import { SPLASH_CSS, SPINNER_MARKUP, SPLASH_ATTRS } from './three/ui/spinner';
import { fetchSummary, fetchReportedFires, fetchBurnPerimeters } from './three/livefire/client';
import { filterReportedCountry } from './three/livefire/normalize';
import { fmtInt, fmtHa, publishedWhen, stageLabel, LIVEFIRE_SOURCES, SK_OFFICIAL } from './three/livefire/strings';
import { REPORTED_FIELD_GROUPS } from './three/livefire/fields';
import { cleanCallsign } from './three/ui/callsign';
import { careerScore, rankFor, nextRankProgress } from './three/missions/rank';
import type { NationalSummary, ReportedFeed, ReportedFire } from './three/livefire/types';

const params = new URLSearchParams(location.search);

// Any of these params means "the visitor wants the GAME / a dev tool, not the front door" — hand the
// page straight to the existing 3D entry so every deep link AND the headless QA harness (?autostart /
// ?qa, which the verify:render CI gate drives) boot exactly as before. A bare URL = the front door.
// ('daily' is retained only so a LEGACY ?daily bookmark lands in the live game — the Daily Burn mode was
// retired, so main.ts routes it to the in-game home/Province, never the front door.)
const GAME_PARAMS = ['m', 'autostart', 'qa', 'ffa', 'province', 'daily', 'editor', 'dev', 'heliview', 'kit', 'tune'];
const wantsGame = GAME_PARAMS.some((p) => params.has(p));

if (wantsGame) {
  queueMicrotask(enterGame);
} else {
  buildFrontDoor();
}

// ── Game handoff ──────────────────────────────────────────────────────────────────────────────────

/**
 * Leave the front door for the 3D game. Re-locks the viewport (the front door scrolls; the game does
 * not), clears the front-door DOM out of `#game` so the renderer gets a clean container, shows the brand
 * ember splash while the game chunk + World build (skipped for the headless harness, which wants the
 * canvas immediately), then lazy-loads the game. The game's own router takes it from there; returning is
 * a page reload back here. Idempotent guard so a double-tap can't double-import.
 */
let entering = false;
function enterGame(): void {
  if (entering) return;
  entering = true;
  // Re-lock the viewport BEFORE the game builds its renderer (it reads #game's client size).
  document.body.classList.add('bmf-playing');
  const game = document.getElementById('game');
  if (game) game.innerHTML = '';
  if (!params.has('qa') && !params.has('autostart')) showGameSplash();
  void import('./three/main');
}

/**
 * The brand ember loader, shown while the game bundle downloads + the World builds. Reuses the ONE
 * shared spinner source and the same `#bmf-splash` id + `bmf:ready` teardown contract the game signals
 * on its first rendered frame (splashSignal.ts) — replicated here because the old static injection moved
 * out of index.html (the front door must paint instantly, with no splash over it).
 */
function showGameSplash(): void {
  if (document.getElementById('bmf-splash')) return;
  if (!document.getElementById('bmf-splash-css')) {
    const css = document.createElement('style');
    css.id = 'bmf-splash-css';
    css.textContent = SPLASH_CSS;
    document.head.appendChild(css);
  }
  const splash = document.createElement('div');
  for (const [k, v] of Object.entries(SPLASH_ATTRS)) splash.setAttribute(k, v);
  splash.innerHTML = SPINNER_MARKUP;
  document.body.appendChild(splash);

  // Hold the loader on screen at least MIN_MS so the ember rise actually reads, then fade once the game
  // signals its first real frame. A hard 12s net can never strand a visitor on the loader.
  const MIN_MS = 1100;
  const t0 = performance.now();
  let done = false;
  let pending = 0;
  const hide = (): void => {
    if (done) return;
    done = true;
    if (pending) clearTimeout(pending);
    splash.classList.add('bmf-hide');
    setTimeout(() => splash.remove(), 550);
  };
  const request = (): void => {
    if (done || pending) return;
    const left = MIN_MS - (performance.now() - t0);
    if (left <= 0) hide();
    else pending = window.setTimeout(hide, left);
  };
  window.addEventListener('bmf:ready', request);
  setTimeout(hide, 12000);
}

// ── Front door ──────────────────────────────────────────────────────────────────────────────────────

function buildFrontDoor(): void {
  injectFonts(); // brand Saira + JetBrains Mono (idempotent; the game's later injectFonts is a no-op)
  injectKitStyles(); // the REAL theme.ts tokens at :root + the .btn/.badge of record — same as the in-game home
  injectHubStyles(); // the cockpit-bento card treatments, all reading the kit's var(--*) tokens (no drift)
  buildDossier(); // a RETURNING pilot leads with their dossier (callsign + rank), not a generic hero
  wireDoors(); // wires every [data-fight]/[data-scroll] incl. the dossier's, so it must run after buildDossier
  paintLegend();
  void hydrate(); // fetch + hydrate the hero / readouts / map — never throws into the page
}

/** Wire every "Fight the fire" trigger + the in-page smooth-scroll anchors. */
function wireDoors(): void {
  document.querySelectorAll<HTMLElement>('#fd-fight, [data-fight]').forEach((node) => {
    node.addEventListener('click', (e) => {
      e.preventDefault();
      enterGame();
    });
  });
  document.querySelectorAll<HTMLAnchorElement>('a[data-scroll]').forEach((a) => {
    a.addEventListener('click', (e) => {
      const id = a.getAttribute('href')?.replace('#', '') ?? '';
      const target = id && document.getElementById(id);
      if (!target) return;
      e.preventDefault();
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
}

/** Stage-of-control legend under the map (same danger→safe ramp the map dots use). */
function paintLegend(): void {
  const legend = document.getElementById('fd-legend');
  if (!legend) return;
  legend.innerHTML =
    `<span><i style="background:var(--warn)"></i>Out of control</span>` +
    `<span><i style="background:var(--caution)"></i>Being held</span>` +
    `<span><i style="background:var(--ok)"></i>Under control</span>`;
  legend.setAttribute('aria-hidden', 'false');
}

/** A RETURNING pilot (a saved callsign) leads the bento with their DOSSIER — identity, rank tier, career
 *  points, and a Resume CTA — so they land on a personal home, not a marketing hero. New pilots see no
 *  dossier (the live-fire hero leads). Reads only localStorage + the Three-free rank ladder; the callsign
 *  is set via textContent (the one user value never touches innerHTML, even after cleanCallsign). */
function buildDossier(): void {
  const grid = document.querySelector('.fd-grid');
  if (!grid) return;
  let name = '';
  try {
    const raw = localStorage.getItem('bmf.profile.v1'); // profile.ts STORAGE_KEY — read directly (no heavy import)
    if (raw) name = cleanCallsign((JSON.parse(raw) as { name?: string }).name ?? '');
  } catch {
    return; // storage blocked / corrupt → treat as a first-run visitor (no dossier)
  }
  if (!name) return; // first-run visitor → the hero leads, not a dossier

  const pts = careerScore();
  const tier = rankFor(pts);
  const prog = nextRankProgress(pts);
  const nextLine = prog.next ? `${fmtInt(prog.remaining)} pts to ${prog.next.name}` : 'Top rank — Chief';

  const tile = document.createElement('section');
  tile.className = 'fd-card warm fd-dossier';
  tile.innerHTML =
    `<div class="fd-dossier-id">` +
    `<span class="fd-glyph fd-glyph-lg" aria-hidden="true"><img src="/brand/icon_white.svg" alt="" width="22" height="22" /></span>` +
    `<div class="fd-dossier-name"><p class="fd-eyebrow">Welcome back, pilot</p><h2 class="fd-callsign"></h2></div>` +
    `<span class="fd-rank" style="--rk:${tier.color}"><i></i>${tier.name}</span>` +
    `</div>` +
    `<div class="fd-dossier-meta">` +
    `<div class="fd-ro-sm"><b>${fmtInt(pts)}</b><span>career pts</span></div>` +
    `<div class="fd-rankbar"><i style="width:${Math.round(prog.frac * 100)}%"></i></div>` +
    `<div class="fd-rank-cap">${nextLine}</div>` +
    `</div>` +
    `<div class="fd-cta-row">` +
    `<button class="btn primary" type="button" data-fight>Resume the fight</button>` +
    `<a class="fd-link" href="#livefire" data-scroll>See live fires ↓</a>` +
    `</div>`;
  const cs = tile.querySelector('.fd-callsign');
  if (cs) cs.textContent = name;
  grid.insertBefore(tile, grid.firstChild); // lead the bento
}

/** Fetch the live data and hydrate the three live surfaces (hero headline, strip, map). Every fetch
 *  degrades to an honest fallback; nothing here can throw into the page. */
async function hydrate(): Promise<void> {
  // Kick all three in parallel. Summary = tiny national totals; reported = the authoritative per-fire
  // roll (drives BOTH the SK headline number and the map dots); perimeters = the burn footprints.
  const [summary, feed] = await Promise.all([
    fetchSummary().catch(() => null),
    fetchReportedFires().catch(() => null),
  ]);
  hydrateHero(summary, feed);
  hydrateStatus(summary, feed);
  void mountMap(feed);
}

/** National active count + the publish time of the SOURCE that produced it — so freshness copy is tied
 *  to the number actually shown, never an unrelated feed's newer timestamp. Prefers the reported roll (so
 *  the headline matches the map's dots), falling back to the CIFFC summary's official figure. n=-1 = neither. */
function resolveNational(summary: NationalSummary | null, feed: ReportedFeed | null): { n: number; pub: number } {
  if (feed && feed.meta.status === 'live') return { n: filterReportedCountry(feed.fires, 'CA').length, pub: feed.meta.publishedAt };
  if (summary && summary.meta.status === 'live') return { n: summary.activeFires, pub: summary.meta.publishedAt };
  return { n: -1, pub: 0 };
}

/** Active fires reported in Saskatchewan (agency 'sk', OC/BH/UC) — the home-turf headline number. -1
 *  when the reported roll is unavailable (we then headline the national number instead). */
function skActive(feed: ReportedFeed | null): number {
  if (!feed || feed.meta.status !== 'live') return -1;
  return feed.fires.filter((f) => (f.agency || '').toLowerCase() === 'sk').length;
}

/** Replace the static evergreen hero with the live, number-first headline. Honest across in-season,
 *  SK-clear, off-season, and reported-roll-down. Leaves the static line untouched if we have no data. */
function hydrateHero(summary: NationalSummary | null, feed: ReportedFeed | null): void {
  const head = document.getElementById('fd-head');
  const sub = document.getElementById('fd-sub');
  if (!head || !sub) return;
  const national = resolveNational(summary, feed).n;
  if (national < 0) return; // no live data → keep the evergreen static hero (the strip says "unavailable")

  if (national === 0) {
    // Off-season / a genuinely quiet day — never "0 fires". Lean preparedness-forward (no extra source).
    head.textContent = 'Wildfire season is quiet — for now.';
    sub.textContent = 'Know your risk before it returns — and fly the fight any time.';
    return;
  }

  const sk = skActive(feed);
  if (sk > 0) {
    head.innerHTML = `<span class="fd-num">${fmtInt(sk)}</span> ${sk === 1 ? 'fire is' : 'fires are'} burning in Saskatchewan right now.`;
    sub.textContent = `${fmtInt(national)} active across Canada. Experience how helicopters fight them.`;
  } else if (sk === 0) {
    head.textContent = 'Saskatchewan is clear right now.';
    sub.textContent = `${fmtInt(national)} ${national === 1 ? 'wildfire is' : 'wildfires are'} burning across Canada. Experience how helicopters fight them.`;
  } else {
    // Reported roll down but the summary gave a national figure — headline the national number.
    head.innerHTML = `<span class="fd-num">${fmtInt(national)}</span> ${national === 1 ? 'wildfire is' : 'wildfires are'} burning across Canada right now.`;
    sub.textContent = 'Experience how helicopters fight them.';
  }
}

/** The instrument readout tile (cool register: mono numerals) + the appbar live status pill. Active
 *  fires / area burned this year / prep level, plus an honest source-publish-time freshness line. All
 *  freshness is the SOURCE's publish time, never our fetch time. Honest when down (a quiet day reads as
 *  a "0" gauge, which now AGREES with the hero's "season is quiet" — empty ≠ down). */
function hydrateStatus(summary: NationalSummary | null, feed: ReportedFeed | null): void {
  const set = (id: string, text: string): void => {
    const n = document.getElementById(id);
    if (n) n.textContent = text;
  };
  const bar = document.getElementById('fd-bar-live');
  const fresh = document.getElementById('fd-fresh');
  const summaryOk = !!summary && summary.meta.status === 'live';
  const feedOk = !!feed && feed.meta.status === 'live';

  if (!summaryOk && !feedOk) {
    set('ro-active', '—');
    set('ro-area', '—');
    set('ro-prep', '—');
    if (bar) {
      bar.textContent = 'Offline';
      bar.className = 'fd-bar-live is-down';
    }
    if (fresh) {
      fresh.innerHTML = `Live data unavailable · <a href="${LIVEFIRE_SOURCES.summary.url}" target="_blank" rel="noopener">official sources →</a>`;
    }
    return;
  }

  const { n: national, pub } = resolveNational(summary, feed);
  set('ro-active', national >= 0 ? fmtInt(national) : '—');
  set('ro-area', summaryOk && summary!.areaBurnedHa > 0 ? fmtHa(summary!.areaBurnedHa) : '—');
  set('ro-prep', summaryOk && summary!.prepLevel > 0 ? `L${summary!.prepLevel}` : '—');

  const fromCache = (feedOk && feed!.meta.fromCache) || (summaryOk && summary!.meta.fromCache);
  if (bar) {
    bar.textContent = fromCache ? 'Cached' : 'Live';
    bar.className = fromCache ? 'fd-bar-live is-cached' : 'fd-bar-live';
  }
  // Freshness = the publish time of the source the active count came from (resolveNational), never max()
  // across both feeds (which could attach the summary's newer date to a number from the older roll).
  if (fresh) fresh.textContent = `${publishedWhen(pub)} · source CIFFC`;
}

/** Lazy-load Leaflet + the existing FireMap and plot the authoritative reported fires + burn footprints.
 *  Honest states: a "map unavailable — see official sources" panel if the feed or the module fails;
 *  never a blank rectangle. The 152 KB Leaflet chunk is decoupled from Three, so it loads on its own. */
async function mountMap(feed: ReportedFeed | null): Promise<void> {
  const host = document.getElementById('fd-map');
  if (!host) return;

  if (!feed || feed.meta.status !== 'live') {
    mapUnavailable(host);
    return;
  }

  try {
    const { FireMap } = await import('./three/livefire/FireMap');
    const map = new FireMap(host, { onSelectHotspot: () => {}, onSelectReported: showDetail });
    document.getElementById('fd-map-skel')?.remove();
    map.setLayer('hotspots', false); // the front-door map shows the AUTHORITATIVE layer, not raw satellite dots
    // The front door tells the Canada story, so plot ONLY the Canada subset — the headline count, the
    // strip, and the dots then all agree (no stray US border fires inflating the visible dot count).
    const ca = filterReportedCountry(feed.fires, 'CA');
    map.setReportedFires(ca);
    if (ca.length > 0) {
      map.fitTo(ca.map((f) => [f.lat, f.lon] as [number, number]));
    } else {
      // Live feed, zero active CA fires (off-season / a quiet day): an HONEST zero-state label over the
      // map — distinct from mapUnavailable (a down feed). "none in view" ≠ "unavailable" (types.ts).
      mapNote(host, `No active wildfires reported in Canada right now${feed.meta.publishedAt ? ` · last CIFFC sitrep ${publishedWhen(feed.meta.publishedAt)}` : ''}.`);
    }
    map.invalidate();
    // The burn footprints are a second, slower feed — drop them in once they land (best-effort).
    void fetchBurnPerimeters()
      .then((burn) => {
        if (burn.meta.status === 'live') map.setBurnPolygons(burn.polys);
      })
      .catch(() => {});
  } catch {
    mapUnavailable(host);
  }
}

/** A small honest label laid OVER the live map (the zero-state) — distinct from mapUnavailable, which
 *  replaces the whole card when the feed is down. Keeps the map readable; just names the empty state. */
function mapNote(host: HTMLElement, text: string): void {
  const note = document.createElement('div');
  note.className = 'fd-map-note';
  note.textContent = text;
  host.appendChild(note);
}

/** Replace the map card with an honest "unavailable" panel + a link to the official source. */
function mapUnavailable(host: HTMLElement): void {
  host.innerHTML =
    `<div class="fd-map-skel">Live fire map unavailable right now.<br />` +
    `<a class="fd-link" href="${SK_OFFICIAL.url}" target="_blank" rel="noopener" style="margin-top:10px">${SK_OFFICIAL.label} →</a></div>`;
}

// ── Fire detail sheet (tap a fire on the map) ───────────────────────────────────────────────────────

/** A compact bottom sheet showing the tapped fire's full agency-reported record (the same grouped
 *  fields the in-app tracker shows), built from the verbatim CIFFC property bag. Honest-window framing:
 *  it surfaces the record + links to the official Saskatchewan map. */
let detailPrevFocus: HTMLElement | null = null;
function showDetail(f: ReportedFire): void {
  closeDetail();
  detailPrevFocus = document.activeElement as HTMLElement | null; // restore focus here on close
  const back = document.createElement('div');
  back.id = 'fd-detail';
  back.className = 'fd-detail-back';
  back.addEventListener('click', (e) => {
    if (e.target === back) closeDetail();
  });

  const groups = REPORTED_FIELD_GROUPS.map((g) => {
    const rows = g.fields
      .map((fld) => {
        const v = fld.fmt(f.props[fld.key]); // external CIFFC value → escape before innerHTML
        return v === '—' ? '' : `<div class="fd-row"><span>${fld.label}</span><b>${esc(v)}</b></div>`;
      })
      .join('');
    return rows ? `<div class="fd-grp"><h4>${g.group}</h4>${rows}</div>` : '';
  }).join('');

  const card = document.createElement('div');
  card.className = 'fd-detail';
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'true');
  card.setAttribute('aria-label', `${f.fireId || 'Reported fire'} — ${stageLabel(f.stage)}`);
  card.innerHTML =
    `<div class="fd-detail-head">` +
    `<div><div class="fd-detail-id">${esc(f.fireId || 'Reported fire')}</div>` +
    `<div class="fd-detail-stage">${stageLabel(f.stage)}${f.sizeHa >= 0 ? ` · ${fmtHa(f.sizeHa)}` : ''}</div></div>` +
    `<button class="fd-detail-x" type="button" aria-label="Close">✕</button>` +
    `</div>` +
    `<div class="fd-detail-body">${groups}</div>` +
    `<a class="fd-link" href="${SK_OFFICIAL.url}" target="_blank" rel="noopener" style="padding:14px 18px">${SK_OFFICIAL.label} →</a>`;
  const closeBtn = card.querySelector<HTMLButtonElement>('.fd-detail-x');
  closeBtn?.addEventListener('click', closeDetail);
  back.appendChild(card);
  document.body.appendChild(back);
  closeBtn?.focus(); // move focus into the dialog so a keyboard/SR user lands on it
  document.addEventListener('keydown', onEscClose);
}

/** Escape external CIFFC text before it goes into innerHTML (defense-in-depth — gov data is trusted,
 *  but a field value should never be able to inject markup). */
function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);
}

function onEscClose(e: KeyboardEvent): void {
  if (e.key === 'Escape') closeDetail();
}
function closeDetail(): void {
  const open = document.getElementById('fd-detail');
  open?.remove();
  document.removeEventListener('keydown', onEscClose);
  if (open && detailPrevFocus && document.contains(detailPrevFocus)) detailPrevFocus.focus(); // restore focus
  detailPrevFocus = null;
}

// ── Cockpit-bento styles (the appbar + hero TILE are in index.html's critical CSS; this styles the
//    rest of the bento — readouts, section headers, map tile, prepare, footer, detail sheet — all
//    reading the kit's real theme.ts var(--*) tokens, so it's a pixel match for the in-game home). ──

function injectHubStyles(): void {
  if (document.getElementById('fd-hub-css')) return;
  const s = document.createElement('style');
  s.id = 'fd-hub-css';
  s.textContent = `
/* Dossier lead tile (returning pilot) — identity + rank + career points + Resume. */
.fd-dossier { grid-column: 1 / -1; display: flex; flex-wrap: wrap; align-items: center; gap: 14px 26px; }
.fd-dossier-id { display: flex; align-items: center; gap: 13px; flex: 1 1 240px; min-width: 0; }
.fd-glyph-lg { width: 50px; height: 50px; flex: 0 0 auto; display: grid; place-items: center; border-radius: var(--r-md); border: 1px solid var(--warm-stroke); background: radial-gradient(circle at 40% 30%, var(--warm-38), rgba(10, 12, 14, 0.9)); box-shadow: inset 0 0 10px var(--ember-35), 0 0 14px var(--ember-12); }
.fd-glyph-lg img { width: 24px; height: 24px; display: block; filter: drop-shadow(0 0 4px var(--glow-80)); }
.fd-dossier-name { min-width: 0; }
.fd-dossier .fd-eyebrow { margin: 0 0 5px; }
.fd-callsign { font-size: var(--fs-display); font-weight: var(--fw-black); color: #fff; line-height: 1; letter-spacing: 0.01em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.fd-rank { display: inline-flex; align-items: center; gap: 6px; flex: 0 0 auto; font-family: var(--mono); font-size: var(--fs-tag); font-weight: var(--fw-bold); letter-spacing: 0.14em; text-transform: uppercase; color: var(--rk); padding: 5px 11px; border-radius: var(--r-sm); border: 1px solid color-mix(in srgb, var(--rk) 55%, transparent); background: color-mix(in srgb, var(--rk) 13%, transparent); }
.fd-rank i { width: 7px; height: 7px; border-radius: 1px; transform: rotate(45deg); background: var(--rk); box-shadow: 0 0 6px color-mix(in srgb, var(--rk) 80%, transparent); }
.fd-dossier-meta { flex: 0 1 220px; min-width: 158px; display: flex; flex-direction: column; gap: 6px; }
.fd-ro-sm { display: flex; align-items: baseline; gap: 8px; }
.fd-ro-sm b { font-family: var(--mono); font-size: var(--fs-title); font-weight: var(--fw-bold); color: var(--text); line-height: 1; }
.fd-ro-sm span { font-family: var(--mono); font-size: var(--fs-micro); letter-spacing: 0.1em; text-transform: uppercase; color: var(--dim); }
.fd-rankbar { height: 5px; border-radius: var(--r-pill); background: var(--recess); border: 1px solid var(--hair); overflow: hidden; }
.fd-rankbar i { display: block; height: 100%; border-radius: var(--r-pill); background: linear-gradient(90deg, var(--fire), var(--ember-hi)); box-shadow: 0 0 8px var(--glow-50); }
.fd-rank-cap { font-family: var(--mono); font-size: var(--fs-micro); letter-spacing: 0.06em; color: var(--faint); }
.fd-dossier .fd-cta-row { flex: 0 0 auto; margin: 0; padding: 0; }

/* Status tile — instrument readouts (mono numerals on a metal panel). */
.fd-status { display: flex; flex-direction: column; }
.fd-readouts { display: flex; flex-direction: column; }
.fd-ro { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; padding: 11px 0; border-bottom: 1px solid var(--hair); }
.fd-ro:last-child { border-bottom: 0; }
.fd-ro b { font-family: var(--mono); font-size: var(--fs-display); font-weight: var(--fw-bold); color: var(--text); line-height: 1; letter-spacing: -0.01em; }
.fd-ro span { font-family: var(--mono); font-size: var(--fs-micro); letter-spacing: 0.12em; text-transform: uppercase; color: var(--dim); text-align: right; }
.fd-fresh { margin-top: 13px; font-family: var(--mono); font-size: var(--fs-micro); letter-spacing: 0.04em; color: var(--faint); }
.fd-fresh a { color: var(--ember-hi); }

/* Section header — mono tag + a gold rule (mirrors the home .sec). */
.fd-sec { display: flex; align-items: center; gap: 10px; margin: 0 0 13px; }
.fd-sec-tag { font-family: var(--mono); font-size: var(--fs-label); letter-spacing: 0.26em; text-transform: uppercase; color: var(--menu); font-weight: var(--fw-bold); white-space: nowrap; }
.fd-sec-line { flex: 1; height: 1px; background: linear-gradient(90deg, var(--gold-32), transparent); }

/* Live map tile. */
.fd-map-tile { display: flex; flex-direction: column; }
.fd-map { position: relative; height: clamp(300px, 46vh, 500px); border-radius: var(--r-md); overflow: hidden; border: 1px solid var(--hair); background: var(--card-bg); }
.fd-map-skel { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; color: var(--faint); font-family: var(--mono); font-size: var(--fs-meta); text-align: center; padding: 20px; }
.fd-map-foot { margin-top: 13px; display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; }
.fd-legend { display: flex; flex-wrap: wrap; gap: 12px; font-family: var(--mono); font-size: var(--fs-micro); letter-spacing: 0.04em; text-transform: uppercase; color: var(--dim); }
.fd-legend span { display: inline-flex; align-items: center; gap: 6px; }
.fd-legend i { width: 9px; height: 9px; border-radius: 50%; display: inline-block; }
.leaflet-container { background: var(--card-bg) !important; font-family: var(--mono); }
.fd-map-note { position: absolute; left: 50%; top: 14px; transform: translateX(-50%); z-index: 500; max-width: 92%; text-align: center; padding: 9px 14px; border-radius: var(--r-md); background: rgba(7, 10, 13, 0.88); border: 1px solid var(--hair); color: var(--text); font-family: var(--mono); font-size: var(--fs-meta); backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px); }

/* Prepare cards (each is a .fd-card metal tile). */
.fd-prep-grid { display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); }
.fd-prep { display: flex; flex-direction: column; gap: 8px; text-decoration: none; color: var(--text); cursor: pointer; transition: border-color .14s ease, transform .14s ease, box-shadow .22s ease; }
.fd-prep:hover { border-color: var(--warm-stroke); transform: translateY(-2px); box-shadow: var(--shadow-card), 0 0 24px var(--ember-12); }
.fd-prep-h { font-size: var(--fs-title); font-weight: var(--fw-heavy); line-height: 1.12; }
.fd-prep-b { font-size: var(--fs-sm); line-height: 1.5; color: var(--dim); flex: 1; }
.fd-prep-src { font-family: var(--mono); font-size: var(--fs-micro); letter-spacing: 0.04em; color: var(--ember-hi); margin-top: 2px; }

/* Footer. */
.fd-foot { color: var(--dim); padding-top: 8px; }
.fd-foot .fd-cause { margin: 0 0 11px; font-size: var(--fs-md); color: var(--text); max-width: 60ch; }
.fd-foot .fd-disclaimer { margin: 0 0 9px; font-size: var(--fs-sm); max-width: 60ch; }
.fd-foot .fd-sources { margin: 0 0 16px; font-family: var(--mono); font-size: var(--fs-micro); color: var(--faint); }
.fd-foot-links { display: flex; flex-wrap: wrap; gap: 8px 18px; }
.fd-foot-links a { text-decoration: none; color: var(--dim); font-size: var(--fs-sm); font-weight: var(--fw-semibold); min-height: 44px; display: inline-flex; align-items: center; }
.fd-foot-links a:first-child { color: var(--ember-hi); }
.fd-foot-links a:hover { color: var(--text); }

/* Fire-detail bottom sheet (tap a fire on the map). */
.fd-detail-back { position: fixed; inset: 0; z-index: 60; display: flex; align-items: flex-end; justify-content: center; background: rgba(4, 8, 6, 0.64); backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px); }
.fd-detail { width: 100%; max-width: 560px; max-height: 78dvh; display: flex; flex-direction: column; background: var(--metal-hi); border: 1px solid var(--stroke); border-top-color: var(--bevel-top); border-bottom: 0; border-radius: var(--r-xl) var(--r-xl) 0 0; box-shadow: 0 -10px 40px rgba(0, 0, 0, 0.55); overflow: hidden; }
@media (min-width: 620px) { .fd-detail-back { align-items: center; } .fd-detail { border-bottom: 1px solid var(--stroke); border-radius: var(--r-xl); } }
.fd-detail-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding: 16px 18px 12px; border-bottom: 1px solid var(--hair); }
.fd-detail-id { font-weight: var(--fw-heavy); font-size: var(--fs-lg); color: var(--text); }
.fd-detail-stage { margin-top: 3px; font-family: var(--mono); font-size: var(--fs-meta); color: var(--ember-hi); }
.fd-detail-x { appearance: none; border: 1px solid var(--hair); background: var(--recess); color: var(--text); width: 44px; height: 44px; border-radius: var(--r-sm); cursor: pointer; font-size: 14px; flex: 0 0 auto; }
.fd-detail-x:hover { border-color: var(--warm-stroke); color: var(--ember-hi); }
.fd-detail-body { overflow-y: auto; padding: 6px 18px 14px; }
.fd-grp { padding: 12px 0; border-bottom: 1px solid var(--hair); }
.fd-grp:last-child { border-bottom: 0; }
.fd-grp h4 { margin: 0 0 8px; font-family: var(--mono); font-size: var(--fs-micro); letter-spacing: 0.14em; text-transform: uppercase; color: var(--faint); font-weight: var(--fw-bold); }
.fd-row { display: flex; align-items: baseline; justify-content: space-between; gap: 14px; padding: 5px 0; font-size: var(--fs-meta); }
.fd-row span { color: var(--dim); }
.fd-row b { font-family: var(--mono); color: var(--text); font-weight: var(--fw-semibold); text-align: right; white-space: nowrap; }
`;
  document.head.appendChild(s);
}
