/**
 * Shared utility functions
 */

import { VALIDATION, GAME_CONFIG } from "../constants";
import { TEAMS } from "../core";
import type { GameState } from "../core";
import type { Position } from "../types";

// ==========================================
// Team utilities
// ==========================================
// getPlayerTeam is already defined in core/index.ts

export function areTeammates(player1: number, player2: number): boolean {
  const team1 = TEAMS.A.players.includes(player1) ? "A" : TEAMS.B.players.includes(player1) ? "B" : null;
  const team2 = TEAMS.A.players.includes(player2) ? "A" : TEAMS.B.players.includes(player2) ? "B" : null;
  return team1 === team2 && team1 !== null;
}

// getTeamPlayers is now defined in core/utils

// ==========================================
// Validation utilities
// ==========================================

export function isValidRoomId(roomId: string): boolean {
  return VALIDATION.ROOM_ID_PATTERN.test(roomId);
}

export function isValidUsername(username: string): boolean {
  return (
    username.length >= VALIDATION.USERNAME_MIN_LENGTH &&
    username.length <= VALIDATION.USERNAME_MAX_LENGTH &&
    VALIDATION.USERNAME_PATTERN.test(username)
  );
}

export function isValidAccessCode(code: string): boolean {
  return VALIDATION.ACCESS_CODE_PATTERN.test(code);
}

export function isValidUuid(value: unknown): value is string {
  return typeof value === "string" && VALIDATION.UUID_PATTERN.test(value);
}

// ==========================================
// Room utilities
// ==========================================

export function generateRoomId(): string {
  const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let result = "";
  for (let i = 0; i < 6; i++) {
    result += characters.charAt(Math.floor(Math.random() * characters.length));
  }
  return result;
}

export function generateAccessCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// ==========================================
// Game state utilities
// ==========================================

export function isGameOver(gameState: GameState): boolean {
  return gameState.winningTeam !== null;
}

export function isPlayerEliminated(playerNumber: number, gameState: GameState): boolean {
  return gameState.eliminatedPlayers[playerNumber - 1];
}

export function getActivePlayersCount(gameState: GameState): number {
  return gameState.eliminatedPlayers.filter(eliminated => !eliminated).length;
}

export function isValidBoardSize(size: number): boolean {
  return size >= GAME_CONFIG.MIN_BOARD_SIZE && size <= GAME_CONFIG.MAX_BOARD_SIZE;
}

// ==========================================
// Position utilities
// ==========================================

export function positionsEqual(pos1: Position, pos2: Position): boolean {
  return pos1[0] === pos2[0] && pos1[1] === pos2[1];
}

export function isInBounds(position: Position, boardSize: number): boolean {
  const [row, col] = position;
  return row >= 0 && row < boardSize && col >= 0 && col < boardSize;
}

// getManhattanDistance is now defined in core/utils

// ==========================================
// Formatting utilities
// ==========================================

export function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export function formatDate(date: Date): string {
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function truncateUsername(username: string, maxLength: number = 12): string {
  if (username.length <= maxLength) return username;
  return username.substring(0, maxLength - 3) + "...";
}

// ==========================================
// Array utilities
// ==========================================

export function shuffleArray<T>(array: T[]): T[] {
  const newArray = [...array];
  for (let i = newArray.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
  }
  return newArray;
}

export function chunk<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}
