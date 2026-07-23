---
name: build-image-first-decks
description: Create image-first presentation decks in which each finished slide is a generated raster image with its visible text baked into the artwork, then package the verified images as PPTX, PDF, or an image set. Use for GPT Image, imagegen, cinematic, editorial, illustrated, campaign-style, or highly art-directed decks where visual impact matters more than native PowerPoint editability. Do not use for ordinary editable corporate slides, dense tables, or live interactive web presentations.
---

# Build Image-First Decks

Create the deck as a coherent visual sequence, not as unrelated image prompts. Treat the slide image as the source of visible truth; PowerPoint is only a delivery container unless the user explicitly requests editable overlays.

## Non-negotiable boundary

- Bake all audience-facing text into each generated slide image.
- Do not silently recreate titles, labels, charts, or page chrome as editable PowerPoint objects.
- Disclose before generation that the visible slide content will not be natively editable.
- Keep a machine-readable manifest containing the exact intended copy and evidence for every slide.
- Never invent facts, metrics, quotes, customers, dates, citations, or logos for a real subject.
- If the request depends on live data, dense editable tables, precise diagrams, or collaborative editing, recommend a native presentation workflow instead.

## Required tools and companion skills

- Use the available image-generation skill or tool for both initial renders and surgical edits. Do not draw the slide artwork programmatically.
- Use the presentation skill or artifact tool only after all slide images pass visual QA.
- Use web or connected-source tools when claims, brand assets, or current facts must be verified.
- Use original-resolution image inspection for QA; a contact sheet is not sufficient to approve text.

## Workflow

### 1. Establish the contract

Confirm or infer only what is safe to infer:

- audience;
- decision or feeling the deck should produce;
- presentation context;
- target length;
- language;
- delivery formats;
- whether non-editable text is accepted;
- brand/reference material and allowed sources.

Ask only when a missing answer would materially change the story or art direction. Do not block on minor preferences that can be resolved by professional judgment.

### 2. Ground claims and copy

Collect the user's real inputs first. Build a source ledger before drafting claim-bearing slides.

- Preserve supplied facts exactly.
- Distinguish sourced facts from creative framing.
- Shorten copy without changing meaning.
- If evidence is unavailable, remove or qualify the claim instead of making it visually persuasive but false.
- Keep source details out of the artwork when they would damage composition; put them in speaker notes or an accompanying source list.

### 3. Design the narrative before prompting images

Read `references/narrative-and-archetypes.md` when selecting the story arc and slide roles.

Write one sentence for each slide's job. Every slide must advance the argument, change emotional energy, or provide necessary evidence. Remove slides that only repeat the previous idea in a different visual style.

Default to 7–14 slides. Longer decks require a reason. Use specialty roles such as comparison, timeline, quote, or big-number only when the underlying content qualifies.

### 4. Create the manifest

Create `slide-manifest.json` before generating images. Use the contract in `references/manifest-contract.md`.

For each slide record:

- number and stable ID;
- narrative role;
- one-sentence message;
- exact visible text in reading order;
- visual brief;
- source references;
- expected image path;
- QA state.

Run:

```bash
python3 <skill-dir>/scripts/validate_manifest.py slide-manifest.json
```

The manifest is the copy source of truth. Do not treat text recovered from an image as authoritative.

### 5. Lock the visual system

Read `references/image-direction.md` before writing prompts.

Define one style lock for the deck:

- canvas size and aspect ratio;
- palette and contrast behavior;
- typography character;
- image medium and material treatment;
- composition grammar;
- recurring motifs;
- prohibited clichés;
- safe margins;
- brand invariants.

Generate the cover and one representative interior slide first. Inspect both at original resolution. Refine the shared direction before generating the remaining deck. Use the approved keyframe as a style reference for later slides when the image tool supports reference images.

Do not force every slide into one layout. Consistency comes from art direction, not identical composition.

### 6. Generate one slide at a time

Each prompt must include:

1. slide purpose;
2. exact text, clearly delimited;
3. content and subject;
4. composition and hierarchy;
5. shared style lock;
6. preservation requirements for edits;
7. exclusions: extra text, watermark, unintended logos, illegible microcopy.

Generate at the final aspect ratio. Prefer a reliable native 16:9 size supported by the active model; do not generate square images and crop them into slides.

Keep copy sparse enough to render and read. If a slide needs dense paragraphs, rewrite or split the slide rather than shrinking the typography.

### 7. Repair surgically

When a slide is close, edit it instead of regenerating from scratch.

State exactly what changes and what must remain invariant, for example:

> Replace only the second line with the exact supplied text. Preserve composition, subjects, identity, lighting, palette, typography style, spacing, and every other element.

Regenerate fully only when the composition or concept is wrong. Repeated text repair is evidence that the copy is too dense or the prompt hierarchy is weak; simplify before continuing.

### 8. Verify every slide

Read `references/qa-and-packaging.md` and inspect every image at original resolution.

Required checks:

- exact text, punctuation, numerals, units, names, and language;
- no added text or pseudo-text;
- no cropped or low-contrast copy;
- source support for every factual claim;
- consistent identity, product, logo, palette, and typography character;
- no malformed hands, objects, diagrams, or impossible geometry that distracts from the message;
- adequate projector readability.

OCR may assist discovery but never approves a slide. Mark a slide `verified` only after human-equivalent visual inspection and source verification.

After images exist, rerun the validator so it also checks file presence, ordering, format, and pixel dimensions.

### 9. Review the sequence

Create a contact sheet and inspect deck-level rhythm:

- silhouette variation;
- light/dark and close/wide variation;
- repeated motifs without copy-paste composition;
- a clear opening, escalation, evidence phase, and close;
- no interior slide visually overpowering the cover or CTA without narrative reason.

Fix the sequence before packaging. Do not use a contact sheet to approve embedded text.

### 10. Package without changing the artwork

Use the presentation skill to place exactly one image edge-to-edge on each slide in manifest order.

- Match the presentation page ratio to the image ratio.
- Do not add margins, headers, page numbers, or editable text unless requested.
- Put talk track and source URLs in speaker notes when supported.
- Add useful alt text based on the manifest's message and exact copy.
- Render the packaged presentation and compare every page with its source image.
- Export PDF only after the PPTX or image sequence passes comparison.

Deliver the requested presentation plus `slide-manifest.json` when future revision or audit matters. Keep prompt logs only when the user asks or the workflow requires reproducibility.

## Exit criteria

Do not deliver until all are true:

- every visible string matches the manifest exactly;
- every claim is sourced, qualified, or explicitly creative framing;
- every slide image has the required dimensions;
- every slide is marked verified with text, visual, and source QA passing;
- the contact sheet has been reviewed for rhythm and consistency;
- the packaged deck has been rendered and compared with the source images;
- the user is not expecting native editability that the artifact does not provide.

## Provenance

The narrative discipline and layout entry-condition idea were adapted from the MIT-licensed StackBlitz Bolt Slides authoring guide. This skill intentionally excludes its React engine and component system and adds an image-first manifest, embedded-text verification, style-lock, repair, and packaging workflow.
