# Model usage semantics

LaplaceBench records provider-reported model usage, but it does not pretend
that a Claude token and an OpenAI token are one universal unit. This document
defines the normalized fields and the comparison boundary used by
`laplace-model-usage-v1`.

## Provider shapes

Anthropic reports three **additive** input buckets. Its documented total input
is:

```text
input_tokens + cache_creation_input_tokens + cache_read_input_tokens
```

OpenAI reports `input_tokens` as the total, with `cached_input_tokens` as a
**subset** of that total:

```text
uncached input = input_tokens - cached_input_tokens
```

Adding OpenAI cached input to `input_tokens` would double-count it. Omitting
Anthropic cache creation and cache reads would under-count it. LaplaceBench
normalizes these different shapes as follows:

| field | meaning |
|---|---|
| `input_tokens_total` | all provider-reported input, cached input included exactly once |
| `input_tokens_uncached` | input not served from a cache; includes cache creation work |
| `cache_read_tokens` | input served from a provider cache |
| `cache_write_tokens` | separate cache-creation bucket when the provider reports it; otherwise `null` |
| `output_tokens_total` | inclusive output total, including reasoning tokens |
| `reasoning_tokens` | reasoning subset when reported on every observed call; otherwise `null` |
| `total_tokens` | total input + total output |
| `fresh_tokens` | uncached input + total output; no invented cache-price weighting |

For complete telemetry, `summary.json` also reports these totals per reported
adapter call, per game, and per scheduled team turn (including forced-pass
turns). Normalized averages are `null` for partial or legacy telemetry rather
than silently treating missing calls as zero.

Primary references:

- [Anthropic Messages usage](https://platform.claude.com/docs/en/api/messages):
  total input is the sum of normal input, cache creation, and cache reads;
  output is the inclusive authoritative total.
- [OpenAI Responses usage](https://platform.openai.com/docs/api-reference/responses-streaming/response/refusal/delta):
  input has a cached-token breakdown and output has a reasoning-token
  breakdown.
- [Claude Code CLI JSON output](https://docs.anthropic.com/en/docs/claude-code/cli-usage)
  and [`codex exec --json` usage discussion](https://github.com/openai/codex/issues/19022)
  document the machine-readable surfaces used by the subscription adapters.

## Locally verified CLI behavior

On 2026-07-22, a one-line smoke request was checked against Claude Code
2.1.211 and Codex CLI 0.144.5:

- Claude returned `input_tokens`, `cache_creation_input_tokens`,
  `cache_read_input_tokens`, and `output_tokens` in the final JSON result.
- Codex returned `input_tokens`, `cached_input_tokens`, `output_tokens`, and
  `reasoning_output_tokens` in `turn.completed.usage`.

The parser treats missing or malformed required totals as **unreported**. It
does not silently turn missing telemetry into zero. `reported_calls` and
`unreported_calls` make partial coverage visible.

## What can be compared

Token totals are directly comparable only when all of these are fixed:

- provider and model;
- CLI/API adapter and its version;
- reasoning effort and sampling settings;
- LaplaceBench harness/prompt version.

Claude Code and Codex inject different vendor-owned system context and use
different tokenizers. A tiny identical LaplaceBench prompt can therefore
produce very different raw input totals before game strategy is considered.
Cross-provider token totals are retained as descriptive diagnostics, not a
single efficiency ranking.

To provide a tokenizer-neutral companion measure, LaplaceBench also records:

- `application_input_bytes`: UTF-8 bytes newly added by LaplaceBench at each
  logical turn (rulebook/strategy once, then turn deltas), excluding
  vendor-injected context and repeated transport transcripts;
- `application_output_bytes`: UTF-8 bytes of model text observed by the
  harness.

These byte counts compare application-layer prompt/response volume. They do
not estimate hidden reasoning or provider compute.

## Scope and limits

Competition usage covers in-game adapter calls, including repair attempts.
Post-game analysis belongs to the participant-owned Skills/harness workflow
and is excluded from the match wallet and match usage summary. Usage is
returned after an in-game call completes, so a subscription CLI budget can
stop the **next turn** but cannot guarantee an exact mid-generation cutoff. A
timeout may consume provider resources without returning final telemetry;
such a call is counted as unreported.

Subscription usage is not the user's remaining Claude/ChatGPT plan quota and
is not a bill. Exact official budget enforcement should use a maintainer-owned
API gateway with provider output limits; subscription runs remain a separate
condition.

## Match resource policy

The optional `--output-token-budget N` is a separate wallet for each team in
each game. It uses in-game `output_tokens_total`, which includes reasoning for
both providers and avoids using vendor-injected input context as the common
budget currency.

Admission is checked once at the start of a scheduled turn:

1. if usage is below the cap, the complete turn is admitted, including its
   repair attempt;
2. the admitted turn may finish above the cap and its valid move still counts;
3. later turns at or above the cap skip without calling the model.

There is intentionally no mid-generation cutoff and no attempt to claw back
the final admitted move. Post-game learning is outside this wallet.

Each turn has one wall-clock deadline shared by both attempts. The default is
300,000 ms (five minutes). A reply completing after the deadline is discarded,
and the referee calls the same `advanceTurn()` path used for a product timeout.
The pass is logged separately as `timeout`; token-budget admission failures are
logged as `token_budget`.
