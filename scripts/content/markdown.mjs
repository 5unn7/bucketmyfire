/**
 * Minimal, dependency-free Markdown + frontmatter for bucketmyfire "Field Notes".
 *
 * We deliberately do NOT pull in `marked` / `gray-matter`: the repo's ethos is minimal-dep,
 * and the article Markdown is authored by our own content engine, so we control the dialect.
 * This renders the subset the engine emits — headings, paragraphs, lists, blockquotes, fenced
 * code, rules, and inline bold/italic/code/links — escaping ALL text by default (these pages are
 * built from semi-trusted Markdown at build time, never from runtime user input).
 *
 * Frontmatter is a flat block between leading `---` fences. Each line is `key: value`; a value
 * that begins with `[` or `{` is parsed as JSON (so arrays/objects like `faq` and `sources` are
 * authored as one-line JSON), everything else is a trimmed string. No nested YAML, on purpose.
 */

export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Parse `---`-fenced frontmatter. Returns { data, body }. */
export function parseFrontmatter(raw) {
  const text = String(raw).replace(/^﻿/, '').replace(/\r\n/g, '\n');
  const m = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { data: {}, body: text };
  const data = {};
  for (const line of m[1].split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let val = line.slice(idx + 1).trim();
    if (val.startsWith('[') || val.startsWith('{')) {
      try {
        data[key] = JSON.parse(val);
        continue;
      } catch {
        /* fall through to string */
      }
    }
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    data[key] = val;
  }
  return { data, body: m[2] };
}

/** Slugify a heading's text into an `id` for deep links. */
export function slugify(s) {
  return String(s)
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 80);
}

/** Is this href an off-site link? (used for target/rel + the allowlist gate elsewhere) */
export function isExternal(href) {
  return /^https?:\/\//i.test(href);
}

/** Render one line of inline Markdown to safe HTML. */
function renderInline(src) {
  let s = escapeHtml(src);
  const store = [];
  // `@@PHn@@` sentinels can't occur in Markdown prose, so the restore never collides with text.
  const stash = (html) => {
    store.push(html);
    return `@@PH${store.length - 1}@@`;
  };
  // code spans first, so * and _ inside them are inert
  s = s.replace(/`([^`]+)`/g, (_, c) => stash(`<code>${c}</code>`));
  // links: [text](href)
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, text, href) => {
    const ext = isExternal(href);
    const attrs = ext ? ' target="_blank" rel="noopener noreferrer"' : '';
    const cls = ext ? ' class="fn-ext"' : '';
    return stash(`<a href="${href}"${cls}${attrs}>${text}</a>`);
  });
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
  s = s.replace(/(^|[^_])_([^_]+)_/g, '$1<em>$2</em>');
  return s.replace(/@@PH(\d+)@@/g, (_, i) => store[Number(i)] ?? '');
}

/**
 * Render a Markdown body to HTML. Also returns the heading list (for a TOC / anchors) and
 * every link found (handy for callers that want to inspect citations without re-parsing).
 */
export function renderMarkdown(md) {
  const lines = String(md).replace(/\r\n/g, '\n').split('\n');
  const out = [];
  const headings = [];
  const links = [];
  let i = 0;

  const collectLinks = (text) => {
    for (const m of text.matchAll(/\[[^\]]+\]\(([^)\s]+)\)/g)) links.push(m[1]);
  };

  while (i < lines.length) {
    const line = lines[i];

    // blank
    if (!line.trim()) {
      i++;
      continue;
    }

    // fenced code
    if (/^```/.test(line)) {
      const buf = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
      i++; // closing fence
      out.push(`<pre><code>${escapeHtml(buf.join('\n'))}</code></pre>`);
      continue;
    }

    // horizontal rule
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      out.push('<hr />');
      i++;
      continue;
    }

    // heading
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      const level = h[1].length;
      const text = h[2].trim();
      const id = slugify(text);
      collectLinks(text);
      headings.push({ level, text, id });
      out.push(`<h${level} id="${id}">${renderInline(text)}</h${level}>`);
      i++;
      continue;
    }

    // blockquote
    if (/^>\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, ''));
      collectLinks(buf.join(' '));
      out.push(`<blockquote>${renderInline(buf.join(' '))}</blockquote>`);
      continue;
    }

    // ordered list
    if (/^\d+\.\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i])) {
        const t = lines[i++].replace(/^\d+\.\s+/, '');
        collectLinks(t);
        items.push(`<li>${renderInline(t)}</li>`);
      }
      out.push(`<ol>${items.join('')}</ol>`);
      continue;
    }

    // unordered list
    if (/^[-*]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i])) {
        const t = lines[i++].replace(/^[-*]\s+/, '');
        collectLinks(t);
        items.push(`<li>${renderInline(t)}</li>`);
      }
      out.push(`<ul>${items.join('')}</ul>`);
      continue;
    }

    // paragraph (consume until blank or a block starter)
    const buf = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{1,6}\s|>\s?|```|\d+\.\s|[-*]\s|(-{3,}|\*{3,}|_{3,})\s*$)/.test(lines[i])
    ) {
      buf.push(lines[i++]);
    }
    collectLinks(buf.join(' '));
    out.push(`<p>${renderInline(buf.join(' '))}</p>`);
  }

  return { html: out.join('\n'), headings, links };
}
