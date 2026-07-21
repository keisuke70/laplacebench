/**
 * Socket.io related types
 */

import type { GameState } from "../core";
import type { MatchType, Position, GameError } from "./index";

// Socket Events (shared between all projects)
export enum SocketEvents {
  // Connection events
  CONNECT = "connect",
  DISCONNECT = "disconnect",
  RECONNECT = "reconnect",

  // Room events
  CREATE_ROOM = "create_room",
  JOIN_ROOM = "join_room",
  LEAVE_ROOM = "leave_room",
  ROOM_CREATED = "room_created",
  ROOM_JOINED = "room_joined",
  ROOM_UPDATED = "room_updated",
  PLAYER_JOINED = "player_joined",
  PLAYER_LEFT = "player_left",
  GET_ROOMS = "get_rooms",
  ROOMS_LIST = "rooms_list",
  ROOM_CLOSED = "room_closed",

  // Game events
  START_GAME = "start_game",
  GAME_STARTED = "game_started",
  MAKE_MOVE = "make_move",
  MOVE_MADE = "move_made",
  INVALID_MOVE = "invalid_move",
  GAME_UPDATED = "game_updated",
  GAME_ENDED = "game_ended",

  // Piece selection events
  PIECE_SELECTED = "piece_selected",
  OPPONENT_PIECE_SELECTED = "opponent_piece_selected",

  // Game state management
  REQUEST_GAME_STATE = "request_game_state",

  // Turn events
  TURN_TIMER_UPDATE = "turn_timer_update",
  NEXT_TURN = "next_turn",

  // Error events
  ERROR = "error",

  // AI events
  AI_MOVE_REQUESTED = "ai_move_requested",
  AI_MOVE_RECEIVED = "ai_move_received",
  AI_ERROR = "ai_error",

  // Navigation events
  REDIRECT_TO_GAME = "redirect_to_game",
  REDIRECT_TO_ROOM = "redirect_to_room",

  // Replay events
  REQUEST_GAME_HISTORY = "request_game_history",
  GAME_HISTORY_DATA = "game_history_data",
  REJOIN_ROOM_AFTER_GAME = "rejoin_room_after_game",

  // Room deletion events
  ROOM_DELETION_SCHEDULED = "room_deletion_scheduled",
}

// Socket Payload Types (shared between Web, Server, Mobile)
export interface CreateRoomPayload {
  roomName: string;
  isPrivate: boolean;
  username: string;
  boardSize?: number;
  matchType?: MatchType;
}

export interface JoinRoomPayload {
  roomId: string;
  username: string;
  accessCode?: string;
}

export interface MakeMovePayload {
  roomId: string;
  from: Position;
  to: Position;
}

export interface PieceSelectionPayload {
  roomId: string;
  position: Position | null;
  validMoves?: Position[];
}

export interface OpponentPieceSelectionData {
  playerNumber: number;
  position: Position | null;
  validMoves?: Position[];
}

export interface RoomDeletionScheduledPayload {
  roomId: string;
  reason: string;
}

export interface GameHistoryPayload {
  roomId: string;
  fromMove?: number;
  toMove?: number;
}

export interface ErrorPayload {
  error: GameError;
  roomId?: string;
}