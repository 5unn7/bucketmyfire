---
name: bmf-art
description: >-
  Art-direct on-brand image prompts for bucketmyfire. Use whenever the task is to WRITE A PROMPT for
  an image generator (Midjourney, DALL·E, SDXL, Flux, Nano-banana, etc.) or to keep AI-generated art
  ON-BRAND across surfaces: concept/key art, asset sheets (helicopters, Bambi buckets, water drops,
  trees, smoke, flames, cabins), UI icons, mission cards, map art, map markers, badges, buttons,
  store/merch visuals, posters, and social/share images. This is a DIRECTOR'S skill, NOT a template
  vending machine — it does not paste a fixed style string. It decides what each image must SAY
  (intent → shot → composition → motivated light), honours the locked brand world as guardrails
  (northern Saskatchewan boreal, Bell utility helicopter + slung Bambi bucket, fire-is-the-enemy,
  warm "fight" vs cool "cockpit" colour registers, the verbatim taglines), keeps the failure-mode
  negative list (no cartoon / toy heli / extra rotor blades / combat / city skyline / desert /
  tropical), and treats consistency as a REFERENCE-IMAGE problem (Midjourney --sref, IP-Adapter /
  LoRA, seed family) rather than a repeated paragraph. Reach for it on "make art for X", "generate a
  poster / key art / mission card", "I need an asset sheet", "prompt for a helicopter render", "merch
  design", "map marker icons", "make this image on-brand", "consistent visual style", or any
  image-generation prompt for the game. NOT for in-game procedural meshes/shaders (that's bmf-asset)
  or the DOM HUD/CSS (that's bmf-ui) — this is for raster ART generated outside the engine.
---

# bucketmyfire — art direction for generated images

This is a **director's** skill, not a prompt vending machine. The old job — paste a fixed 60-word
style string at the front of every prompt and swap the subject — is **dead**. It made every image
the same and directed none of them.

Your job: **decide what each image has to say, then build the one shot that says it — inside a locked
world.** Consistency does not come from repeating words; it comes from **reference images** (see
*Consistency is a reference problem*). That frees the prompt to do the real work: direction.

---

## Direct it — the four moves (do these before you type a prompt)

1. **Intent — one sentence.** What does THIS image say? Name it before anything else. *Open Skies* =
   "the fight never ends, and you're not alone in it." A mission card = "this town is about to burn."
   A heli asset = "this is a credible workhorse, not a toy." If you can't say the line, you're not
   ready to prompt — and the prompt will come out generic.
2. **Shot — the single frame that carries the line.** Choose angle, distance, and the *moment in
   time* (the banking turn, the bucket dipping to scoop, the sheet of water hitting flame, the wide
   that dwarfs the heli against the smoke). The shot is a decision, not a default. Across a set, vary
   it on purpose so they don't all read the same.
3. **Composition — where the eye lands, then goes.** One clear focal anchor, deliberate negative
   space (leave room for UI if it backs a screen), real foreground/mid/background depth. For any
   screen art, obey the **Cross-device law** below.
4. **Light & mood — motivated, not reflex.** Don't reach for "golden hour" by habit. Ask: what is the
   only warm thing in the frame? What is the air doing — smoke, haze, god rays, ember fall? Name a
   mood word (relentless, lonely, triumphant, tense) and light to it.

Then a **constraints pass**: honour the world truths, append the failure-mode guards, set the aspect,
and name the consistency anchor (which reference frame + seed this should match).

**Write it like a director, not a tagger.** Lead with the idea and the shot in plain cinematic
language. Pull only the world-detail this frame actually needs. Cut rote tokens a reference image
already carries. **A short, directed prompt beats a long boilerplate one** — length is not quality.

If the intent is genuinely ambiguous (which heli, the emotional beat, day vs dusk), ask one tight
question. Never invent a place name to fill a gap (see place authenticity).

---

## The world (truths the image must HONOUR — not a string to paste)

These are constraints that must be *true in the frame*, not words to prepend. Pull what the shot
needs; never violate them.

- **What it is:** a serious, grounded, *real-3D* game about flying a Bell-style **utility
  helicopter** with a **slung Bambi bucket**, scooping from **northern Saskatchewan** lakes and
  dropping on **living wildfire** before it reaches remote cabins and communities.
- **The fight is the brand:** fire is the *enemy*. Not firefighting-as-job, not save-the-forest, not
  hero fantasy, not a cause. Heroic but humble — pressure, responsibility, the weight of protecting
  people. If an image feels like a tourism poster or a hero selfie, it's wrong.
- **Place authenticity:** northern Saskatchewan / Canadian Shield — boreal spruce & pine, deep blue
  lakes, grey granite outcrops, blackened burn scars, log cabins, remote comms. **No mountains-as-
  Rockies, no city skylines, no tropics/desert.** **Never invent place names** in the prompt or any
  baked-in caption; if a real one is needed, leave it to the user.
- **Two-register colour law:** **fight / brand surfaces** (key art, posters, cards, merch) run
  **warm** — amber, ember-orange, fire-glow on charcoal and smoke. **Instrument / cockpit surfaces**
  (HUD, gauges, in-flight overlays) run **cool cyan** on dark frosted glass. Never warm the cockpit;
  never cool the fight.
- **Tone words:** heroic, grounded, high-stakes, physically believable, lightly stylized for game
  readability. **Never:** arcade, cartoonish, fantasy, sci-fi, toy-like.
- **Taglines — verbatim only, never paraphrase into AI-slop, and only when copy is actually wanted:**
  `Fly. Scoop. Drop. Protect.` · `Fight wildfires from the sky.` · `Remote lakes, real pressure,
  living fire.` · `A bucket, a chopper, a wildfire.` (origin hook). Default to **no baked-in text** —
  let the DOM render copy.
- **Palette to reach for:** charcoal, steel grey, deep lake blue, forest green, fire orange, warm
  amber highlights, ash grey, ember red. (Cockpit register adds: dark frosted glass, cyan instrument
  glow, amber action accents.)

---

## Consistency is a reference problem (this is the keystone)

There is **no magic style word** — putting "bucketmyfire style" (or any invented label) in a prompt
does nothing; no base model has seen it. Real frame-to-frame consistency comes from three levers, in
order of power:

1. **Reference images — the only true house-style lock.** Once 1–3 hero frames are approved, anchor
   everything after to them:
   - **Midjourney** — `--sref <image-url or style-code>` + `--sw <0–1000>` (apply strength);
     `--cref` to keep a specific helicopter consistent; or a trained moodboard via personalization
     (`--p`). An image URL at the *front* of the prompt is also an anchor.
   - **Flux / SDXL** (ComfyUI, A1111, Replicate) — **IP-Adapter / style-reference** for a one-off
     match, or train a **LoRA** on the approved set and trigger it with its token (this is what makes
     a *named* style actually real).
   - **Nano-banana (Gemini 2.5 Flash Image) / DALL·E in ChatGPT** — no style codes; **attach the
     reference frame(s)** and say "match this style, lighting, palette." Nano-banana is especially
     strong at carrying a fed frame.
2. **The world truths + the failure-mode guards.** Honouring the same constraints keeps the same
   world even when the words differ. This — not a copy-pasted paragraph — is what holds the look.
3. **Seed family.** Reuse one seed (MJ `--seed N`, SDXL/Flux seed field) across a set so a series
   reads as one shoot. DALL·E has no usable seed — lean harder on levers 1 + 2.

**So when a job must match earlier art, don't just hand back text** — tell the user which hero frame
to attach as `--sref` / IP-Adapter / reference, and which seed to reuse. Generate the *first* hero of
any family carefully, pick the keeper, and make it the reference for everything downstream.

---

## Failure-mode guards (append to every prompt — these prevent specific breakages)

Midjourney form: `--no cartoon, neon sci-fi, toy helicopter, extra rotor blades, broken aircraft
geometry, malformed rotor, unreadable text, gibberish text, random logos, watermark, futuristic
weapons, military combat, missiles, explosions-as-combat, city skyline, skyscrapers, tropical jungle,
palm trees, desert, sand dunes, anime, chibi, plastic toy look, oversaturated fantasy flames`

Non-Midjourney: render the same list as the **Negative prompt** field, or a trailing "Avoid: …"
sentence. **Never drop it** — this is what stops helis sprouting extra blades and the biome drifting
tropical. (These are guards, not art direction — they don't make an image good, they stop it failing.)

---

## What each surface is FOR (brief, not boilerplate)

Direct to the *purpose*. The technical must-haves are hard requirements; the rest is yours to shoot.

- **Key art / hero / mode-card** — sell the feeling of the mode or the game in one frame. Must: clear
  focal anchor, clean negative space for an overlay, usually **no baked text**. Aspect: `16:9` hero,
  `4:3` card, `9:16`/`3:4` portrait splash. Screen art → **Cross-device law**.
- **Mission card** — communicate *this scenario's stakes* (the town, the head-fire, the lake run).
  Must: room for UI bottom/left, one readable beat. Aspect `4:3` (or the responsive master).
- **UI / HUD mockup** — explore layout & mood only (real UI is built in `ui/theme.ts` + `ui/
  components/`, see `bmf-ui`). Must: cool-cyan instrument register, frosted glass, monospace
  readouts, high legibility. Aspect per device (`9:19.5` portrait, `19.5:9` landscape, `16:9`
  desktop).
- **Map / region card** — make the place legible and characterful from above. Must: oblique/iso
  aerial, real SK landforms (lakes, shield, burn scars), **no place labels**. Aspect `4:3`/`1:1`/`3:4`.
- **Icon / map marker / glyph** — one idea, readable at 24px. Must: bold silhouette, flat-but-
  dimensional, single-flat or transparent bg, correct register (amber-on-charcoal brand /
  cyan-on-glass instrument), no text. Generate as a matching **set** in one prompt. Aspect `1:1`.
- **Badge / rank** — feel earned. Must: embossed metal-and-enamel, ember-amber + steel, centred
  emblem, minimal-or-no numerals. Aspect `1:1`.
- **Merch / poster ("Wear the fight")** — strong silhouette that reads on a dark tee from across a
  room. Must: limited 2–4 colour screen-print palette, rugged fire-crew/forestry-patch energy, room
  for a **real** tagline, no fake logos. Aspect `4:5`/`2:3`/`1:1`. Confirm taste via
  `creative-director` before treating as final.

(Icons, badges, asset sheets, markers, merch are **not** viewport backgrounds — frame them to their
own aspect; the cross-device law does not apply.)

---

## Cross-device law (every SCREEN hero must survive both orientations)

The game ships phone + desktop from one codebase; screen art sits behind a fixed single-viewport UI
via `object-fit: cover`, so the **same image is cropped to portrait on a phone and landscape on
desktop**. Any hero/background/key-art that backs a *screen* must survive both crops. This is a
default — don't ask "mobile or desktop?", make it work on both. Two ways:

1. **One centre-safe master (default).** Shoot **16:9** but keep the focal subject + horizon inside
   the central vertical third, with expendable sky/smoke/water bleeding to the side edges and nothing
   important in the corners — so a phone's cover-crop only ever discards the sides. Direction
   fragment: *"centred composition, hero subject and horizon held in the central third, expendable
   sky/smoke/water to the side edges, nothing important in corners, safe for a 16:9→9:16 cover crop."*
2. **A matched pair.** A **16:9** and a **9:16** of the same scene, same reference + seed,
   **recomposed** (not just cropped) per orientation; the app picks via `<picture>`/media query.

Never frame a screen hero for one orientation only.

---

## A worked direction (the process once, concretely — *Open Skies* mode hero)

- **Intent:** the fight is endless and you're one of many — relentless, vast, shared. Not a hero shot.
- **Shot:** high three-quarter aerial looking *down a wildfire front that runs unbroken to the
  horizon* — the endlessness is the subject; helis are small along it.
- **Composition:** the burning line + horizon hold the central third; multiple choppers scattered at
  different depths; smoke/sky expendable to the edges (centre-safe for cover crop).
- **Light & mood:** low sun smothered in smoke; the fire's glow is the *only* warm light in a vast
  cool sky. Mood: relentless.

→ Prompt (lean, directed; reference + seed carry the house look):

```
Aerial wide shot, high three-quarter angle looking down a wildfire front that runs unbroken to the horizon — the endlessness is the subject, not any one chopper. Five or six Bell utility helicopters with slung Bambi buckets scattered at different depths along the burning line, each small against the scale of it: a working sky, not a hero shot. Low sun smothered in smoke; the fire's glow the only warm light in a vast cool open sky. Northern Saskatchewan boreal below — spruce, granite, a chain of lakes threading the haze. Mood: relentless, shared. Centred so the fire line and horizon hold the central third, smoke and sky expendable to the edges, safe for a 16:9→9:16 cover crop, no text --ar 16:9 --no cartoon, neon sci-fi, toy helicopter, extra rotor blades, broken aircraft geometry, malformed rotor, unreadable text, gibberish text, random logos, watermark, futuristic weapons, military combat, missiles, explosions-as-combat, city skyline, skyscrapers, tropical jungle, palm trees, desert, sand dunes, anime, chibi, plastic toy look, oversaturated fantasy flames
```

Notice what's *absent*: no "bucketmyfire visual style", no rote 60-word world dump. The world is
honoured (SK boreal, Bell + Bambi, warm fire on cool sky, fire-as-enemy) and the guards are appended
— but the prompt is mostly *the shot and the idea*.

---

## Before you hand it back (director's check — not a robot checklist)

- [ ] **Says one thing.** You can state the intent in a sentence, and the frame delivers it.
- [ ] **Directed, not tagged.** Leads with idea + shot; no dead style label; no boilerplate the
      reference already carries; length earned, not padded.
- [ ] **World honoured:** Bell **utility** heli + **slung Bambi bucket**, northern-SK boreal, fire is
      the enemy, correct colour register (warm fight / cool cockpit), **no invented place name**, no
      baked text unless copy was asked for (then a verbatim tagline).
- [ ] **Guards appended** (failure-mode negatives) and **aspect** set for the surface.
- [ ] **Cross-device** handled for any screen hero (centre-safe master or matched pair).
- [ ] **Consistency anchor named:** which reference frame (`--sref`/IP-Adapter/attached) + seed this
      should match, or — if it's the first of a family — a note to keep it as the reference.

When the call is "is this actually good / on-brand?" hand it to **`creative-director`**. When the
output becomes real game art, route procedural meshes/shaders to **`bmf-asset`** and DOM UI to
**`bmf-ui`** — this skill stops at the directed prompt and the raster reference.
