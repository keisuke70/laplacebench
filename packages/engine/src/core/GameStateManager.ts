import { GameState } from "./types";
import { DEFAULT_BOARD_SIZE, DEFAULT_TURN_TIME_LIMIT } from "./utils";
import { cloneGameState } from "./state/StateManager";
import { MoveOrchestrator } from "./orchestration/MoveOrchestrator";
import { GameFlowController } from "./flow/GameFlowController";
import { getRemainingTurnTime } from "./turn/TurnManager";
import { checkCaptures } from "./capture/CaptureDetector";
import { checkGameEnd } from "./end/GameEndChecker";
import { logger } from "../utils/logger";

/**
 * Main game state manager - orchestrates all game logic modules
 * Maintains public API for backward compatibility
 */
export class GameStateManager {
  public state: GameState;

  // Orchestrators
  private moveOrchestrator: MoveOrchestrator;
  private flowController: GameFlowController;

  constructor() {
    this.moveOrchestrator = new MoveOrchestrator();
    this.flowController = new GameFlowController();
    this.state = this.createInitialState();
  }

  private get TURN_TIME_LIMIT(): number {
    return DEFAULT_TURN_TIME_LIMIT;
  }

  // Public API - delegates to modules

  public getState(): GameState {
    return cloneGameState(this.state);
  }

  public createInitialState(boardSize: number = DEFAULT_BOARD_SIZE, turnTimeLimit?: number): GameState {
    return this.flowController.createInitialState(
      boardSize,
      turnTimeLimit ?? this.TURN_TIME_LIMIT
    );
  }

  public startGame(boardSize: number = DEFAULT_BOARD_SIZE, turnTimeLimit?: number): GameState {
    try {
      this.state = this.flowController.startGame(
        boardSize,
        turnTimeLimit ?? this.TURN_TIME_LIMIT
      );
      logger.info(
        `Game started at ${this.state.gameStartedAt?.toISOString()} with currentPlayer = ${this.state.currentPlayer} and turnTimeLimit = ${this.state.turnTimeLimit}s`
      );
      return cloneGameState(this.state);
    } catch (error) {
      logger.error("Error in startGame:", error);
      this.state = this.flowController.startGame(
        boardSize,
        turnTimeLimit ?? this.TURN_TIME_LIMIT
      );
      return cloneGameState(this.state);
    }
  }

  public makeMove(
    fromRow: number,
    fromCol: number,
    toRow: number,
    toCol: number
  ): {
    valid: boolean;
    state: GameState;
    message?: string;
  } {
    const result = this.moveOrchestrator.executeMove(
      this.state,
      fromRow,
      fromCol,
      toRow,
      toCol
    );

    if (result.valid) {
      this.state = result.state;
      // Move to next player if game hasn't ended
      if (!this.state.gameEndedAt) {
        this.state = this.flowController.advanceTurn(this.state);
      }
    }

    // Return the fully updated state including turn advancement
    return {
      valid: result.valid,
      state: this.state,
      message: result.message
    };
  }

  public advanceTurn(): GameState {
    if (this.state.gameEndedAt) return this.state;
    try {
      this.state = this.flowController.handleTimeout(this.state);
      checkGameEnd(this.state);
      return cloneGameState(this.state);
    } catch (error) {
      logger.error("Error in advanceTurn:", error);
      this.state.turnStartedAt = new Date();
      return cloneGameState(this.state);
    }
  }

  public getRemainingTurnTime(): number {
    try {
      return getRemainingTurnTime(this.state);
    } catch (error) {
      logger.error("Error calculating remaining time:", error);
      return this.state.turnTimeLimit;
    }
  }

  public refreshTurnTimer(): void {
    this.state = this.flowController.refreshTurnTimer(this.state);
    logger.info(
      `Refreshed turn timer at ${
        this.state.turnStartedAt instanceof Date
          ? this.state.turnStartedAt.toISOString()
          : this.state.turnStartedAt
      }`
    );
  }

  // Backward compatibility methods

  public static simulateCapturesForMove(
    gameState: GameState,
    to: [number, number],
    player: number
  ): [number, number][] {
    return MoveOrchestrator.simulateCaptures(gameState, to, player);
  }

  protected checkCaptures(
    state: GameState,
    row: number,
    col: number,
    player: number
  ): [number, number][] {
    return checkCaptures(state, row, col, player);
  }
}
