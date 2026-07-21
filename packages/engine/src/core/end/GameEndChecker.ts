import { GameState } from "../types";
import { getTeam } from "../utils";

export function checkGameEnd(state: GameState): void {
  const teamAEliminated = state.eliminatedPlayers[0] && state.eliminatedPlayers[2];
  const teamBEliminated = state.eliminatedPlayers[1] && state.eliminatedPlayers[3];
  if (teamAEliminated) {
    state.gameEndedAt = new Date();
    state.winningTeam = "B";
  } else if (teamBEliminated) {
    state.gameEndedAt = new Date();
    state.winningTeam = "A";
  }
  if (!state.gameEndedAt) checkGameEndInCenter(state);
}

export function checkGameEndInCenter(state: GameState): void {
  const mid = Math.floor(state.boardSize / 2);
  const cells = [
    state.board[mid - 1][mid - 1],
    state.board[mid - 1][mid],
    state.board[mid][mid - 1],
    state.board[mid][mid],
  ];
  if (cells.some((c) => !c)) return;
  const team = getTeam(cells[0]!.player);
  if (cells.every((c) => getTeam(c!.player) === team)) {
    state.gameEndedAt = new Date();
    state.winningTeam = team;
  }
}

