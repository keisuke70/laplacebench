import { GameBoard, GameState } from "../types";
import { isValidPosition } from "../utils";

export function checkCaptures(
  state: GameState,
  row: number,
  col: number,
  player: number
): [number, number][] {
  const surroundedCaptures = checkSurroundedCaptures(state.board, row, col, player);
  const capturedPositionsMap = new Map<string, boolean>();
  surroundedCaptures.forEach((pos) => capturedPositionsMap.set(`${pos[0]},${pos[1]}`, true));

  const sandwichCaptures = checkSandwichCaptures(
    state.board,
    row,
    col,
    player,
    capturedPositionsMap
  );
  return [...surroundedCaptures, ...sandwichCaptures];
}

export function checkSandwichCaptures(
  board: GameBoard,
  row: number,
  col: number,
  player: number,
  alreadyCapturedMap: Map<string, boolean> = new Map()
): [number, number][] {
  const captured: [number, number][] = [];
  checkCaptureLine(board, row, col, player, 0, 1, captured, alreadyCapturedMap);
  checkCaptureLine(board, row, col, player, 0, -1, captured, alreadyCapturedMap);
  checkCaptureLine(board, row, col, player, 1, 0, captured, alreadyCapturedMap);
  checkCaptureLine(board, row, col, player, -1, 0, captured, alreadyCapturedMap);
  return captured;
}

export function checkCaptureLine(
  board: GameBoard,
  row: number,
  col: number,
  player: number,
  dRow: number,
  dCol: number,
  captured: [number, number][],
  alreadyCapturedMap: Map<string, boolean>
): void {
  let currentRow = row + dRow;
  let currentCol = col + dCol;
  const opponentPositions: [number, number][] = [];

  while (isValidPosition(currentRow, currentCol, board.length)) {
    const cell = board[currentRow][currentCol];
    if (!cell) break;
    if (cell.player === player) {
      if (opponentPositions.length > 0) {
        opponentPositions.forEach(([r, c]) => {
          const key = `${r},${c}`;
          if (!alreadyCapturedMap.get(key)) captured.push([r, c]);
        });
      }
      break;
    } else {
      opponentPositions.push([currentRow, currentCol]);
    }
    currentRow += dRow;
    currentCol += dCol;
  }
}

export function checkSurroundedCaptures(
  board: GameBoard,
  row: number,
  col: number,
  player: number
): [number, number][] {
  const capturedPositionsSet = new Set<string>();
  const allVisitedPositions = new Set<string>();
  const directions = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ];
  for (const [dRow, dCol] of directions) {
    const newRow = row + dRow;
    const newCol = col + dCol;
    const posKey = `${newRow},${newCol}`;
    if (allVisitedPositions.has(posKey)) continue;
    const groupVisited = new Set<string>();
    const groupPositions: [number, number][] = [];
    const isSurrounded = checkIfGroupIsSurrounded(
      board,
      newRow,
      newCol,
      player,
      groupVisited,
      groupPositions
    );
    groupVisited.forEach((pos) => allVisitedPositions.add(pos));
    if (isSurrounded) {
      groupPositions.forEach((pos) => capturedPositionsSet.add(`${pos[0]},${pos[1]}`));
    }
  }
  return Array.from(capturedPositionsSet).map((posStr) => posStr.split(",").map(Number) as [number, number]);
}

export function checkIfGroupIsSurrounded(
  board: GameBoard,
  row: number,
  col: number,
  currentPlayer: number,
  visitedPositions: Set<string>,
  groupPositions: [number, number][]
): boolean {
  if (!isValidPosition(row, col, board.length)) return true;
  const piece = board[row][col];
  if (!piece) return true;
  if (piece.player === currentPlayer) return true;
  const posKey = `${row},${col}`;
  if (visitedPositions.has(posKey)) return true;
  visitedPositions.add(posKey);
  groupPositions.push([row, col]);
  if (canMove(board, row, col)) return false;
  const directions = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ];
  for (const [dRow, dCol] of directions) {
    const newRow = row + dRow;
    const newCol = col + dCol;
    if (
      !checkIfGroupIsSurrounded(
        board,
        newRow,
        newCol,
        currentPlayer,
        visitedPositions,
        groupPositions
      )
    ) {
      return false;
    }
  }
  return true;
}

export function canMove(board: GameBoard, row: number, col: number): boolean {
  const directions = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ];
  for (const [dRow, dCol] of directions) {
    let currentRow = row + dRow;
    let currentCol = col + dCol;
    // Check if the adjacent cell in this direction is empty (piece can move there)
    if (isValidPosition(currentRow, currentCol, board.length)) {
      const cell = board[currentRow][currentCol];
      if (!cell) {
        // Found an empty adjacent cell - piece can move here
        return true;
      }
    }
  }
  return false;
}

