# Post-game Analysis Procedure

You have just finished a LAPLACE game. You will be given the full ground-truth
game record from the referee, which team you were, the result, and your
current strategy document. Your job is to convert this game into an improved
strategy document.

## Steps (do all of them, in this order)

1. **Losses audit.** For EVERY capture where your pieces were taken:
   identify the ply, reconstruct the mechanism (which enemy pieces formed the
   sandwich/enclosure, and which of your moves made it possible), and state
   the concrete alternative — a specific different move at a specific earlier
   ply — that would have avoided the loss.
2. **Missed captures audit.** Find positions where you could have captured
   enemy pieces within 1-2 moves but played something else. State the
   enabling move sequence you should have seen.
3. **Center audit.** Decide whether you contested or conceded the four
   center cells at the right moments. If the game was decided by the center
   (either side), extract the timing rule you should follow next time.
4. **Elimination audit.** Check how your loss counts evolved against the
   3-loss threshold: did you trade when you should not have, or protect a
   doomed color too long?
5. **Distill.** Update the strategy document with what you learned. Follow
   the strategy document format exactly (section structure, one-line rules,
   evidence tags, word limit). Merge with the existing document: keep rules
   that this game confirmed, rewrite or delete rules this game refuted, and
   add the new rules from steps 1-4.

## Output

Reply with ONLY the complete updated strategy document in markdown.
No preamble, no commentary outside the document.
