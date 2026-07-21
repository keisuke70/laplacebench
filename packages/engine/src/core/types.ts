export interface GamePiece {
  player: number;
  isDead?: boolean; // Mark if the piece belongs to a dead player
}

export type GameBoard = (GamePiece | null)[][];

// Updated LastMove interface to match server definition and support animations
export interface LastMove {
  from: [number, number] | null;
  to: [number, number] | null;
  capturedPositions: [number, number][];
  eliminatedPlayer?: number | null; // Added for animation support
  remainingPiecePositions?: [number, number][]; // Added for elimination animation
  capturedPiecesMeta?: {
    position: [number, number];
    player: number;
  }[];
}

export interface GameState {
  board: GameBoard;
  boardSize: number;
  capturedPieces: number[];
  eliminatedPlayers: boolean[];
  startingPiecesCount: number;
  eliminationThreshold: number;
  currentPlayer: number;
  turnStartedAt: Date;
  turnTimeLimit: number;
  gameStartedAt: Date | null;
  gameEndedAt: Date | null;
  winningTeam: "A" | "B" | null; // Made this more specific to match server
  lastMoveBy: number | null;
  lastMoveAt: Date | null;
  lastMove: LastMove | null;
  consecutiveTimeouts: number[];
}

export interface Player {
  id: string;
  username: string;
  playerNumber?: number[];
  isConnected?: boolean;
  isAI?: boolean;
  isGuest?: boolean;
  socketId?: string;
  joinedAt?: Date;
}

// Added additional common types that might be useful across both client and server
export enum Team {
  A = "A",
  B = "B",
}

// Export function to determine which team a player belongs to
export function getPlayerTeam(playerNumber: number): Team {
  return playerNumber % 2 === 1 ? Team.A : Team.B;
}
