export const meta = {
  name: 'bmf-content',
  description: 'Produce an on-brand, fact-checked Field Notes article (official-sources-only) ready for /blog',
  whenToUse: 'Write one bucketmyfire blog article end to end: research -> fact-check -> outline -> draft -> image brief -> audit. Pass args {pillar, topic, slug, keyword}.',
  phases: [
    { title: 'Research', detail: 'parallel research, official domains only' },
    { title: 'Fact-check', detail: 'adversarially verify each claim against its cited source' },
    { title: 'Outline', detail: 'title + takeaways + question-shaped H2s + FAQ' },
    { title: 'Draft', detail: 'write the body in brand voice, cite inline' },
    { title: 'Image brief', detail: 'on-brand OG/hero prompt (bmf-art guardrails)' },
    { title: 'Audit', detail: 'voice + SEO/AEO/GEO + source-compliance, then revise' },
  ],
};

// Kept in sync with content/sources.allowlist.json (the workflow sandbox has no filesystem). If you
// add a domain there, add it here too. Matching is hostname-suffix.
const ALLOW = [
  'gc.ca', 'nrcan.gc.ca', 'cwfis.cfs.nrcan.gc.ca', 'canada.ca', 'weather.gc.ca', 'publicsafety.gc.ca',
  'getprepared.gc.ca', 'pc.gc.ca', 'ciffc.net', 'saskatchewan.ca', 'saskalert.ca', 'gov.bc.ca',
  'alberta.ca', 'manitoba.ca', 'gov.on.ca', 'ontario.ca', 'sopfeu.qc.ca', 'quebec.ca', 'gnb.ca',
  'novascotia.ca', 'princeedwardisland.ca', 'gov.nl.ca', 'yukon.ca', 'gov.nt.ca', 'gov.nu.ca',
  'firesmartcanada.ca',
];
const allowStr = ALLOW.join(', ');

const VOICE = [
  'Warm "fight" register: dry, direct, calm. Fire is loud enough, say it straight.',
  'Headlines declarative and short (ideally <=8 words).',
  'HARD: no em-dashes (the character U+2014). Use periods and commas.',
  'No AI-slop: no "delve", no "it\'s important to note", no "game-changer", no "unleash", no "tapestry", no "in conclusion", no hype, no participation-trophy softness.',
  'We are a window, not an emergency service. Do not overclaim authority.',
  'Cite plainly inline. Bridge to flying the game once, near the end, never a hard sell.',
].join(' ');

const A = (typeof args === 'object' && args) || {};
const topic = A.topic || 'How helicopters fight wildfires';
const pillar = A.pillar || 'how-wildfires-are-fought';
const slug = A.slug || 'how-helicopters-fight-wildfires';
const keyword = A.keyword || topic.toLowerCase();

/* ── schemas ─────────────────────────────────────────────────────────────────── */
const FACTS = {
  type: 'object',
  properties: {
    facts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          claim: { type: 'string' },
          sourceUrl: { type: 'string' },
          sourceLabel: { type: 'string' },
        },
        required: ['claim', 'sourceUrl', 'sourceLabel'],
      },
    },
  },
  required: ['facts'],
};
const VERDICT = {
  type: 'object',
  properties: {
    verified: { type: 'boolean' },
    onAllowlist: { type: 'boolean' },
    correctedClaim: { type: 'string' },
    note: { type: 'string' },
  },
  required: ['verified', 'onAllowlist'],
};
const OUTLINE = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    description: { type: 'string' },
    takeaways: { type: 'array', items: { type: 'string' } },
    sections: {
      type: 'array',
      items: {
        type: 'object',
        properties: { h2: { type: 'string' }, factNums: { type: 'array', items: { type: 'number' } } },
        required: ['h2'],
      },
    },
    faq: {
      type: 'array',
      items: { type: 'object', properties: { q: { type: 'string' }, a: { type: 'string' } }, required: ['q', 'a'] },
    },
  },
  required: ['title', 'description', 'takeaways', 'sections', 'faq'],
};
const DRAFT = {
  type: 'object',
  properties: {
    markdownBody: { type: 'string' },
    sources: {
      type: 'array',
      items: { type: 'object', properties: { label: { type: 'string' }, url: { type: 'string' } }, required: ['label', 'url'] },
    },
    faq: {
      type: 'array',
      items: { type: 'object', properties: { q: { type: 'string' }, a: { type: 'string' } }, required: ['q', 'a'] },
    },
    takeaways: { type: 'array', items: { type: 'string' } },
  },
  required: ['markdownBody', 'sources', 'faq', 'takeaways'],
};
const IMG = {
  type: 'object',
  properties: {
    ogPrompt: { type: 'string' },
    altText: { type: 'string' },
    figurePrompts: { type: 'array', items: { type: 'string' } },
  },
  required: ['ogPrompt', 'altText'],
};
const AUDIT = {
  type: 'object',
  properties: {
    issues: {
      type: 'array',
      items: {
        type: 'object',
        properties: { severity: { type: 'string' }, where: { type: 'string' }, fix: { type: 'string' } },
        required: ['fix'],
      },
    },
  },
  required: ['issues'],
};
const REVISE = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    description: { type: 'string' },
    markdownBody: { type: 'string' },
  },
  required: ['markdownBody'],
};

/* ── 1. Research (parallel; official domains only) ───────────────────────────── */
phase('Research');
const ANGLES = [
  `Core definitions and mechanics of: ${topic}. What it is, how it physically works, the equipment.`,
  `Canadian and Saskatchewan specifics for: ${topic}. The agencies (CIFFC, provincial wildfire services, NRCan / CWFIS) and how the work is organized here.`,
  `Concrete numbers, capacities, procedures, and exact terminology for: ${topic}.`,
  `Safety, limits, and official public guidance relevant to: ${topic}.`,
];
const research = (
  await parallel(
    ANGLES.map((angle, idx) => () =>
      agent(
        `You are researching for a factual wildfire explainer. ANGLE: ${angle}\n\n` +
          `HARD RULE — official sources only. Every fact's sourceUrl MUST be a page on one of these domains or a subdomain: ${allowStr}. ` +
          `Use WebSearch (set allowed_domains to these) and WebFetch the page to CONFIRM it actually states the fact. ` +
          `Discard anything you cannot tie to one of these official domains. Return 4 to 8 specific, verifiable facts, each with the exact confirmed URL.`,
        { label: `research:${idx + 1}`, phase: 'Research', schema: FACTS }
      )
    )
  )
)
  .filter(Boolean)
  .flatMap((r) => r.facts || []);
log(`gathered ${research.length} candidate facts`);

/* ── 2. Fact-check (adversarial; per claim) ──────────────────────────────────── */
phase('Fact-check');
const checked = (
  await parallel(
    research.map((f) => () =>
      agent(
        `Adversarially verify this claim for a wildfire article. Default to verified=false if unsure.\n\n` +
          `CLAIM: ${f.claim}\nCITED SOURCE: ${f.sourceLabel} — ${f.sourceUrl}\n\n` +
          `1) Is the cited URL's hostname on this allowlist (or a subdomain)? ${allowStr}. Set onAllowlist.\n` +
          `2) WebFetch the URL. Does the page actually support the claim? Set verified=true ONLY if the page loads AND supports it.\n` +
          `3) If the claim is slightly off but the source supports a corrected version, put the corrected wording in correctedClaim.`,
        { label: 'verify', phase: 'Fact-check', schema: VERDICT }
      ).then((v) => (v ? { ...f, ...v } : null))
    )
  )
)
  .filter(Boolean)
  .filter((v) => v.verified && v.onAllowlist)
  .map((v) => ({ claim: v.correctedClaim || v.claim, sourceUrl: v.sourceUrl, sourceLabel: v.sourceLabel }));

log(`${checked.length}/${research.length} facts verified on the allowlist`);
if (!checked.length) {
  throw new Error('No facts survived fact-check — cannot write an official-sources-only article. Widen ANGLES or check connectivity.');
}
const verifiedList = checked.map((c, i) => `${i + 1}. ${c.claim}  [${c.sourceLabel} — ${c.sourceUrl}]`).join('\n');

/* ── 3. Outline ──────────────────────────────────────────────────────────────── */
phase('Outline');
const outline = await agent(
  `Plan a wildfire explainer about "${topic}" (target search keyword "${keyword}"). Use ONLY these verified facts:\n\n${verifiedList}\n\n` +
    `Produce: an SEO title (<=60 characters, declarative, no em-dash), a meta description (<=160 characters), 3 to 5 one-sentence key takeaways, ` +
    `4 to 7 ordered H2 sections (question-shaped where natural, including a short definitional "What is..." opener) each tagged with the fact numbers it uses, ` +
    `and 3 to 5 FAQ question/answer pairs whose answers are self-contained and grounded in the facts. Voice: ${VOICE}`,
  { phase: 'Outline', schema: OUTLINE }
);

/* ── 4. Draft ────────────────────────────────────────────────────────────────── */
phase('Draft');
const draft = await agent(
  `Write the article body in Markdown. Start at a "## " heading (NO H1 — the page renders the title). ` +
    `Use ONLY the verified facts below and cite each non-obvious fact inline as a Markdown link to its official source URL. ` +
    `Open with a short definitional section. Keep paragraphs tight. End with ONE natural sentence bridging to flying the game (no hard sell).\n\n` +
    `TITLE: ${outline.title}\nSECTIONS: ${JSON.stringify(outline.sections)}\n\nVERIFIED FACTS (link these source URLs):\n${verifiedList}\n\n` +
    `Voice (hard rules): ${VOICE}\n\n` +
    `Return: markdownBody (body only), sources (the DISTINCT official sources you actually cited, label+url, every url on the allowlist), faq (refine the outline's), takeaways (refine the outline's).`,
  { phase: 'Draft', schema: DRAFT }
);

/* ── 5. Image brief (bmf-art guardrails inline) ──────────────────────────────── */
phase('Image brief');
const art = await agent(
  `Write an on-brand image-generation prompt (Midjourney / Flux style) for this article's hero / OG image.\n` +
    `Brand world (guardrails): northern Saskatchewan boreal (spruce, pine, lakes, granite, burn scars); a BELL utility helicopter carrying a slung Bambi bucket; ` +
    `fire is the enemy (pressure, stakes, protecting people); warm "fight" colour register (ember / amber over charcoal and smoke) for editorial art; ` +
    `grounded, cinematic, physically believable. NEVER: cartoon, toy helicopter, extra rotor blades, combat, city skyline, desert, tropical. ` +
    `16:9, center-safe composition that survives a 1200x630 crop. Article: "${outline.title}".\n` +
    `Return ogPrompt, a one-line altText, and 0 to 2 figurePrompts for optional inline diagrams.`,
  { phase: 'Image brief', schema: IMG }
);

/* ── 6. Audit (parallel lenses) -> revise ────────────────────────────────────── */
phase('Audit');
const lenses = [
  ['voice', `Brand voice + anti-slop. Dry, direct. Headlines short. HARD: no em-dash (U+2014). No AI-slop phrases. Flag each violation with the exact fix.`],
  ['seo', `SEO/AEO/GEO. title <=60 chars, description <=160 chars, has 3-5 key takeaways, question-shaped H2s, >=1 FAQ, a definitional opener, inline citations present.`],
  ['sources', `Source compliance. EVERY link must be on the allowlist (${allowStr}). Flag any link not on it, and any factual claim with no citation.`],
];
const issues = (
  await parallel(
    lenses.map(([k, desc]) => () =>
      agent(
        `Audit this draft for: ${desc}\n\nTITLE: ${outline.title}\nDESCRIPTION: ${outline.description}\n\nBODY:\n${draft.markdownBody}\n\nSOURCES: ${JSON.stringify(
          draft.sources
        )}\n\nReturn issues (empty array if clean).`,
        { label: `audit:${k}`, phase: 'Audit', schema: AUDIT }
      )
    )
  )
)
  .filter(Boolean)
  .flatMap((x) => x.issues || []);
log(`${issues.length} audit issue(s)`);

let finalTitle = outline.title;
let finalDesc = outline.description;
let finalBody = draft.markdownBody;
if (issues.length) {
  const revised = await agent(
    `Apply these audit fixes to the article. Do NOT introduce new facts or new links — only fix what is listed. Return the corrected fields.\n\n` +
      `ISSUES: ${JSON.stringify(issues)}\n\nTITLE: ${outline.title}\nDESCRIPTION: ${outline.description}\n\nBODY:\n${draft.markdownBody}`,
    { phase: 'Audit', schema: REVISE }
  );
  if (revised) {
    finalTitle = revised.title || finalTitle;
    finalDesc = revised.description || finalDesc;
    finalBody = revised.markdownBody || finalBody;
  }
}

/* ── assemble (main loop stamps the date + writes content/<slug>.md) ─────────── */
return {
  frontmatter: {
    title: finalTitle,
    slug,
    description: finalDesc,
    pillar,
    keyword,
    takeaways: draft.takeaways,
    faq: draft.faq,
    sources: draft.sources,
    internalLinks: A.internalLinks || [],
    howto: A.howto || null,
  },
  markdown: finalBody,
  imagePrompts: art,
  audit: issues,
  stats: { candidate: research.length, verified: checked.length },
};
