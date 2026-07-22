import * as fs from "node:fs";
import * as path from "node:path";
import type { GameResult } from "./runner";
import type { UsageAggregate } from "./types";
import {
  blankUsage,
  isUsageAggregate,
  legacyUsageFromTeamStats,
  mergeUsage,
  usageSummary,
} from "./usage";

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
  timeoutSkips: number;
  tokenBudgetSkips: number;
  usage: UsageAggregate;
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
    timeoutSkips: 0,
    tokenBudgetSkips: 0,
    usage: blankUsage(),
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
      agg.timeoutSkips += ts.timeoutSkips ?? 0;
      agg.tokenBudgetSkips += ts.tokenBudgetSkips ?? 0;
      mergeUsage(
        agg.usage,
        isUsageAggregate(ts.usage) ? ts.usage : legacyUsageFromTeamStats(ts)
      );
      agg.latencyMs += ts.latencyMs;
      agg.plies += r.plies;
    }
  }

  const summary = {
    run_dir: runDir,
    usage_schema: "laplace-model-usage-v1",
    usage_comparability: {
      token_totals:
        "directly comparable only within the same provider, model, adapter, effort, and harness version",
      cross_provider:
        "descriptive only: tokenizers and provider-injected CLI context differ",
      application_bytes:
        "tokenizer-neutral LaplaceBench logical-turn I/O only; excludes provider-injected context and hidden reasoning",
    },
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
          timeout_skips: a.timeoutSkips,
          token_budget_skips: a.tokenBudgetSkips,
          turns: a.turns,
          // Backward-compatible aliases. `tokens_in` is now normalized total
          // input and includes cached input exactly once.
          tokens_in: a.usage.inputTotalTokens,
          tokens_out: a.usage.outputTotalTokens,
          tokens_cache_read: a.usage.cacheReadTokens,
          usage: usageSummary(a.usage, { games: a.games, turns: a.turns }),
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
