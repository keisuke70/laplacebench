# QA and packaging

Use this reference after generation starts and before delivery.

## Per-slide approval

Inspect the image at original resolution. Check in this order:

### 1. Text

- Compare every visible string against `exact_text` character by character.
- Verify punctuation, capitalization, Japanese glyphs, numerals, decimal points, currency symbols, units, dates, and names.
- Confirm reading order and hierarchy.
- Look for extra words, pseudo-letters, duplicated labels, and background signage.
- Confirm text remains legible at normal slide-view scale, not only when zoomed in.

OCR may identify suspicious regions but cannot approve the slide. Image OCR commonly misses stylized text and can normalize an incorrect character into the expected one.

### 2. Evidence

- Match each factual claim to `source_refs`.
- Confirm the image does not imply an unsupported endorsement, partnership, customer, location, or product capability.
- Confirm metaphorical imagery is not presented as documentary evidence.

### 3. Visual integrity

- Check faces, hands, products, logos, diagrams, shadows, reflections, and object interactions.
- Check cropping and safe margins.
- Check that background texture does not compete with copy.
- Check that the slide remains part of the approved style system.
- Reject beautiful images that communicate the wrong claim.

Set all QA fields to `pass` only after these checks succeed.

## Deck-level contact sheet

Create a contact sheet after all individual slides have at least generated images. Review:

- cover strength and immediate topic recognition;
- silhouette variation across adjacent slides;
- balanced light/dark rhythm;
- consistent typography character and accent use;
- recurring subject or identity consistency;
- evidence slides visually distinct from emotional slides;
- a deliberate final frame rather than an abrupt stop.

The contact sheet is for sequence judgment only. Reopen individual originals after every fix.

## Packaging into PPTX

Use the available presentation skill or artifact tool.

1. Create a deck matching the manifest width/height ratio.
2. Add one slide per manifest entry.
3. Place the corresponding image at `x=0`, `y=0`, full slide width and height.
4. Do not add editable audience-facing copy, page chrome, or margins unless explicitly requested.
5. Add speaker notes containing talk track and source references when supported.
6. Add alt text summarizing the slide message and embedded copy when supported.
7. Render the resulting PPTX.
8. Compare every rendered slide to its source image for crop, scaling, color, and order.

If PowerPoint or the renderer changes the image crop, fix the placement rather than altering the approved source image.

## PDF and image delivery

- Generate PDF only from an approved packaged deck or from the approved image sequence using a deterministic full-page conversion.
- Preserve image order and page ratio.
- Avoid recompression when the delivery channel permits.
- Include the manifest when auditability or later text revision matters.
- Keep the original slide images; they are the editable source for image-generation revisions even though the visible text is rasterized.

## Final report

Report only material information:

- delivered formats and paths;
- slide count;
- source/reference material used;
- confirmation that embedded text and packaged renders were checked;
- non-editability reminder when relevant;
- any unresolved visual or source limitation.
