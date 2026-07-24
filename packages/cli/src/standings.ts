import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Canonical regeneration command — used verbatim in the README, the wizard's
 * submission guidance, the generated Markdown, and the CI gate's failure
 * message, so contributors always see exactly one command.
 */
export const STANDINGS_REGEN_COMMAND =
  "npx laplacebench standings community/runs/* --out community/STANDINGS.md --json-out community/standings.json";

export interface StandingsRow {
  agent: string;
  games: number;
  wins: number;
  draws: number;
  losses: number;
  center_wins: number;
  elim_wins: number;
  horizon_draws: number;
  repetition_draws: number;
  /** errors per turn rounded to 3 decimals; null when the agent had no turns */
  err_per_turn: number | null;
}

export interface StandingsData {
  schema: "laplace-bench-standings-v1";
  lane: "community";
  game_count: number;
  run_count: number;
  rows: StandingsRow[];
}

interface Agg {
  agent: string;
  games: number;
  wins: number;
  draws: number;
  losses: number;
  centerWins: number;
  elimWins: number;
  horizonDraws: number;
  repetitionDraws: number;
  errors: number;
  turns: number;
}

/**
 * Single computation behind both the Markdown table and the public JSON.
 * Deterministic byte contract (docs/plans/2026-07-25-standings-json.md):
 * total order = wins desc, win-rate desc, then ordinal code-unit agent-name
 * asc (no locale collation); err_per_turn = Math.round(x*1000)/1000.
 */
export function standingsData(runDirs: string[]): StandingsData {
  const rows = new Map<string, Agg>();
  const row = (agent: string): Agg => {
    let r = rows.get(agent);
    if (!r) {
      r = { agent, games: 0, wins: 0, draws: 0, losses: 0, centerWins: 0, elimWins: 0, horizonDraws: 0, repetitionDraws: 0, errors: 0, turns: 0 };
      rows.set(agent, r);
    }
    return r;
  };

  let gameCount = 0;
  let runCount = 0;
  for (const runDir of runDirs) {
    const gamesDir = path.join(runDir, "games");
    if (!fs.existsSync(gamesDir)) continue;
    runCount++;
    for (const g of fs.readdirSync(gamesDir).sort()) {
      const finalPath = path.join(gamesDir, g, "final.json");
      if (!fs.existsSync(finalPath)) continue;
      const fin = JSON.parse(fs.readFileSync(finalPath, "utf8"));
      gameCount++;
      for (const team of ["A", "B"] as const) {
        const t = fin.teams[team];
        const r = row(t.agent);
        r.games++;
        if (fin.winner === null) {
          r.draws++;
          if (fin.reason === "horizon_draw") r.horizonDraws++;
          if (fin.reason === "repetition_draw") r.repetitionDraws++;
        } else if (fin.winner === team) {
          r.wins++;
          if (fin.reason === "center") r.centerWins++;
          if (fin.reason === "elimination") r.elimWins++;
        } else r.losses++;
        r.errors += t.legalityFailures + t.formatFailures;
        r.turns += t.turns;
      }
    }
  }

  const sorted = [...rows.values()].sort((a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins;
    const ra = a.wins / Math.max(1, a.games);
    const rb = b.wins / Math.max(1, b.games);
    if (rb !== ra) return rb - ra;
    // ordinal code-unit comparison — environment-independent
    return a.agent < b.agent ? -1 : a.agent > b.agent ? 1 : 0;
  });

  return {
    schema: "laplace-bench-standings-v1",
    lane: "community",
    game_count: gameCount,
    run_count: runCount,
    rows: sorted.map((r) => ({
      agent: r.agent,
      games: r.games,
      wins: r.wins,
      draws: r.draws,
      losses: r.losses,
      center_wins: r.centerWins,
      elim_wins: r.elimWins,
      horizon_draws: r.horizonDraws,
      repetition_draws: r.repetitionDraws,
      err_per_turn:
        r.turns > 0 ? Math.round((r.errors / r.turns) * 1000) / 1000 : null,
    })),
  };
}

/** Public JSON artifact: 2-space indent, exactly one trailing newline. */
export function standingsJson(runDirs: string[]): string {
  return JSON.stringify(standingsData(runDirs), null, 2) + "\n";
}

/**
 * Aggregate standings across many run directories into a markdown table.
 * Used for the community lane (community/STANDINGS.md). Derived from
 * standingsData — never a second computation.
 */
export function standingsMarkdown(runDirs: string[]): string {
  const data = standingsData(runDirs);
  const lines = [
    `# Community standings`,
    ``,
    `${data.game_count} games across ${data.run_count} run(s). Regenerate with:`,
    "`" + STANDINGS_REGEN_COMMAND + "`",
    ``,
    `| agent | G | W | D | L | center | elim | D:horizon | D:repetition | err/turn |`,
    `|---|---|---|---|---|---|---|---|---|---|`,
    ...data.rows.map(
      (r) =>
        `| \`${r.agent}\` | ${r.games} | ${r.wins} | ${r.draws} | ${r.losses} | ${r.center_wins} | ${r.elim_wins} | ${r.horizon_draws} | ${r.repetition_draws} | ${r.err_per_turn === null ? "-" : r.err_per_turn.toFixed(3)} |`
    ),
    ``,
    `Conditions (model, effort, harness) are labeled in agent names; small samples.`,
  ];
  return lines.join("\n") + "\n";
}
