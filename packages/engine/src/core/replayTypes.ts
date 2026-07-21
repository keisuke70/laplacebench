// Minimal replay data types - optimized for storage and replay functionality
// Removes all timing data and duplicated metadata

// Static game metadata (stored once per match)
export interface ReplayGameMetadata {
  room_id: string;
  match_type: "solo_rank" | "random_rank" | "paired_rank" | "friends";
  board_size: number;
  winner_team: "A" | "B" | null;
  total_moves: number;
  participants: ReplayParticipant[];
}

// Participant information (stored once per match)
export interface ReplayParticipant {
  player_id: string;
  player_number: number; // 1-4
  team_number: number; // 1-2
  is_winner: boolean;
}

// Minimal move data (stored per move)
export interface ReplayMove {
  sequence: number; // 0 = initial state, 1+ = moves
  player_number: number | null; // null for initial state
  from: [number, number] | null; // [row, col] or null for initial state
  to: [number, number] | null; // [row, col] or null for initial state
  captured: [number, number][] | null; // positions captured in this move
  eliminated_player: number | null; // player eliminated by this move (1-4)
}

// Minimal board snapshot for efficient scrubbing
export interface ReplayBoardSnapshot {
  move_sequence: number;
  board: (ReplayPiece | null)[][]; // simplified 2D board
  current_player: number;
  captured_counts: [number, number, number, number]; // captured pieces per player
  eliminated_players: [boolean, boolean, boolean, boolean]; // elimination status per player
  game_ended: boolean;
}

// Simplified piece representation (only player number)
export interface ReplayPiece {
  player: number; // 1-4
}

// Complete replay data structure
export interface GameReplayData {
  match_id: string;
  metadata: ReplayGameMetadata;
  moves: ReplayMove[];
  snapshots: ReplayBoardSnapshot[]; // optional, for efficient scrubbing
}

// Database response format
export interface ReplayDatabaseResponse {
  match_id: string;
  room_id: string;
  match_type: string;
  board_size: number;
  winner_team: string | null;
  total_moves: number;
  participants: any; // JSONB
  moves: any; // JSONB
  snapshots: any; // JSONB
}

// Conversion utilities
export function convertDatabaseToReplayData(
  dbResponse: ReplayDatabaseResponse
): GameReplayData {
  return {
    match_id: dbResponse.match_id,
    metadata: {
      room_id: dbResponse.room_id,
      match_type: dbResponse.match_type as
        | "solo_rank"
        | "paired_rank"
        | "friends",
      board_size: dbResponse.board_size,
      winner_team: dbResponse.winner_team as "A" | "B" | null,
      total_moves: dbResponse.total_moves,
      participants: dbResponse.participants as ReplayParticipant[],
    },
    moves: dbResponse.moves as ReplayMove[],
    snapshots: dbResponse.snapshots as ReplayBoardSnapshot[],
  };
}

// Convert current GameState format to minimal move format
export function convertGameStateToReplayMove(
  gameState: any, // Current GameState
  sequence: number
): ReplayMove {
  if (sequence === 0) {
    // Initial state
    return {
      sequence: 0,
      player_number: null,
      from: null,
      to: null,
      captured: null,
      eliminated_player: null,
    };
  }

  // Regular move
  return {
    sequence,
    player_number: gameState.lastMoveBy,
    from: gameState.lastMove?.from || null,
    to: gameState.lastMove?.to || null,
    captured: gameState.lastMove?.capturedPositions || null,
    eliminated_player: gameState.lastMove?.eliminatedPlayer || null,
  };
}

// Convert current GameState to minimal board snapshot
export function convertGameStateToReplaySnapshot(
  gameState: any, // Current GameState
  sequence: number
): ReplayBoardSnapshot {
  // Simplify board - only keep player numbers
  const simplifiedBoard = gameState.board.map((row: any[]) =>
    row.map((cell: any) => (cell ? { player: cell.player } : null))
  );

  return {
    move_sequence: sequence,
    board: simplifiedBoard,
    current_player: gameState.currentPlayer,
    captured_counts: gameState.capturedPieces as [
      number,
      number,
      number,
      number,
    ],
    eliminated_players: gameState.eliminatedPlayers as [
      boolean,
      boolean,
      boolean,
      boolean,
    ],
    game_ended: !!gameState.gameEndedAt,
  };
}

// Helper to reconstruct board state from moves (for replay without snapshots)
export function reconstructBoardStateAtMove(
  moves: ReplayMove[],
  targetSequence: number,
  boardSize: number
): ReplayBoardSnapshot | null {
  if (moves.length === 0) return null;

  // Initialize empty board
  const board: (ReplayPiece | null)[][] = Array(boardSize)
    .fill(null)
    .map(() => Array(boardSize).fill(null));

  // Track game state
  let currentPlayer = 1;
  const capturedCounts: [number, number, number, number] = [0, 0, 0, 0];
  const eliminatedPlayers: [boolean, boolean, boolean, boolean] = [
    false,
    false,
    false,
    false,
  ];

  // Apply moves up to target sequence
  for (let i = 0; i <= targetSequence && i < moves.length; i++) {
    const move = moves[i];

    if (move.sequence === 0) {
      // Initial state - set up starting positions
      // This would need to be populated based on game rules
      continue;
    }

    if (move.from && move.to && move.player_number) {
      // Apply move
      const [fromRow, fromCol] = move.from;
      const [toRow, toCol] = move.to;

      const piece = board[fromRow][fromCol];
      if (piece) {
        board[toRow][toCol] = piece;
        board[fromRow][fromCol] = null;
      }

      // Apply captures
      if (move.captured) {
        move.captured.forEach(([row, col]) => {
          const capturedPiece = board[row][col];
          if (capturedPiece) {
            capturedCounts[capturedPiece.player - 1]++;
            board[row][col] = null;
          }
        });
      }

      // Apply eliminations
      if (move.eliminated_player) {
        eliminatedPlayers[move.eliminated_player - 1] = true;
      }

      // Update current player (simplified - would need proper turn logic)
      currentPlayer = (currentPlayer % 4) + 1;
    }
  }

  return {
    move_sequence: targetSequence,
    board,
    current_player: currentPlayer,
    captured_counts: capturedCounts,
    eliminated_players: eliminatedPlayers,
    game_ended: targetSequence === moves.length - 1,
  };
}
