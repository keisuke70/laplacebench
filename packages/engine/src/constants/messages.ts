/**
 * Game messages and text constants
 */

export const GAME_MESSAGES = {
  // Room messages
  ROOM_CREATED: "Room created successfully",
  ROOM_JOINED: "Joined room successfully",
  ROOM_FULL: "Room is full",
  ROOM_NOT_FOUND: "Room not found",
  ROOM_CLOSED: "Room has been closed",

  // Game messages
  GAME_STARTED: "Game has started",
  GAME_ENDED: "Game has ended",
  YOUR_TURN: "It's your turn",
  OPPONENT_TURN: "Waiting for opponent",

  // Move messages
  MOVE_SUCCESS: "Move successful",
  INVALID_MOVE: "Invalid move",
  NOT_YOUR_TURN: "It's not your turn",

  // Win/Loss messages
  YOU_WIN: "Congratulations! You won!",
  YOU_LOSE: "You lost. Better luck next time!",
  TEAM_WIN: (team: string) => `Team ${team} wins!`,
  DRAW: "The game ended in a draw",

  // Player status
  PLAYER_ELIMINATED: (username: string) => `${username} has been eliminated`,
  PLAYER_DISCONNECTED: (username: string) => `${username} disconnected`,
  PLAYER_RECONNECTED: (username: string) => `${username} reconnected`,

  // Error messages
  CONNECTION_ERROR: "Connection error. Please try again.",
  SERVER_ERROR: "Server error. Please try again later.",
  TIMEOUT_WARNING: "You have limited time to make your move",
  TIMEOUT_ERROR: "Time's up! Turn skipped.",
  INVALID_ROOM_CODE: "Invalid room code",
  INVALID_USERNAME: "Invalid username",
} as const;