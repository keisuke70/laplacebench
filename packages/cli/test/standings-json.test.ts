import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import { randomAgent } from "../src/agents/random";
import { positionals } from "../src/cli";
import { playGame } from "../src/runner";
import {
  STANDINGS_REGEN_COMMAND,
  standingsData,
  standingsJson,
  standingsMarkdown,
} from "../src/standings";
import { submissionGuidance } from "../src/wizard";

function writeRun(dir: string, gameId: string, fin: object): void {
  const g = path.join(dir, "games", gameId);
  fs.mkdirSync(g, { recursive: true });
  fs.writeFileSync(path.join(g, "final.json"), JSON.stringify(fin));
}

function team(agent: string, turns = 10, legality = 0, format = 0) {
  return { agent, turns, legalityFailures: legality, formatFailures: format };
}

test("standings golden bytes: property order, rounding, null err, one trailing newline", () => {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "laplace-golden-"));
  // "B-agent" and "a-agent" are BOTH 1W over 2 games (identical wins AND
  // win rate), so ordering falls to the tertiary ordinal comparator:
  // "B" (0x42) < "a" (0x61) — locale collation would order them the other
  // way, so this fixture distinguishes the two. B-agent has 1 error in
  // 3+7 turns... use 3 turns in game-000 for the 0.333 rounding boundary
  // via a third agent; idle has 0 turns -> err null.
  writeRun(runDir, "game-000", {
    winner: "A", reason: "center",
    teams: { A: team("B-agent"), B: team("a-agent") },
  });
  writeRun(runDir, "game-001", {
    winner: "B", reason: "elimination",
    teams: { A: team("B-agent"), B: team("a-agent") },
  });
  writeRun(runDir, "game-002", {
    winner: "A", reason: "center",
    teams: { A: team("rounder", 3, 1, 0), B: team("idle", 0) },
  });
  const json = standingsJson([runDir]);
  const expected = `{
  "schema": "laplace-bench-standings-v1",
  "lane": "community",
  "game_count": 3,
  "run_count": 1,
  "rows": [
    {
      "agent": "rounder",
      "games": 1,
      "wins": 1,
      "draws": 0,
      "losses": 0,
      "center_wins": 1,
      "elim_wins": 0,
      "horizon_draws": 0,
      "repetition_draws": 0,
      "err_per_turn": 0.333
    },
    {
      "agent": "B-agent",
      "games": 2,
      "wins": 1,
      "draws": 0,
      "losses": 1,
      "center_wins": 1,
      "elim_wins": 0,
      "horizon_draws": 0,
      "repetition_draws": 0,
      "err_per_turn": 0
    },
    {
      "agent": "a-agent",
      "games": 2,
      "wins": 1,
      "draws": 0,
      "losses": 1,
      "center_wins": 0,
      "elim_wins": 1,
      "horizon_draws": 0,
      "repetition_draws": 0,
      "err_per_turn": 0
    },
    {
      "agent": "idle",
      "games": 1,
      "wins": 0,
      "draws": 0,
      "losses": 1,
      "center_wins": 0,
      "elim_wins": 0,
      "horizon_draws": 0,
      "repetition_draws": 0,
      "err_per_turn": null
    }
  ]
}
`;
  assert.equal(json, expected);
  // two-call determinism
  assert.equal(standingsJson([runDir]), json);
  // markdown derives from the same data; command line appears VERBATIM
  const md = standingsMarkdown([runDir]);
  assert.ok(md.includes("\`" + STANDINGS_REGEN_COMMAND + "\`"));
  assert.ok(md.indexOf("`B-agent`") < md.indexOf("`a-agent`"));
  assert.ok(md.includes("| `idle` | 1 | 0 | 0 | 1 | 0 | 0 | 0 | 0 | - |"));
});

test("zero runs produce an empty but valid document", () => {
  const data = standingsData([]);
  assert.equal(data.game_count, 0);
  assert.equal(data.run_count, 0);
  assert.deepEqual(data.rows, []);
  assert.ok(standingsJson([]).endsWith("\n"));
});

test("positionals exclude option values (latent standings bug)", () => {
  assert.deepEqual(
    positionals(["community/runs/a", "--out", "x.md", "--json-out", "y.json", "community/runs/b"]),
    ["community/runs/a", "community/runs/b"]
  );
});

test("CLI standings writes json alone and combined with md", async () => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "laplace-cli-json-"));
  await playGame({
    gameId: "game-000",
    runDir: path.join(workDir, "r1"),
    seed: 5,
    maxPlies: 6,
    agents: { A: randomAgent(1), B: randomAgent(2) },
  });
  const { execFileSync } = await import("node:child_process");
  const jsonPath = path.join(workDir, "standings.json");
  const mdPath = path.join(workDir, "STANDINGS.md");
  execFileSync("npx", ["tsx", "src/cli.ts", "standings", path.join(workDir, "r1"), "--json-out", jsonPath], { stdio: "ignore" });
  const parsed = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  assert.equal(parsed.schema, "laplace-bench-standings-v1");
  execFileSync("npx", ["tsx", "src/cli.ts", "standings", path.join(workDir, "r1"), "--out", mdPath, "--json-out", jsonPath], { stdio: "ignore" });
  assert.ok(fs.existsSync(mdPath));
  assert.ok(fs.existsSync(jsonPath));
});

test("submission guidance carries the canonical command verbatim", () => {
  const lines = submissionGuidance("run-y");
  assert.ok(lines.includes(`  ${STANDINGS_REGEN_COMMAND}`));
  assert.ok(STANDINGS_REGEN_COMMAND.startsWith("npx laplacebench standings "));
});

test("README and CI gate use the exact canonical command", () => {
  const readme = fs.readFileSync(path.join(__dirname, "../../../community/README.md"), "utf8");
  assert.ok(readme.includes(STANDINGS_REGEN_COMMAND));
  const workflow = fs.readFileSync(
    path.join(__dirname, "../../../.github/workflows/community-verify.yml"),
    "utf8"
  );
  assert.ok(workflow.includes(STANDINGS_REGEN_COMMAND));
});
