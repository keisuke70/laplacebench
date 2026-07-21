import { GameBoard, GameState } from "../types";
type Position = [number, number];
import { isValidPosition as utilIsValidPosition, isValidMove as utilIsValidMove } from "../utils";

export type ValidationResult = { valid: true } | { valid: false; reason: string };

export function isValidPosition(row: number, col: number, boardSize: number): boolean {
  return utilIsValidPosition(row, col, boardSize);
}

export function isHorizontalMove(from: Position, to: Position): boolean {
  return from[0] === to[0] && from[1] !== to[1];
}

export function isVerticalMove(from: Position, to: Position): boolean {
  return from[1] === to[1] && from[0] !== to[0];
}

export function checkPathClear(
  from: Position,
  to: Position,
  board: GameBoard
): boolean {
  const [fromRow, fromCol] = from;
  const [toRow, toCol] = to;
  if (fromRow === toRow) {
    const start = Math.min(fromCol, toCol) + 1;
    const end = Math.max(fromCol, toCol);
    for (let c = start; c < end; c++) if (board[fromRow][c]) return false;
    return true;
  }
  if (fromCol === toCol) {
    const start = Math.min(fromRow, toRow) + 1;
    const end = Math.max(fromRow, toRow);
    for (let r = start; r < end; r++) if (board[r][fromCol]) return false;
    return true;
  }
  return false;
}

export function isValidMove(
  fromRow: number,
  fromCol: number,
  toRow: number,
  toCol: number,
  board: GameBoard,
  boardSize: number
): boolean {
  // Delegate to canonical util implementation
  return utilIsValidMove(fromRow, fromCol, toRow, toCol, board, boardSize);
}

export function validateMoveRequest(
  from: Position,
  to: Position,
  state: GameState
): ValidationResult {
  const [fr, fc] = from;
  const [tr, tc] = to;
  if (!isValidPosition(fr, fc, state.boardSize) || !isValidPosition(tr, tc, state.boardSize)) {
    return { valid: false, reason: "Invalid position" };
  }
  const piece = state.board[fr][fc];
  if (!piece) return { valid: false, reason: "No piece at starting position" };
  if (state.board[tr][tc]) return { valid: false, reason: "Destination is occupied" };
  if (piece.player !== state.currentPlayer) return { valid: false, reason: "Not your piece" };
  if (!isHorizontalMove(from, to) && !isVerticalMove(from, to)) {
    return { valid: false, reason: "Invalid move pattern" };
  }
  if (!checkPathClear(from, to, state.board)) return { valid: false, reason: "Path blocked" };
  return { valid: true };
}
