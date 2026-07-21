import { GameState } from "../types";
import { startNewGame, createInitialState } from "../state/GameStateInitializer";
import { moveToNextPlayer } from "../turn/TurnManager";
import { cloneGameState } from "../state/StateManager";
import { checkGameEnd } from "../end/GameEndChecker";
import { DEFAULT_BOARD_SIZE } from "../utils";

/**
 * Controls high-level game flow: starting, ending, and turn progression
 */
export class GameFlowController {
  /**
   * Create initial game state without starting the game
   */
  createInitialState(boardSize: number = DEFAULT_BOARD_SIZE, turnTimeLimit?: number): GameState {
    return createInitialState(boardSize, turnTimeLimit);
  }

  /**
   * Start a new game with the given configuration
   */
  startGame(boardSize: number = DEFAULT_BOARD_SIZE, turnTimeLimit?: number): GameState {
    return startNewGame(boardSize, turnTimeLimit);
  }

  /**
   * End the game with a winning team
   */
  endGame(state: GameState, winningTeam: "A" | "B" | null): GameState {
    const newState = cloneGameState(state);
    newState.gameEndedAt = new Date();
    newState.winningTeam = winningTeam;
    return newState;
  }

  /**
   * Handle timeout by eliminating current player and advancing turn
   */
  handleTimeout(state: GameState): GameState {
    const newState = cloneGameState(state);
    const currentPlayer = newState.currentPlayer;
    const timeoutTimestamp = new Date();

    newState.lastMoveBy = currentPlayer;
    newState.lastMoveAt = timeoutTimestamp;
    newState.lastMove = {
      from: null,
      to: null,
      capturedPositions: [],
      eliminatedPlayer: null,
    };

    // Increment consecutive timeouts
    newState.consecutiveTimeouts[currentPlayer - 1]++;

    // If 2 consecutive timeouts, eliminate player
    if (newState.consecutiveTimeouts[currentPlayer - 1] >= 2) {
      newState.eliminatedPlayers[currentPlayer - 1] = true;

      // Remove all pieces of eliminated player
      for (let r = 0; r < newState.boardSize; r++) {
        for (let c = 0; c < newState.boardSize; c++) {
          if (newState.board[r][c]?.player === currentPlayer) {
            newState.board[r][c] = null;
          }
        }
      }

      if (newState.lastMove) {
        newState.lastMove.eliminatedPlayer = currentPlayer;
      }
    }

    checkGameEnd(newState);

    // Move to next player if game continues
    if (!newState.gameEndedAt) {
      moveToNextPlayer(newState);
    }

    return newState;
  }

  /**
   * Advance to the next player's turn
   */
  advanceTurn(state: GameState): GameState {
    if (state.gameEndedAt) return state;

    const newState = cloneGameState(state);
    moveToNextPlayer(newState);
    return newState;
  }

  /**
   * Refresh the turn timer to current time
   */
  refreshTurnTimer(state: GameState): GameState {
    const newState = cloneGameState(state);
    newState.turnStartedAt = new Date();
    return newState;
  }
}
