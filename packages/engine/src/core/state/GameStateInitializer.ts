import { GameState } from "../types";
import {
  DEFAULT_BOARD_SIZE,
  DEFAULT_TURN_TIME_LIMIT,
  clampBoardSize,
  getEliminationThreshold,
  getStartingPiecesCount,
} from "../utils";

export function createInitialState(
  boardSize: number = DEFAULT_BOARD_SIZE,
  turnTimeLimit: number = DEFAULT_TURN_TIME_LIMIT
): GameState {
  const size = clampBoardSize(boardSize);
  const startingPiecesCount = getStartingPiecesCount(size);
  const eliminationThreshold = getEliminationThreshold(size);

  const board = Array(size)
    .fill(null)
    .map(() => Array(size).fill(null));

  for (let i = 1; i < size - 1; i++) {
    board[0][i] = { player: 1, isDead: false };
    board[i][size - 1] = { player: 2, isDead: false };
    board[size - 1][i] = { player: 3, isDead: false };
    board[i][0] = { player: 4, isDead: false };
  }

  return {
    board,
    boardSize: size,
    capturedPieces: [0, 0, 0, 0],
    eliminatedPlayers: [false, false, false, false],
    startingPiecesCount,
    eliminationThreshold,
    currentPlayer: 1,
    turnStartedAt: new Date(),
    turnTimeLimit,
    gameStartedAt: null,
    gameEndedAt: null,
    winningTeam: null,
    lastMoveBy: null,
    lastMoveAt: null,
    lastMove: null,
    consecutiveTimeouts: [0, 0, 0, 0],
  };
}

export function startNewGame(
  boardSize: number = DEFAULT_BOARD_SIZE,
  turnTimeLimit: number = DEFAULT_TURN_TIME_LIMIT
): GameState {
  const state = createInitialState(boardSize, turnTimeLimit);
  const now = new Date();
  state.gameStartedAt = now;
  state.turnStartedAt = now;
  state.currentPlayer = 1;
  return { ...state };
}
