# LAPLACE Strategy Document Format

The strategy document is your accumulated playbook. You will read it at the
start of every future game in this series, so write it for your future self:
concrete, imperative, and short enough to act on under time pressure.

## Hard constraints

- Markdown, at most ~1200 words total.
- Keep the exact section structure below (all six sections, in order).
- At most 8 rules per section. If a section is full, merge or replace the
  weakest rule instead of appending.
- Every rule is ONE line: `situation → action`, optionally followed by
  `(evidence: game N, ply M)`.
- Revise, don't accumulate: delete rules that later games contradicted.
  A rule that cost you a game must be rewritten or removed, not annotated.

## Sections

### 1. Opening plan
First 2-3 moves for each of your colors and the intent behind them.

### 2. Center: attack and defense
When to commit pieces to the four center cells, when to deny the opponent,
and what board signals mean the center race is already lost/won.

### 3. Capture tactics
Sandwich/enclosure setups that actually worked: the pattern, the setup move
order, and what made the opponent unable to respond.

### 4. Blunder avoidance
Each entry names a concrete mistake pattern from a real game and the rule
that prevents it. Example shape:
`Moving onto a line between two enemy same-color pieces with a gap → check both flanks before landing (evidence: game 2, ply 17)`

### 5. Elimination and Void management
Managing your loss counts (the 3-loss threshold), when to trade, how to
play with/against Void pieces.

### 6. Opponent modeling
Patterns this opponent has shown (openings, habits, weaknesses) and the
counter you will use next game.
