import * as fs from "node:fs";
import * as path from "node:path";

interface Agg {
  agent: string;
  games: number;
  wins: number;
  draws: number;
  losses: number;
  centerWins: number;
  elimWins: number;
  errors: number;
  turns: number;
}

/**
 * Aggregate standings across many run directories into a markdown table.
 * Used for the community lane (community/STANDINGS.md).
 */
export function standingsMarkdown(runDirs: string[]): string {
  const rows = new Map<string, Agg>();
  const row = (agent: string): Agg => {
    let r = rows.get(agent);
    if (!r) {
      r = { agent, games: 0, wins: 0, draws: 0, losses: 0, centerWins: 0, elimWins: 0, errors: 0, turns: 0 };
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
        if (fin.winner === null) r.draws++;
        else if (fin.winner === team) {
          r.wins++;
          if (fin.reason === "center") r.centerWins++;
          if (fin.reason === "elimination") r.elimWins++;
        } else r.losses++;
        r.errors += t.legalityFailures + t.formatFailures;
        r.turns += t.turns;
      }
    }
  }

  const sorted = [...rows.values()].sort(
    (a, b) => b.wins - a.wins || b.wins / Math.max(1, b.games) - a.wins / Math.max(1, a.games)
  );

  const lines = [
    `# Community standings`,
    ``,
    `${gameCount} games across ${runCount} run(s). Regenerate with:`,
    "`laplacebench standings community/runs/* --out community/STANDINGS.md`",
    ``,
    `| agent | G | W | D | L | center | elim | err/turn |`,
    `|---|---|---|---|---|---|---|---|`,
    ...sorted.map(
      (r) =>
        `| \`${r.agent}\` | ${r.games} | ${r.wins} | ${r.draws} | ${r.losses} | ${r.centerWins} | ${r.elimWins} | ${r.turns > 0 ? (r.errors / r.turns).toFixed(3) : "-"} |`
    ),
    ``,
    `Conditions (model, effort, harness) are labeled in agent names; small samples.`,
  ];
  return lines.join("\n") + "\n";
}
