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

## Human-readable rules

The English rulebook given to models is
[`rulebook/laplace-8x8-v1.md`](../cli/rulebook/laplace-8x8-v1.md) in the
LaplaceBench CLI package.
