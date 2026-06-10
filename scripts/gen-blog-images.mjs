/**
 * Generate AI hero images for blog articles via OpenAI gpt-image-1.
 *
 * Usage:
 *   node scripts/gen-blog-images.mjs              # all articles missing hero.webp
 *   node scripts/gen-blog-images.mjs --force      # regenerate even if hero.webp exists
 *   node scripts/gen-blog-images.mjs --slug defensible-space-around-your-home
 *   node scripts/gen-blog-images.mjs --dry-run    # print prompts, no API calls
 *
 * Requires: OPENAI_API_KEY env var.
 *
 * Reference images (optional — improve cross-article consistency):
 *   Place approved heroes at scripts/blog-art/series-a-ref.jpg (or .png/.webp)
 *                              scripts/blog-art/series-b-ref.jpg
 *                              scripts/blog-art/series-c-ref.jpg
 *   On the first run of a series the image is generated without a reference.
 *   After you approve the output, copy it to the matching series-*-ref file and
 *   subsequent articles will anchor to that visual family.
 *
 * Output: public/blog/<slug>/hero.webp  (1536×1024, 16:10 ish)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFrontmatter } from './content/markdown.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const CONTENT_DIR = path.join(ROOT, 'content');
const REF_DIR = path.join(HERE, 'blog-art');
const OUT_DIR = path.join(ROOT, 'public', 'blog');

/* ── style lock ─────────────────────────────────────────────────────────────────
   Describes the game's exact Three.js rendered aesthetic. Never vary this —
   it IS the house style. Only the shot/subject changes per article. */
const STYLE = `3D game engine render aesthetic: Three.js procedural geometry, \
cinematic teal-orange split tone (warm ember-orange highlights #ff6a2c, cool \
teal-green shadows), ACES tone mapping, selective bloom on fire cores and sun. \
Boreal terrain palette — deep forest green #2f6e2c, jewel-blue northern lake \
#1c5878 to shallow teal #52aec9, granite grey #71747a, warm shore tan #b6a06a. \
Fire: white-hot core, ember-orange glow #ff7a26, smoke column from fire-lit \
orange base #ff6a1e through ash-grey #5b574f to near-black anvil #100e0c. \
Saturation lifted, subtle vignette, film grain heavier in shadows. God rays \
when sun is in frame. NOT photorealistic, NOT cartoon — cinematic stylized 3D.`;

const AVOID = `Avoid: cartoon, neon, sci-fi, toy helicopter, extra rotor blades, \
broken aircraft geometry, city skyline, skyscrapers, mountains-as-Rockies, tropical \
jungle, palm trees, desert, anime, chibi, oversaturated fantasy flames, \
photorealistic photograph, text, watermarks, logos.`;

/* ── series shot templates ──────────────────────────────────────────────────── */
const SERIES = {
  /** Threat-framing: cabin at risk, fire visible. For preparedness articles. */
  A(slot) {
    return `Wide-medium shot: a remote log cabin in northern Saskatchewan, small in frame, surrounded by boreal spruce and pine. ${slot}. Warm amber fire-glow on the horizon against a cool smoky grey-blue sky. High-stakes, grounded — the fight is the enemy, not the framing. No human faces visible. Centred composition, cabin and fire in the central third, sky and smoke expendable to the edges, safe for a 16:9 to 9:16 cover crop.`;
  },
  /** Calm competence: hands-on gear or practical action in a Canadian outdoor setting. */
  B(slot) {
    return `Close-medium shot: ${slot}. Northern Canadian outdoor setting — cabin porch, truck bed, or boreal treeline. Calm, focused, methodical energy — not panic. Natural greens, khaki, dark wood palette with one warm amber accent (headlamp, fire faintly through glass). No human faces, no text, no logos. Subject in the central third.`;
  },
  /** Aerial firefighting: Bell helicopter + Bambi bucket over northern SK. */
  C(slot) {
    return `Aerial three-quarter shot: a Bell utility helicopter with a slung Bambi water bucket, ${slot}. Northern Saskatchewan below — boreal spruce, deep blue lakes, granite outcrops, burn scars. Heroic, grounded, physically believable — not a toy, not a war machine. Scale matters: landscape is vast. No text. Centred, helicopter and bucket in the central third, sky and landscape expendable to the edges, safe for a 16:9 to 9:16 cover crop.`;
  },
};

/* ── build full prompt ───────────────────────────────────────────────────────── */
function buildPrompt(series, slot, hasRef) {
  const template = SERIES[series.toUpperCase()];
  if (!template) throw new Error(`Unknown series "${series}". Use A, B, or C.`);
  const shot = template(slot);
  const refNote = hasRef
    ? 'Match the visual style, lighting, colour grade, and atmosphere of the reference image exactly.'
    : '';
  return [shot, STYLE, refNote, AVOID].filter(Boolean).join('\n\n');
}

/* ── OpenAI API helpers ───────────────────────────────────────────────────────── */
function apiKey() {
  const k = process.env.OPENAI_API_KEY;
  if (!k) throw new Error('OPENAI_API_KEY env var is not set.');
  return k;
}

/** Generate without a reference image. Returns PNG bytes. */
async function generateNoRef(prompt) {
  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-image-1',
      prompt,
      size: '1536x1024',
      quality: 'high',
      n: 1,
      response_format: 'b64_json',
    }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`OpenAI API error ${res.status}: ${JSON.stringify(json.error)}`);
  return Buffer.from(json.data[0].b64_json, 'base64');
}

/** Generate with a reference image using the edit endpoint. Returns PNG bytes. */
async function generateWithRef(prompt, refBuffer, refMime) {
  const form = new FormData();
  form.append('model', 'gpt-image-1');
  form.append('prompt', prompt);
  form.append('size', '1536x1024');
  form.append('quality', 'high');
  form.append('n', '1');
  form.append('response_format', 'b64_json');
  const ext = refMime === 'image/webp' ? 'webp' : refMime === 'image/png' ? 'png' : 'jpg';
  form.append('image[]', new Blob([refBuffer], { type: refMime }), `ref.${ext}`);

  const res = await fetch('https://api.openai.com/v1/images/edits', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey()}` },
    body: form,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`OpenAI API error ${res.status}: ${JSON.stringify(json.error)}`);
  return Buffer.from(json.data[0].b64_json, 'base64');
}

/** Find a reference image for the series (a/b/c), returns { buffer, mime } or null. */
function loadRef(series) {
  const exts = ['.jpg', '.jpeg', '.png', '.webp'];
  const mimes = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
  for (const ext of exts) {
    const p = path.join(REF_DIR, `series-${series.toLowerCase()}-ref${ext}`);
    if (fs.existsSync(p)) return { buffer: fs.readFileSync(p), mime: mimes[ext] };
  }
  return null;
}

/** Convert PNG buffer → webp and save. Falls back to saving as PNG if sharp unavailable. */
async function saveWebp(pngBuffer, outPath) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  try {
    const sharp = (await import('sharp')).default;
    await sharp(pngBuffer).webp({ quality: 88 }).toFile(outPath);
  } catch {
    // sharp unavailable — save the raw PNG with a .webp extension (browsers handle it)
    fs.writeFileSync(outPath, pngBuffer);
    console.log('  (sharp unavailable; saved as PNG with .webp extension)');
  }
}

/* ── main ───────────────────────────────────────────────────────────────────── */
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const force = args.includes('--force');
const slugIdx = args.indexOf('--slug');
const onlySlug = slugIdx !== -1 ? args[slugIdx + 1] : null;

if (!dryRun && !process.env.OPENAI_API_KEY) {
  console.error('Error: OPENAI_API_KEY is not set. Export it or pass it inline:\n  OPENAI_API_KEY=sk-... node scripts/gen-blog-images.mjs');
  process.exit(1);
}

// Collect articles with image_series + image_slot
const articles = [];
for (const file of fs.readdirSync(CONTENT_DIR).filter((f) => f.endsWith('.md'))) {
  const raw = fs.readFileSync(path.join(CONTENT_DIR, file), 'utf8');
  const { data } = parseFrontmatter(raw);
  if (!data.image_series || !data.image_slot) continue;
  if (onlySlug && data.slug !== onlySlug) continue;
  articles.push({ slug: data.slug, series: data.image_series, slot: data.image_slot });
}

if (!articles.length) {
  console.log('No articles have image_series + image_slot set. Add them to content/*.md frontmatter.');
  process.exit(0);
}

console.log(`Found ${articles.length} article(s) with image slots.\n`);

let generated = 0;
let skipped = 0;
let failed = 0;

for (const { slug, series, slot } of articles) {
  const outPath = path.join(OUT_DIR, slug, 'hero.webp');
  if (!force && fs.existsSync(outPath)) {
    console.log(`  [skip] ${slug} — hero.webp already exists (--force to regenerate)`);
    skipped++;
    continue;
  }

  const ref = loadRef(series);
  const prompt = buildPrompt(series, slot, !!ref);

  if (dryRun) {
    console.log(`\n[dry-run] ${slug} (series ${series.toUpperCase()})`);
    const refHint = ref ? 'yes' : `none — copy an approved output to scripts/blog-art/series-${series.toLowerCase()}-ref.jpg to lock the style`;
    console.log(`  ref: ${refHint}`);;
    console.log(`  prompt:\n  ${prompt.replace(/\n/g, '\n  ')}\n`);
    continue;
  }

  try {
    console.log(`  [gen]  ${slug} (series ${series.toUpperCase()}, ref: ${ref ? 'yes' : 'none'})…`);
    const png = ref
      ? await generateWithRef(prompt, ref.buffer, ref.mime)
      : await generateNoRef(prompt);
    await saveWebp(png, outPath);
    console.log(`         → saved public/blog/${slug}/hero.webp`);
    generated++;
  } catch (err) {
    console.error(`  [fail] ${slug}: ${err.message}`);
    failed++;
  }
}

if (!dryRun) {
  console.log(`\nDone. Generated: ${generated}  Skipped: ${skipped}  Failed: ${failed}`);
  if (generated > 0) {
    console.log(`\nNext step: run \`npm run build:content\` — the blog will use the new hero images.`);
    console.log(`To lock in a style family, copy one generated image to:\n  scripts/blog-art/series-a-ref.jpg  (or b / c)`);
  }
}
