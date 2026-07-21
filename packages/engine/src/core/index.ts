export * from "./types";
export * from "./GameStateManager";
export * from "./TakeshiPolicy";
export * from "./replayTypes";
export * from "./utils";
export * from "./capture/CaptureDetector";

// Export constants
export const BOARD_SIZE_OPTIONS = [7, 8, 9, 10];

export const TEAM_COLORS = {
  A1: "from-red-500 to-rose-700", // Player 1
  A2: "from-yellow-400 to-yellow-600", // Player 3
  B1: "from-blue-500 to-indigo-700", // Player 2
  B2: "from-teal-500 to-emerald-700", // Player 4 (teal → deep teal)
};

export type Team = "A" | "B";

export const TEAMS = {
  A: {
    name: "Team A",
    players: [1, 3] as number[], // Red and Yellow
  },
  B: {
    name: "Team B",
    players: [2, 4] as number[], // Blue and Green
  },
};

// Helper function to get player team
export function getPlayerTeam(playerNumber: number): "A" | "B" | null {
  if (TEAMS.A.players.includes(playerNumber)) return "A";
  if (TEAMS.B.players.includes(playerNumber)) return "B";
  return null;
}
