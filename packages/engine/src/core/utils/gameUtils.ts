import { GameBoard } from "../types";

/**
 * Game utility functions
 * Pure helper functions with no state dependencies
 */

/**
 * Check if a position is within board boundaries
 */
export function isValidPosition(
  row: number,
  col: number,
  boardSize: number
): boolean {
  return row >= 0 && row < boardSize && col >= 0 && col < boardSize;
}

/**
 * Get team (A or B) for a player number
 * Players 1 and 3 are team A, players 2 and 4 are team B
 */
export function getTeam(player: number): "A" | "B" {
  return player % 2 === 1 ? "A" : "B";
}

/**
 * Get opponent team for a given team
 */
export function getOpponentTeam(team: "A" | "B"): "A" | "B" {
  return team === "A" ? "B" : "A";
}

/**
 * Check if two players are on the same team
 */
export function isSameTeam(player1: number, player2: number): boolean {
  return getTeam(player1) === getTeam(player2);
}

/**
 * Get all players on a team
 */
export function getTeamPlayers(team: "A" | "B"): number[] {
  return team === "A" ? [1, 3] : [2, 4];
}

/**
 * Check if a move is valid (horizontal or vertical with no obstacles)
 */
export function isValidMove(
  fromRow: number,
  fromCol: number,
  toRow: number,
  toCol: number,
  board: GameBoard,
  boardSize: number
): boolean {
  // Must move either horizontally or vertically
  if (fromRow !== toRow && fromCol !== toCol) {
    return false;
  }

  // Check for obstacles in the path
  if (fromRow === toRow) {
    // Horizontal move
    const startCol = Math.min(fromCol, toCol);
    const endCol = Math.max(fromCol, toCol);
    for (let col = startCol + 1; col < endCol; col++) {
      if (board[fromRow][col]) {
        return false; // Path is blocked
      }
    }
  } else {
    // Vertical move
    const startRow = Math.min(fromRow, toRow);
    const endRow = Math.max(fromRow, toRow);
    for (let row = startRow + 1; row < endRow; row++) {
      if (board[row][fromCol]) {
        return false; // Path is blocked
      }
    }
  }

  return true;
}

/**
 * Get distance between two positions (Manhattan distance)
 */
export function getManhattanDistance(
  fromRow: number,
  fromCol: number,
  toRow: number,
  toCol: number
): number {
  return Math.abs(toRow - fromRow) + Math.abs(toCol - fromCol);
}

/**
 * Check if a position is on the board edge
 */
export function isEdgePosition(
  row: number,
  col: number,
  boardSize: number
): boolean {
  return row === 0 || row === boardSize - 1 || col === 0 || col === boardSize - 1;
}

/**
 * Check if a position is a corner
 */
export function isCornerPosition(
  row: number,
  col: number,
  boardSize: number
): boolean {
  return (
    (row === 0 || row === boardSize - 1) &&
    (col === 0 || col === boardSize - 1)
  );
}
