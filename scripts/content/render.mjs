/**
 * The content build: content/*.md  ->  dist/blog/<slug>/index.html (+ pillar hubs + index + OG cards
 * + a regenerated sitemap.xml). Dependency-free Markdown (./markdown.mjs) + pure string templates
 * (./template.mjs). Runs from the Vite plugin (closeBundle) AND standalone via `npm run build:content`.
 *
 * Design tokens are NOT hand-mirrored: we inline the generated `mockups/tokens.css` (the canonical
 * CSS-var layer produced from theme.ts by `npm run gen:tokens`), so the blog and the app share one
 * source of truth (DESIGN.md). OG cards are an on-brand SVG rasterized to PNG with `sharp` (already a
 * devDependency) — real PNG share images, zero new deps; falls back to the SVG if sharp is unavailable.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFrontmatter, renderMarkdown } from './markdown.mjs';
import { articlePage, indexPage, pillarPage, ogCardSvg, PILLARS, pillarTitle } from './template.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');

const REQUIRED = ['title', 'slug', 'description', 'pillar', 'date'];

function formatDate(iso) {
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return String(iso);
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return `${months[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`;
}

/** Read + resolve every article in content/. Throws on a hard frontmatter error. */
export function loadArticles(root = ROOT) {
  const dir = path.join(root, 'content');
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.md'));
  const articles = [];
  for (const file of files) {
    const raw = fs.readFileSync(path.join(dir, file), 'utf8');
    const { data, body } = parseFrontmatter(raw);
    for (const k of REQUIRED) {
      if (!data[k]) throw new Error(`content/${file}: missing frontmatter "${k}"`);
    }
    if (!PILLARS[data.pillar]) {
      throw new Error(`content/${file}: unknown pillar "${data.pillar}" (see docs/CONTENT-STRATEGY.md)`);
    }
    const { html, links } = renderMarkdown(body);
    articles.push({
      file,
      slug: data.slug,
      title: data.title,
      description: data.description,
      pillar: data.pillar,
      pillarTitle: pillarTitle(data.pillar),
      keyword: data.keyword || '',
      date: data.date,
      updated: data.updated || data.date,
      dateLabel: formatDate(data.date),
      updatedLabel: formatDate(data.updated || data.date),
      ogImage: data.ogImage || `/blog/${data.slug}/og.png`,
      takeaways: data.takeaways || [],
      faq: data.faq || [],
      sources: data.sources || [],
      internalLinks: data.internalLinks || [],
      howto: data.howto || null,
      bodyHtml: html,
      links,
    });
  }
  // newest first
  articles.sort((a, b) => String(b.updated).localeCompare(String(a.updated)));
  return articles;
}

function loadCss(root) {
  const tokens = fs.readFileSync(path.join(root, 'mockups', 'tokens.css'), 'utf8');
  return `${tokens}\n${BLOG_CSS}`;
}

/** Best-effort self-host the two variable fonts so the blog matches the app; non-fatal if absent. */
function fontFace(root, outBlog) {
  const fonts = [
    ['@fontsource-variable/saira/files/saira-latin-wght-normal.woff2', 'saira.woff2', 'Saira Variable'],
    ['@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2', 'jetbrains-mono.woff2', 'JetBrains Mono Variable'],
  ];
  const faces = [];
  const fontDir = path.join(outBlog, 'fonts');
  for (const [rel, out, family] of fonts) {
    const src = path.join(root, 'node_modules', rel);
    if (!fs.existsSync(src)) continue;
    fs.mkdirSync(fontDir, { recursive: true });
    fs.copyFileSync(src, path.join(fontDir, out));
    faces.push(
      `@font-face{font-family:"${family}";font-style:normal;font-weight:300 900;font-display:swap;src:url("/blog/fonts/${out}") format("woff2");}`
    );
  }
  return faces.join('\n');
}

async function writeOg(outArticleDir, article, log) {
  fs.mkdirSync(outArticleDir, { recursive: true });
  const svg = ogCardSvg({ title: article.title, pillar: article.pillar });
  fs.writeFileSync(path.join(outArticleDir, 'og.svg'), svg);
  // Honor a custom raster the author supplied (e.g. real bmf-art render); only generate the fallback.
  if (article.ogImage && !article.ogImage.endsWith('/og.png')) return;
  try {
    const sharp = (await import('sharp')).default;
    await sharp(Buffer.from(svg)).png().toFile(path.join(outArticleDir, 'og.png'));
  } catch (e) {
    // No sharp / render failed: fall back to the SVG card so the page still has a valid og:image.
    article.ogImage = `/blog/${article.slug}/og.svg`;
    log?.(`  (og: sharp unavailable, using SVG fallback for ${article.slug})`);
  }
}

function sitemap(articles) {
  const urls = [{ loc: `${'https://bucketmyfire.com'}/`, changefreq: 'daily', priority: '1.0', lastmod: today() }];
  urls.push({ loc: `https://bucketmyfire.com/campaign/`, changefreq: 'monthly', priority: '0.8', lastmod: today() });
  urls.push({ loc: `https://bucketmyfire.com/prepare/`, changefreq: 'monthly', priority: '0.8', lastmod: today() });
  urls.push({ loc: `https://bucketmyfire.com/blog/`, changefreq: 'weekly', priority: '0.9', lastmod: today() });
  for (const id of Object.keys(PILLARS)) {
    if (articles.some((a) => a.pillar === id)) {
      urls.push({ loc: `https://bucketmyfire.com/blog/${id}/`, changefreq: 'weekly', priority: '0.6', lastmod: today() });
    }
  }
  for (const a of articles) {
    urls.push({ loc: `https://bucketmyfire.com/blog/${a.slug}/`, changefreq: 'monthly', priority: '0.7', lastmod: a.updated });
  }
  const body = urls
    .map(
      (u) =>
        `  <url>\n    <loc>${u.loc}</loc>\n    <lastmod>${u.lastmod}</lastmod>\n    <changefreq>${u.changefreq}</changefreq>\n    <priority>${u.priority}</priority>\n  </url>`
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}

function today() {
  // Date.now() is fine here (Node build script, not a Workflow); keep it simple + UTC.
  return new Date().toISOString().slice(0, 10);
}

/**
 * Build the whole blog into `outDir` (default dist/). Returns a manifest. Idempotent.
 */
export async function buildContent({ root = ROOT, outDir, log = () => {} } = {}) {
  const out = outDir || path.join(root, 'dist');
  const articles = loadArticles(root);
  const outBlog = path.join(out, 'blog');
  fs.mkdirSync(outBlog, { recursive: true });

  const css = loadCss(root) + '\n' + fontFace(root, outBlog);

  // OG cards first (writeOg may rewrite article.ogImage to the SVG fallback before pages render).
  for (const a of articles) {
    await writeOg(path.join(outBlog, a.slug), a, log);
  }

  // Article pages
  for (const a of articles) {
    const dir = path.join(outBlog, a.slug);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.html'), articlePage(a, css));
    log(`  blog/${a.slug}/`);
  }

  // Pillar hubs (only for pillars that have articles)
  for (const id of Object.keys(PILLARS)) {
    if (!articles.some((a) => a.pillar === id)) continue;
    const dir = path.join(outBlog, id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.html'), pillarPage(id, articles, css));
    log(`  blog/${id}/`);
  }

  // Blog index
  fs.writeFileSync(path.join(outBlog, 'index.html'), indexPage(articles, css));
  log('  blog/');

  // Blog manifest (the "Field Notes" carousel on the home + Prepare pages fetches this — see
  // src/site/blogCarousel.ts). A small static JSON so the rail always reflects what's published, with
  // no article metadata hand-mirrored into the app bundle.
  const feed = articles.map((a) => ({
    slug: a.slug,
    title: a.title,
    description: a.description,
    pillarTitle: a.pillarTitle,
    dateLabel: a.dateLabel,
  }));
  fs.writeFileSync(path.join(outBlog, 'index.json'), JSON.stringify(feed));
  log(`  blog/index.json (${feed.length})`);

  // Sitemap (home + blog), overwriting the static public/ copy that Vite copied into dist/
  fs.writeFileSync(path.join(out, 'sitemap.xml'), sitemap(articles));
  log(`  sitemap.xml (${articles.length} article${articles.length === 1 ? '' : 's'})`);

  return { count: articles.length, articles: articles.map((a) => ({ slug: a.slug, pillar: a.pillar })) };
}

/* ── The blog stylesheet (consumes the tokens above; warm "fight" register) ───────────── */
const BLOG_CSS = `
*{box-sizing:border-box}
html,body{margin:0;padding:0}
body.fn{
  background:
    radial-gradient(130% 60% at 50% -8%, var(--ember-20) 0%, var(--ember-05) 30%, transparent 56%),
    linear-gradient(180deg,#0a0d10 0%,#0b0e10 42%,#07090b 100%);
  background-attachment:fixed;
  color:var(--text);font-family:var(--font);line-height:1.6;
  -webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility;
}
a{color:var(--ember-hi);text-decoration:none}
a:hover{color:var(--ember)}
.fn-skip{position:absolute;left:-9999px;top:0;background:var(--menu);color:#3a2406;padding:8px 12px;border-radius:8px}
.fn-skip:focus{left:8px;top:8px;z-index:50}
h1,h2,h3,h4{font-weight:800;letter-spacing:-0.01em;line-height:1.15;color:#fff}
.fn-bar{position:sticky;top:0;z-index:20;display:flex;align-items:center;gap:12px;min-height:56px;
  padding:10px max(14px,env(safe-area-inset-left));
  background:linear-gradient(180deg,rgba(7,10,13,0.92),rgba(7,10,13,0.55));
  backdrop-filter:blur(10px) saturate(120%);-webkit-backdrop-filter:blur(10px) saturate(120%);
  border-bottom:1px solid var(--hair)}
.fn-brand{display:inline-flex;align-items:center;gap:10px;color:var(--text)}
.fn-glyph{width:34px;height:34px;display:grid;place-items:center;border-radius:var(--r-md);
  border:1px solid var(--warm-stroke);background:radial-gradient(circle at 40% 30%,var(--warm-38),rgba(10,12,14,0.9));
  box-shadow:inset 0 0 10px var(--ember-35),0 0 14px var(--ember-12)}
.fn-glyph img{width:17px;height:17px;display:block}
.fn-brand b{font-family:var(--mono);font-weight:800;font-size:13px;letter-spacing:0.16em;text-transform:uppercase}
.fn-spacer{flex:1}
.fn-navlink{font-family:var(--mono);font-size:11px;letter-spacing:0.12em;text-transform:uppercase;
  font-weight:700;color:var(--dim);padding:10px 11px;min-height:44px;display:inline-flex;align-items:center}
.fn-navlink:hover{color:var(--ember-hi)}
@media (max-width:520px){.fn-brand b{display:none}.fn-navlink{padding:10px 8px}}
.fn-wrap{max-width:760px;margin:0 auto;padding:26px max(16px,env(safe-area-inset-left)) 64px}
.fn-crumbs{font-family:var(--mono);font-size:var(--fs-meta);letter-spacing:0.06em;color:var(--dim);margin-bottom:18px}
.fn-crumbs a{color:var(--dim)}.fn-crumbs a:hover{color:var(--ember-hi)}.fn-crumbs span{opacity:0.5;margin:0 4px}
.fn-eyebrow{font-family:var(--mono);font-size:var(--fs-label);letter-spacing:0.24em;text-transform:uppercase;color:var(--menu);font-weight:700;margin:0 0 12px}
.fn-title{font-size:clamp(28px,5vw,44px);margin:0 0 14px;text-wrap:balance}
.fn-dateline{font-family:var(--mono);font-size:var(--fs-sm);color:var(--dim);margin:0 0 26px}
.fn-lede{font-size:var(--fs-xl);color:var(--text-subtle);max-width:60ch;line-height:1.55}
.fn-takeaways{background:var(--card-soft);border:1px solid var(--stroke);border-left:3px solid var(--ember);
  border-radius:var(--r-md);padding:16px 20px;margin:0 0 30px}
.fn-takeaways .fn-tk-h{font-size:var(--fs-meta);letter-spacing:0.14em;text-transform:uppercase;color:var(--menu);margin:0 0 10px}
.fn-takeaways ul{margin:0;padding-left:20px}.fn-takeaways li{margin:6px 0;color:var(--text-subtle)}
.fn-prose{font-size:var(--fs-xl);line-height:1.72}
.fn-prose h2{font-size:clamp(21px,3vw,27px);margin:38px 0 12px;scroll-margin-top:72px}
.fn-prose h3{font-size:clamp(17px,2.4vw,20px);margin:28px 0 10px;color:var(--text)}
.fn-prose p{margin:0 0 18px}
.fn-prose ul,.fn-prose ol{margin:0 0 18px;padding-left:24px}
.fn-prose li{margin:7px 0}
.fn-prose a.fn-ext::after{content:" ↗";color:var(--dim);font-size:0.8em}
.fn-prose blockquote{margin:0 0 18px;padding:8px 18px;border-left:3px solid var(--warm-stroke);
  color:var(--text-subtle);background:var(--ember-05);border-radius:0 var(--r-sm) var(--r-sm) 0}
.fn-prose code{font-family:var(--mono);font-size:0.88em;background:var(--recess);padding:2px 6px;border-radius:6px}
.fn-prose pre{background:var(--recess);border:1px solid var(--hair);border-radius:var(--r-md);padding:14px 16px;overflow:auto}
.fn-prose pre code{background:none;padding:0}
.fn-prose hr{border:0;border-top:1px solid var(--hair);margin:30px 0}
.fn-faq{margin:40px 0 0}
.fn-faq h2{font-size:clamp(20px,3vw,25px);margin:0 0 14px}
.fn-q{border:1px solid var(--stroke);border-radius:var(--r-md);background:var(--card-soft);margin:0 0 10px;padding:0 16px}
.fn-q summary{cursor:pointer;padding:14px 0;font-weight:700;color:#fff;list-style:none}
.fn-q summary::-webkit-details-marker{display:none}
.fn-q summary::before{content:"+ ";color:var(--ember-hi)}
.fn-q[open] summary::before{content:"– "}
.fn-q>div{padding:0 0 16px;color:var(--text-subtle);line-height:1.6}
.fn-srcbox{margin:38px 0 0;background:var(--recess);border:1px solid var(--hair);border-radius:var(--r-md);padding:16px 20px}
.fn-srcbox h2{font-size:var(--fs-meta);letter-spacing:0.14em;text-transform:uppercase;color:var(--dim);margin:0 0 10px}
.fn-srcbox ul{margin:0;padding-left:18px}.fn-srcbox li{margin:6px 0;font-size:var(--fs-md)}
.fn-bridge{margin:44px 0 0;background:radial-gradient(120% 140% at 82% 0%,var(--ember-12),transparent 55%),var(--card-glass);
  border:1px solid var(--warm-stroke);border-radius:var(--r-xl);padding:24px;text-align:center}
.fn-bridge p{margin:0 0 16px;font-size:var(--fs-xl);color:#fff;font-weight:600}
.fn-related{margin:44px 0 0}
.fn-related h2{font-size:var(--fs-title);margin:0 0 12px}
.fn-related ul{list-style:none;margin:0;padding:0}
.fn-related li{margin:8px 0}
.fn-related a{color:var(--ember-hi);font-weight:600}
.fn-hub-head{margin:0 0 28px}
.fn-sec{display:flex;align-items:center;gap:12px;margin:34px 0 6px}
.fn-sec-tag{font-family:var(--mono);font-size:var(--fs-meta);letter-spacing:0.16em;text-transform:uppercase;color:var(--menu);font-weight:700;white-space:nowrap}
.fn-sec-line{flex:1;height:1px;background:var(--hair)}
.fn-pillar-blurb{color:var(--dim);font-size:var(--fs-md);margin:0 0 14px}
.fn-list{list-style:none;margin:0;padding:0;display:grid;gap:10px}
.fn-item a{display:block;background:var(--card-soft);border:1px solid var(--stroke);border-radius:var(--r-md);padding:16px 18px;transition:border-color .12s,background .12s}
.fn-item a:hover{border-color:var(--warm-stroke);background:var(--card-glass)}
.fn-item-h{display:block;font-weight:700;font-size:var(--fs-title);color:#fff;margin-bottom:5px}
.fn-item-d{display:block;color:var(--dim);font-size:var(--fs-md);line-height:1.5}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:9px;cursor:pointer;font-family:var(--font);
  font-weight:800;letter-spacing:0.06em;text-transform:uppercase;line-height:1;border:1px solid transparent;
  border-radius:var(--r-lg);padding:14px 24px;min-height:50px;font-size:var(--fs-md)}
.btn.primary{background:var(--cta);color:var(--cta-ink);box-shadow:0 1px 0 rgba(255,255,255,0.5) inset,0 8px 20px var(--cta-glow)}
.fn-foot{max-width:760px;margin:0 auto;padding:30px max(16px,env(safe-area-inset-left)) calc(40px + env(safe-area-inset-bottom));border-top:1px solid var(--hair)}
.fn-cause{color:var(--text-subtle);font-size:var(--fs-md);max-width:60ch;line-height:1.55;margin:0 0 12px}
.fn-disclaimer{color:var(--dim);font-size:var(--fs-sm);margin:0 0 12px}
.fn-sources{color:var(--faint);font-family:var(--mono);font-size:var(--fs-meta);letter-spacing:0.06em;margin:0 0 16px}
.fn-foot-links{display:flex;flex-wrap:wrap;gap:8px 18px}
.fn-foot-links a{font-family:var(--mono);font-size:var(--fs-meta);letter-spacing:0.1em;text-transform:uppercase;color:var(--dim)}
.fn-foot-links a:hover{color:var(--ember-hi)}
@media (prefers-reduced-motion:reduce){*{transition-duration:0.001ms!important}}
`;
