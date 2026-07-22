import type { GameState } from "laplace-engine";

export type RC = { row: number; col: number };
export type Move = { from: RC; to: RC };
export type TeamId = "A" | "B";

export const COLOR_NAMES = ["Red", "Blue", "Yellow", "Green"] as const;
export const COLOR_CHARS = ["R", "B", "Y", "G"] as const;
export const TEAM_PLAYERS: Record<TeamId, number[]> = { A: [1, 3], B: [2, 4] };

export type FailureCode =
  | "E_BAD_FORMAT"
  | "E_OFF_BOARD"
  | "E_NO_PIECE_AT_FROM"
  | "E_NOT_YOUR_PIECE"
  | "E_DEST_OCCUPIED"
  | "E_BAD_PATH";

export interface RecentEvent {
  ply: number;
  color: string;
  action: "move" | "pass";
  from?: [number, number];
  to?: [number, number];
  captures?: { at: [number, number]; owner: string }[];
  eliminated?: string | null;
}

export interface TurnInput {
  state: GameState;
  ply: number;
  actingPlayer: number;
  team: TeamId;
  /** Legal moves for baselines. LLM adapters MUST NOT show these to the model. */
  legal: Move[];
  /** Events since this team's previous turn (opponent moves, passes). */
  recent: RecentEvent[];
  attempt: number;
  error?: { code: FailureCode };
  maxPlies: number;
}

export const MODEL_USAGE_SCHEMA = "laplace-model-usage-v1" as const;

export type UsageProvider = "anthropic" | "openai";
export type UsageSource = "anthropic-api" | "claude-cli" | "codex-cli";

/**
 * Provider-reported usage normalized to one semantic shape.
 *
 * `inputTotalTokens` always includes cached input exactly once. Anthropic
 * reports uncached, cache-write, and cache-read input as three additive
 * fields; OpenAI reports total input with cached input as a subset. Keeping
 * both the total and the cache buckets prevents accidental double-counting.
 * `outputTotalTokens` is inclusive of reasoning tokens for both providers.
 */
export interface ModelUsage {
  schema: typeof MODEL_USAGE_SCHEMA;
  provider: UsageProvider;
  source: UsageSource;
  inputTotalTokens: number;
  inputUncachedTokens: number;
  cacheReadTokens: number;
  /** null means the provider surface did not report this bucket. */
  cacheWriteTokens: number | null;
  outputTotalTokens: number;
  /** null means the provider surface did not expose the reasoning split. */
  reasoningTokens: number | null;
  /** UTF-8 bytes newly added by LaplaceBench, excluding provider/CLI prompts. */
  applicationInputBytes: number;
  /** UTF-8 bytes of model text observed by LaplaceBench. */
  applicationOutputBytes: number;
}

export interface UsageProfile {
  provider: UsageProvider;
  source: UsageSource;
}

export interface UsageAggregate {
  schema: typeof MODEL_USAGE_SCHEMA;
  adapterCalls: number;
  reportedCalls: number;
  unreportedCalls: number;
  /** Calls imported from artifacts written before this schema existed. */
  legacyUnversionedCalls: number;
  providers: UsageProvider[];
  sources: UsageSource[];
  inputTotalTokens: number;
  inputUncachedTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  cacheWriteReportedCalls: number;
  outputTotalTokens: number;
  reasoningTokens: number;
  reasoningReportedCalls: number;
  applicationInputBytes: number;
  applicationOutputBytes: number;
}

export interface AgentReply {
  move: Move | null;
  raw?: string;
  latencyMs?: number;
  usage?: ModelUsage;
}

export interface EndGameInfo {
  gameId: string;
  team: TeamId;
  result: "win" | "loss" | "draw";
  winner: TeamId | null;
  reason: string;
  plies: number;
  eventsPath: string;
}

export interface Agent {
  name: string;
  /** Present when each `act` call is expected to produce model usage. */
  usageProfile?: UsageProfile;
  startGame?(team: TeamId, gameId: string): Promise<void> | void;
  act(input: TurnInput): Promise<AgentReply> | AgentReply;
  endGame?(
    info?: EndGameInfo
  ):
    | Promise<{ usageReports?: Array<ModelUsage | null> } | void>
    | { usageReports?: Array<ModelUsage | null> }
    | void;
}

/** mulberry32 seeded PRNG */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
