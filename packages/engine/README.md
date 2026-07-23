# laplace-engine

The deterministic rules engine for **LAPLACE** — an 8x8, four-color,
2-vs-2 strategy board game — packaged as the frozen referee for
[LaplaceBench](https://github.com/keisuke70/laplacebench).

## Ruleset freeze

**This package's version line IS the ruleset ID.** `laplace-engine@1.x`
implements `laplace-8x8-v1`:

- 8x8 board; colors Red(1), Blue(2), Yellow(3), Green(4); teams A = Red+Yellow,
  B = Blue+Green; turn order R->B->Y->G, skipping colors with no pieces left.
- Rook-like movement, no jumping, empty destination.
- Sandwich captures (same-color flanks, mixed-color lines captured whole,
  friendly fire real, voluntary entry safe) and enclosure captures
  (zero-liberty groups adjacent to the landing square).
- Elimination at **3 pieces lost** (fixed, board-size independent);
  survivors become Void pieces (move, can be captured, never capture).
- Victory by eliminating both enemy colors or occupying the four center
  cells with one team's pieces (Void included).

Any future rule change ships as a new major version = new ruleset ID.
Old benchmark results stay interpretable forever.

The engine is a verbatim freeze of the LAPLACE product engine
(`@laplace/game-shared`) as of 2026-07-21, including the canonical
elimination-threshold rule (fixed 3). It has zero runtime dependencies.

## API sketch

```ts
import { GameStateManager, TakeshiPolicy } from "laplace-engine";

const game = new GameStateManager();
game.startGame(8);
const res = game.makeMove(0, 3, 4, 3); // fromRow, fromCol, toRow, toCol
// res.valid, res.state (captures, eliminations, winner all applied)
```

`GameStateManager` is the referee: it alone decides legality, captures,
Void conversion, elimination, turn order, and victory. `TakeshiPolicy` is a
team-aware alpha-beta baseline (a policy, not a rules oracle).

## Conformance

`test/fixtures/rulegym-v1.json` pins the edge-rule behaviors this freeze
depends on — exact elimination threshold, same-color-not-same-team capture,
friendly fire, Void-piece move-without-capture, team (not color) center and
elimination victory, and move legality — as hand-readable fixtures, run on
every `npm test` (`test/conformance.test.ts`, `test/elimination-threshold.test.ts`).
This is the Stage 0 gate from
[`design-v0.1.md` section 10](../../docs/design-v0.1.md) and
[`benchmark-strategy-ja.md` section 6.3](../../docs/benchmark-strategy-ja.md):
a rules bug here invalidates every published result, so it is CI-enforced
rather than a one-time manual read-through.

These fixtures prove internal self-consistency of the frozen engine. They do
**not** by themselves prove the freeze still matches the live product engine
— the product repository is a separate, actively developed checkout this
package must never depend on at runtime or in CI. For that, a maintainer can
run the same fixtures against a local product checkout on demand:

```bash
node packages/engine/scripts/verify-against-product.cjs \
  --product-path /path/to/laplace-main
```

(Requires `packages/game-shared/dist` already built in that checkout; this
script never builds or writes into it.) Last verified 2026-07-23 against
laplace-main commit `ff57443bbc7333efbad74084cfa6db2bfc634b1d`: all 10
fixtures matched (also confirmed via a byte-for-byte `diff -rq` of
`packages/engine/src/core` against the product's `packages/game-shared/src/core`
— see `scripts/check-upstream-drift.sh`). If a future run diverges, that is
a signal to cut a deliberate `laplace-8x8-v2`, not to silently edit this
package's fixtures or source to match. The product repo is under active
development on other work, so this commit hash will age quickly; re-run
`scripts/verify-against-product.cjs` rather than trusting this note.

## Human-readable rules

The English rulebook given to models is
[`rulebook/laplace-8x8-v1.md`](../cli/rulebook/laplace-8x8-v1.md) in the
LaplaceBench CLI package.
