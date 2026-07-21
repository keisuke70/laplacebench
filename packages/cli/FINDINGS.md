# Pilot findings

Running log of what the discrimination pilot has told us. Newest first.

## Run 7 — learning-vs-cold (fable@low, 4 games): modest edge, rich failure modes

`runs/fable-low-learn-vs-cold/`. Both sides claude-fable-5@low. The only
variable: the learn side gets a post-game analysis pass (same model, same
effort) that reads the referee's ground-truth record and maintains a
format-constrained strategy document, injected at the next game's start.

**Score: learn 2W-1D-1L** (game 0: center win as A, 69 plies, captures 6-2;
game 1: center win as B in 18 plies; game 2: 80-ply horizon draw; game 3:
LOST to the cold side's center rush as B, 23 plies). Decisive games 2-1.
n=4 — suggestive, not conclusive. Protocol note: 190 turns at LOW effort,
zero illegal moves from either side.

**The strategy corpus is the real result** (learn/strategy-after-game-*.md,
817→1125 words). Genuine rule extraction through play, with evidence tags:

- After a failed capture attempt it wrote: "mixed-color flanks do not
  capture — build a SAME-COLOR sandwich" (a real rule it wasn't told
  explicitly in that form, learned from one failed attempt).
- Correct meta-lessons: "a vacated center cell is a free win condition";
  "held 3/4 center for 38 plies and drew — every move must progress the
  eviction".

**Two identified failure modes of naive accumulation** (the interesting
part):

1. **Seat-scrambled opponent model.** Games alternate seats, and the notes
   say "Team B opens Blue (3,7)->(3,4)..." — written when the opponent was
   Team B. In game 3 the LEARN side played Team B, so its own opponent-
   modeling section described itself and said nothing about the actual
   opponent. Naive seat-labeled notes break under side-swapping; the memo
   format needs seat-invariant language ("the opponent", "we"). This is a
   harness-design lesson, not a model lesson — exactly the Division-3
   thesis that memo format is a competitive variable.
2. **Attack-biased distillation.** The center section accumulated eviction/
   conversion rules from long games but no defensive rule for "opponent
   rushes center from move 1" — and game 3 was lost to precisely that,
   while the learn side developed flank pieces. Wins teach attack; losses
   must be force-distilled into defense.

**Latency observation worth chasing:** learn averaged 62s/turn vs cold's
82s/turn — the side WITH strategy notes thought ~24% faster while scoring
better. Hypothesis: injected strategy substitutes for in-context
re-derivation. Cheap to test at larger n.

## PILOT VERDICT (after Runs 1-6): Laplace discriminates frontier models

The Phase-0.5 question — "does Laplace separate frontier models at all?" —
is answered **yes**, on three independent axes, with a consistent picture:

| agent (@medium, subscription CLI) | head-to-head | vs center-greedy | errors |
|---|---|---|---|
| claude-fable-5 | 2-0 vs codex (elim + center, both seats) | 1-0 (center, 21 plies, 0 pieces lost) | **0 in 43 turns** |
| gpt-5.6-sol | 0-2 | 1-0 (center, 23 plies, 2 lost, 1 forfeited turn) | every game: 0.10-0.17 illegal/turn |

1. **W/L**: Fable swept the side-swapped pair, winning by both victory
   routes; both LLMs beat the center-aware baseline, which splits with the
   product minimax. Clean ladder: Fable > codex > center-greedy ~ takeshi >
   greedy > random.
2. **Piece economy**: pair aggregate 10-3 captures for Fable; vs baseline,
   Fable conceded 0, codex conceded 2.
3. **Error rates** (independent of W/L): Fable zero across all games;
   codex shows a persistent signature — board-state drift after captures
   (E_NO_PIECE_AT_FROM on just-captured pieces), occasional format lapses,
   one fully forfeited turn. The per-turn failure metrics separate models
   even in games codex wins.

Qualitative capabilities actually observed in play: novel-rule acquisition
from a cold rulebook (zero legal-move hints), two-color coordination,
mixed-line double captures (both models), pre-staged multi-move tactics and
dual-purpose moves (Fable), correct Void handling, both victory routes.

Also validated along the way: center defense neutralizes the center rush
(game balance holds when both sides know the rule); the referee handles
elimination/Void/center correctly in real games; the subscription-CLI
harness is viable (wall-clock ~40-75s/turn at medium, ~$0 marginal cost);
raw-reply auditing is essential (Run 2's harness bugs masqueraded as model
failure).

Caveats for anything public: n is tiny (1 pair + 2 calibration games);
subscription CLIs inject their own system prompts (label as a distinct
condition; API track exists for clean runs); codex ran with the user's
`model_instructions_file` present; per-move regret not yet measured.

## Run 6 — fable@medium vs center-greedy: calibration closed

`runs/fable-vs-centergreedy/`. **Fable won by center in 21 plies, captures
3-0, zero pieces lost, zero errors** (~62s/turn). Where codex needed 23
plies and conceded 2 pieces plus a forfeited turn against the same
opponent, Fable gave up nothing. Calibration ladder complete — see verdict
above.

## Run 5 — codex@medium vs center-greedy: ladder holds, error signature persists

`runs/codex56-vs-centergreedy/`. **Codex won by center occupation in 23
plies** (captures 3-1) — so the ladder ordering holds: frontier LLMs >
center-greedy (which itself splits 2-2 with takeshi). The baseline can't
match multi-move center planning; codex assembled the 4-cell occupation
against active center defense.

But codex's error signature repeated: ply 14 format failure then
E_NO_PIECE_AT_FROM on the repair -> forfeited the turn entirely; ply 18
E_DEST_OCCUPIED (recovered). That's 0.167 illegal/turn and 1 failed turn
in a *won* game — codex wins through its errors, but errors recur in every
codex game so far (state drift + occasional format lapses), while Fable has
zero errors in 32 turns. Per-turn error rate is discriminating models
independently of W/L, exactly as the metric design hoped.

Ladder so far (all @medium, subscription CLIs):
Fable 5 (2-0 vs codex, 0 errors) > codex gpt-5.6-sol (1-0 vs center-greedy,
errors every game) > center-greedy (2-2 with takeshi) ~ takeshi > greedy >
random.

## Run 4 — return game (sides swapped): Fable sweeps the pair 2-0

`runs/fable-vs-codex56-medium-swap/`. Codex first-moving (Team A), Fable
second (Team B). **Fable won by CENTER occupation in 20 plies** — so the
pair ends 2-0 Fable, one win by each victory route, from both seats.
First-move advantage does not explain the result.

The finish was the strongest sequence seen yet. Fable (B) set an anchor at
(2,3) on ply 3, then ply 7 Green (5,0)->(5,3) double-captured the mixed line
Red@(4,3)+Yellow@(3,3) against that anchor — the same mixed-line trick Codex
found in game 1, but *pre-staged two moves earlier*. Ply 17 Blue
(4,5)->(4,4) was dual-purpose: captured Yellow@(5,4) (third loss ->
Yellow eliminated) AND placed Blue on center cell (4,4). Ply 19 Green
(2,3)->(3,3) completed (3,3)(3,4)(4,3)(4,4) for the center win — the
eventual center squares were assembled via capture threats, not a rush.

**First genuine state-tracking failure captured:** ply 8, Codex attempted
to move a piece that had just been captured on the previous ply
(E_NO_PIECE_AT_FROM) — exactly the failure mode the benchmark is designed
to expose (board-state drift after an opponent's capture). It recovered on
its single repair attempt. Codex: illegal_rate 0.1/turn this game.

Pair aggregate (both games): Fable captured 10 pieces and lost 3; Codex
captured 3 and lost 10. Fable: 0 illegal / 0 format failures in 32 turns.
Codex: 1 illegal (recovered) in 31 turns. Lengths 43 and 20 plies — real
games, not rushes.

Reading: at medium effort, this matchup discriminates clearly — the
stronger-looking play (piece safety, pre-staged multi-move tactics, dual-
purpose moves, exploiting both victory routes) belongs to the same side
that wins, from either seat. Still n=1 pair; a small series would firm it
up, and both models still need calibration vs `center-greedy`.

## Run 3 — claude-fable-5@medium vs gpt-5.6-sol@medium (first real match)

`runs/fable-vs-codex56-medium/`. Both sides subscription CLIs, effort=medium.

**Result: Fable 5 won by team elimination in 43 plies.** Captures 6-2 in
Fable's favor; final losses Red 1 / Yellow 1 vs Blue 3 / Green 3. Zero
illegal moves and zero format failures on BOTH sides across 43 turns.

Game arc — the first full-spectrum LAPLACE game we've seen:

- **Center rush neutralized by contest.** Red opened to (3,3); Codex's Blue
  immediately contested (3,7)->(3,4) on ply 1. The center changed hands
  through plies 4-17 and nobody completed the 4-cell occupation. When both
  sides know the center rule, the rush is not dominant — first positive
  evidence on the game-balance question from Runs 1-2.
- **Both models executed real sandwich tactics.** Fable: repeated
  coordinated captures using same-color anchor pairs (plies 4, 12, 26, 32,
  34, 42). Codex ply 17 was the most sophisticated single move of the game:
  Blue (2,5)->(2,3) captured Red@(3,3) AND Yellow@(4,3) in one line — the
  mixed-color multi-piece sandwich rule, found unprompted.
- **Fable converted material into the elimination route:** third Blue loss
  at ply 32 (Blue -> Void), third Green loss at ply 42 -> both enemy colors
  eliminated. Codex correctly kept playing its Void Blue pieces after
  elimination (plies 33/37/41) — no rule confusion on either side.
- Fable's only losses were the ply-17 double capture; it gave up nothing
  else in 22 turns.

Cost/latency (subscription, so wall-clock is the real constraint):
- Fable: 22 turns, ~75s/turn avg, 114k output tokens, 1.85M cache-read.
- Codex: 21 turns, ~41s/turn avg, 225k output tokens, ~5.1M cached input.
- Whole game ~42 minutes.

Interpretation: one game is an anecdote, not a rating — but the pilot's
core question ("does Laplace discriminate?") is trending yes: a capable
model pair produces a long, legal, tactically rich game with a clear
winner, and the visible quality gap (capture ratio, piece safety) matches
the result. Protocol adherence at medium effort is a solved problem for
both vendors' frontier CLIs.

Next measurements that matter: the side-swapped return game (was Team A /
first-move an advantage?), a small series for W/L stability, and each model
vs `center-greedy` to calibrate against the baseline ladder.

## Run 2 — claude-cli:sonnet vs codex-cli (first attempt, then fixed)

`runs/llm-vs-llm-1/` (first attempt). Sonnet "won" by center in 7 plies —
but only because **codex forfeited all 3 of its turns**. Digging into the raw
replies separated two causes, which is the point of running a pilot:

**Harness bug (mine, not the model):** codex's first call hung on
`Reading additional input from stdin...` — the adapter left the child's stdin
pipe open, and `codex exec` waits on it. Fixed by always closing stdin.

**Overly strict parsing (mine):** codex replied with `{"action":"move",
"from":[4,0],"to":[4,4]}` — array coordinates, which the parser rejected. But
`[row,col]` arrays were the *original* schema shape (`schemas/`); rejecting
them was my bug, not codex's. Now accepted.

**Genuine model signal:** codex also emitted chess algebraic notation
(`{"move":"e2e4"}`, `"a4e4"`, `"h4e4"`) — it partly models the board as chess.
Using notation the game never defines is a real failure to adopt the
coordinate system — one of the six target capabilities ("reliable structured
action"). We still reject chess notation; the one repair attempt now re-shows
the exact `{row,col}` schema, which is the fair remedy.

**Methodology note:** a harness bug and overly strict I/O both masquerade as a
model failure. The first game looked like "codex can't play"; it was mostly
"my adapter can't read codex." Any published number must survive this kind of
raw-reply audit — which is why the benchmark stores every raw reply.

After the fixes, a codex-vs-takeshi smoke (`runs/smoke-codex/`) showed codex
playing with **zero failures** — and, like Sonnet, immediately rushing the
center (Red→(3,3), Yellow→(4,3), Red→(3,4) in its first three moves). So both
frontier models independently discover the center-rush. The fair head-to-head
(`runs/llm-vs-llm-2/`) is running.

## Baseline addition — `center-greedy`

Built a one-ply greedy that values center occupation alongside material
(`agents/centergreedy.ts`), to fix takeshi's center-blindness (Run 1). Check
vs plain takeshi, 4 games side-swapped: **2W-2L each**. center-greedy's wins
are both by center (13, 8 plies); takeshi's are both by elimination (22, 43).
So it genuinely contests and defends the center while staying roughly balanced
with material-only minimax — a valid opponent for testing whether a model can
take the center against real defense. Side note: even a 1-ply center-aware
player wins by center in 8–13 plies, reinforcing that the center route is fast
and rushable (open game-balance question, not yet a verdict).

## Run 1 — claude-cli:sonnet (Team A) vs takeshi:d2 (Team B)

`runs/validate-claude-cli/`. 1 game, JSON observations, subscription-driven
Claude Code CLI as the model. Seed 42, max-plies 60.

**Result: Sonnet won by center occupation in 11 plies. 6 moves, 0 illegal,
0 format failures.**

Full game:

```
ply  0    Red: [0,3] -> [4,3]     (center 4,3)
ply  2 Yellow: [7,4] -> [4,4]     (center 4,4)
ply  4    Red: [0,4] -> [3,4]     (center 3,4)
ply  6 Yellow: [7,2] -> [3,2]     (staging)
ply 10 Yellow: [3,2] -> [3,3]     (center 3,3) -> WIN
```

Red holds (4,3)+(3,4); Yellow holds (4,4)+(3,3). Team A occupied all four
center cells using **both colors in coordination** — exactly the two-armies-
one-mind capability the benchmark targets. Referee detected the center win
correctly.

### What works

- **Subscription-driven pipeline is sound.** Claude Code CLI as a persistent-
  session subprocess: rulebook in first message, `--session-id`/`--resume`
  for continuity, tools disabled. Zero API key, zero per-token billing.
- **Sonnet learned the rules cold.** No legal-move list, novel rulebook, and
  it produced 6 legal rook-moves and a valid win plan with no rule errors.
- **Prompt caching pays off.** 205,735 cache-read tokens across 6 turns vs 12
  uncached input tokens — the append-only-transcript design keeps per-turn
  input almost entirely cached.
- **Cost/latency:** ~35s per Sonnet turn (212s for 6 turns). Center-rush wins
  are short; expect full strategic games to run much longer. Wall-clock, not
  dollars, is the constraint under a subscription.

### The load-bearing caveat: takeshi is blind to the center

TakeshiPolicy's evaluation (`TakeshiPolicy.ts:17` weights) scores only
`teamPieces`, `deathRisk`, `immediateThreat`, `immediateCapture`, `mobility`.
**There is no center-control term.** So minimax literally cannot see the
center-victory threat: through the whole game Blue/Green wandered on material
heuristics while Team A stacked the center unopposed.

Consequences:

1. **takeshi is not a valid baseline for the center-victory route.** Against
   it, "rush the center" is a free win for any model that notices the center
   rule. This game measures "did the model spot and execute the center rush,"
   not deep strategy. Sonnet passed that bar cleanly; it does not yet tell us
   how Sonnet fares against competent center defense.
2. This concretely validates design-v0.1 §13: minimax must not define good
   play, and its evaluation needs review before it anchors anything.
3. **Possible game-balance issue:** an 11-ply center rush may be a dominant
   opening even against real defense. Unknown until tested against an opponent
   that defends the center. Flag, don't conclude.

### Immediate next steps

- LLM vs LLM (claude-cli vs codex-cli): both understand the center rule, so
  it won't be a trivial rush — first real strategic/discrimination signal.
  (Running.)
- Give the baseline a center term (benchmark-side, not by mutating the product
  minimax) so there is an opponent that actually defends the center.
- Only then is "does center-rush beat competent defense" answerable.
