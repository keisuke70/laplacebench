/**
 * Additional shared type definitions for LAPLACE game
 * Core game types are exported from ../core
 */

// Import types for use in this file
import type { Player, GameState } from "../core";

// Room types (shared between Web, Server, Mobile)
export interface GameRoom {
  id: string;
  name: string;
  createdAt: Date;
  createdBy: string; // Player ID
  players: Player[];
  gameState: GameState | null;
  isPrivate: boolean;
  accessCode?: string;
  maxPlayers: number;
  status: RoomStatus;
  boardSize: number;
  turnTimeLimit: number; // in seconds
  lastActivity: Date;
  aiPlayers: number[]; // Player numbers that are AI controlled
  gameHistory: GameState[]; // For replay functionality
  matchType?: MatchType;
  isQueueRoom?: boolean; // For ranked matchmaking
  isStarting?: boolean; // Countdown before game starts
  hasBroadcastedGameEnd?: boolean; // Server-side guard to prevent duplicate GAME_ENDED emissions
}

// Enum types
export type RoomStatus = "waiting" | "playing" | "finished";
export type MatchType = "solo_rank" | "random_rank" | "paired_rank" | "friends";
// Team type is defined in core/index.ts

// Position type for convenience
export type Position = [number, number];

// Move validation result
export interface MoveResult {
  success: boolean;
  gameState?: GameState;
  error?: GameError;
  capturedPieces?: Position[];
}

// Error types (shared)
export interface GameError {
  code: string;
  message: string;
  details?: any;
}

// Turn timer data
export interface TurnTimerData {
  remainingTime: number;
  currentPlayer: number;
  turnStartedAt: Date;
}

// Game history entry for replay
export interface GameHistoryEntry {
  gameState: GameState;
  timestamp: Date;
  moveNumber: number;
  playerId?: string;
}

// Player statistics (for future use)
export interface PlayerStats {
  playerId: string;
  gamesPlayed: number;
  wins: number;
  losses: number;
  draws: number;
  rating?: number;
}

// Room list item (for room browser)
export interface RoomListItem {
  id: string;
  name: string;
  playerCount: number;
  maxPlayers: number;
  status: RoomStatus;
  boardSize: number;
  matchType?: MatchType;
  isPrivate: boolean;
}

// Re-export friends types
export * from "./friends";
