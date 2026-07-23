# LaplaceBench

**An open arena where language models — and the agent harnesses people build
around them — compete at a board game nobody knows.**

LAPLACE is a novel 8x8, four-color, 2-vs-2 strategy game (rook movement,
sandwich/enclosure captures, Void pieces, two victory routes). Because it is
absent from training data, a match measures what we actually care about:
learning unfamiliar rules cold, tracking a full board over a long game,
coordinating two allied armies with one mind, accumulating strategy across
turns and games, and returning reliable structured actions — with a
deterministic referee deciding everything.

One model controls Red+Yellow, the other Blue+Green: the native 2v2 game
becomes a clean model-vs-model duel. Models never click a browser; they read
an observation and return coordinates. Humans get the browser: every game
exports (replay-verified) into a spectator web UI with the product board,
animations, and per-model reliability stats.

## What exists today

- **Deterministic referee** — the frozen product engine
  ([`laplace-engine`](packages/engine)); package version = immutable ruleset
  ID (`laplace-8x8-v1`). Zero runtime deps.
- **CLI** ([`packages/cli`](packages/cli)) — full matches with a baseline
  ladder (`random`, `greedy`, `center-greedy`, minimax `takeshi`),
  persistent-context LLM adapters, side-swapped schedules, JSONL event logs,
  and replay-verified export to the spectator UI.
- **Subscription-driven play**: adapters that drive the Claude Code CLI
  (`claude-cli:<model>@<effort>`) and Codex CLI (`codex-cli:...`) — if you
  already pay for Claude or ChatGPT, you can run frontier-model matches with
  **no API key and no per-token cost**. A clean Anthropic API adapter
  (`anthropic:<model>`) exists for verified runs.
- **Learning series**: a post-game analysis skill that audits losses and
  missed captures from the referee's ground-truth record and maintains a
  format-constrained strategy document injected into the next game —
  measuring accumulation ability separately from cold-start strength
  (see [FINDINGS](packages/cli/FINDINGS.md)).

## Quickstart

No clone, no install, no API key:

```bash
# watch the baseline ladder fight (no LLM needed)
npx laplacebench arena --team-a takeshi --team-b center-greedy --games 2 --swap

# with a Claude subscription (Claude Code CLI installed & logged in)
npx laplacebench arena --team-a claude-cli:sonnet@low --team-b takeshi --games 2 --swap

# frontier vs frontier on your own subscriptions
npx laplacebench arena \
  --team-a claude-cli:claude-fable-5@medium --team-b codex-cli:gpt-5.6-sol@medium \
  --games 2 --swap

# learning-vs-cold: same model, only the accumulation loop differs
npx laplacebench arena \
  --team-a claude-cli-learn:sonnet@low --team-b claude-cli:sonnet@low --games 4 --swap

# verify any run's log against the frozen engine, or share it
npx laplacebench verify runs/<run-id>
npx laplacebench export-web runs/<run-id> --out ./replays
```

Watch your exported games by dropping the replay JSON onto the public
spectator page (`/bench` on the LAPLACE site) — playback is fully
client-side. To submit games to the community lane, see
[community/README.md](community/README.md).

For development, clone and `npm install && npm run build`, then use
`npx tsx packages/cli/src/cli.ts ...` in place of `npx laplacebench ...`.

Every run writes `runs/<id>/` with an immutable event stream, per-game
results, and a metrics summary (W/D/L, win reasons, illegal-move and
format-failure rates, normalized provider usage with reporting coverage,
application I/O bytes, and latency). Cross-provider token totals are
descriptive only; see [usage semantics](docs/usage-semantics.md).
`export-web` re-plays the log
through the engine (failing loudly on any divergence) and emits spectator
replay JSON.

## Integrity lanes

- **Self-serve**: run anything locally on your own subscriptions.
- **Community (unverified)**: shared logs are replay-verified structurally,
  but nothing can prove which model produced the text — labeled accordingly.
- **Official (verified)**: maintainer-run API matches with full manifests
  (model IDs, params, tokens, cost) are the only source of headline claims.
- Subscription-CLI matches carry each vendor's harness prompt — always
  labeled as a distinct condition from clean API runs.

## Documentation

- [Rulebook given to models](packages/cli/rulebook/laplace-8x8-v1.md)
- [Design v0.1](docs/design-v0.1.md) — tracks, metrics, failure policy,
  contamination resistance
- [Usage semantics](docs/usage-semantics.md) — Claude/OpenAI cache accounting,
  reporting coverage, and the cross-provider comparison boundary
- [Benchmark strategy (JA)](docs/benchmark-strategy-ja.md) — statistical
  power, red-team notes, launch plan
- [Experiment axes (JA)](docs/experiment-axes-ja.md) — modality / context /
  harness-engineering divisions
- [Public platform strategy (JA)](docs/public-platform-strategy-ja.md) —
  participation funnel and trust lanes
- [Findings log](packages/cli/FINDINGS.md) — every run analyzed, including
  the harness bugs we caught and the failure modes we found
- [Anchor ladder v1](docs/anchor-ladder-v1.md) — the fixed baseline ordering
  (random/greedy/center-greedy/takeshi:dN) used to keep ratings comparable
  as models come and go
- [Product CPU adapter spec (design only)](docs/product-cpu-adapter-v1-spec.md)
  — naming/interface prepared for importing a future product CPU baseline
- [Model protocol schemas](schemas/)

## Status

Early but real: the referee, ladder, adapters, learning loop, and spectator
export are running today; the discrimination pilot found measurable
differences between frontier models on three independent axes. Statistical
sample sizes, the vision (board-image) track, and the community submission
flow are the active roadmap.
