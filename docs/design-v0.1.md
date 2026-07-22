# LaplaceBench design v0.1

## 1. Goal

Build a benchmark in which a model must learn an unfamiliar board game from a
provided rulebook, retain a private game-long context, and then demonstrate:

- exact rule following;
- two-dimensional state tracking;
- tactical calculation;
- longer-horizon planning;
- coordinated control of two allied colors;
- reliable structured action;
- robust board understanding from images.

Laplace is especially useful because the board is fully observable while the
four alternating colors, same-color capture rule, friendly fire, Void pieces,
and two different victory routes create errors that are easy to diagnose.

The base comparison is model-versus-model rather than four independent agents.
Model A controls both Red and Yellow; Model B controls both Blue and Green. The
underlying Red, Blue, Yellow, Green turn order remains unchanged. Each model
therefore acts twice per four plies and must coordinate two allied armies whose
pieces contribute jointly to victory but cannot form a mixed-color sandwich.

## 2. Main design decision: persistent agents, image input, protocol action

### Why the model should not operate the browser

A browser-operated match mixes at least four capabilities:

1. reading the board image;
2. finding and clicking the right cell;
3. remembering the rules and history;
4. choosing a strong move.

It also introduces animation timing, viewport size, click coordinates, network
latency, and UI regressions. A loss would not tell us whether the model reasoned
poorly or merely missed a click. The browser may render and replay a match for a
human, but it is never the model's action channel.

### Architecture

```text
                 +--------------------------+
                 | deterministic referee    |
                 | rules, moves, scoring    |
                 +------------+-------------+
                              |
            +-------------+----------------+
            |                              |
       PNG renderer                 JSON state adapter
    primary observation             diagnostic track
            |
      human replay UI

    Model A persistent context       Model B persistent context
        Red + Yellow                     Blue + Green
            |                              |
            +------ structured move -------+
```

Every observation consumes the same immutable state and move log. Only the
referee may mutate the state. A model returns coordinates through a tool call or
validated JSON, never screen coordinates or clicks.

The primary observation is a canonical rendered image containing the 8x8 board,
coordinate labels, current color, capture counts, Void status, and last-move
highlight. A paired structured-state track uses the same positions to separate
visual-reading errors from strategic errors.

## 3. Benchmark suites

### 3.1 RuleGym

Small, objective tests of one concept at a time:

- legal rook-like movement and blocked paths;
- same-color sandwich versus teammate endpoints;
- voluntary entry into a sandwich being safe;
- multi-piece sandwich and friendly fire;
- edge, corner, and group enclosure;
- Void movement and inability to capture;
- elimination threshold and Void conversion;
- center occupation and team identity;
- correct turn after elimination or a missing color.

RuleGym should report both answer accuracy and the model's confusion matrix by
rule concept. These cases test whether the rulebook was understood, not game
strength.

### 3.2 Tactics

Positions with engine-verifiable labels:

- capture-in-1;
- avoid-elimination-in-1;
- win-center-in-1;
- prevent-center-loss-in-1;
- forced win in a bounded horizon;
- choose among moves with different minimax/team values.

For positions without a proven solution, do not call one human choice
“optimal.” Score regret against a versioned search baseline and label the
position `estimated`, not `proven`.

### 3.3 Arena

Complete games with one model per team. A balanced evaluation unit is a
side-swapped pair rather than one game:

- game 1 assigns Model X to the first-moving Red + Yellow team;
- game 2 assigns Model Y to that team and Model X to Blue + Green;
- pair every start with board symmetries where valid;
- keep sampling settings and budgets equal;
- use deterministic seeds and save every prompt/response/event.

One pair is the minimum fairness unit, not a sufficient sample. Published
comparisons should use multiple pairs and estimate first-team advantage rather
than assuming the side swap removes all variance.

Primary outputs are win/draw/loss, rating with uncertainty, illegal-move rate,
and win reason. Report cost and latency beside strength, not folded invisibly
into one score.

### 3.4 Persistent Context Lab

The benchmark's base condition is persistent, because the target capability is
human-like accumulation of plans across a match. Each team receives one isolated
context that is resumed for both of its colors. Use these conditions:

1. `persistent-native`: each team uses its provider's native conversation or
   response continuation for the whole game;
2. `persistent-transcript`: the runner explicitly replays the observable private
   transcript when native continuation is unavailable;
3. `persistent-agent`: the adapter may manage provider-native reasoning,
   assistant text, tools, and other private state under a declared resource
   budget. No common thought format is imposed.

In all three, each team has one private context lasting the whole game. Red and
Yellow use Team A's context, while Blue and Green use Team B's.

The benchmark standardizes the resource envelope and observable move protocol,
not the contents of thought. It records declared context/token limits, provider
reasoning settings, compaction events, and observable responses. It does not
require a chain-of-thought field or grade private reasoning text.

A fourth condition, `public-dialogue`, lets the acting model emit a short message
that the referee shows to both opponents. This measures persuasion, signaling,
and resistance to distraction rather than pure board strength, so its results
must remain separate.

The two opponents must never be placed in one shared private context for scored
games. That leaks both strategies to the same inference process and can cause
role confusion. Even when a model plays against another instance of itself,
create two isolated contexts, one per team.

### 3.5 Vision and structured-state diagnosis

The canonical Vision track uses engine-rendered PNGs rather than browser
screenshots, so pixels are reproducible. The board has coordinate labels and a
status panel, and the model returns logical board coordinates. Controlled visual
variants such as piece shapes, themes, rotation, and mild noise belong in
robustness suites rather than the base leaderboard.

The structured-state track runs matched games and positions with JSON or ASCII
observations. It is diagnostic, not a replacement for the human-like visual
track. A large Vision-to-State gap identifies perception/grounding weakness;
similar results with poor play identify strategic weakness.

## 4. Rule learning experiments

The unfamiliarity of Laplace is an advantage. Run the same cases under distinct
prompt conditions:

- `full-once`: the primary condition; rulebook supplied when the persistent game
  context is created;
- `reference-card`: a compact rule card remains available on later turns;
- `legal-list`: legal moves supplied by the referee;
- `state-only`: no legal move list;
- `distractor`: plausible but false chess/Hasami assumptions are mentioned and
  the model must follow the authoritative Laplace rulebook.

Scores from these conditions must never be merged without labels. Supplying a
legal move list removes a substantial part of the rules-and-spatial task.

## 5. Model protocol

The transport is independent of any provider. A request includes:

- protocol and ruleset versions;
- run, game, and request identifiers;
- acting color, controlled team colors, and public state;
- observation mode and rule-delivery condition;
- optional legal moves;
- response deadline and output schema.

A normalized response includes one coordinate move and, only in the dialogue
variant, an optional public message. The adapter may keep arbitrary private
assistant output or provider-native reasoning in its isolated persistent state;
that private material is not part of the referee action schema.

No benchmark requires or grades private chain of thought. Provider adapters may
use native structured-output features, but the stored normalized response must
validate against the same schema.

See `schemas/agent-request.schema.json` and
`schemas/agent-response.schema.json`.

## 6. Failure policy

Model failures are benchmark results, not referee exceptions.

| Failure | Referee behavior | Recorded metric |
|---|---|---|
| Non-JSON or schema mismatch | One schema-only repair request | format failure |
| Illegal move | No strategic hint; one retry with error code | legality failure |
| Second invalid response | Pass the turn | failed turn |
| Provider timeout/error | Configurable retry, then pass | availability failure |
| Repeated position | Draw after versioned repetition rule | repetition draw |
| Maximum plies | Draw | horizon draw |

The repair prompt must not reveal legal moves unless the track already supplies
them.

## 7. Metrics

### Objective metrics

- schema-valid response rate;
- legal move rate before and after repair;
- per-rule RuleGym accuracy;
- exact tactic success rate;
- Arena W/D/L and rating interval;
- center-win versus elimination-win rate;
- friendly-fire and self-blunder rate;
- timeouts/provider failures;
- median and tail latency;
- normalized provider-reported input/output/cache/reasoning usage with
  reporting coverage and application I/O bytes (cross-provider totals remain
  descriptive; see [usage semantics](usage-semantics.md));
- deterministic replay verification rate.

### Derived diagnostics

- structured-state-to-vision gap for identical positions;
- state-only versus legal-list gap;
- reference-card versus full-once retention gap;
- native versus transcript-managed persistence;
- no-dialogue versus public-dialogue change;
- seat/color advantage;
- performance by game phase and branching factor.

Avoid a single opaque 0-100 score in the raw results. A leaderboard may show a
small dashboard, but it must preserve these dimensions and uncertainty.

## 8. Dataset integrity and contamination resistance

- Generate many positions from legal engine trajectories.
- Use board symmetries and color/team-preserving permutations.
- Keep a private held-out set for leaderboard verification.
- Publish generators and public examples, not every scored position.
- Hash every case, rulebook, prompt template, renderer, and engine build.
- Reject impossible states unless a suite intentionally tests state validation.
- Record whether a tactical label is proven, search-estimated, or human-reviewed.

## 9. Reproducibility manifest

Every run should contain:

```text
run.json                 resolved configuration and hashes
games/<id>/events.jsonl  immutable referee event stream
games/<id>/responses/    raw and normalized model responses
games/<id>/final.json    outcome and metrics
summary.json             aggregate statistics and uncertainty
```

At minimum `run.json` records the model's resolved provider ID, parameters,
token budget, prompt template hash, ruleset hash, engine commit, seed, host
version, and timestamps.

## 10. Rule freeze required before model testing

The product repository currently contains prose and implementations that must be
reconciled before they can define benchmark ground truth. Examples include:

- (resolved 2026-07-20) elimination occurs after three captured pieces on
  every board size; the engines previously derived the threshold as
  `boardSize - 5` and the TypeScript, Python, and Android implementations
  have been updated to the fixed value 3;
- older AI code supports several board sizes, while the product currently
  presents 8x8 as canonical;
- the existing benchmark draft contains color/order examples that do not all
  match the product rule text;
- the product and Python AI environment need differential tests for capture,
  Void, center, and turn behavior.

For v0.1, freeze the existing 8x8 product behavior under the immutable ID
`laplace-8x8-v1`. Create conformance fixtures for every edge rule and execute
them against both the benchmark referee and the product engine. A later rule
change becomes `laplace-8x8-v2`; old run results remain interpretable.

## 11. First implementation slices

### Slice A — executable rules and replay

- define canonical state and event schemas;
- wrap or port the product engine behind a pure referee API;
- write cross-engine conformance fixtures;
- add JSONL replay and deterministic replay verification;
- adapt the existing minimax CPU plus random and greedy agents for end-to-end
  tests.

### Slice B — Core and Tactics

- hand-author edge cases;
- generate legal distractor positions;
- add symmetry-based metamorphic tests;
- add exact scoring and per-concept reports.

### Slice C — persistent LLM adapters and Arena

- define `start_game`, `act`, and `end_game` adapter lifecycle methods;
- preserve one isolated native context per team across Red/Yellow or Blue/Green
  turns;
- add provider adapters without embedding secrets in run files;
- add prompt variants, budgets, repair behavior, and balanced schedules;
- produce a local HTML replay/leaderboard report.

### Slice D — Vision and replay viewer

- render controlled images from state;
- run paired text/vision cases;
- connect the existing Laplace web client to saved referee games for human
  viewing; models continue to submit coordinate moves through the protocol.

## 12. Decisions intentionally deferred

- the public leaderboard's exact rating algorithm;
- whether public dialogue uses natural language or a small intent vocabulary;
- the provider list and model-specific tool-call integration;
- maximum plies and repetition count;
- whether benchmark releases include 7x7/9x9 variants;
- the search method used to certify deeper tactical positions.

## 13. Existing minimax CPU

The product repository already contains a team-aware minimax implementation in
`ai/src/agents/minimax.py`. It is useful in four roles:

1. a deterministic opponent for early LLM matches;
2. a strength baseline below or beside the model leaderboard;
3. a search estimate for the value/regret of an LLM move;
4. a generator for tactically interesting candidate positions.

Minimax must not automatically become the rules oracle or the definition of an
optimal move. Its transition logic needs differential conformance tests against
the canonical TypeScript product engine, especially for enclosure, Void pieces,
elimination, center victory, and turn advancement. The referee remains the rules
authority; minimax is a versioned policy baseline.

These decisions do not block the engine and conformance slice.
