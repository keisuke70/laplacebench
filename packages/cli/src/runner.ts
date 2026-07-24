import "./env";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  colorName,
  failureCode,
  legalMoves,
  newGame,
  playerTeam,
  repetitionKey,
  winReason,
} from "./engine";
import type { Agent, RecentEvent, TeamId, UsageAggregate } from "./types";
import { blankUsage, recordUsageCall } from "./usage";

export interface TeamStats {
  agent: string;
  turns: number;
  moves: number;
  actCalls: number;
  formatFailures: number;
  legalityFailures: number;
  failedTurns: number;
  forcedPasses: number;
  timeoutSkips: number;
  tokenBudgetSkips: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  latencyMs: number;
  usage: UsageAggregate;
}

export interface GameResult {
  gameId: string;
  ruleset: string;
  seed: number;
  winner: TeamId | null;
  reason: "center" | "elimination" | "horizon_draw" | "repetition_draw";
  plies: number;
  losses: Record<string, number>;
  teams: Record<TeamId, TeamStats>;
}

export interface GameConfig {
  gameId: string;
  runDir: string;
  seed: number;
  maxPlies: number;
  /** Shared by both repair attempts. Defaults to five minutes. */
  turnTimeoutMs?: number;
  /** Per-team in-game output-token admission cap. Omit for no cap. */
  outputTokenBudget?: number;
  agents: Record<TeamId, Agent>;
}

const RULESET = "laplace-8x8-v1";

/**
 * Canonical ply cap for laplace-8x8-v1 bench matches — provisional-canonical
 * for the stage-0.5 pilot; final v1 freeze happens after the pilot's
 * horizon-draw rate is reviewed. See docs/match-conduct-laplace-8x8-v1.md.
 */
export const CANONICAL_MAX_PLIES = 100;

/** Third occurrence of the same game-relevant state ends the game as a draw. */
export const REPETITION_DRAW_OCCURRENCES = 3;

/** CLI `--max-plies` resolution: omission selects the canonical cap. */
export function resolveMaxPlies(raw: unknown): number {
  if (raw === undefined) return CANONICAL_MAX_PLIES;
  const s = String(raw);
  if (!/^\d+$/.test(s)) {
    throw new Error("--max-plies must be a positive integer");
  }
  const n = parseInt(s, 10);
  if (!Number.isSafeInteger(n) || n <= 0) {
    throw new Error("--max-plies must be a positive integer");
  }
  return n;
}

/**
 * Per-iteration termination decision. Pure so the precedence invariant
 * (normal end > repetition draw > horizon draw) is pinned by unit tests even
 * for combinations real play cannot reach.
 */
export function classifyTermination(input: {
  gameEnded: boolean;
  occurrences: number;
  ply: number;
  maxPlies: number;
}): "normal_end" | "repetition_draw" | "horizon_draw" | null {
  if (input.gameEnded) return "normal_end";
  if (input.occurrences >= REPETITION_DRAW_OCCURRENCES) return "repetition_draw";
  if (input.ply >= input.maxPlies) return "horizon_draw";
  return null;
}

function newTeamStats(agent: Agent): TeamStats {
  return {
    agent: agent.name,
    turns: 0,
    moves: 0,
    actCalls: 0,
    formatFailures: 0,
    legalityFailures: 0,
    failedTurns: 0,
    forcedPasses: 0,
    timeoutSkips: 0,
    tokenBudgetSkips: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    latencyMs: 0,
    usage: blankUsage(agent.usageProfile),
  };
}

function syncLegacyUsageFields(stats: TeamStats): void {
  // Compatibility aliases for existing replay/UI consumers. Unlike the old
  // implementation, inputTokens now means total input including cache once.
  stats.inputTokens = stats.usage.inputTotalTokens;
  stats.outputTokens = stats.usage.outputTotalTokens;
  stats.cacheReadTokens = stats.usage.cacheReadTokens;
}

export async function playGame(cfg: GameConfig): Promise<GameResult> {
  try {
    return await playGameInner(cfg);
  } finally {
    // Agents may own external resources (e.g. the product CPU bridge child
    // process); release them on every exit path, not only after endGame.
    for (const team of ["A", "B"] as const) {
      try {
        await cfg.agents[team].dispose?.();
      } catch {
        // disposal failures must not mask the game result or original error
      }
    }
  }
}

async function playGameInner(cfg: GameConfig): Promise<GameResult> {
  const gameDir = path.join(cfg.runDir, "games", cfg.gameId);
  fs.mkdirSync(gameDir, { recursive: true });
  const eventsPath = path.join(gameDir, "events.jsonl");
  const emit = (e: object) =>
    fs.appendFileSync(eventsPath, JSON.stringify(e) + "\n");

  const manager = newGame();
  const stats: Record<TeamId, TeamStats> = {
    A: newTeamStats(cfg.agents.A),
    B: newTeamStats(cfg.agents.B),
  };
  const recent: Record<TeamId, RecentEvent[]> = { A: [], B: [] };

  emit({
    t: "game_start",
    game_id: cfg.gameId,
    ruleset: RULESET,
    seed: cfg.seed,
    max_plies: cfg.maxPlies,
    turn_timeout_ms: cfg.turnTimeoutMs ?? 300_000,
    output_token_budget_per_team: cfg.outputTokenBudget ?? null,
    team_a: cfg.agents.A.name,
    team_b: cfg.agents.B.name,
    ts: new Date().toISOString(),
  });

  await cfg.agents.A.startGame?.("A", cfg.gameId);
  await cfg.agents.B.startGame?.("B", cfg.gameId);

  let ply = 0;
  const pushEvent = (e: RecentEvent) => {
    recent.A.push(e);
    recent.B.push(e);
  };

  // Termination precedence per docs/plans/2026-07-24-freeze-draw-rules.md:
  // normal end (center/elimination) > repetition draw > horizon draw. The
  // repetition count applies to every reached nonterminal state — including
  // the one produced by the last permitted ply, which the old
  // `ply < maxPlies` loop condition would misclassify as a horizon draw.
  const repetitionCounts = new Map<string, number>();
  let repetitionDraw = false;

  while (true) {
    const gameEnded = !!manager.state.gameEndedAt;
    let occurrences = 0;
    if (!gameEnded) {
      const stateKey = repetitionKey(manager.state);
      occurrences = (repetitionCounts.get(stateKey) ?? 0) + 1;
      repetitionCounts.set(stateKey, occurrences);
    }
    const termination = classifyTermination({
      gameEnded,
      occurrences,
      ply,
      maxPlies: cfg.maxPlies,
    });
    if (termination === "repetition_draw") {
      repetitionDraw = true;
      emit({ t: "repetition_draw", ply, occurrences });
    }
    if (termination !== null) break;

    const state = manager.state;
    const actingPlayer = state.currentPlayer;
    const team = playerTeam(actingPlayer);
    const agent = cfg.agents[team];
    const legal = legalMoves(state);
    const st = stats[team];
    st.turns++;

    if (legal.length === 0) {
      const beforeElim = [...state.eliminatedPlayers];
      manager.advanceTurn();
      const eliminated = manager.state.eliminatedPlayers.findIndex(
        (e, i) => e && !beforeElim[i]
      );
      st.forcedPasses++;
      const ev: RecentEvent = {
        ply,
        color: colorName(actingPlayer),
        action: "pass",
        eliminated: eliminated >= 0 ? colorName(eliminated + 1) : null,
      };
      pushEvent(ev);
      emit({ t: "pass", ply, player: actingPlayer, reason: "no_legal_moves", eliminated: ev.eliminated });
      ply++;
      continue;
    }

    // Admission is checked once per game turn. If the team is still below
    // the cap, the whole turn (including a repair attempt) may complete and
    // overshoot it. The next turn will then be skipped.
    if (
      agent.usageProfile &&
      cfg.outputTokenBudget !== undefined &&
      st.usage.outputTotalTokens >= cfg.outputTokenBudget
    ) {
      const beforeElim = [...state.eliminatedPlayers];
      manager.advanceTurn();
      const eliminated = manager.state.eliminatedPlayers.findIndex(
        (e, i) => e && !beforeElim[i]
      );
      st.tokenBudgetSkips++;
      const ev: RecentEvent = {
        ply,
        color: colorName(actingPlayer),
        action: "pass",
        eliminated: eliminated >= 0 ? colorName(eliminated + 1) : null,
      };
      pushEvent(ev);
      emit({
        t: "pass",
        ply,
        player: actingPlayer,
        reason: "token_budget",
        output_tokens_used: st.usage.outputTotalTokens,
        output_token_budget: cfg.outputTokenBudget,
        eliminated: ev.eliminated,
      });
      ply++;
      continue;
    }

    const teamRecent = recent[team];
    recent[team] = [];
    const deadlineAtMs = Date.now() + (cfg.turnTimeoutMs ?? 300_000);

    let moved = false;
    let timedOut = false;
    let error: { code: ReturnType<typeof failureCode> } | undefined;
    for (let attempt = 1; attempt <= 2 && !moved; attempt++) {
      if (Date.now() >= deadlineAtMs) {
        timedOut = true;
        break;
      }
      const reply = await agent.act({
        state,
        ply,
        actingPlayer,
        team,
        legal,
        recent: teamRecent,
        attempt,
        error,
        maxPlies: cfg.maxPlies,
        deadlineAtMs,
      });
      st.actCalls++;
      if (reply.latencyMs) st.latencyMs += reply.latencyMs;
      if (agent.usageProfile || reply.usage) {
        recordUsageCall(st.usage, reply.usage, agent.usageProfile);
        syncLegacyUsageFields(st);
        emit({
          t: "usage",
          phase: "play",
          team,
          ply,
          attempt,
          usage: reply.usage ?? null,
        });
      }
      if (reply.timedOut || Date.now() >= deadlineAtMs) {
        timedOut = true;
        emit({
          t: "failure",
          ply,
          attempt,
          kind: "timeout",
          deadline_ms: cfg.turnTimeoutMs ?? 300_000,
          raw: reply.raw?.slice(0, 500),
        });
        break;
      }

      if (!reply.move) {
        st.formatFailures++;
        error = { code: "E_BAD_FORMAT" };
        emit({ t: "failure", ply, attempt, kind: "format", raw: reply.raw?.slice(0, 500) });
        continue;
      }

      const { from, to } = reply.move;
      const res = manager.makeMove(from.row, from.col, to.row, to.col);
      if (!res.valid) {
        st.legalityFailures++;
        const code = failureCode(res.message);
        error = { code };
        emit({
          t: "failure",
          ply,
          attempt,
          kind: "legality",
          code,
          from: [from.row, from.col],
          to: [to.row, to.col],
        });
        continue;
      }

      moved = true;
      st.moves++;
      const last = res.state.lastMove;
      const captures = (last?.capturedPiecesMeta ?? []).map((c) => ({
        at: c.position,
        owner: colorName(c.player),
      }));
      const eliminated =
        last?.eliminatedPlayer != null ? colorName(last.eliminatedPlayer) : null;
      const ev: RecentEvent = {
        ply,
        color: colorName(actingPlayer),
        action: "move",
        from: [from.row, from.col],
        to: [to.row, to.col],
        captures,
        eliminated,
      };
      pushEvent(ev);
      emit({
        t: "move",
        ply,
        player: actingPlayer,
        from: [from.row, from.col],
        to: [to.row, to.col],
        captures,
        eliminated,
        winner: res.state.winningTeam,
        // The model's visible reply text — the "why" behind the move.
        // Powers the spectator commentary view; bounded to keep logs sane.
        raw: reply.raw?.slice(0, 4000),
        // Agent-specific provenance (e.g. product CPU per-move seed).
        meta: reply.meta,
      });
    }

    if (!moved) {
      const beforeElim = [...manager.state.eliminatedPlayers];
      manager.advanceTurn();
      const eliminatedIdx = manager.state.eliminatedPlayers.findIndex(
        (e, i) => e && !beforeElim[i]
      );
      st.failedTurns++;
      if (timedOut) st.timeoutSkips++;
      const ev: RecentEvent = {
        ply,
        color: colorName(actingPlayer),
        action: "pass",
        eliminated: eliminatedIdx >= 0 ? colorName(eliminatedIdx + 1) : null,
      };
      pushEvent(ev);
      emit({
        t: "pass",
        ply,
        player: actingPlayer,
        reason: timedOut ? "timeout" : "failed_turn",
        eliminated: ev.eliminated,
      });
    }

    ply++;
  }

  const finalState = manager.state;
  const horizon = !finalState.gameEndedAt && !repetitionDraw;
  const reason: GameResult["reason"] = repetitionDraw
    ? "repetition_draw"
    : winReason(finalState, horizon) ?? "horizon_draw";
  const losses: Record<string, number> = {};
  for (let p = 1; p <= 4; p++) losses[colorName(p)] = finalState.capturedPieces[p - 1];

  const result: GameResult = {
    gameId: cfg.gameId,
    ruleset: RULESET,
    seed: cfg.seed,
    winner: finalState.winningTeam,
    reason,
    plies: ply,
    losses,
    teams: stats,
  };

  emit({ t: "game_end", winner: result.winner, reason, plies: ply, losses, ts: new Date().toISOString() });
  fs.writeFileSync(
    path.join(gameDir, "final.json"),
    JSON.stringify(result, null, 2)
  );
  for (const team of ["A", "B"] as const) {
    await cfg.agents[team].endGame?.({
      gameId: cfg.gameId,
      team,
      result:
        result.winner === null ? "draw" : result.winner === team ? "win" : "loss",
      winner: result.winner,
      reason,
      plies: ply,
      eventsPath,
    });
  }

  return result;
}
