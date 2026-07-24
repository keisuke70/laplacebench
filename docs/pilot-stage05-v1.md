# Stage 0.5 pilot v1 — reduced grid (2026-07-24)

A reduced-grid pilot toward §7 (2 games per pairing, versus the 10–20 the
strategy prescribes for the full gate), following the smoke run
(`docs/pilot-stage05-smoke.md`). Grid chosen by the maintainer: opponents
are the product ladder only — `product-cpu:cpu-v4:{level_1, level_3,
level_5}` (floor anchors deliberately dropped; per-move regret covers the
low end, as the smoke run demonstrated) — versus `claude-cli:{haiku,
sonnet, opus}`, 2 side-swapped games per pairing, canonical match conduct
(cap 100, repetition rule), oracle `product-cpu:cpu-v4:level_5` @ commit
`d316b30`. Seeds: 6001/6002/6003 (level_1 column), 6101–6106 (rest).

**Run condition caveat (uncontrolled, discovered mid-run):** all claude-cli
games inherited `CLAUDE_EFFORT=high` from the launching session's
environment — unlabeled in agent names. The condition is *internally
consistent* (every model ran at high effort), so within-grid comparisons
stand, but these numbers must not be merged with future runs at other
efforts. The leak is fixed harness-side as of this commit
(`buildChildEnv` drops ambient `CLAUDE_EFFORT`; the explicit `--effort`
flag is now the only channel), so future ordinary-play AND postgame-analysis subprocesses are sanitized
(the learning agent's analysis call shared the same leak).

An earlier attempt at this grid was destroyed by a provider rate-limit
window (every CLI call erroring, LLM sides forfeiting in 7–8 plies);
those runs were quarantined as `*-invalid-ratelimited` and the driver
gained fail-closed infra guards (any `CLI_RESULT_ERROR` in events, or zero
claude output tokens, invalidates the run). All nine pairings below are
clean: zero `CLI_RESULT_ERROR` events.

## Results (W/L, median/p90 same-class regret, timeouts, illegal rate)

| model | vs level_1 | vs level_3 | vs level_5 |
|---|---|---|---|
| haiku  | 1W-1L · med 12.49 · p90 294 · TO 0 | 0W-2L · med 78.71 · p90 176 · TO 0 · ill 0.05 | 0W-2L · med 36.93 · p90 189 · TO 0 |
| sonnet | 1W-1L · med **0** · p90 128 | 1W-1L · med 6.87 · p90 197 · TO 5 | 0W-2L · med 18.53 · p90 210 |
| opus   | 1W-1L · med **0** · p90 100 · TO 4 | 0W-2L · med 9.72 · p90 102 · **TO 9** | 0W-2L · med 1.96 · p90 276 · **TO 11** |

(TO = forfeited turns, all of them 300 s turn-timeouts; illegal rate 0
unless shown. Categorical blunders: sonnet `chose_unsafe` 0.028/0.027 at
L3/L5; everything else 0.)

## Findings

1. **Preliminary discrimination signal — not yet a passed gate.** sonnet
   separates from haiku on both channels — W/L (1W-1L vs 0W-2L against
   level_3; at n=2 that is a one-game difference) and regret (lower median
   in every column, with no uncertainty treatment and opponent-correlated
   positions). The observed shape — level_1 competitive for all three
   models, level_3 splitting them, level_5 beating all three — is what a
   working difficulty ladder looks like, but §7's gate requires the
   prescribed 10–20 games per pairing with paired-uncertainty reporting
   before "the ladder brackets the model family" can be asserted.
2. **W/L and regret disagree about opus — and the disagreement is the
   finding.** Opus's board-level move quality is sonnet-class or better
   (median regret 0 / 9.7 / 2.0), but 24 of its turns timed out at 300 s
   and two of its six games were lost primarily on forfeits. Under a
   wall-clock protocol at high effort, opus is measured as *slower*, not
   *weaker* — exactly the §4-7 fairness point (thinking budgets should be
   token-denominated; wall clock recorded, not enforced). The v1 protocol
   decision on turn budgets must happen before the launch grid.
3. **Illegal-rate is near-saturated but not dead**: zero everywhere except
   haiku vs level_3 (0.05, all repaired on the corrective chance). For
   this model family the §2.3 learning-curve story runs primarily through
   regret; illegal-rate stays as a cheap floor check.
4. **Regret medians are opponent-conditioned**: haiku's median is *higher*
   vs level_3 (78.7) than vs level_5 (36.9) — different opponents induce
   different position distributions. Compare models within a column, not
   across columns; cross-column aggregation needs the stage-2 oracle work
   (position-stratified or book-anchored evaluation).
5. **Ops learnings encoded in the driver**: provider rate-limit windows can
   silently convert an LLM benchmark into a forfeit generator; the
   parallel driver now fail-closes on infra signatures, caps concurrency
   at 4 (memory ≈0.5 GB/CLI process on a 16 GB host; burst rate under a
   just-observed subscription limit), and validates + regret-analyzes every
   pairing before accepting it.

## Costs (this grid)

≈2.1 M claude output tokens across 20 valid LLM games (incl. smoke);
wall clock ≈3 h with 4-way pairing parallelism (games are turn-sequential
internally, so pairing-level parallelism is the ceiling). Regret analysis:
≈0.65 s/position offline, negligible next to game generation.

## What this unlocks / next decisions

- Stage 1–2 (per strategy §8): the regret oracle and event-log replay are
  live; the open protocol decision is the thinking budget (token-based vs
  wall-clock) and per-move regret's position stratification.
- Cross-provider row (codex-cli) was deliberately deferred; adding it is a
  driver config change, not new plumbing.
- All raw runs remain under `packages/cli/runs/pilot-v1-*` (gitignored);
  this document is the durable record. Reproduce lines are in the driver
  scripts (`runs/pilot-v1-driver.sh`, `runs/pilot-v1-parallel.sh`, also
  gitignored — the arena/regret commands and seeds are restated above).

## Addendum 2026-07-25 — token-envelope validation rerun (prompt generation p2)

Mechanical validation of the token-denominated envelope
(`docs/plans/2026-07-24-token-budget.md` §5): opus vs level_3 rerun under
the new defaults (budget 250k, backstop timeout 1200 s, sanitized effort,
`prompt_rev: p2-token-budget`). One game per orientation (the original
paired run was killed mid-game-001 by a host sleep; the partial game is
quarantined, and the second orientation was rerun as a separate seed).
Results are NOT comparable with the p1 grid above (different prompt
generation); only the mechanical facts are claimed:

| game (orientation) | result | opus admitted turns | budget-pass turns | exhaustion ply | TO | opus tokens_out | avg lat |
|---|---|---|---|---|---|---|---|
| seed 7001, opus=A | level_3 win (elim @56) | 28 | 0 | — | **0** | 249,519 / 250,000 (99.8%) | 117.2 s |
| seed 7002, opus=B | level_3 win (elim @31) | 15 | 0 | — | **0** | 219,124 / 250,000 (87.6%) | 189.1 s |

1. **Timeout forfeits are gone**: 0 in both games (the p1 pairing had 9).
   Opus now loses on the board, not on the clock.
2. **The budget did not fire** (0 auto-passed turns in either game) — per
   the pre-registered rule this **reconfirms 250k**, recorded in
   `docs/match-conduct-laplace-8x8-v1.md`. Honest margin note: consumption
   reached 99.8% / 87.6%, so 250k is the *effective binding scale* for an
   opus-class heavy thinker (~14.5k tokens/turn) — the value is neither
   loose nor yet observed to truncate games.
3. Disclosure/recording verified: `prompt_rev`, budget, and backstop
   timeout present in `game_start`/`run.json`; the observation carries
   `output_token_budget` / `output_tokens_used` (test-pinned).
