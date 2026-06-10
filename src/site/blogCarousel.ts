/**
 * The "Field Notes" rail/grid — our own articles, shared by the home tile and the Prepare page. It
 * fetches the static manifest the content build emits (`/blog/index.json`, written by
 * scripts/content/render.mjs) so it always reflects what's actually published, with no article data
 * hand-mirrored into the app. Best-effort: if the feed is missing (e.g. a dev server with no build
 * yet) it shows a single "Read Field Notes" card linking to the blog index, never an empty rail.
 *
 * Each article renders as the in-game MISSION CARD (`.fd-mcard`, defined in shell.ts), so a Field
 * Note reads like a poster the same way a mission does. Layout is driven by the HOST's class: a
 * `.fd-rail` host scroll-snaps the cards; a `.fd-mgrid` host tiles them like the campaign showcase.
 */

import { esc } from './siteNav.mjs';

interface FeedArticle {
  slug: string;
  title: string;
  description: string;
  pillarTitle: string;
  dateLabel: string;
}

// Per-card light position so the procedural posters don't read as identical clones (geometry only,
// no colour literal — the ember tint stays a token). Cycles as the rail/grid grows.
const PROC_X = [70, 28, 52, 80, 22, 60];
const PROC_Y = [18, 26, 14, 30, 22, 16];

function card(a: FeedArticle, i: number): string {
  const px = PROC_X[i % PROC_X.length];
  const py = PROC_Y[i % PROC_Y.length];
  return (
    `<a class="fd-mcard fd-card" href="/blog/${esc(a.slug)}/" aria-label="Read ${esc(a.title)}">` +
    `<div class="fd-m-art proc" style="--px:${px}%;--py:${py}%"></div>` +
    `<span class="fd-m-scrim"></span>` +
    `<div class="fd-m-body">` +
    `<span class="fd-m-no">${esc(a.pillarTitle)}</span>` +
    `<div class="fd-m-name">${esc(a.title)}</div>` +
    `</div>` +
    `</a>`
  );
}

function fallbackCard(): string {
  return (
    `<a class="fd-mcard fd-card" href="/blog/" aria-label="Read Field Notes">` +
    `<div class="fd-m-art proc" style="--px:70%;--py:18%"></div>` +
    `<span class="fd-m-scrim"></span>` +
    `<div class="fd-m-body">` +
    `<span class="fd-m-no">Field Notes</span>` +
    `<div class="fd-m-name">Plain answers to real wildfire questions</div>` +
    `</div>` +
    `</a>`
  );
}

/** Fill `host` with up to `limit` recent Field Notes cards from the manifest. Layout follows the
 *  host's class: an explicit `.fd-mgrid` host tiles; anything else defaults to the scroll-snap rail. */
export async function mountBlogCarousel(host: HTMLElement, limit = 6): Promise<void> {
  if (!host.classList.contains('fd-mgrid')) host.classList.add('fd-rail');
  let articles: FeedArticle[] = [];
  try {
    const res = await fetch('/blog/index.json', { cache: 'no-cache' });
    if (res.ok) articles = (await res.json()) as FeedArticle[];
  } catch {
    articles = [];
  }
  host.innerHTML = articles.length
    ? articles.slice(0, limit).map((a, i) => card(a, i)).join('')
    : fallbackCard();
}
