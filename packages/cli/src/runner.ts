import "./env";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  colorName,
  failureCode,
  legalMoves,
  newGame,
  playerTeam,
  winReason,
} from "./engine";
import type { Agent, RecentEvent, TeamId } from "./types";

export interface TeamStats {
  agent: string;
  turns: number;
  moves: number;
  actCalls: number;
  formatFailures: number;
  legalityFailures: number;
  failedTurns: number;
  forcedPasses: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  latencyMs: number;
}

export interface GameResult {
  gameId: string;
  ruleset: string;
  seed: number;
  winner: TeamId | null;
  reason: "center" | "elimination" | "horizon_draw";
  plies: number;
  losses: Record<string, number>;
  teams: Record<TeamId, TeamStats>;
}

export interface GameConfig {
  gameId: string;
  runDir: string;
  seed: number;
  maxPlies: number;
  agents: Record<TeamId, Agent>;
}

const RULESET = "laplace-8x8-v1";

function newTeamStats(agent: string): TeamStats {
  return {
    agent,
    turns: 0,
    moves: 0,
    actCalls: 0,
    formatFailures: 0,
    legalityFailures: 0,
    failedTurns: 0,
    forcedPasses: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    latencyMs: 0,
  };
}

export async function playGame(cfg: GameConfig): Promise<GameResult> {
  const gameDir = path.join(cfg.runDir, "games", cfg.gameId);
  fs.mkdirSync(gameDir, { recursive: true });
  const eventsPath = path.join(gameDir, "events.jsonl");
  const emit = (e: object) =>
    fs.appendFileSync(eventsPath, JSON.stringify(e) + "\n");

  const manager = newGame();
  const stats: Record<TeamId, TeamStats> = {
    A: newTeamStats(cfg.agents.A.name),
    B: newTeamStats(cfg.agents.B.name),
  };
  const recent: Record<TeamId, RecentEvent[]> = { A: [], B: [] };

  emit({
    t: "game_start",
    game_id: cfg.gameId,
    ruleset: RULESET,
    seed: cfg.seed,
    max_plies: cfg.maxPlies,
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

  while (!manager.state.gameEndedAt && ply < cfg.maxPlies) {
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

    const teamRecent = recent[team];
    recent[team] = [];

    let moved = false;
    let error: { code: ReturnType<typeof failureCode> } | undefined;
    for (let attempt = 1; attempt <= 2 && !moved; attempt++) {
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
      });
      st.actCalls++;
      if (reply.latencyMs) st.latencyMs += reply.latencyMs;
      if (reply.usage) {
        st.inputTokens += reply.usage.inputTokens;
        st.outputTokens += reply.usage.outputTokens;
        st.cacheReadTokens += reply.usage.cacheReadTokens ?? 0;
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
      });
    }

    if (!moved) {
      const beforeElim = [...manager.state.eliminatedPlayers];
      manager.advanceTurn();
      const eliminatedIdx = manager.state.eliminatedPlayers.findIndex(
        (e, i) => e && !beforeElim[i]
      );
      st.failedTurns++;
      const ev: RecentEvent = {
        ply,
        color: colorName(actingPlayer),
        action: "pass",
        eliminated: eliminatedIdx >= 0 ? colorName(eliminatedIdx + 1) : null,
      };
      pushEvent(ev);
      emit({ t: "pass", ply, player: actingPlayer, reason: "failed_turn", eliminated: ev.eliminated });
    }

    ply++;
  }

  const finalState = manager.state;
  const horizon = !finalState.gameEndedAt;
  const reason = winReason(finalState, horizon) ?? "horizon_draw";
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
