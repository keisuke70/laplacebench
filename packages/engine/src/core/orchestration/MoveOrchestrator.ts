import { GameState, GamePiece } from "../types";
import { isValidMove, isValidPosition } from "../validation/MoveValidator";
import { checkCaptures } from "../capture/CaptureDetector";
import { checkGameEnd } from "../end/GameEndChecker";
import { cloneGameState } from "../state/StateManager";
import { updatePlayerStatus } from "../player/PlayerStatus";

export interface MoveResult {
  valid: boolean;
  state: GameState;
  message?: string;
}

/**
 * Orchestrates move validation, execution, capture detection, and game end checks
 */
export class MoveOrchestrator {
  /**
   * Validates and executes a move with full capture/elimination logic
   */
  executeMove(
    state: GameState,
    fromRow: number,
    fromCol: number,
    toRow: number,
    toCol: number
  ): MoveResult {
    const { board, currentPlayer, boardSize } = state;

    // Basic validation checks
    if (
      !isValidPosition(fromRow, fromCol, boardSize) ||
      !isValidPosition(toRow, toCol, boardSize)
    ) {
      return { valid: false, state, message: "Invalid position" };
    }

    // Check if there's a piece at the from position
    if (!board[fromRow][fromCol]) {
      return {
        valid: false,
        state,
        message: "No piece at starting position",
      };
    }

    // Check if the piece belongs to the current player
    if (board[fromRow][fromCol]?.player !== currentPlayer) {
      return { valid: false, state, message: "Not your piece" };
    }

    // If the piece is dead, allow move but prevent captures
    const isDead = !!board[fromRow][fromCol]?.isDead;

    // Check if the destination is empty
    if (board[toRow][toCol]) {
      return {
        valid: false,
        state,
        message: "Destination is occupied",
      };
    }

    // Check if the move is valid (only straight lines, no jumping over pieces)
    if (!isValidMove(fromRow, fromCol, toRow, toCol, board, boardSize)) {
      return {
        valid: false,
        state,
        message: "Invalid move pattern",
      };
    }

    // Clone state (immutable update)
    const newState = cloneGameState(state);

    // Execute move
    const piece = newState.board[fromRow][fromCol];
    newState.board[toRow][toCol] = { ...piece! };
    newState.board[fromRow][fromCol] = null;

    // Reset consecutive timeouts for the current player when they make a move
    newState.consecutiveTimeouts[currentPlayer - 1] = 0;

    // Check for captures (skip if dead)
    let capturedPositions: [number, number][] = [];
    if (!isDead) {
      capturedPositions = checkCaptures(newState, toRow, toCol, piece!.player);
    }

    // Update last move info with enhanced animation data
    newState.lastMoveBy = currentPlayer;
    newState.lastMoveAt = new Date();
    newState.lastMove = {
      from: [fromRow, fromCol],
      to: [toRow, toCol],
      capturedPositions,
      eliminatedPlayer: null, // Will be set by updatePlayerStatus if needed
    };

    // Update player status: remove captured pieces and handle elimination
    updatePlayerStatus(newState, capturedPositions);

    // Get eliminated player from state (updatePlayerStatus sets this)
    let eliminatedPlayer: number | null = null;
    for (let i = 0; i < 4; i++) {
      const wasEliminated = state.eliminatedPlayers[i];
      if (newState.eliminatedPlayers[i] && !wasEliminated) {
        eliminatedPlayer = i + 1; // 1-based player number
        break;
      }
    }

    // Update lastMove with eliminated player info
    if (eliminatedPlayer !== null) {
      newState.lastMove.eliminatedPlayer = eliminatedPlayer;
    }

    // Check for game end
    checkGameEnd(newState);

    return { valid: true, state: newState };
  }

  /**
   * Simulate captures for a potential move without mutating state
   */
  static simulateCaptures(
    state: GameState,
    to: [number, number],
    player: number
  ): [number, number][] {
    // Create a temporary state copy
    const tempState = cloneGameState(state);
    return checkCaptures(tempState, to[0], to[1], player);
  }
}
