import { GameStateManager } from "./GameStateManager";
import { GameState, GameBoard } from "./types";
import { logger } from "../utils/logger";

export interface PolicyAction {
  from: [number, number];
  to: [number, number];
  description: string;
}

/**
 * Team-based minimax policy for the 4-player game
 * Teams: A (Red:1 + Yellow:3) vs B (Blue:2 + Green:4)
 */
export class TakeshiPolicy {
  // Weight configuration based on priority order
  private readonly weights = {
    teamPieces: 100, // Total team pieces (highest priority)
    immediateThreat: 10, // Pieces that can be captured next turn
    immediateCapture: 10, // Pieces we can capture next turn
    deathRisk: 5, // Risk of player death (4 or less pieces)
    mobility: 1, // Total valid moves for the team
  };

  // Team mappings
  private readonly teams = {
    A: [1, 3], // Red + Yellow
    B: [2, 4], // Blue + Green
  };

  /**
   * Get the best move for the current player using minimax
   */
  public getBestMove(gameState: GameState): PolicyAction | null {
    try {
      const validMoves = this.getAllValidMoves(gameState);

      if (validMoves.length === 0) {
        logger.info(
          `Player ${gameState.currentPlayer}: No valid moves available`
        );
        return null;
      }

      if (validMoves.length === 1) {
        logger.info(
          `Player ${gameState.currentPlayer}: Only one move available`
        );
        return validMoves[0];
      }

      // Determine search depth based on game state
      const searchDepth = this.getSearchDepth(gameState);

      let bestMove = validMoves[0];
      let bestValue = -Infinity;

      // Evaluate each move
      for (const move of validMoves) {
        const newState = this.applyMove(gameState, move);
        const value = this.minimax(
          newState,
          searchDepth - 1,
          -Infinity,
          Infinity,
          false,
          gameState.currentPlayer
        );

        if (value > bestValue) {
          bestValue = value;
          bestMove = move;
        }
      }

      logger.info(
        `Player ${gameState.currentPlayer} best move: ${bestMove.description} (eval: ${bestValue.toFixed(1)})`
      );

      return bestMove;
    } catch (error) {
      logger.error("Error in getBestMove:", error);
      const validMoves = this.getAllValidMoves(gameState);
      return validMoves.length > 0 ? validMoves[0] : null;
    }
  }

  /**
   * Get all valid moves for the current player
   */
  private getAllValidMoves(gameState: GameState): PolicyAction[] {
    const { board, currentPlayer, boardSize } = gameState;
    const validMoves: PolicyAction[] = [];

    for (let row = 0; row < boardSize; row++) {
      for (let col = 0; col < boardSize; col++) {
        const piece = board[row][col];
        if (piece && piece.player === currentPlayer) {
          const pieceMoves = this.getValidMovesForPiece(
            board,
            row,
            col,
            boardSize
          );
          for (const move of pieceMoves) {
            validMoves.push({
              from: [row, col],
              to: move,
              description: `(${row},${col}) → (${move[0]},${move[1]})`,
            });
          }
        }
      }
    }

    return validMoves;
  }

  /**
   * Get valid moves for a specific piece
   */
  private getValidMovesForPiece(
    board: GameBoard,
    row: number,
    col: number,
    boardSize: number
  ): [number, number][] {
    const validMoves: [number, number][] = [];

    // Check all four directions
    const directions = [
      [0, 1],
      [0, -1],
      [1, 0],
      [-1, 0],
    ];

    for (const [dr, dc] of directions) {
      let r = row + dr;
      let c = col + dc;

      while (
        r >= 0 &&
        r < boardSize &&
        c >= 0 &&
        c < boardSize &&
        !board[r][c]
      ) {
        validMoves.push([r, c]);
        r += dr;
        c += dc;
      }
    }

    return validMoves;
  }

  /**
   * Minimax algorithm with alpha-beta pruning
   */
  private minimax(
    gameState: GameState,
    depth: number,
    alpha: number,
    beta: number,
    maximizing: boolean,
    evalForPlayer: number
  ): number {
    // Terminal conditions
    if (depth === 0 || this.isGameOver(gameState)) {
      return this.evaluatePosition(gameState, evalForPlayer);
    }

    const currentTeam = this.getPlayerTeam(gameState.currentPlayer);
    const evalTeam = this.getPlayerTeam(evalForPlayer);
    const isTeammate = currentTeam === evalTeam;

    // If current player is on our team, maximize; otherwise minimize
    if (isTeammate) {
      let maxEval = -Infinity;
      const moves = this.getAllValidMoves(gameState);

      for (const move of moves) {
        const newState = this.applyMove(gameState, move);
        const eval_value = this.minimax(
          newState,
          depth - 1,
          alpha,
          beta,
          !maximizing,
          evalForPlayer
        );
        maxEval = Math.max(maxEval, eval_value);
        alpha = Math.max(alpha, eval_value);
        if (beta <= alpha) break;
      }

      return maxEval;
    } else {
      let minEval = Infinity;
      const moves = this.getAllValidMoves(gameState);

      for (const move of moves) {
        const newState = this.applyMove(gameState, move);
        const eval_value = this.minimax(
          newState,
          depth - 1,
          alpha,
          beta,
          !maximizing,
          evalForPlayer
        );
        minEval = Math.min(minEval, eval_value);
        beta = Math.min(beta, eval_value);
        if (beta <= alpha) break;
      }

      return minEval;
    }
  }

  /**
   * Evaluate the game position from a player's perspective
   */
  private evaluatePosition(gameState: GameState, forPlayer: number): number {
    const myTeam = this.getPlayerTeam(forPlayer);
    const enemyTeam = myTeam === "A" ? "B" : "A";

    let score = 0;

    // 1. Team total pieces (highest priority)
    const teamPieces = this.getTeamPieceCount(gameState, myTeam);
    const enemyPieces = this.getTeamPieceCount(gameState, enemyTeam);
    score += this.weights.teamPieces * (teamPieces - enemyPieces);

    // 2. Death risk evaluation
    const myDeathRisk = this.evaluateDeathRisk(gameState, myTeam);
    const enemyDeathRisk = this.evaluateDeathRisk(gameState, enemyTeam);
    score += this.weights.deathRisk * (enemyDeathRisk - myDeathRisk);

    // 3. Immediate threats
    const myThreats = this.countImmediateThreats(gameState, myTeam);
    const enemyThreats = this.countImmediateThreats(gameState, enemyTeam);
    score += this.weights.immediateThreat * (enemyThreats - myThreats);

    // 4. Immediate captures
    const myCaptures = this.countImmediateCaptures(gameState, myTeam);
    const enemyCaptures = this.countImmediateCaptures(gameState, enemyTeam);
    score += this.weights.immediateCapture * (myCaptures - enemyCaptures);

    // 5. Mobility
    const myMobility = this.getTeamMobility(gameState, myTeam);
    const enemyMobility = this.getTeamMobility(gameState, enemyTeam);
    score += this.weights.mobility * (myMobility - enemyMobility);

    return score;
  }

  /**
   * Get which team a player belongs to
   */
  private getPlayerTeam(player: number): "A" | "B" {
    return this.teams.A.includes(player) ? "A" : "B";
  }

  /**
   * Count total pieces for a team
   */
  private getTeamPieceCount(gameState: GameState, team: "A" | "B"): number {
    const { board, boardSize } = gameState;
    let count = 0;
    const teamPlayers = this.teams[team];

    for (let row = 0; row < boardSize; row++) {
      for (let col = 0; col < boardSize; col++) {
        const piece = board[row][col];
        if (piece && teamPlayers.includes(piece.player)) {
          count += piece.isDead ? 0.5 : 1; // Count dead pieces as half
        }
      }
    }

    return count;
  }

  /**
   * Evaluate death risk for a team
   */
  private evaluateDeathRisk(gameState: GameState, team: "A" | "B"): number {
    const teamPlayers = this.teams[team];
    let risk = 0;

    for (const player of teamPlayers) {
      const pieces = this.getPlayerPieceCount(gameState, player);

      if (pieces <= 3) {
        risk += 30; // Already dead
      } else if (pieces === 4) {
        risk += 10; // Critical danger
      } else if (pieces === 5) {
        risk += 3; // High risk
      }
    }

    return risk;
  }

  /**
   * Count pieces for a specific player
   */
  private getPlayerPieceCount(gameState: GameState, player: number): number {
    const { board, boardSize } = gameState;
    let count = 0;

    for (let row = 0; row < boardSize; row++) {
      for (let col = 0; col < boardSize; col++) {
        const piece = board[row][col];
        if (piece && piece.player === player) {
          count++;
        }
      }
    }

    return count;
  }

  /**
   * Count immediate threats to a team
   */
  private countImmediateThreats(gameState: GameState, team: "A" | "B"): number {
    const teamPlayers = this.teams[team];
    const enemyTeam = team === "A" ? "B" : "A";
    const enemyPlayers = this.teams[enemyTeam];

    let threats = 0;

    // Check each enemy piece for potential captures
    for (const enemyPlayer of enemyPlayers) {
      const tempState = { ...gameState, currentPlayer: enemyPlayer };
      const enemyMoves = this.getAllValidMoves(tempState);

      for (const move of enemyMoves) {
        const capturedPositions = this.simulateCaptures(
          gameState,
          move.from,
          move.to,
          enemyPlayer
        );

        // Count how many of our team's pieces would be captured
        for (const [r, c] of capturedPositions) {
          const piece = gameState.board[r][c];
          if (piece && teamPlayers.includes(piece.player)) {
            threats += piece.isDead ? 0.5 : 1;
          }
        }
      }
    }

    return threats;
  }

  /**
   * Count immediate capture opportunities for a team
   */
  private countImmediateCaptures(
    gameState: GameState,
    team: "A" | "B"
  ): number {
    const teamPlayers = this.teams[team];
    const enemyTeam = team === "A" ? "B" : "A";
    const enemyPlayers = this.teams[enemyTeam];

    let captures = 0;

    // Check each team piece for potential captures
    for (const player of teamPlayers) {
      const tempState = { ...gameState, currentPlayer: player };
      const moves = this.getAllValidMoves(tempState);

      for (const move of moves) {
        const capturedPositions = this.simulateCaptures(
          gameState,
          move.from,
          move.to,
          player
        );

        // Count enemy pieces that would be captured
        for (const [r, c] of capturedPositions) {
          const piece = gameState.board[r][c];
          if (piece && enemyPlayers.includes(piece.player)) {
            captures += piece.isDead ? 0.5 : 1;
          }
        }
      }
    }

    return captures;
  }

  /**
   * Calculate team mobility (total valid moves)
   */
  private getTeamMobility(gameState: GameState, team: "A" | "B"): number {
    const teamPlayers = this.teams[team];
    let totalMoves = 0;

    for (const player of teamPlayers) {
      const tempState = { ...gameState, currentPlayer: player };
      const moves = this.getAllValidMoves(tempState);
      totalMoves += moves.length;
    }

    return totalMoves;
  }

  /**
   * Simulate captures for a move
   */
  private simulateCaptures(
    gameState: GameState,
    from: [number, number],
    to: [number, number],
    player: number
  ): [number, number][] {
    // Create a copy of gameState to avoid mutating the original
    const tempState = JSON.parse(JSON.stringify(gameState)) as GameState;
    tempState.board[to[0]][to[1]] = tempState.board[from[0]][from[1]];
    tempState.board[from[0]][from[1]] = null;

    if (tempState.board[to[0]][to[1]]?.isDead) {
      return [];
    }

    const captured = GameStateManager.simulateCapturesForMove(
      tempState,
      to,
      player
    );

    return captured;
  }

  /**
   * Apply a move to create a new game state
   */
  private applyMove(gameState: GameState, move: PolicyAction): GameState {
    // Deep copy the game state
    const newState = JSON.parse(JSON.stringify(gameState)) as GameState;

    // Move the piece
    const [fromRow, fromCol] = move.from;
    const [toRow, toCol] = move.to;

    newState.board[toRow][toCol] = newState.board[fromRow][fromCol];
    newState.board[fromRow][fromCol] = null;

    // Simulate captures
    const captures = this.simulateCaptures(
      newState,
      move.from,
      move.to,
      newState.currentPlayer
    );

    // Remove captured pieces
    for (const [r, c] of captures) {
      newState.board[r][c] = null;
    }

    // Update players captured pieces count and status
    this.updatePlayerStatus(newState);

    // Update to next player
    do {
      newState.currentPlayer = (newState.currentPlayer % 4) + 1;
    } while (!this.hasAnyPiece(newState, newState.currentPlayer));

    return newState;
  }

  /**
   * Update player status after a move
   */
  private updatePlayerStatus(gameState: GameState): void {
    const { board, eliminatedPlayers, capturedPieces } = gameState;
    const boardSize = gameState.boardSize;

    // Reset captured pieces count
    for (let i = 0; i < capturedPieces.length; i++) {
      capturedPieces[i] = 6;
    }
    // Check each piece on the board
    for (let r = 0; r < boardSize; r++) {
      for (let c = 0; c < boardSize; c++) {
        const piece = board[r][c];
        if (piece) {
          capturedPieces[piece.player - 1]--;
        }
      }
    }

    // Check if any player has no pieces left
    for (let i = 0; i < eliminatedPlayers.length; i++) {
      if (capturedPieces[i] >= gameState.eliminationThreshold) {
        eliminatedPlayers[i] = true;
      }
    }

    for (let i = 0; i < eliminatedPlayers.length; i++) {
      if (eliminatedPlayers[i]) {
        // If a player is eliminated, set their pieces to dead
        for (let r = 0; r < boardSize; r++) {
          for (let c = 0; c < boardSize; c++) {
            const piece = board[r][c];
            if (piece && piece.player === i + 1) {
              piece.isDead = true;
            }
          }
        }
      }
    }
  }

  /**
   * Check if a player has any pieces left
   */
  private hasAnyPiece(gameState: GameState, player: number): boolean {
    const { board, boardSize } = gameState;

    for (let r = 0; r < boardSize; r++) {
      for (let c = 0; c < boardSize; c++) {
        if (board[r][c]?.player === player) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Check if the game is over
   */
  private isGameOver(gameState: GameState): boolean {
    // Check if either team is completely eliminated
    const teamAAlive = this.teams.A.some(
      (player) =>
        !gameState.eliminatedPlayers[player - 1] ||
        this.hasAnyPiece(gameState, player)
    );
    const teamBAlive = this.teams.B.some(
      (player) =>
        !gameState.eliminatedPlayers[player - 1] ||
        this.hasAnyPiece(gameState, player)
    );

    return !teamAAlive || !teamBAlive;
  }

  /**
   * Determine search depth based on game state
   */
  private getSearchDepth(gameState: GameState): number {
    const totalPieces = this.getTotalPieceCount(gameState);

    // More depth when fewer pieces (endgame)
    // if (totalPieces <= 12) return 6;
    // if (totalPieces <= 16) return 5;
    return 2; // Default depth for early game
  }

  /**
   * Count total pieces on the board
   */
  private getTotalPieceCount(gameState: GameState): number {
    const { board, boardSize } = gameState;
    let count = 0;

    for (let row = 0; row < boardSize; row++) {
      for (let col = 0; col < boardSize; col++) {
        if (board[row][col] && !board[row][col]?.isDead) {
          count++;
        }
      }
    }

    return count;
  }

  /**
   * Backward compatibility method
   */
  public getRandomMove(gameState: GameState): PolicyAction | null {
    return this.getBestMove(gameState);
  }
}
