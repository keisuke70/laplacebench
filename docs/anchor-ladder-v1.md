# Anchor ladder v1

`benchmark-strategy-ja.md` section 2.2 calls for a fixed baseline ladder
(originally sketched as `random -> greedy -> minimax d2 -> d4 -> d6`) mixed
permanently into future Bradley-Terry/Elo ratings, so the scale stays
comparable across seasons even as the actively-rated models change. This
document is the first real run of that ladder against `laplace-8x8-v1`,
using only baselines already implemented in `packages/cli/src/agents/`
(`random`, `greedy`, `center-greedy`, `takeshi:dN`) — no LLM calls, no
external cost.

## The d4/d6 depths in the original sketch are not usable as written

Before running games, a direct timing check
(`TakeshiPolicy.getBestMove` on the opening position, single-worker, same
host) measured the cost of one root move by search depth:

| depth | first-move time |
|---|---|
| 1 | 0.07 s |
| 2 | 2.2 s |
| 3 | 18.5 s |
| 4 | 266.6 s (4.4 min) |

Growth is roughly 8-14x per additional ply — steeper than typical alpha-beta
because `TakeshiPolicy` (`packages/engine/src/core/TakeshiPolicy.ts`) is the
old, frozen, unoptimized policy this benchmark deliberately keeps verbatim
(see the README's "difference from takeshi" note); it is not the product's
current Python search. At this cost, `takeshi:d4` alone would put a single
move over four minutes and a full game potentially over an hour — not
repeatable for a ladder meant to be re-run routinely. `d6` is not evaluated
further; the trend makes it clearly infeasible on this policy.

The ladder below therefore stops at `takeshi:d3`, run with a reduced sample
and a lower ply cap, and documents that limit rather than silently omitting
it. If a genuinely faster search ever exists for a *product* CPU baseline
(the product repository's own CPU-strengthening work targets exactly this),
re-evaluating deeper anchors becomes worth revisiting then — see
[`product-cpu-adapter-v1-spec.md`](product-cpu-adapter-v1-spec.md).

## Results

Each tier is an adjacent side-swapped pair (matching `design-v0.1.md`
section 3.3's fairness unit), not a full round robin — the goal is a
monotonic ordering proof for the ladder, not a rating estimate. `seed`
values are recorded so every game is exactly reproducible.

| pairing | games | result | notes |
|---|---|---|---|
| `random` vs `greedy` | 4 (2 paired seeds) | greedy 4W-0L | seed 1001, default 300-ply cap |
| `greedy` vs `center-greedy` | 4 (2 paired seeds) | center-greedy 3W-1L, all 3 wins by center | seed 1002, default 300-ply cap |
| `center-greedy` vs `takeshi:d1` | 4 (2 paired seeds) | takeshi:d1 4W-0L, all by elimination | seed 1003, default 300-ply cap |
| `takeshi:d1` vs `takeshi:d2` | 4 (2 paired seeds) | takeshi:d2 4W-0L, all by elimination | seed 1004, 150-ply cap, ~3m15s wall clock for all 4 games |
| `takeshi:d2` vs `takeshi:d3` | 2 (1 paired seed) | **inconclusive: d2 1W-1D, d3 0W-1D-1L** | seed 1005, 60-ply cap, ~13m24s wall clock for both games |

`takeshi:d2` vs `takeshi:d3` detail: game-000 (A=d2, B=d3) was won by **d2**
by elimination at ply 59; game-001 (A=d3, B=d2) hit the 60-ply cap and ended
in a horizon draw. Unlike every shallower tier, this pairing did **not**
order monotonically in favor of the deeper search within this sample.

This is exactly the "tied or within one game-equivalent of 50%" situation
the product repository's own CPU-strengthening plan treats as a trigger to
add more seeds, not to declare an outcome — the honest read here is
**inconclusive**, not "d3 is not stronger than d2." Plausible causes, none
disambiguated by n=2:

- the 60-ply cap (kept low specifically because of d3's per-move cost) may
  cut games short before a deeper search's positional edge cashes in —
  the drawn game never reached a decision;
- real variance at n=2, the smallest possible non-degenerate sample;
- at these still-shallow depths, `TakeshiPolicy`'s static evaluation
  weights (section not re-tuned here) may dominate over the small extra
  lookahead more than expected.

Resolving this would need either a higher ply cap (in tension with the
measured d3 move cost above) or more paired seeds at the current cap — both
are cheap to add later; not done here to keep this slice's total wall clock
bounded, matching the same reduced-sample discipline used to decide the
d3 cutoff in the first place.

Every tier below `takeshi:d2` vs `takeshi:d3` orders monotonically in the
expected direction (`center-greedy` beats `greedy` specifically by
contesting the center route, `greedy` has no center term at all so this is
the expected mechanism, not just a strength gap). That, plus the d2-vs-d3
result actually being interesting rather than a flat tie, is a useful
sanity result on its own: the ladder is discriminating, not flat, which is
the precondition `benchmark-strategy-ja.md` section 7's cheap pilot exists
to check before investing in anything larger.

## Reproduce

```bash
cd packages/cli
npx tsx src/cli.ts arena --team-a random        --team-b greedy       --games 4 --swap --seed 1001 --run-id anchor-v1-random-vs-greedy
npx tsx src/cli.ts arena --team-a greedy        --team-b center-greedy --games 4 --swap --seed 1002 --run-id anchor-v1-greedy-vs-centergreedy
npx tsx src/cli.ts arena --team-a center-greedy --team-b takeshi:d1    --games 4 --swap --seed 1003 --run-id anchor-v1-centergreedy-vs-takeshi-d1
npx tsx src/cli.ts arena --team-a takeshi:d1    --team-b takeshi:d2    --games 4 --swap --seed 1004 --max-plies 150 --run-id anchor-v1-takeshi-d1-vs-d2
npx tsx src/cli.ts arena --team-a takeshi:d2    --team-b takeshi:d3    --games 2 --swap --seed 1005 --max-plies 60  --run-id anchor-v1-takeshi-d2-vs-d3
```

`runs/` is gitignored (matching every other run in this repository); this
document, not the raw run directories, is the durable record. Re-run and
diff against the table above if `TakeshiPolicy` or the engine ever changes
in a way that should be behavior-preserving.

## What this ladder is not yet

- Not an Elo/Bradley-Terry fit — that requires the full ladder mixed into
  real model ratings (deferred to when Arena runs against LLMs use it).
- Not a claim that `takeshi:d3` is "the" strong baseline — it is simply the
  deepest tier that stays repeatable on the frozen policy's current cost.
- Not wired into the CLI as a preset yet; the commands above are the
  citable definition until/unless a `laplacebench ladder` subcommand is
  worth adding.

## Follow-up 2026-07-24: d2-vs-d3 re-measured at the canonical cap — open item closed

Re-run of the inconclusive pairing under the now-frozen match conduct
(`docs/match-conduct-laplace-8x8-v1.md`, max_plies=100, repetition rule),
same seed 1005:

| pairing | games | result |
|---|---|---|
| `takeshi:d2` vs `takeshi:d3` | 2 (1 paired seed) | d2 1W-1D — **identical shape to the original** (d2 won by elimination at ply 59; the other game drew at the horizon, now 100 instead of 60) |

The "60-ply cap cut the deeper search's edge short" explanation is not
supported for this paired seed: at the canonical cap the outcome shape was
unchanged. (One seed cannot reject cap effects in general; what remains is
either real variance at n=2 or `TakeshiPolicy`'s static evaluation
dominating shallow depth gains.)
This item is now **closed without further sampling**, deliberately:
[`anchor-ladder-v2.md`](anchor-ladder-v2.md) shows the entire product
cpu-v4 ladder — including its weakest tier — beats `takeshi:d2` by early
center rush, so the takeshi ladder serves as a floor anchor only, and
resolving d2-vs-d3 to statistical significance would purchase no
discriminating power the benchmark actually uses.
