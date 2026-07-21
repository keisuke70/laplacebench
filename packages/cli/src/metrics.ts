import * as fs from "node:fs";
import * as path from "node:path";
import type { GameResult } from "./runner";

interface AgentAgg {
  games: number;
  wins: number;
  draws: number;
  losses: number;
  winReasons: Record<string, number>;
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
  plies: number;
}

function blank(): AgentAgg {
  return {
    games: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    winReasons: {},
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
    plies: 0,
  };
}

export function summarize(runDir: string): object {
  const gamesDir = path.join(runDir, "games");
  const results: GameResult[] = fs
    .readdirSync(gamesDir)
    .sort()
    .map((g) => path.join(gamesDir, g, "final.json"))
    .filter((p) => fs.existsSync(p))
    .map((p) => JSON.parse(fs.readFileSync(p, "utf8")));

  const agents: Record<string, AgentAgg> = {};
  for (const r of results) {
    for (const team of ["A", "B"] as const) {
      const ts = r.teams[team];
      const agg = (agents[ts.agent] ??= blank());
      agg.games++;
      if (r.winner === null) agg.draws++;
      else if (r.winner === team) {
        agg.wins++;
        agg.winReasons[r.reason] = (agg.winReasons[r.reason] ?? 0) + 1;
      } else agg.losses++;
      agg.turns += ts.turns;
      agg.moves += ts.moves;
      agg.actCalls += ts.actCalls;
      agg.formatFailures += ts.formatFailures;
      agg.legalityFailures += ts.legalityFailures;
      agg.failedTurns += ts.failedTurns;
      agg.forcedPasses += ts.forcedPasses;
      agg.inputTokens += ts.inputTokens;
      agg.outputTokens += ts.outputTokens;
      agg.cacheReadTokens += ts.cacheReadTokens;
      agg.latencyMs += ts.latencyMs;
      agg.plies += r.plies;
    }
  }

  const summary = {
    run_dir: runDir,
    games: results.length,
    avg_plies:
      results.length > 0
        ? Math.round(results.reduce((s, r) => s + r.plies, 0) / results.length)
        : 0,
    results: results.map((r) => ({
      game: r.gameId,
      team_a: r.teams.A.agent,
      team_b: r.teams.B.agent,
      winner: r.winner,
      reason: r.reason,
      plies: r.plies,
    })),
    agents: Object.fromEntries(
      Object.entries(agents).map(([name, a]) => [
        name,
        {
          record: `${a.wins}W-${a.draws}D-${a.losses}L`,
          win_reasons: a.winReasons,
          illegal_rate_per_turn:
            a.turns > 0 ? +(a.legalityFailures / a.turns).toFixed(3) : 0,
          format_failure_rate_per_turn:
            a.turns > 0 ? +(a.formatFailures / a.turns).toFixed(3) : 0,
          failed_turns: a.failedTurns,
          forced_passes: a.forcedPasses,
          turns: a.turns,
          tokens_in: a.inputTokens,
          tokens_out: a.outputTokens,
          tokens_cache_read: a.cacheReadTokens,
          avg_latency_ms:
            a.actCalls > 0 ? Math.round(a.latencyMs / a.actCalls) : 0,
        },
      ])
    ),
  };

  fs.writeFileSync(
    path.join(runDir, "summary.json"),
    JSON.stringify(summary, null, 2)
  );
  return summary;
}
