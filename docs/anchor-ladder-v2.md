# Anchor ladder v2 — product cpu-v4 tiers

2026-07-24. Placement runs for the newly imported product CPU baselines
(`product-cpu:cpu-v4:level_1..5`, snapshot commit
`d316b30914cb49942486f744099468fe0561ea02`), run under the canonical match
conduct (`docs/match-conduct-laplace-8x8-v1.md`: max_plies=100, threefold
repetition, no adjudication). Complements — does not replace —
[`anchor-ladder-v1.md`](anchor-ladder-v1.md); the frozen `takeshi:dN`
baselines keep their v1 placements and are connected to the new tiers via
the `takeshi:d2` matches below.

All games: adjacent side-swapped pairs, seeded, reproducible (product CPU
per-move seeds are derived from the bench seed and recorded per move in
`events.jsonl`).

## Adjacent product tiers (4 games each, 2 paired seeds, seed 4001)

| pairing | result | notes |
|---|---|---|
| `level_1` vs `level_2` | 1W-2D-1L each side | **tied at n=4** — adjacent stochastic tiers, inconclusive at this sample; recorded, not resolved |
| `level_2` vs `level_3` | level_3 2W-0L-2D | monotonic ✓ (1 elimination, 1 center win) |
| `level_3` vs `level_4` | level_4 2W-1L-1D | monotonic ✓; the draw was a **repetition_draw at ply 80** — first real-match firing of the new rule |
| `level_4` vs `level_5` | **0W-4D-0L** | all four games horizon draws at ply 100 — the two deterministic strong tiers are inseparable by W/L at the canonical cap; a per-move regret comparison (not run here) is the right instrument for this pair |

## Connection to the frozen takeshi ladder (seed 4002/4003)

| pairing | result | notes |
|---|---|---|
| `takeshi:d2` vs `level_1` | level_1 2W-0L | both center wins, at ply 16 and 11 |
| `takeshi:d2` vs `level_5` | level_5 2W-0L | both center wins, at ply 8 and 7 |

The entire cpu-v4 visible ladder sits **above** `takeshi:d2` (v1's deepest
routinely-runnable anchor): even the weakest tier beats it, and every win
came by the same mechanism — an immediate center rush the frozen
`TakeshiPolicy` does not defend. Two consequences recorded honestly:
(1) the takeshi and product ladders barely overlap, so `takeshi:dN` remains
useful mainly as a *floor* anchor; (2) because all four connection games
ended by one tactic within 16 plies, this connection measures that tactic
more than general strength — do not read a fine-grained rating out of it.

## First regret readout (oracle: `product-cpu:cpu-v4:level_5`)

`laplacebench regret runs/ladder-v2-level_1-vs-level_2` (316 scored moves,
~0.65 s/position offline):

| agent | median regret | p90 | mean | missed_win_rate |
|---|---|---|---|---|
| `level_1` | 13.976 | 360.1 | 57050.9 | 0 |
| `level_2` | **0.739** | 327.1 | 63766.5 | 0.006 |

Two honest observations, recorded before any LLM run uses this metric:

1. **The median discriminates in the expected direction** (level_2 ≪
   level_1) even though the 4-game W/L record above is tied — exactly the
   per-move statistical-power argument of `benchmark-strategy-ja.md` §2.1.
2. **The mean is dominated by a heavy tail**: positions where the oracle
   sees a decisive line carry values in the 10⁵ range, so a handful of
   moves swamps the mean. Use median/p90 as the robust discriminators;
   any future winsorization/clipping must be frozen as part of the metric
   definition before v1 runs, not tuned afterwards.

Regret values are comparable only within the same oracle generation
(spec + product commit, embedded in every output).

## Reproduce

```bash
export LAPLACE_PRODUCT_REPO=/Users/kei/projects/laplace-main-cpu-v4
export LAPLACE_PRODUCT_COMMIT=d316b30914cb49942486f744099468fe0561ea02
cd packages/cli
npx tsx src/cli.ts arena --team-a product-cpu:cpu-v4:level_1 --team-b product-cpu:cpu-v4:level_2 --games 4 --swap --seed 4001 --run-id ladder-v2-level_1-vs-level_2
npx tsx src/cli.ts arena --team-a product-cpu:cpu-v4:level_2 --team-b product-cpu:cpu-v4:level_3 --games 4 --swap --seed 4001 --run-id ladder-v2-level_2-vs-level_3
npx tsx src/cli.ts arena --team-a product-cpu:cpu-v4:level_3 --team-b product-cpu:cpu-v4:level_4 --games 4 --swap --seed 4001 --run-id ladder-v2-level_3-vs-level_4
npx tsx src/cli.ts arena --team-a product-cpu:cpu-v4:level_4 --team-b product-cpu:cpu-v4:level_5 --games 4 --swap --seed 4001 --run-id ladder-v2-level_4-vs-level_5
npx tsx src/cli.ts arena --team-a takeshi:d2 --team-b product-cpu:cpu-v4:level_1 --games 2 --swap --seed 4002 --run-id ladder-v2-takeshi-d2-vs-level_1
npx tsx src/cli.ts arena --team-a takeshi:d2 --team-b product-cpu:cpu-v4:level_5 --games 2 --swap --seed 4003 --run-id ladder-v2-takeshi-d2-vs-level_5
npx tsx src/cli.ts regret runs/ladder-v2-level_1-vs-level_2
```

`runs/` is gitignored; this document is the durable record (same discipline
as v1).
