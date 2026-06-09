/**
 * Page templates for bucketmyfire "Field Notes" (the blog). Pure string builders — no DOM, no
 * Vite — so they run in plain Node from the render module AND the Vite plugin. Everything visual
 * reads the design tokens (the generated `mockups/tokens.css`, inlined by the render module) so the
 * blog speaks the SAME glass-cockpit language as the app, warm "fight" register (see DESIGN.md).
 */

import { escapeHtml } from './markdown.mjs';

export const BASE_URL = 'https://bucketmyfire.com';
export const BLOG_BASE = '/blog';
export const SITE_NAME = 'Bucket My Fire';
export const SECTION_NAME = 'Field Notes';

/** The four content pillars (ids match article frontmatter `pillar`). See docs/CONTENT-STRATEGY.md. */
export const PILLARS = {
  'how-wildfires-are-fought': {
    title: 'How wildfires are fought',
    blurb: 'Aerial firefighting, water bombers, buckets, and the people who fly them.',
  },
  'wildfire-preparedness': {
    title: 'Wildfire preparedness',
    blurb: 'FireSmart your home, build a go-bag, and get the alerts before you need them.',
  },
  'wildfire-data-explainers': {
    title: 'Wildfire data explainers',
    blurb: 'Read the Fire Weather Index, stages of control, and the season by the numbers.',
  },
  'the-cause': {
    title: 'The cause',
    blurb: 'Why we built this, and where it goes.',
  },
};

export function pillarTitle(id) {
  return PILLARS[id]?.title ?? 'Field Notes';
}

const json = (o) => JSON.stringify(o);

/** The shared document shell. `head` and `body` are pre-built HTML strings. */
function pageShell({ title, description, canonical, ogImage, ogType = 'article', jsonLd = [], css, body }) {
  const ld = jsonLd.length
    ? `\n    <script type="application/ld+json">${json(jsonLd.length === 1 ? jsonLd[0] : { '@context': 'https://schema.org', '@graph': jsonLd })}</script>`
    : '';
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
    <meta name="theme-color" content="#05080b" />
    <link rel="icon" type="image/svg+xml" href="/icon.svg" />
    <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <link rel="canonical" href="${escapeHtml(canonical)}" />
    <meta property="og:type" content="${ogType}" />
    <meta property="og:site_name" content="${SITE_NAME}" />
    <meta property="og:url" content="${escapeHtml(canonical)}" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:image" content="${escapeHtml(ogImage)}" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(title)}" />
    <meta name="twitter:description" content="${escapeHtml(description)}" />
    <meta name="twitter:image" content="${escapeHtml(ogImage)}" />${ld}
    <style>${css}</style>
  </head>
  <body class="fn">
    <a class="fn-skip" href="#fn-main">Skip to content</a>
    <header class="fn-bar">
      <a class="fn-brand" href="/" aria-label="Bucket My Fire — home">
        <span class="fn-glyph"><img src="/brand/icon_white.svg" alt="" width="17" height="17" /></span>
        <b>Bucket My Fire</b>
      </a>
      <span class="fn-spacer"></span>
      <a class="fn-navlink" href="${BLOG_BASE}/">Field Notes</a>
      <a class="fn-navlink" href="/#prepare">Prepare</a>
      <a class="fn-navlink" href="/">Fight the fire</a>
    </header>
    <main id="fn-main" class="fn-wrap">
${body}
    </main>
    <footer class="fn-foot">
      <p class="fn-cause">
        Bucket My Fire is a helicopter wildfire flight sim, and a window onto the real fire season it
        is set in. The game is the hook. The data is real.
      </p>
      <p class="fn-disclaimer">
        General information, not an emergency tool. In an emergency, follow official sources and local
        authorities.
      </p>
      <p class="fn-sources">Sources: CWFIS (NRCan) · CIFFC · ECCC · FireSmart Canada</p>
      <div class="fn-foot-links">
        <a href="${BLOG_BASE}/">Field Notes</a>
        <a href="/">Play</a>
        <a href="https://shop.bucketmyfire.com/?utm_source=bucketmyfire&utm_medium=fieldnotes&utm_campaign=footer">Wear the fight</a>
        <a href="/privacy.html">Privacy</a>
        <a href="/terms.html">Terms</a>
      </div>
    </footer>
  </body>
</html>
`;
}

/** Build the article page. `a` is the resolved article object (see render.mjs). */
export function articlePage(a, css) {
  const canonical = `${BASE_URL}${BLOG_BASE}/${a.slug}/`;
  const ogAbs = a.ogImage.startsWith('http') ? a.ogImage : `${BASE_URL}${a.ogImage}`;
  const pTitle = pillarTitle(a.pillar);

  const takeaways = (a.takeaways || []).length
    ? `<aside class="fn-takeaways" aria-label="Key takeaways">
        <h2 class="fn-tk-h">Key takeaways</h2>
        <ul>${a.takeaways.map((t) => `<li>${escapeHtml(t)}</li>`).join('')}</ul>
      </aside>`
    : '';

  const faq = (a.faq || []).length
    ? `<section class="fn-faq" aria-labelledby="fn-faq-h">
        <h2 id="fn-faq-h">Frequently asked</h2>
        ${a.faq
          .map(
            (f) => `<details class="fn-q"><summary>${escapeHtml(f.q)}</summary><div>${escapeHtml(f.a)}</div></details>`
          )
          .join('\n        ')}
      </section>`
    : '';

  const sources = (a.sources || []).length
    ? `<section class="fn-srcbox" aria-labelledby="fn-src-h">
        <h2 id="fn-src-h">Official sources</h2>
        <ul>${a.sources
          .map(
            (s) =>
              `<li><a href="${escapeHtml(s.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(
                s.label
              )}</a></li>`
          )
          .join('')}</ul>
      </section>`
    : '';

  const related = (a.internalLinks || []).length
    ? `<nav class="fn-related" aria-label="Related Field Notes">
        <h2>Keep reading</h2>
        <ul>${a.internalLinks
          .map((l) => `<li><a href="${escapeHtml(l.href)}">${escapeHtml(l.label)}</a></li>`)
          .join('')}</ul>
      </nav>`
    : '';

  const body = `      <article class="fn-article">
        <nav class="fn-crumbs" aria-label="Breadcrumb">
          <a href="/">Home</a> <span>/</span>
          <a href="${BLOG_BASE}/">Field Notes</a> <span>/</span>
          <a href="${BLOG_BASE}/${a.pillar}/">${escapeHtml(pTitle)}</a>
        </nav>
        <p class="fn-eyebrow">${escapeHtml(pTitle)}</p>
        <h1 class="fn-title">${escapeHtml(a.title)}</h1>
        <p class="fn-dateline">
          <time datetime="${escapeHtml(a.date)}">Published ${escapeHtml(a.dateLabel)}</time>${
            a.updated && a.updated !== a.date
              ? ` · <time datetime="${escapeHtml(a.updated)}">Updated ${escapeHtml(a.updatedLabel)}</time>`
              : ''
          }
        </p>
        ${takeaways}
        <div class="fn-prose">
${a.bodyHtml}
        </div>
        ${faq}
        ${sources}
        <aside class="fn-bridge">
          <p>See it from the air. Fly a helicopter into the fight, free in your browser.</p>
          <a class="btn primary" href="/">Fight the fire</a>
        </aside>
        ${related}
      </article>`;

  const jsonLd = [articleLd(a, canonical, ogAbs)];
  const bc = breadcrumbLd(a, canonical, pTitle);
  jsonLd.push(bc);
  if ((a.faq || []).length) jsonLd.push(faqLd(a.faq));
  if (a.howto && a.howto.steps && a.howto.steps.length) jsonLd.push(howtoLd(a, ogAbs));

  return pageShell({
    title: `${a.title} — ${SECTION_NAME} · ${SITE_NAME}`,
    description: a.description,
    canonical,
    ogImage: ogAbs,
    jsonLd,
    css,
    body,
  });
}

/** The blog hub (index) — pillars + the article list. */
export function indexPage(articles, css) {
  const canonical = `${BASE_URL}${BLOG_BASE}/`;
  const byPillar = (id) => articles.filter((a) => a.pillar === id);
  const pillars = Object.entries(PILLARS)
    .map(([id, p]) => {
      const items = byPillar(id);
      if (!items.length) return '';
      return `      <section class="fn-pillar">
        <div class="fn-sec"><a class="fn-sec-tag" href="${BLOG_BASE}/${id}/">${escapeHtml(p.title)}</a><i class="fn-sec-line"></i></div>
        <p class="fn-pillar-blurb">${escapeHtml(p.blurb)}</p>
        <ul class="fn-list">${items.map(articleCard).join('')}</ul>
      </section>`;
    })
    .filter(Boolean)
    .join('\n');

  const body = `      <header class="fn-hub-head">
        <p class="fn-eyebrow">Field Notes</p>
        <h1 class="fn-title">Wildfire, explained straight.</h1>
        <p class="fn-lede">Original, fact-checked notes on how wildfire works and how it is fought. Every fact cites an official source.</p>
      </header>
${pillars || '      <p class="fn-lede">New notes are on the way.</p>'}`;

  return pageShell({
    title: `${SECTION_NAME} — Wildfire, explained · ${SITE_NAME}`,
    description:
      'Original, fact-checked field notes on how wildfire works and how it is fought, sourced from official Canadian agencies.',
    canonical,
    ogImage: `${BASE_URL}/og-image.jpg`,
    ogType: 'website',
    jsonLd: [collectionLd(articles)],
    css,
    body,
  });
}

/** A single pillar hub page. */
export function pillarPage(id, articles, css) {
  const p = PILLARS[id];
  const canonical = `${BASE_URL}${BLOG_BASE}/${id}/`;
  const items = articles.filter((a) => a.pillar === id);
  const body = `      <nav class="fn-crumbs" aria-label="Breadcrumb">
        <a href="/">Home</a> <span>/</span>
        <a href="${BLOG_BASE}/">Field Notes</a>
      </nav>
      <header class="fn-hub-head">
        <p class="fn-eyebrow">Field Notes</p>
        <h1 class="fn-title">${escapeHtml(p.title)}</h1>
        <p class="fn-lede">${escapeHtml(p.blurb)}</p>
      </header>
      <ul class="fn-list">${items.map(articleCard).join('')}</ul>`;

  return pageShell({
    title: `${p.title} — ${SECTION_NAME} · ${SITE_NAME}`,
    description: p.blurb,
    canonical,
    ogImage: `${BASE_URL}/og-image.jpg`,
    ogType: 'website',
    jsonLd: [collectionLd(items)],
    css,
    body,
  });
}

function articleCard(a) {
  return `<li class="fn-item"><a href="${BLOG_BASE}/${a.slug}/"><span class="fn-item-h">${escapeHtml(
    a.title
  )}</span><span class="fn-item-d">${escapeHtml(a.description)}</span></a></li>`;
}

/* ── JSON-LD builders ─────────────────────────────────────────────────────────── */

function articleLd(a, canonical, ogAbs) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: a.title,
    description: a.description,
    image: [ogAbs],
    datePublished: a.date,
    dateModified: a.updated || a.date,
    inLanguage: 'en',
    mainEntityOfPage: { '@type': 'WebPage', '@id': canonical },
    author: { '@type': 'Organization', name: SITE_NAME, url: `${BASE_URL}/` },
    publisher: {
      '@type': 'Organization',
      name: SITE_NAME,
      url: `${BASE_URL}/`,
      logo: { '@type': 'ImageObject', url: `${BASE_URL}/apple-touch-icon.png` },
    },
    isPartOf: { '@type': 'WebSite', name: SITE_NAME, url: `${BASE_URL}/` },
  };
}

function breadcrumbLd(a, canonical, pTitle) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: `${BASE_URL}/` },
      { '@type': 'ListItem', position: 2, name: SECTION_NAME, item: `${BASE_URL}${BLOG_BASE}/` },
      { '@type': 'ListItem', position: 3, name: pTitle, item: `${BASE_URL}${BLOG_BASE}/${a.pillar}/` },
      { '@type': 'ListItem', position: 4, name: a.title, item: canonical },
    ],
  };
}

function faqLd(faq) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faq.map((f) => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  };
}

function howtoLd(a, ogAbs) {
  return {
    '@context': 'https://schema.org',
    '@type': 'HowTo',
    name: a.howto.name || a.title,
    description: a.description,
    image: [ogAbs],
    step: a.howto.steps.map((s, n) => ({
      '@type': 'HowToStep',
      position: n + 1,
      name: s.name || `Step ${n + 1}`,
      text: s.text || s.name,
    })),
  };
}

function collectionLd(articles) {
  return {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: `${SECTION_NAME} — ${SITE_NAME}`,
    url: `${BASE_URL}${BLOG_BASE}/`,
    hasPart: articles.map((a) => ({
      '@type': 'Article',
      headline: a.title,
      url: `${BASE_URL}${BLOG_BASE}/${a.slug}/`,
    })),
  };
}

/* ── Procedural OG card (on-brand fallback; rasterized to PNG by the render module) ────── */

function wrapWords(text, perLine, maxLines) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > perLine && cur) {
      lines.push(cur);
      cur = w;
    } else {
      cur = (cur + ' ' + w).trim();
    }
    if (lines.length === maxLines - 1 && (cur + ' ').length > perLine) break;
  }
  if (cur) lines.push(cur);
  return lines.slice(0, maxLines);
}

/** A 1200×630 warm-register SVG share card. */
export function ogCardSvg({ title, pillar }) {
  const pTitle = (pillarTitle(pillar) || 'Field Notes').toUpperCase();
  const lines = wrapWords(title, 26, 4);
  const startY = 300 - (lines.length - 1) * 34;
  const tspans = lines
    .map((ln, n) => `<tspan x="80" y="${startY + n * 72}">${escapeHtml(ln)}</tspan>`)
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <radialGradient id="ember" cx="22%" cy="0%" r="120%">
      <stop offset="0%" stop-color="#ff6a2c" stop-opacity="0.30"/>
      <stop offset="45%" stop-color="#ff6a2c" stop-opacity="0.06"/>
      <stop offset="100%" stop-color="#070a0b" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#0a0d10"/>
      <stop offset="100%" stop-color="#07090b"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <rect width="1200" height="630" fill="url(#ember)"/>
  <rect x="0" y="0" width="1200" height="6" fill="#ff6a2c"/>
  <g font-family="Saira, 'Segoe UI', system-ui, sans-serif">
    <text x="80" y="120" fill="#ffc24a" font-size="26" font-weight="700" letter-spacing="6">FIELD NOTES · BUCKET MY FIRE</text>
    <text x="80" y="170" fill="rgba(255,255,255,0.5)" font-size="22" font-weight="600" letter-spacing="3">${escapeHtml(
      pTitle
    )}</text>
    <text fill="#ffffff" font-size="60" font-weight="800">${tspans}</text>
  </g>
  <text x="80" y="560" fill="rgba(255,255,255,0.55)" font-family="'JetBrains Mono', monospace" font-size="22">Every fact cited to an official source.</text>
</svg>`;
}
