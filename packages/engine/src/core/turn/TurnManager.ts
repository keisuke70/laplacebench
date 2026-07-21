import { GameState } from "../types";
import { getTeam } from "../utils";

function hasAnyPiece(state: GameState, player: number): boolean {
  for (let r = 0; r < state.boardSize; r++) {
    for (let c = 0; c < state.boardSize; c++) {
      if (state.board[r][c]?.player === player) return true;
    }
  }
  return false;
}

export function moveToNextPlayer(state: GameState): void {
  let nextPlayer = state.currentPlayer;
  do {
    nextPlayer = (nextPlayer % 4) + 1;
  } while (!hasAnyPiece(state, nextPlayer));
  state.currentPlayer = nextPlayer;
  state.turnStartedAt = new Date();
}

export function advanceTurn(state: GameState): void {
  if (state.gameEndedAt) return;

  state.consecutiveTimeouts[state.currentPlayer - 1]++;

  if (state.consecutiveTimeouts[state.currentPlayer - 1] >= 2) {
    // eliminate due to consecutive timeouts
    state.eliminatedPlayers[state.currentPlayer - 1] = true;

    for (let r = 0; r < state.boardSize; r++) {
      for (let c = 0; c < state.boardSize; c++) {
        if (state.board[r][c]?.player === state.currentPlayer) {
          state.board[r][c] = null;
        }
      }
    }
  }

  moveToNextPlayer(state);
}

export function getRemainingTurnTime(state: GameState): number {
  if (state.gameEndedAt) return 0;
  let turnStartedTime: Date;
  if (typeof state.turnStartedAt === "string") {
    turnStartedTime = new Date(state.turnStartedAt);
  } else if (state.turnStartedAt instanceof Date) {
    turnStartedTime = state.turnStartedAt;
  } else {
    state.turnStartedAt = new Date();
    turnStartedTime = state.turnStartedAt;
  }
  const now = new Date();
  const elapsedSeconds = Math.max(0, (now.getTime() - turnStartedTime.getTime()) / 1000);
  const remainingSeconds = Math.max(0, state.turnTimeLimit - Math.floor(elapsedSeconds));
  return Math.floor(remainingSeconds);
}

export function refreshTurnTimer(state: GameState): void {
  state.turnStartedAt = new Date();
}

