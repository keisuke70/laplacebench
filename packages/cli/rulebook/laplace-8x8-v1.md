# LAPLACE — Official Rules (ruleset: laplace-8x8-v1)

LAPLACE is a 2-versus-2 team board game played on an 8x8 grid by four
colors. You control BOTH colors of one team for the entire game. This
document is the complete and authoritative rulebook. It resembles no
well-known game exactly; do not import assumptions from chess, Go, or
Hasami Shogi.

## 1. Colors, teams, and turn order

- Player 1 = Red (R), Player 2 = Blue (B), Player 3 = Yellow (Y),
  Player 4 = Green (G).
- Team A = Red + Yellow. Team B = Blue + Green.
- Turn order is fixed and clockwise: Red -> Blue -> Yellow -> Green ->
  Red -> ... A color with no pieces left on the board is skipped.
- On your turn you move exactly one piece of the CURRENT color. Even
  though you control two colors, you may never move your other color's
  piece on this turn, and your two colors never capture as a pair (see
  Section 4).

## 2. Board and starting position

The board is 8x8. Rows and columns are numbered 0-7. Row 0 is the top
row; column 0 is the leftmost column. Each color starts with 6 pieces
on one edge (corners are empty):

- Red: row 0, columns 1-6 (top edge)
- Blue: column 7, rows 1-6 (right edge)
- Yellow: row 7, columns 1-6 (bottom edge)
- Green: column 0, rows 1-6 (left edge)

```text
   0  1  2  3  4  5  6  7
0  .  R  R  R  R  R  R  .
1  G  .  .  .  .  .  .  B
2  G  .  .  .  .  .  .  B
3  G  .  .  .  .  .  .  B
4  G  .  .  .  .  .  .  B
5  G  .  .  .  .  .  .  B
6  G  .  .  .  .  .  .  B
7  .  Y  Y  Y  Y  Y  Y  .
```

## 3. Movement

- A piece moves like a rook: any number of squares horizontally or
  vertically, in a straight line.
- It cannot jump over any piece (of any color).
- The destination square must be empty.
- There is no diagonal movement, no passing by choice, and no moving
  onto or through occupied squares.

## 4. Capturing

Captures are checked ONLY as a result of your own move, and only
around the square your piece landed on. Pieces are never captured
merely because the position looks captured; if it was not triggered by
the capturing side's move, nothing happens. In particular, moving your
own piece INTO a sandwiched position is always safe.

### 4.1 Sandwich capture

After you move a piece to a square, look outward from that square in
each of the four directions (up, down, left, right):

- If there is an unbroken straight line of one or more pieces that are
  all NOT your moving color, and the piece immediately beyond that line
  is of your moving color, then EVERY piece in that line is captured.
- The line may mix any other colors: enemy pieces AND your teammate's
  pieces are captured together. Friendly fire is real: your teammate's
  captured pieces count toward your teammate's losses.
- Both flanking pieces must be the same color as the moving piece.
  Your teammate's color does NOT pair with yours for a sandwich.
- There are no diagonal sandwiches.
- If the line runs into an empty square or the board edge before
  reaching one of your pieces, nothing is captured in that direction.
- A Void piece of your color (see Section 6) CAN serve as the far
  flanking piece, because only the far end's color matters. The moving
  piece itself must not be Void (Section 6).

### 4.2 Enclosure capture

After you move, each group of connected pieces adjacent to your landing
square is checked. A "group" is one or more pieces that are not your
moving color, connected orthogonally (again, enemy and teammate colors
can mix within a group). The group is captured if NONE of its pieces
has any empty adjacent square — i.e., every piece in the group is
completely unable to move, walled in by pieces of your moving color
and/or the board edge (your teammate's or enemy pieces adjacent to the
group instead join the group).

- A single piece in a corner is captured by blocking its 2 open sides.
- A single piece on an edge is captured by blocking its 3 open sides.
- Larger groups are captured the same way once they have no empty
  neighbor squares at all.

Both capture types can trigger from the same move; each captured piece
is removed from the board and counted once.

## 5. Piece loss and elimination

- Every captured piece increments the LOSS COUNT of the color that
  owned it (not the capturer).
- The moment a color's loss count reaches 3, that color is ELIMINATED.
- When a color is eliminated, all of its remaining pieces on the board
  are converted to VOID pieces (they stay on the board).

## 6. Void pieces

A Void piece is a former piece of an eliminated color. It is shown in
lowercase (r, b, y, g). Void pieces:

- still take turns and move exactly like normal pieces (an eliminated
  color keeps playing its Void pieces in the normal turn order);
- can be captured like normal pieces (their color's loss count no
  longer matters);
- can NEVER capture: when a Void piece moves, no sandwich or enclosure
  check happens at all;
- CAN act as the stationary far end of a sandwich or as part of the
  wall for enclosure when a NORMAL piece of the same color moves;
- count as team pieces for the center victory (Section 7).

## 7. Winning

A team wins immediately when either condition holds:

1. **Team elimination**: both colors of the enemy team are eliminated.
2. **Center occupation**: the four central squares — (row 3, col 3),
   (row 3, col 4), (row 4, col 3), (row 4, col 4) — are ALL occupied
   by pieces of one team (any mix of that team's colors; Void pieces
   count). That team wins instantly, even if it is not their turn
   sequence that completes it.

## 8. Match protocol (benchmark referee)

- You must respond with exactly one legal move in the required JSON
  format on every turn.
- If your response is malformed or illegal, you get ONE corrective
  chance for that turn. A second failure forfeits the turn (a pass).
- Passing twice in a row with the same color eliminates that color and
  REMOVES all of its pieces from the board (they do not become Void).
  A color whose only pieces are gone is skipped from then on.
- If the game reaches the maximum ply limit stated at game start, it
  ends as a draw.
- If your team has an output-token budget (stated at game start), every
  token you produce — including hidden thinking — counts against it.
  When it is exhausted, your remaining turns are passed automatically,
  and consecutive automatic passes eliminate colors like any other pass.
- If the exact same game situation (board including Void status, the
  color about to act, every color's accumulated losses, eliminations,
  and pending forfeit counts) occurs for the third time, the game ends
  as a draw at that moment.
