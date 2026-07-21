import { cloneManager, playerTeam } from "../engine";
import { rng, TEAM_PLAYERS, type Agent, type Move, type TurnInput } from "../types";

/**
 * One-ply material greedy: maximizes enemy pieces captured minus own-team
 * pieces lost (friendly fire), with a large bonus for immediate wins.
 * Uses the real referee for every simulation, so its notion of a capture
 * is exact.
 */
export function greedyAgent(seed: number): Agent {
  const rand = rng(seed);
  return {
    name: "greedy",
    act(input: TurnInput) {
      const myTeam = input.team;
      const enemies = TEAM_PLAYERS[myTeam === "A" ? "B" : "A"];
      let best: Move[] = [];
      let bestScore = -Infinity;
      for (const move of input.legal) {
        const sim = cloneManager(input.state);
        const res = sim.makeMove(
          move.from.row,
          move.from.col,
          move.to.row,
          move.to.col
        );
        if (!res.valid) continue;
        let score = 0;
        for (const p of enemies) {
          score +=
            res.state.capturedPieces[p - 1] - input.state.capturedPieces[p - 1];
        }
        for (const p of TEAM_PLAYERS[myTeam]) {
          score -=
            res.state.capturedPieces[p - 1] - input.state.capturedPieces[p - 1];
        }
        if (res.state.winningTeam === myTeam) score += 1000;
        if (res.state.winningTeam && res.state.winningTeam !== myTeam)
          score -= 1000;
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
