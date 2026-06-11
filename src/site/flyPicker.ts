/**
 * The shared front-door "pick & fly" picker — ONE source for the image-forward poster cards + their
 * swipeable carousel, used by BOTH front-door play pages: Campaign (`/campaign/` — Solo: map then
 * aircraft) and Open Skies (`/open-skies/` — Shared: aircraft only). Extracted so the two pages can't
 * fork the card markup or the carousel wiring (the bmf-ui no-fork law).
 *
 * It builds on the shared poster-card vocabulary (`.fd-mcard`/`.fd-card` from `site/shell.ts`); this
 * module adds only the picker LAYOUT — the horizontal `.fly-strip` carousel, its `.fly-dots`, and the
 * image-forward `.fd-m-*` overrides that turn a mission card into a pick poster. Pure data + DOM, token-
 * only CSS (every value a `var(--*)` from theme.ts). No Three, no game bundle.
 */
import { type CatalogItem } from '../three/ui/profile';
import { esc } from './siteNav.mjs';

/** A poster pick card — the corner-cut poster card (`.fd-mcard`), reframed for the picker as an
 *  IMAGE-FORWARD poster: the art is the hero, the copy is a tight tagline kicker + the name + a glanceable
 *  meta strip (an aircraft's spec meters, or a map's scale) — no paragraph of body text. `badge` is the
 *  status pill; `locked` dims it; a `href` flies the round, a `pick` value advances a multi-step wizard. */
export function pickCard(item: CatalogItem, badge: string, opts: { locked?: boolean; href?: string; pick?: string }): string {
  const art = item.imageUrl
    ? `<div class="fd-m-art"><img src="${item.imageUrl}" alt="" loading="lazy" /></div>`
    : `<div class="fd-m-art proc"></div>`;
  // Helis carry spec meters (visual, decision-relevant); maps carry a two-fact scale line. Either one
  // replaces the old blurb paragraph that buried the art.
  const meta = item.specs
    ? `<div class="fd-m-specs">${item.specs
        .map((s) => `<div class="fd-spec"><span>${esc(s.label)}</span><i class="trk"><b style="--v:${s.value}"></b></i></div>`)
        .join('')}</div>`
    : item.stats
      ? `<div class="fd-m-meta"><span>${esc(item.stats.area)}</span><span>${esc(item.stats.lakes)}</span></div>`
      : '';
  const cta = opts.locked ? '' : `<span class="fd-m-go">${opts.href ? 'Fly' : 'Choose'} →</span>`;
  const inner =
    art +
    `<span class="fd-m-scrim"></span>` +
    `<div class="fd-m-top">${badge}</div>` +
    `<div class="fd-m-body">` +
    `<p class="fd-m-kicker">${esc(item.tagline)}</p>` +
    `<div class="fd-m-name">${esc(item.name)}</div>` +
    meta +
    cta +
    `</div>`;
  // A map's art is a 3D terrain SLAB on transparency (built to FLOAT, not fill) → flag it (.fd-map) so the
  // CSS shows the WHOLE slab over a spotlight (contain), not a cover-crop. Helis stay full-bleed key art.
  const cls = `fd-mcard fd-card${item.stats ? ' fd-map' : ''}`;
  if (opts.locked) return `<div class="${cls} locked" aria-disabled="true">${inner}</div>`;
  if (opts.href) return `<a class="${cls}" href="${opts.href}" aria-label="Fly ${esc(item.name)}">${inner}</a>`;
  return `<button class="${cls}" data-pick="${esc(opts.pick ?? '')}" aria-label="Choose ${esc(item.name)}">${inner}</button>`;
}

/** Wire the mobile picker carousel inside `host`: build position dots under a `.fly-strip` of poster
 *  cards, sync the active dot as the strip scrolls, and let a dot tap centre its card. No-op past the
 *  ≥600px breakpoint (the strip relaxes into a grid + the dots hide) and a no-op with a lone card.
 *  Re-run after each render — the old element + its listeners drop with the host's innerHTML. */
export function wireFlyPicker(host: HTMLElement): void {
  const track = host.querySelector<HTMLElement>('.fly-strip');
  const dotsHost = host.querySelector<HTMLElement>('.fly-dots');
  if (!track || !dotsHost) return;
  const cards = Array.from(track.querySelectorAll<HTMLElement>('.fd-mcard'));
  if (cards.length < 2) return; // a single pick needs no carousel chrome
  dotsHost.innerHTML = cards.map((_, i) => `<i${i === 0 ? ' class="on"' : ''}></i>`).join('');
  const dots = Array.from(dotsHost.children) as HTMLElement[];
  const setActive = (i: number): void => dots.forEach((d, k) => d.classList.toggle('on', k === i));
  // Active = the card whose centre is nearest the strip's centre (works for the start-snapped layout).
  const nearest = (): number => {
    const mid = track.scrollLeft + track.clientWidth / 2;
    let best = 0;
    let bd = Infinity;
    cards.forEach((c, k) => {
      const d = Math.abs(c.offsetLeft + c.clientWidth / 2 - mid);
      if (d < bd) { bd = d; best = k; }
    });
    return best;
  };
  let raf = 0;
  track.addEventListener(
    'scroll',
    () => {
      if (raf) return;
      raf = requestAnimationFrame(() => { raf = 0; setActive(nearest()); });
    },
    { passive: true },
  );
  dots.forEach((d, i) =>
    d.addEventListener('click', () => {
      const c = cards[i];
      track.scrollTo({ left: c.offsetLeft - (track.clientWidth - c.clientWidth) / 2, behavior: 'smooth' });
    }),
  );
}

/** Inject the shared picker layout ONCE (idempotent). The poster-card BASE (`.fd-mcard`/`.fd-card`)
 *  comes from `injectShellStyles()`; this adds only the picker carousel + the image-forward overrides. */
export function injectFlyPickerStyles(): void {
  if (document.getElementById('fd-flypicker-css')) return;
  const s = document.createElement('style');
  s.id = 'fd-flypicker-css';
  s.textContent = `
/* Bigger, image-forward picker posters in a swipeable carousel — ONE horizontal row at every width, no
   wrap. On a PHONE one tall poster sits in view with a peek of the next (swipe to advance). On a wider
   screen the posters fix to a comfortable width so several ride the same line and the row scrolls past
   the edge when they don't all fit. Position dots track the strip the whole way. */
.bmf-app.front .fly-strip { display: flex; gap: 14px; overflow-x: auto; scroll-snap-type: x mandatory;
  -webkit-overflow-scrolling: touch; scrollbar-width: none; padding-bottom: 2px; }
.bmf-app.front .fly-strip::-webkit-scrollbar { display: none; }
.bmf-app.front .fly-strip > .fd-mcard { flex: 0 0 86%; max-width: 400px; scroll-snap-align: start; }
.bmf-app.front .fly-dots { display: flex; justify-content: center; gap: 6px; margin-top: 14px; }
.bmf-app.front .fly-dots i { width: 6px; height: 6px; border-radius: 50%; background: var(--track);
  transition: width .2s, background .2s; cursor: pointer; }
.bmf-app.front .fly-dots i.on { width: 18px; border-radius: var(--r-pill); background: var(--ember-hi); }
/* Tablet+ : fixed-width posters so the strip stays ONE line and overflows horizontally rather than wrapping. */
@media (min-width: 600px) {
  .bmf-app.front .fly-strip > .fd-mcard { flex: 0 0 300px; max-width: none; }
}
.bmf-app.front .fly-strip .fd-mcard { min-height: 300px; }
@media (min-width: 600px) { .bmf-app.front .fly-strip .fd-mcard { min-height: 326px; } }
/* The pick card can be a <button>; null its UA chrome so the copy left/bottom-aligns in the app font,
   exactly like the locked <div> and the <a> aircraft cards (a bare button defaults to centre + Arial). */
.bmf-app.front .fly-strip button.fd-mcard { appearance: none; -webkit-appearance: none; text-align: left; font: inherit; color: var(--text); cursor: pointer; }
.bmf-app.front .fly-strip .fd-mcard .fd-m-top { justify-content: flex-end; }
.bmf-app.front .fly-strip .fd-mcard .fd-m-body { padding: 16px 16px 17px; }
.bmf-app.front .fly-strip .fd-m-kicker { margin: 0 0 5px; font-family: var(--mono); font-size: var(--fs-micro); letter-spacing: .16em; text-transform: uppercase; color: var(--menu); }
.bmf-app.front .fly-strip .fd-m-name { font-size: clamp(20px, 2.2vw, 25px); line-height: 1.05; }
.bmf-app.front .fly-strip .fd-m-meta { display: flex; flex-wrap: wrap; gap: 5px 12px; margin-top: 9px; }
.bmf-app.front .fly-strip .fd-m-meta span { font-family: var(--mono); font-size: var(--fs-meta); letter-spacing: .02em; color: var(--text-subtle); }
.bmf-app.front .fly-strip .fd-m-specs { display: grid; gap: 6px; margin-top: 11px; max-width: 232px; }
.bmf-app.front .fly-strip .fd-spec { display: grid; grid-template-columns: 56px 1fr; align-items: center; gap: 9px; }
.bmf-app.front .fly-strip .fd-spec > span { font-family: var(--mono); font-size: var(--fs-micro); letter-spacing: .07em; text-transform: uppercase; color: var(--dim); }
.bmf-app.front .fly-strip .fd-spec .trk { height: 4px; border-radius: 99px; background: var(--recess); overflow: hidden; }
.bmf-app.front .fly-strip .fd-spec .trk b { display: block; height: 100%; width: calc(var(--v, 0) * 100%); border-radius: 99px; background: linear-gradient(90deg, var(--ember), var(--ember-hi)); }
/* Map pick cards (.fd-map): the art is a 3D terrain SLAB rendered on transparency — built to FLOAT, not
   to fill. Show the WHOLE slab (contain), parked in the upper card over a faint warm spotlight and casting
   a true silhouette shadow, so it reads as a floating object rather than a zoomed-in cover crop (mirrors
   the in-game .artcard.map). Helis keep the full-bleed cover key art. */
.bmf-app.front .fly-strip .fd-mcard.fd-map { background: radial-gradient(118% 82% at 50% 27%, var(--ember-12), var(--card-bg) 70%); }
.bmf-app.front .fly-strip .fd-mcard.fd-map .fd-m-art { inset: 0 0 auto 0; height: 72%; }
.bmf-app.front .fly-strip .fd-mcard.fd-map .fd-m-art img { object-fit: contain; object-position: 50% 42%;
  padding: 20px 18px 0; box-sizing: border-box; filter: drop-shadow(0 18px 22px rgba(0,0,0,0.5)); }
/* Base-anchored scrim only — the slab floats above it, so don't wash the whole card (which would dim the slab). */
.bmf-app.front .fly-strip .fd-mcard.fd-map .fd-m-scrim { background: linear-gradient(180deg, transparent 0%, transparent 52%, rgba(6,9,11,0.74) 82%, rgba(6,9,11,0.95) 100%); }
/* Hover LIFTS the slab (a contained slab should rise, not zoom like the cover key-art cards). */
.bmf-app.front .fly-strip .fd-mcard.fd-map:hover .fd-m-art img { transform: translateY(-6px); }
`;
  document.head.appendChild(s);
}
