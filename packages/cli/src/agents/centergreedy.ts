import { cloneManager, playerTeam } from "../engine";
import { rng, TEAM_PLAYERS, type Agent, type Move, type TurnInput } from "../types";
import type { GameState } from "laplace-engine";

const CENTER: [number, number][] = [
  [3, 3],
  [3, 4],
  [4, 3],
  [4, 4],
];

function centerCount(state: GameState, team: "A" | "B"): number {
  let n = 0;
  for (const [r, c] of CENTER) {
    const cell = state.board[r][c];
    if (cell && playerTeam(cell.player) === team) n++;
  }
  return n;
}

/**
 * One-ply greedy that values center occupation alongside material. Unlike
 * plain `greedy` (and unlike the product minimax, whose evaluation has no
 * center term), this baseline both contests and defends the center-victory
 * route: occupying a center cell raises my count and denies it to the enemy,
 * and capturing an enemy center piece lowers theirs. It cannot plan a
 * multi-move stack on its own, but it will grab open center cells and block
 * an opponent about to complete the center — enough to force a real fight
 * for the middle instead of a free rush.
 *
 * `centerWeight` scales center control against captured pieces (default 4:
 * one center cell is worth ~4 enemy captures in the tie-break).
 */
export function centerGreedyAgent(seed: number, centerWeight = 4): Agent {
  const rand = rng(seed);
  return {
    name: centerWeight === 4 ? "center-greedy" : `center-greedy:w${centerWeight}`,
    act(input: TurnInput) {
      const myTeam = input.team;
      const enemyTeam = myTeam === "A" ? "B" : "A";
      const enemies = TEAM_PLAYERS[enemyTeam];
      let best: Move[] = [];
      let bestScore = -Infinity;
      for (const move of input.legal) {
        const sim = cloneManager(input.state);
        const res = sim.makeMove(move.from.row, move.from.col, move.to.row, move.to.col);
        if (!res.valid) continue;

        let score = 0;
        for (const p of enemies) {
          score += res.state.capturedPieces[p - 1] - input.state.capturedPieces[p - 1];
        }
        for (const p of TEAM_PLAYERS[myTeam]) {
          score -= res.state.capturedPieces[p - 1] - input.state.capturedPieces[p - 1];
        }
        score +=
          centerWeight *
          (centerCount(res.state, myTeam) - centerCount(res.state, enemyTeam));
        if (res.state.winningTeam === myTeam) score += 1000;
        if (res.state.winningTeam && res.state.winningTeam !== myTeam) score -= 1000;

        if (score > bestScore) {
          bestScore = score;
          best = [move];
        } else if (score === bestScore) {
          best.push(move);
        }
      }
      const move = best[Math.floor(rand() * best.length)] ?? null;
      return { move };
    },
  };
}
