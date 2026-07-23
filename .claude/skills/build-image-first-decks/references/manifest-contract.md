# Slide manifest contract

`slide-manifest.json` is the source of truth for order, exact copy, evidence, asset paths, and QA state.

## Minimal structure

```json
{
  "deck": {
    "title": "Deck title",
    "audience": "Decision makers",
    "objective": "Approve the pilot",
    "language": "ja",
    "width": 2560,
    "height": 1440,
    "style_lock": "Cinematic editorial; charcoal, warm white, orange accent"
  },
  "slides": [
    {
      "number": 1,
      "id": "cover",
      "role": "cover",
      "message": "Frame the central promise.",
      "exact_text": [
        "未来を予測するソフトウェア。",
        "Product vision 2026"
      ],
      "visual_brief": "A restrained cinematic hero frame with negative space.",
      "source_refs": [],
      "image": "slides/01-cover.png",
      "status": "planned",
      "qa": {
        "text": "pending",
        "visual": "pending",
        "source": "pending"
      }
    }
  ]
}
```

## Field rules

### Deck

- `title`, `audience`, `objective`, and `style_lock` must be non-empty strings.
- `width` and `height` must be positive integers and match every generated slide.
- Use one ratio for the entire deck.

### Slide

- `number` must be contiguous from 1.
- `id` must be stable, unique, and filename-safe.
- `role` selects the narrative job, not a decorative template.
- `message` states the one thing the audience should retain.
- `exact_text` lists every intended visible string in reading order. Use `[]` only for an intentionally text-free visual breather.
- `visual_brief` describes content and hierarchy without duplicating the complete style lock.
- `source_refs` contains URLs, document references, or source IDs supporting factual claims. Creative framing may have none.
- `image` is a unique path relative to the manifest.
- `status` is `planned`, `generated`, or `verified`.
- `qa.text`, `qa.visual`, and `qa.source` are `pending`, `pass`, or `fail`.

## State transitions

```text
planned   -> copy and brief approved, image may not exist
generated -> image exists, QA incomplete or failed
verified  -> image exists and all three QA fields are pass
```

Never mark a slide `verified` because generation completed successfully. Verification is a separate inspection step.

## Sources

Use precise references where possible:

```json
"source_refs": [
  "https://example.com/report#section",
  "input/strategy.pdf page 14",
  "Drive: FY2026 Plan / Metrics table"
]
```

Do not place secrets, private raw payloads, or unnecessary customer data in the manifest.

## Validation

Run before generation and again before packaging:

```bash
python3 <skill-dir>/scripts/validate_manifest.py path/to/slide-manifest.json
python3 <skill-dir>/scripts/validate_manifest.py path/to/slide-manifest.json --strict
```

The non-strict mode fails structural errors and reports editorial warnings. Strict mode also fails warnings.
