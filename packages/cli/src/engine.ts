import "./env";
import {
  GameStateManager,
  TakeshiPolicy,
  type GameState,
} from "laplace-engine";
import {
  COLOR_CHARS,
  COLOR_NAMES,
  type FailureCode,
  type Move,
  type RecentEvent,
  type TeamId,
} from "./types";

const movePolicy = new TakeshiPolicy();

export function newGame(): GameStateManager {
  const m = new GameStateManager();
  m.startGame(8);
  return m;
}

export function cloneManager(state: GameState): GameStateManager {
  const m = new GameStateManager();
  m.state = JSON.parse(JSON.stringify(state));
  return m;
}

/** Legal moves for state.currentPlayer, via the product engine's own generator. */
export function legalMoves(state: GameState): Move[] {
  const actions = (movePolicy as any).getAllValidMoves(state) as {
    from: [number, number];
    to: [number, number];
  }[];
  return actions.map((a) => ({
    from: { row: a.from[0], col: a.from[1] },
    to: { row: a.to[0], col: a.to[1] },
  }));
}

export function failureCode(message: string | undefined): FailureCode {
  switch (message) {
    case "Invalid position":
      return "E_OFF_BOARD";
    case "No piece at starting position":
      return "E_NO_PIECE_AT_FROM";
    case "Not your piece":
      return "E_NOT_YOUR_PIECE";
    case "Destination is occupied":
      return "E_DEST_OCCUPIED";
    default:
      return "E_BAD_PATH";
  }
}

export function colorName(player: number): string {
  return COLOR_NAMES[player - 1];
}

export function playerTeam(player: number): TeamId {
  return player % 2 === 1 ? "A" : "B";
}

export function boardRows(state: GameState): string[] {
  return state.board.map((row) =>
    row
      .map((cell) => {
        if (!cell) return ".";
        const ch = COLOR_CHARS[cell.player - 1];
        return cell.isDead ? ch.toLowerCase() : ch;
      })
      .join("")
  );
}

/**
 * Repetition-key field classification over the ENTIRE GameState. Exhaustive
 * by construction: the Record over keyof GameState fails typecheck when the
 * vendored state shape gains a field, and repetitionKey throws on any runtime
 * key this map does not know, so an intentional core sync cannot silently
 * skew repetition detection. Excluded fields are timing, display, or
 * terminal metadata only (docs/plans/2026-07-24-freeze-draw-rules.md).
 */
const REPETITION_KEY_FIELDS: Record<keyof GameState, "include" | "exclude"> = {
  board: "include",
  boardSize: "include",
  capturedPieces: "include",
  eliminatedPlayers: "include",
  startingPiecesCount: "include",
  eliminationThreshold: "include",
  currentPlayer: "include",
  consecutiveTimeouts: "include",
  turnStartedAt: "exclude",
  turnTimeLimit: "exclude",
  gameStartedAt: "exclude",
  gameEndedAt: "exclude",
  winningTeam: "exclude",
  lastMoveBy: "exclude",
  lastMoveAt: "exclude",
  lastMove: "exclude",
};

/** Canonical serialization of the game-relevant state for repetition draws. */
export function repetitionKey(state: GameState): string {
  const included: Record<string, unknown> = {};
  for (const key of Object.keys(state).sort()) {
    const cls = (REPETITION_KEY_FIELDS as Record<string, string | undefined>)[
      key
    ];
    if (cls === undefined) {
      throw new Error(`repetitionKey: unclassified GameState field "${key}"`);
    }
    if (cls !== "include") continue;
    if (key === "board") {
      // Cells may carry isDead as absent, false, or true; normalize so
      // semantically equal boards serialize identically.
      included[key] = state.board.map((row) =>
        row.map((cell) => (cell ? [cell.player, cell.isDead ? 1 : 0] : 0))
      );
    } else {
      included[key] = (state as unknown as Record<string, unknown>)[key];
    }
  }
  return JSON.stringify(included);
}

export function winReason(
  state: GameState,
  horizonReached: boolean
): "center" | "elimination" | "horizon_draw" | null {
  if (!state.winningTeam) return horizonReached ? "horizon_draw" : null;
  const mid = Math.floor(state.boardSize / 2);
  const cells = [
    state.board[mid - 1][mid - 1],
    state.board[mid - 1][mid],
    state.board[mid][mid - 1],
    state.board[mid][mid],
  ];
  if (
    cells.every((c) => c && playerTeam(c.player) === state.winningTeam)
  ) {
    return "center";
  }
  return "elimination";
}

/** Observation JSON given to LLM agents. Never includes legal moves. */
export function observation(
  state: GameState,
  ply: number,
  maxPlies: number,
  team: TeamId,
  recent: RecentEvent[]
): object {
  const losses: Record<string, number> = {};
  const eliminated: string[] = [];
  for (let p = 1; p <= 4; p++) {
    losses[colorName(p)] = state.capturedPieces[p - 1];
    if (state.eliminatedPlayers[p - 1]) eliminated.push(colorName(p));
  }
  return {
    ply,
    max_plies: maxPlies,
    you_control: team === "A" ? ["Red", "Yellow"] : ["Blue", "Green"],
    acting_color: colorName(state.currentPlayer),
    board_rows_top_to_bottom: boardRows(state),
    losses,
    eliminated_colors: eliminated,
    events_since_your_last_turn: recent,
  };
}
