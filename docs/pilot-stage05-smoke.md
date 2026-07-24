# Stage 0.5 pilot — smoke run (2026-07-24)

First end-to-end LLM pilot slice per `benchmark-strategy-ja.md` §7, run under
the frozen match conduct (`docs/match-conduct-laplace-8x8-v1.md`) with the
imported product baselines and regret oracle
(`docs/plans/2026-07-24-product-cpu-import-and-regret.md`). This is a
**smoke-scale** run (one model, one opponent tier, 2 side-swapped games,
seed 5001) whose job is to validate the measurement pipeline and produce the
first real numbers — not to rank models.

```
arena --team-a claude-cli:haiku --team-b product-cpu:cpu-v4:level_1
      --games 2 --swap --seed 5001 --output-token-budget 120000
run: pilot-smoke-haiku-vs-level_1   (runs/ is gitignored; this doc is the record)
```

## Results

| metric | claude-cli:haiku | product-cpu:cpu-v4:level_1 |
|---|---|---|
| W/L | 0W-2L (center loss @28, elimination loss @61) | 2W-0L |
| illegal moves / turn | **0** | 0 |
| format failures / turn | **0** | 0 |
| median regret (oracle: cpu-v4:level_5) | 54.998 | 24.906 |
| p90 regret | 572.1 | 495.5 |
| unsafe-move rate | 0.023 | 0 |
| missed-win rate | 0 | 0.044 |
| output tokens (2 games) | 189,672 | — |
| avg latency / move | 45.3 s | 17 ms |

## What the smoke run established

1. **The full pipeline works live**: persistent-conversation CLI adapter →
   referee (frozen rules, canonical cap, repetition rule) → product-cpu
   bridge (per-move seeds recorded) → offline regret oracle, with zero
   manual intervention across 89 plies.
2. **Rule acquisition may saturate for capable models**: haiku played 44
   moves from the rulebook alone with zero illegal or malformed replies —
   its one repair mechanism was never used. If frontier models generally
   sit at an illegal-rate floor of ~0, the §2.3 learning-curve story needs
   per-move regret (not error rate) as its primary signal. n=1 model;
   weaker/smaller models may still show a curve.
3. **The pipeline discriminates in the expected direction for this
   pairing**: haiku ranks below level_1 by both W/L and median regret,
   consistently. Within this sampled pairing the result is itself a
   "crushed" outcome, so this smoke run cannot yet say whether the ladder
   avoids §7's failure mode ("everyone wins or everyone is crushed with
   nothing in between") — that determination needs the untested lower
   anchors (takeshi:dN, center-greedy, greedy, random) and more models,
   which is exactly what the full pilot grid below is for.
4. **Cost envelope**: ≈95k output tokens and ≈45 s/move per game-side for
   haiku with visible reasoning. A §7-scale pilot (10–20 games × opponent ×
   model) is affordable but wall-clock heavy (hours per model); SPRT-style
   early stopping and the per-move regret channel (≈60 samples/game) are
   the levers, exactly as §2 argues.

## Honest limitations

- n=2 games, one model, one opponent tier, one seed pair. No ranking claims.
- Median-regret values depend on the position distribution the pairing
  produces; compare agents **within the same run/opponent mix** (and only
  within the same oracle generation — oracle identity is embedded in every
  regret output).
- The 0-illegal observation is a single-model data point, not yet evidence
  that the metric is dead for all models.

## Next (full stage 0.5, when triggered)

Model set of 3–5 (spanning haiku → frontier), opponents random /
takeshi:d2 / level_1 / level_3, 10–20 side-swapped games per pairing,
regret always on, illegal-rate curve kept (cheap) even if expected flat.
