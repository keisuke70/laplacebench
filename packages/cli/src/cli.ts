import "./env";
import * as fs from "node:fs";
import * as path from "node:path";
import { centerGreedyAgent } from "./agents/centergreedy";
import { chaosAgent } from "./agents/chaos";
import { greedyAgent } from "./agents/greedy";
import { randomAgent } from "./agents/random";
import { takeshiAgent } from "./agents/takeshi";
import { summarize } from "./metrics";
import { playGame } from "./runner";
import type { Agent } from "./types";

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) out[key] = true;
    else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

function makeAgent(spec: string, seed: number, ctx: { runDir: string }): Agent {
  if (spec === "random") return randomAgent(seed);
  if (spec === "greedy") return greedyAgent(seed);
  if (spec === "center-greedy") return centerGreedyAgent(seed);
  const centerW = spec.match(/^center-greedy:w(\d+)$/);
  if (centerW) return centerGreedyAgent(seed, parseInt(centerW[1], 10));
  if (spec === "chaos") return chaosAgent(seed);
  if (spec === "takeshi") return takeshiAgent();
  const takeshiDepth = spec.match(/^takeshi:d(\d+)$/);
  if (takeshiDepth) return takeshiAgent(parseInt(takeshiDepth[1], 10));
  const anthropic = spec.match(/^anthropic:(.+)$/);
  if (anthropic) {
    // Lazy import so baseline runs never need the SDK or an API key.
    const { anthropicAgent } = require("./agents/llm") as typeof import("./agents/llm");
    return anthropicAgent({ model: anthropic[1] });
  }
  const claudeLearn = spec.match(/^claude-cli-learn(?::(.+))?$/);
  if (claudeLearn) {
    const { learningClaudeCliAgent } = require("./agents/learning") as typeof import("./agents/learning");
    return learningClaudeCliAgent({ ...splitModelEffort(claudeLearn[1]), runDir: ctx.runDir });
  }
  const claudeCli = spec.match(/^claude-cli(?::(.+))?$/);
  if (claudeCli) {
    const { claudeCliAgent } = require("./agents/cli") as typeof import("./agents/cli");
    return claudeCliAgent(splitModelEffort(claudeCli[1]));
  }
  const codexCli = spec.match(/^codex-cli(?::(.+))?$/);
  if (codexCli) {
    const { codexCliAgent } = require("./agents/cli") as typeof import("./agents/cli");
    return codexCliAgent(splitModelEffort(codexCli[1]));
  }
  throw new Error(`Unknown agent spec: ${spec}`);
}

/** "model@effort" | "model" | "@effort" | undefined -> {model?, effort?} */
function splitModelEffort(s: string | undefined): { model?: string; effort?: string } {
  if (!s) return {};
  const at = s.lastIndexOf("@");
  if (at === -1) return { model: s };
  const model = s.slice(0, at);
  const effort = s.slice(at + 1);
  return { model: model || undefined, effort: effort || undefined };
}

async function arena(args: Record<string, string | boolean>): Promise<void> {
  const specA = String(args["team-a"] ?? "random");
  const specB = String(args["team-b"] ?? "takeshi");
  const games = parseInt(String(args["games"] ?? "2"), 10);
  const swap = Boolean(args["swap"]);
  const seed = parseInt(String(args["seed"] ?? "42"), 10);
  const maxPlies = parseInt(String(args["max-plies"] ?? "300"), 10);

  const runId =
    (args["run-id"] as string) ||
    new Date().toISOString().replace(/[:.]/g, "").slice(0, 15) + `-${specA}-vs-${specB}`.replace(/[^a-zA-Z0-9_-]/g, "_");
  // Runs live under the caller's working directory, not the package install.
  const runDir = path.resolve(process.cwd(), "runs", runId);
  fs.mkdirSync(runDir, { recursive: true });

  fs.writeFileSync(
    path.join(runDir, "run.json"),
    JSON.stringify(
      {
        run_id: runId,
        ruleset: "laplace-8x8-v1",
        team_a: specA,
        team_b: specB,
        games,
        swap,
        seed,
        max_plies: maxPlies,
        sampling: "provider-default (no temperature control on current models)",
        started_at: new Date().toISOString(),
      },
      null,
      2
    )
  );

  for (let g = 0; g < games; g++) {
    const swapped = swap && g % 2 === 1;
    const gameSeed = seed + g * 1000;
    const first = makeAgent(swapped ? specB : specA, gameSeed + 1, { runDir });
    const second = makeAgent(swapped ? specA : specB, gameSeed + 2, { runDir });
    const gameId = `game-${String(g).padStart(3, "0")}`;
    const label = `${gameId}: A=${first.name} vs B=${second.name}`;
    process.stdout.write(label + " ... ");
    const result = await playGame({
      gameId,
      runDir,
      seed: gameSeed,
      maxPlies,
      agents: { A: first, B: second },
    });
    console.log(
      `${result.winner ? `winner=${result.winner} (${result.reason})` : `draw (${result.reason})`} plies=${result.plies}`
    );
  }

  const summary = summarize(runDir);
  console.log("\n=== summary ===");
  console.log(JSON.stringify(summary, null, 2));
  console.log(`\nrun dir: ${runDir}`);
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);
  if (cmd === "arena") {
    await arena(args);
  } else if (cmd === "summarize") {
    const runDir = String(args["run"] ?? rest[0]);
    console.log(JSON.stringify(summarize(runDir), null, 2));
  } else if (cmd === "export-web") {
    const { exportRun, defaultOutDir } = require("./exportweb") as typeof import("./exportweb");
    const runDir = path.resolve(String(args["run"] ?? rest[0]));
    const outDir = args["out"] ? path.resolve(String(args["out"])) : defaultOutDir();
    exportRun(runDir, outDir);
  } else {
    console.log(
      "usage:\n  tsx src/cli.ts arena --team-a <spec> --team-b <spec> [--games N] [--swap] [--seed N] [--max-plies N]\n  tsx src/cli.ts summarize <runDir>\n  tsx src/cli.ts export-web <runDir> [--out <dir>]   (verify + export to web app /bench)\n\nagent specs: random | greedy | chaos | takeshi | takeshi:dN | anthropic:<model> | claude-cli[:<model>] | codex-cli[:<model>]\n  (claude-cli/codex-cli run under your Claude/ChatGPT subscription — no API key)"
    );
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
