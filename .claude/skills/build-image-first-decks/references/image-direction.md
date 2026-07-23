# Image direction and prompting

Use this reference after the narrative and exact copy are stable.

## Style lock

Create one reusable style lock with concrete decisions:

```yaml
canvas: 16:9 landscape at the final requested resolution
medium: cinematic editorial photography with restrained graphic design
palette: charcoal, warm white, one signal accent
type_character: oversized modern grotesk, high contrast, generous tracking
composition: asymmetric, strong negative space, one dominant focal point
light: directional, natural falloff, no generic neon glow
texture: subtle grain, physical materials, controlled imperfection
motifs: one recurring line or shape language
safe_area: keep essential text and faces away from every edge
brand_invariants: exact logo, product silhouette, approved colors
avoid: generic gradients, card grids, fake dashboards, stock-photo smiles, watermarks, extra copy
```

Do not use vague labels such as “premium” or “beautiful” without specifying the visual evidence that should create that quality.

## Prompt contract

Use a stable prompt structure:

```text
SLIDE PURPOSE
<What the audience should understand or feel>

EXACT VISIBLE TEXT
Render each quoted string exactly once and in this reading order:
1. "<headline>"
2. "<supporting line>"

CONTENT
<Subject, environment, objects, people, real product details>

COMPOSITION AND HIERARCHY
<Placement, scale, camera, negative space, text hierarchy>

STYLE LOCK
<Shared visual system>

CONSTRAINTS
- No additional text, pseudo-text, watermark, or unrelated logo.
- Preserve exact spelling, punctuation, numerals, and capitalization.
- Keep all essential content inside the safe area.
- Create a finished presentation slide, not a poster mockup shown in a room.
```

For Japanese, provide the final Japanese strings directly. Do not ask the image model to translate inside the image.

## Keyframe strategy

1. Generate the cover first to establish the outer edge of the visual world.
2. Generate one evidence-heavy or interior slide to prove the style works beyond the cover.
3. Inspect both at original resolution.
4. Select one or both as reference images for subsequent slides.
5. Reuse the style lock verbatim; change only slide-local content and composition.

Do not batch the entire deck before the keyframes are sound. A weak direction multiplied across ten slides creates expensive rework.

## Composition variation

Rotate among a small set of composition families:

- dominant subject with negative space;
- environmental wide shot;
- typographic field with one material motif;
- close detail or macro evidence;
- split tension between two subjects;
- ordered visual sequence;
- nearly empty synthesis frame.

Avoid repeating the same centered headline, subject placement, or horizon line on adjacent slides.

## Embedded text rules

- Supply literal text in quotes and list reading order.
- Specify hierarchy rather than an exact font unless a supplied reference makes the font reproducible.
- Keep critical text large and high contrast.
- Avoid small footnotes inside generated artwork. Put detailed citations in notes.
- Never approve a close-enough spelling of a name, number, or quote.
- If text repeatedly fails, shorten it or reduce the number of text regions before increasing generation effort.

## Editing pattern

Use a narrow change request:

```text
Change only the exact text "OLD" to "NEW".
Preserve every other visible string, layout, subject, face, product geometry,
logo, palette, lighting, texture, crop, spacing, and typography character.
Do not add any new text.
```

If the model changes unrelated details, restore the last approved image and retry with a smaller edit. Do not compound drift by editing an already drifted version.

## Brand and identity consistency

- Use supplied logos and product images as references rather than asking the model to recreate them from memory.
- Keep one approved identity reference for recurring people or characters.
- Record which reference files were used in the manifest or working notes.
- Treat a changed face, product silhouette, logo, or signature color as a failed slide even when the composition is attractive.
