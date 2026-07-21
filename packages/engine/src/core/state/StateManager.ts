import { GameState, GamePiece } from "../types";

/**
 * Pure functions for state manipulation
 * Replaces inefficient JSON.parse(JSON.stringify())
 */

export function cloneGameState(state: GameState): GameState {
  return {
    ...state,
    board: state.board.map(row => row.map(cell => cell ? { ...cell } : null)),
    capturedPieces: [...state.capturedPieces],
    eliminatedPlayers: [...state.eliminatedPlayers],
    consecutiveTimeouts: [...state.consecutiveTimeouts],
    lastMove: state.lastMove ? {
      ...state.lastMove,
      from: state.lastMove.from ? [...state.lastMove.from] as [number, number] : null,
      to: state.lastMove.to ? [...state.lastMove.to] as [number, number] : null,
      capturedPositions: [...state.lastMove.capturedPositions],
      remainingPiecePositions: state.lastMove.remainingPiecePositions
        ? [...state.lastMove.remainingPiecePositions]
        : undefined,
      capturedPiecesMeta: state.lastMove.capturedPiecesMeta
        ? state.lastMove.capturedPiecesMeta.map((entry) => ({
            position: [...entry.position] as [number, number],
            player: entry.player,
          }))
        : undefined,
    } : null,
    turnStartedAt: new Date(state.turnStartedAt),
    gameStartedAt: state.gameStartedAt ? new Date(state.gameStartedAt) : null,
    gameEndedAt: state.gameEndedAt ? new Date(state.gameEndedAt) : null,
    lastMoveAt: state.lastMoveAt ? new Date(state.lastMoveAt) : null,
  };
}

export function setPieceAt(
  state: GameState,
  row: number,
  col: number,
  piece: GamePiece | null
): GameState {
  const newState = cloneGameState(state);
  newState.board[row][col] = piece ? { ...piece } : null;
  return newState;
}

export function movePiece(
  state: GameState,
  fromRow: number,
  fromCol: number,
  toRow: number,
  toCol: number
): GameState {
  const newState = cloneGameState(state);
  const piece = newState.board[fromRow][fromCol];
  newState.board[toRow][toCol] = piece ? { ...piece } : null;
  newState.board[fromRow][fromCol] = null;
  return newState;
}

export function resetBoard(state: GameState): GameState {
  const newState = cloneGameState(state);
  newState.board = newState.board.map(row => row.map(() => null));
  return newState;
}
