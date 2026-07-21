/**
 * Shared constants and configurations
 */

// ==========================================
// Game Configuration
// ==========================================

export const GAME_CONFIG = {
  // Board sizes
  BOARD_SIZE_OPTIONS: [7, 8, 9, 10] as const,
  DEFAULT_BOARD_SIZE: 8,
  MIN_BOARD_SIZE: 7,
  MAX_BOARD_SIZE: 10,

  // Player configuration
  MIN_PLAYERS: 2,
  MAX_PLAYERS: 4,
  PIECES_PER_PLAYER: 6,

  // Game rules
  ELIMINATION_THRESHOLD: 3, // Lose 3 pieces = eliminated
  TURN_TIME_LIMIT: 120, // seconds
  CONSECUTIVE_TIMEOUT_LIMIT: 2, // Auto-forfeit after 2 timeouts

  // Room settings
  ROOM_IDLE_TIMEOUT: 600000, // 10 minutes in ms
  ROOM_CLEANUP_INTERVAL: 60000, // 1 minute in ms
  MAX_ROOM_NAME_LENGTH: 50,
  ACCESS_CODE_LENGTH: 6,
} as const;

// Team configuration is defined in core/index.ts to avoid duplication

// ==========================================
// Colors and UI
// ==========================================
// TEAM_COLORS is defined in core/index.ts to avoid duplication

// Basic colors for non-Tailwind environments (React Native, Canvas, etc.)
export const PLAYER_COLORS = {
  1: { primary: "#ef4444", secondary: "#be123c", name: "Red" },
  2: { primary: "#3b82f6", secondary: "#4338ca", name: "Blue" },
  3: { primary: "#fb923c", secondary: "#d97706", name: "Yellow" },
  4: { primary: "#06b6d4", secondary: "#059669", name: "Green" },
} as const;

// UI Colors
export const UI_COLORS = {
  background: {
    board: "#8b7355", // Wood brown
    cell: {
      light: "#deb887", // Burlywood
      dark: "#a0826d", // Tan
    },
  },
  highlight: {
    validMove: "#10b981", // Green
    selected: "#facc15", // Yellow
    lastMove: "#f59e0b", // Amber
    danger: "#ef4444", // Red
  },
} as const;

// ==========================================
// Socket Configuration
// ==========================================

export const SOCKET_CONFIG = {
  // Connection options
  reconnection: true,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  reconnectionAttempts: 5,
  timeout: 20000,
  transports: ["websocket", "polling"] as const,

  // Heartbeat
  pingInterval: 25000,
  pingTimeout: 60000,

  // Rate limiting
  maxHttpBufferSize: 1e6, // 1MB
} as const;

// ==========================================
// API Configuration
// ==========================================

export const API_CONFIG = {
  // Timeouts
  REQUEST_TIMEOUT: 30000, // 30 seconds
  AI_MOVE_TIMEOUT: 10000, // 10 seconds

  // Retry configuration
  MAX_RETRIES: 3,
  RETRY_DELAY: 1000,

  // Rate limiting
  RATE_LIMIT_WINDOW: 60000, // 1 minute
  RATE_LIMIT_MAX_REQUESTS: 60,
} as const;

// ==========================================
// Validation Patterns
// ==========================================

export const VALIDATION = {
  // Room ID pattern (alphanumeric, 6 characters)
  ROOM_ID_PATTERN: /^[A-Z0-9]{6}$/,

  // Username constraints
  USERNAME_MIN_LENGTH: 1,
  USERNAME_MAX_LENGTH: 20,
  USERNAME_PATTERN: /^[a-zA-Z0-9_-]+$/,

  // Access code pattern
  ACCESS_CODE_PATTERN: /^[0-9]{6}$/,

  // UUID (v4) pattern - case insensitive
  UUID_PATTERN: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
} as const;
