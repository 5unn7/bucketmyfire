/**
 * Poster card — the single-source builder for the home carousel's full-bleed "hero" card. The Map /
 * region picker and the Hangar / aircraft picker both render one, and before this they each hand-rolled
 * the same `.cslide` → `.artcard` skeleton. This owns that STRUCTURE so they stop duplicating it.
 *
 * Layout is AUTO-LAYOUT (flex), not magic numbers: `.inner` is a flex column whose first child is the
 * tagline + badge row, and whose `.pc-stack` (title / body / footer) is pinned to the BASE of the poster
 * with `margin-top:auto` and spaced by one `gap` — so the card reads identically at every carousel
 * height with no spacer divs or per-element `margin-top`s. The visual CSS (`.cslide` / `.artcard` /
 * `.inner` / `.pc-stack` / `.pc-title`) lives in home/styles.ts, since the card is coupled to the
 * carousel; this builder owns only the markup. Pure string assembly — no DOM, no deps.
 */

export interface PosterCardOpts {
  /** dim + grayscale the whole card (locked / coming-soon content). */
  locked?: boolean;
  /** extra class(es) on the `.artcard` (e.g. `'heli'`). */
  cardClass?: string;
  /** extra attributes on the `.artcard` (e.g. a `data-heli` id + an `--accent` livery custom-property). */
  cardAttrs?: string;
  /** the backdrop layer behind the scrim — a poster `<img>`/fallback, or the procedural heli art. */
  backdrop: string;
  /** top-left context chip text (the tagline). */
  tagline: string;
  /** top-right status badge markup (already built — e.g. a `.badge` span). */
  badge: string;
  /** the big card title (region / aircraft name). */
  title: string;
  /** optional middle content under the title (stats row, spec bars). */
  body?: string;
  /** optional bottom slot (a CTA button, or an empty mount filled later, e.g. `.heli-foot`). */
  footer?: string;
}

/** Assemble the canonical poster-card markup string used by both carousel pickers. */
export function posterCard(o: PosterCardOpts): string {
  const cls = `artcard${o.cardClass ? ` ${o.cardClass}` : ''}`;
  return (
    `<article class="cslide${o.locked ? ' locked' : ''}">` +
    `<div class="${cls}"${o.cardAttrs ? ` ${o.cardAttrs}` : ''}>` +
    o.backdrop +
    `<div class="scrim"></div><div class="brackets"><i></i><i></i><i></i></div>` +
    `<div class="inner">` +
    `<div class="row between"><span class="chip ghost">${o.tagline}</span>${o.badge}</div>` +
    `<div class="pc-stack">` +
    `<h2 class="h-big pc-title">${o.title}</h2>` +
    (o.body ?? '') +
    (o.footer ?? '') +
    `</div>` +
    `</div></div></article>`
  );
}
