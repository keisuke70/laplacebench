/**
 * Game constants
 * Shared configuration values used throughout the game logic
 */

/**
 * Default turn time limit in seconds
 */
export const DEFAULT_TURN_TIME_LIMIT = 120; // 2 minutes

/**
 * Default board size
 */
export const DEFAULT_BOARD_SIZE = 8;

/**
 * Minimum allowed board size
 */
export const MIN_BOARD_SIZE = 7;

/**
 * Maximum allowed board size
 */
export const MAX_BOARD_SIZE = 10;

/**
 * Team identifiers
 */
export const TEAM_A = "A" as const;
export const TEAM_B = "B" as const;

/**
 * Player numbers
 */
export const PLAYER_1 = 1;
export const PLAYER_2 = 2;
export const PLAYER_3 = 3;
export const PLAYER_4 = 4;

/**
 * All player numbers
 */
export const ALL_PLAYERS = [PLAYER_1, PLAYER_2, PLAYER_3, PLAYER_4] as const;

/**
 * Team A players
 */
export const TEAM_A_PLAYERS = [PLAYER_1, PLAYER_3] as const;

/**
 * Team B players
 */
export const TEAM_B_PLAYERS = [PLAYER_2, PLAYER_4] as const;

/**
 * Calculate starting pieces count based on board size
 * Formula: m - 2 (where m is board size)
 */
export function getStartingPiecesCount(boardSize: number): number {
  return boardSize - 2;
}

/**
 * Elimination threshold: a player is eliminated after losing this many pieces.
 * Fixed by rule at 3, independent of board size.
 */
export const ELIMINATION_THRESHOLD = 3;

export function getEliminationThreshold(_boardSize?: number): number {
  return ELIMINATION_THRESHOLD;
}

/**
 * Clamp board size to valid range
 */
export function clampBoardSize(boardSize: number): number {
  return Math.min(Math.max(boardSize, MIN_BOARD_SIZE), MAX_BOARD_SIZE);
}
