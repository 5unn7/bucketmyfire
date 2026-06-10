/**
 * verify:content — the Field Notes content gate (pure Node, like verify-ui.mjs). Wired into
 * `npm run verify` and therefore .github/workflows/deploy.yml, so a non-compliant article BLOCKS
 * the auto-deploy. It validates the SOURCE (content/*.md + content/sources.allowlist.json), not the
 * build output, so it runs with or without a prior `vite build`.
 *
 * The core rule it enforces — bucketmyfire's E-E-A-T / GEO moat — is OFFICIAL SOURCES ONLY: every
 * off-site link in every article must resolve to a hostname on the allowlist. It also guards the
 * mechanical SEO/AEO/GEO + brand-voice checklist from docs/CONTENT-STRATEGY.md.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFrontmatter, renderMarkdown, isExternal } from './content/markdown.mjs';
import { PILLARS } from './content/template.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONTENT_DIR = path.join(ROOT, 'content');

const TITLE_MAX = 60;
const DESC_MIN = 50;
const DESC_MAX = 160;
const TAKEAWAYS_MIN = 3;

// Conservative anti-slop list (lowercased substrings). The em-dash ban is separate (U+2014).
const SLOP = [
  'delve',
  "in today's fast-paced",
  "it's important to note",
  'game-changer',
  'game changer',
  'unleash',
  'tapestry',
  'testament to',
  'in conclusion,',
  'look no further',
  'elevate your',
  'when it comes to',
  'the world of',
];

const errors = [];
const warnings = [];
const err = (f, m) => errors.push(`${f}: ${m}`);
const warn = (f, m) => warnings.push(`${f}: ${m}`);

function loadAllowlist() {
  const p = path.join(CONTENT_DIR, 'sources.allowlist.json');
  const json = JSON.parse(fs.readFileSync(p, 'utf8'));
  const domains = (json.sources || []).map((s) => s.domain.toLowerCase());
  const exempt = (json.exempt || []).map((d) => d.toLowerCase());
  return [...domains, ...exempt];
}

function hostAllowed(host, allow) {
  host = String(host).toLowerCase();
  return allow.some((d) => host === d || host.endsWith('.' + d));
}

function checkUrl(file, url, allow, where) {
  if (!isExternal(url)) return; // internal "/..." links are fine
  let host;
  try {
    host = new URL(url).hostname;
  } catch {
    err(file, `unparseable URL in ${where}: ${url}`);
    return;
  }
  if (!hostAllowed(host, allow)) {
    err(file, `OFF-ALLOWLIST link in ${where}: ${host} (${url}) — official sources only (content/sources.allowlist.json)`);
  }
}

function main() {
  if (!fs.existsSync(CONTENT_DIR)) {
    console.log('verify:content — no content/ dir; nothing to check.');
    return;
  }
  const allow = loadAllowlist();
  const files = fs.readdirSync(CONTENT_DIR).filter((f) => f.endsWith('.md'));

  for (const file of files) {
    const f = `content/${file}`;
    const raw = fs.readFileSync(path.join(CONTENT_DIR, file), 'utf8');
    const { data, body } = parseFrontmatter(raw);

    // required frontmatter
    for (const k of ['title', 'slug', 'description', 'pillar', 'date']) {
      if (!data[k]) err(f, `missing frontmatter "${k}"`);
    }
    if (data.pillar && !PILLARS[data.pillar]) err(f, `unknown pillar "${data.pillar}"`);
    if (data.slug && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(data.slug)) err(f, `slug not URL-safe: "${data.slug}"`);

    const isCause = data.pillar === 'the-cause';
    // Advisory "what to do" pieces (evacuation, go-bag, smoke safety) are pure actionable guidance with
    // no citable statistics, so they opt out of the mandatory-source rule with `advisory: true`. The
    // moat is unchanged for anything that states a number or a specific fact: drop the flag and the
    // official-source requirement returns. Any link an advisory article DOES include is still
    // allowlist-checked below, so a stray off-site link can never sneak through.
    const isAdvisory = data.advisory === true || String(data.advisory).toLowerCase() === 'true';
    const exemptSources = isCause || isAdvisory;

    // SEO field bounds
    if (data.title && data.title.length > TITLE_MAX) err(f, `title ${data.title.length} chars > ${TITLE_MAX}`);
    if (data.description) {
      if (data.description.length > DESC_MAX) err(f, `description ${data.description.length} chars > ${DESC_MAX}`);
      if (data.description.length < DESC_MIN) warn(f, `description ${data.description.length} chars < ${DESC_MIN} (thin)`);
    }

    // body structure + links
    const { headings, links } = renderMarkdown(body);
    if (headings.some((h) => h.level === 1)) err(f, 'body contains an H1 (#) — the page <h1> is the title; start body at ##');
    if (!headings.some((h) => h.level === 2)) warn(f, 'no H2 sections in body');

    // links: every external link (body + sources + internalLinks) on the allowlist
    for (const u of links) checkUrl(f, u, allow, 'body');
    const sources = Array.isArray(data.sources) ? data.sources : [];
    for (const s of sources) checkUrl(f, s.url || '', allow, 'sources');
    const internal = Array.isArray(data.internalLinks) ? data.internalLinks : [];
    for (const l of internal) {
      if (isExternal(l.href || '')) checkUrl(f, l.href, allow, 'internalLinks');
    }

    // AEO / GEO requirements
    const takeaways = Array.isArray(data.takeaways) ? data.takeaways : [];
    const faq = Array.isArray(data.faq) ? data.faq : [];
    if (!exemptSources) {
      if (sources.length < 1) err(f, 'no official sources cited (need >=1 allowlisted source) — the whole point of Field Notes (set advisory:true for pure how-to pieces)');
    }
    if (!isCause) {
      if (takeaways.length < TAKEAWAYS_MIN) warn(f, `${takeaways.length} key takeaways (<${TAKEAWAYS_MIN}); AEO wants 3-5`);
      if (faq.length < 1) warn(f, 'no FAQ entries (AEO: an explainer should answer >=1 question)');
      if (internal.length < 1) warn(f, 'no internalLinks (SEO: link the pillar hub or a sibling)');
    }
    // a citation must actually exist somewhere (body or sources), allowlisted — unless this is a
    // citation-free piece (the-cause manifesto or an advisory how-to).
    const cited = links.some(isExternal) || sources.length > 0;
    if (!exemptSources && !cited) err(f, 'no inline citations at all (GEO: state facts, cite an official source)');

    // brand-voice mechanical rules
    const scanText = [data.title, data.description, body, ...takeaways, ...faq.flatMap((q) => [q.q, q.a])]
      .filter(Boolean)
      .join('\n');
    if (scanText.includes('—')) err(f, 'contains an em-dash (—) — banned; use periods/commas (DESIGN.md voice)');
    const low = scanText.toLowerCase();
    for (const s of SLOP) if (low.includes(s)) err(f, `anti-slop tell present: "${s}"`);
  }

  // optional sitemap sync check (only if a build output exists)
  const sm = path.join(ROOT, 'dist', 'sitemap.xml');
  if (fs.existsSync(sm)) {
    const xml = fs.readFileSync(sm, 'utf8');
    for (const file of files) {
      const { data } = parseFrontmatter(fs.readFileSync(path.join(CONTENT_DIR, file), 'utf8'));
      if (data.slug && !xml.includes(`/blog/${data.slug}/`)) {
        err(`content/${file}`, `not in dist/sitemap.xml — run npm run build:content (or vite build) to regenerate`);
      }
    }
  }

  for (const w of warnings) console.log(`  warn  ${w}`);
  if (errors.length) {
    for (const e of errors) console.error(`  ERROR ${e}`);
    console.error(`\nverify:content FAILED — ${errors.length} error(s), ${warnings.length} warning(s) across ${files.length} article(s).`);
    process.exit(1);
  }
  console.log(`\nverify:content OK — ${files.length} article(s), ${warnings.length} warning(s).`);
}

main();
