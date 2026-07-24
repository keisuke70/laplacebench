import "./env";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { centerGreedyAgent } from "./agents/centergreedy";
import { chaosAgent } from "./agents/chaos";
import { greedyAgent } from "./agents/greedy";
import { randomAgent } from "./agents/random";
import { takeshiAgent } from "./agents/takeshi";
import { summarize } from "./metrics";
import {
  CANONICAL_OUTPUT_TOKEN_BUDGET,
  LLM_TURN_TIMEOUT_MS,
  playGame,
  resolveMaxPlies,
} from "./runner";
import { PROMPT_REV } from "./prompt";
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

const PRODUCT_CPU_SPEC = /^product-cpu:([a-z0-9-]+):(level_\d+)$/;

/** Specs whose agents consume model tokens (the fairness envelope applies). */
export function isLlmSpec(spec: string): boolean {
  return (
    spec.startsWith("claude-cli") || // includes claude-cli-learn
    spec.startsWith("codex-cli") ||
    spec.startsWith("anthropic:")
  );
}

/**
 * Match resource defaults (docs/match-conduct doc): matches with LLM agents
 * get the canonical token envelope and the backstop timeout; baseline-only
 * matches keep the old defaults (no tokens to meter). Explicit flags win.
 */
export function resolveMatchResources(
  args: Record<string, string | boolean>,
  specA: string,
  specB: string
): { turnTimeoutMs: number; outputTokenBudget: number | undefined } {
  const llmMatch = isLlmSpec(specA) || isLlmSpec(specB);
  const turnTimeoutMs = parseInt(
    String(
      args["turn-timeout-ms"] ??
        (llmMatch ? String(LLM_TURN_TIMEOUT_MS) : "300000")
    ),
    10
  );
  const outputTokenBudget =
    args["output-token-budget"] !== undefined
      ? parseInt(String(args["output-token-budget"]), 10)
      : llmMatch
        ? CANONICAL_OUTPUT_TOKEN_BUDGET
        : undefined;
  return { turnTimeoutMs, outputTokenBudget };
}

interface ProductCpuContext {
  productRepo: string;
  expectedCommit: string;
}

/** Resolve product repo + commit pin from CLI args and env. Fail-closed. */
function productCpuContext(args: Record<string, string | boolean>): ProductCpuContext {
  const productRepo = String(
    args["product-repo"] ?? process.env.LAPLACE_PRODUCT_REPO ?? ""
  );
  const expectedCommit = String(
    args["product-commit"] ?? process.env.LAPLACE_PRODUCT_COMMIT ?? ""
  );
  if (!productRepo) {
    throw new Error(
      "product-cpu specs need the product checkout: pass --product-repo or set LAPLACE_PRODUCT_REPO"
    );
  }
  if (!expectedCommit) {
    throw new Error(
      "product-cpu specs need a commit pin: pass --product-commit or set LAPLACE_PRODUCT_COMMIT"
    );
  }
  return { productRepo, expectedCommit };
}

async function makeAgent(
  spec: string,
  seed: number,
  ctx: { runDir: string; productCpu?: ProductCpuContext }
): Promise<Agent> {
  const productCpu = spec.match(PRODUCT_CPU_SPEC);
  if (productCpu) {
    if (!ctx.productCpu) {
      throw new Error(`product-cpu spec ${spec} used without --product-repo/--product-commit context`);
    }
    const { createProductCpuAgent } = require("./agents/productcpu") as typeof import("./agents/productcpu");
    return createProductCpuAgent(productCpu[2], seed, {
      productRepo: ctx.productCpu.productRepo,
      expectedCommit: ctx.productCpu.expectedCommit,
      expectedPolicy: productCpu[1],
    });
  }
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

function commandVersion(command: string): string | null {
  try {
    return execFileSync(command, ["--version"], {
      encoding: "utf8",
      timeout: 10_000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

export async function arena(args: Record<string, string | boolean>): Promise<void> {
  const specA = String(args["team-a"] ?? "random");
  const specB = String(args["team-b"] ?? "takeshi");
  const games = parseInt(String(args["games"] ?? "2"), 10);
  const swap = Boolean(args["swap"]);
  const seed = parseInt(String(args["seed"] ?? "42"), 10);
  const maxPlies = resolveMaxPlies(args["max-plies"]);
  const { turnTimeoutMs, outputTokenBudget } = resolveMatchResources(
    args,
    specA,
    specB
  );
  if (!Number.isSafeInteger(turnTimeoutMs) || turnTimeoutMs <= 0) {
    throw new Error("--turn-timeout-ms must be a positive integer");
  }
  if (
    outputTokenBudget !== undefined &&
    (!Number.isSafeInteger(outputTokenBudget) || outputTokenBudget <= 0)
  ) {
    throw new Error("--output-token-budget must be a positive integer");
  }

  const runId =
    (args["run-id"] as string) ||
    new Date().toISOString().replace(/[:.]/g, "").slice(0, 15) + `-${specA}-vs-${specB}`.replace(/[^a-zA-Z0-9_-]/g, "_");
  // Runs live under the caller's working directory, not the package install.
  const runDir = path.resolve(process.cwd(), "runs", runId);
  fs.mkdirSync(runDir, { recursive: true });

  // Metadata-only preflight: for product-cpu specs, spawn a bridge, verify
  // hello (policy/commit/dirty/tier), capture provenance, dispose — all
  // BEFORE run.json is written, so provenance and names are settled first.
  const productSpecs = [specA, specB].filter((s) => PRODUCT_CPU_SPEC.test(s));
  let productCpuCtx: ProductCpuContext | undefined;
  let productProvenance: object | null = null;
  if (productSpecs.length > 0) {
    productCpuCtx = productCpuContext(args);
    const { preflightProductCpu } = require("./agents/productcpu") as typeof import("./agents/productcpu");
    let hello: import("./agents/productcpu").BridgeHello | null = null;
    for (const spec of productSpecs) {
      const m = spec.match(PRODUCT_CPU_SPEC)!;
      hello = await preflightProductCpu(
        {
          productRepo: productCpuCtx.productRepo,
          expectedCommit: productCpuCtx.expectedCommit,
          expectedPolicy: m[1],
        },
        m[2]
      );
    }
    productProvenance = {
      policy_version: hello!.policy_version,
      product_commit: hello!.product_commit,
      python: hello!.python,
      protocol: hello!.protocol,
      product_repo: productCpuCtx.productRepo,
      dirty: hello!.product_dirty,
      teams: {
        A: PRODUCT_CPU_SPEC.test(specA)
          ? { spec: specA, level_id: specA.match(PRODUCT_CPU_SPEC)![2] }
          : null,
        B: PRODUCT_CPU_SPEC.test(specB)
          ? { spec: specB, level_id: specB.match(PRODUCT_CPU_SPEC)![2] }
          : null,
      },
    };
  }

  fs.writeFileSync(
    path.join(runDir, "run.json"),
    JSON.stringify(
      {
        run_id: runId,
        ruleset: "laplace-8x8-v1",
        prompt_rev: PROMPT_REV,
        team_a: specA,
        team_b: specB,
        games,
        swap,
        seed,
        max_plies: maxPlies,
        turn_timeout_ms: turnTimeoutMs,
        output_token_budget_per_team_per_game: outputTokenBudget ?? null,
        output_token_budget_metric: "in-game output_tokens_total (reasoning inclusive)",
        sampling: "provider-default (no temperature control on current models)",
        usage_schema: "laplace-model-usage-v1",
        usage_scope: "in-game act calls, including repair attempts; excludes post-game learning",
        cli_versions: {
          claude:
            specA.startsWith("claude-cli") || specB.startsWith("claude-cli")
              ? commandVersion("claude")
              : null,
          codex:
            specA.startsWith("codex-cli") || specB.startsWith("codex-cli")
              ? commandVersion("codex")
              : null,
        },
        product_cpu: productProvenance,
        started_at: new Date().toISOString(),
      },
      null,
      2
    )
  );

  for (let g = 0; g < games; g++) {
    const swapped = swap && g % 2 === 1;
    const gameSeed = seed + g * 1000;
    const ctx = { runDir, productCpu: productCpuCtx };
    const first = await makeAgent(swapped ? specB : specA, gameSeed + 1, ctx);
    let second: Agent;
    try {
      second = await makeAgent(swapped ? specA : specB, gameSeed + 2, ctx);
    } catch (err) {
      await first.dispose?.();
      throw err;
    }
    const gameId = `game-${String(g).padStart(3, "0")}`;
    const label = `${gameId}: A=${first.name} vs B=${second.name}`;
    process.stdout.write(label + " ... ");
    const result = await playGame({
      gameId,
      runDir,
      seed: gameSeed,
      maxPlies,
      turnTimeoutMs,
      outputTokenBudget,
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
  } else if (cmd === "verify") {
    const { exportGame } = require("./exportweb") as typeof import("./exportweb");
    const runDirs = rest.filter((a) => !a.startsWith("--")).map((d) => path.resolve(d));
    let games = 0;
    let failed = 0;
    for (const runDir of runDirs) {
      const gamesDir = path.join(runDir, "games");
      if (!fs.existsSync(gamesDir)) {
        console.error(`FAILED: ${runDir}: no games/ directory`);
        failed++;
        continue;
      }
      for (const gameId of fs.readdirSync(gamesDir).sort()) {
        if (!fs.existsSync(path.join(gamesDir, gameId, "events.jsonl"))) continue;
        games++;
        try {
          exportGame(runDir, gameId);
          console.log(`verified: ${path.basename(runDir)}/${gameId}`);
        } catch (err: any) {
          failed++;
          console.error(`FAILED: ${path.basename(runDir)}/${gameId}: ${err?.message ?? err}`);
        }
      }
    }
    console.log(`${games - failed}/${games} games verified across ${runDirs.length} run(s)`);
    if (failed > 0 || games === 0) process.exitCode = 1;
  } else if (cmd === "regret") {
    const runDir = path.resolve(String(args["run"] ?? rest[0]));
    const oracleSpec = String(args["oracle"] ?? "product-cpu:cpu-v4:level_5");
    const m = oracleSpec.match(PRODUCT_CPU_SPEC);
    if (!m) throw new Error(`--oracle must be a product-cpu spec, got: ${oracleSpec}`);
    const ctx = productCpuContext(args);
    const { analyzeRunRegret } = require("./regret") as typeof import("./regret");
    const summary = await analyzeRunRegret(runDir, {
      productRepo: ctx.productRepo,
      expectedCommit: ctx.expectedCommit,
      expectedPolicy: m[1],
      oracleLevelId: m[2],
    });
    console.log(JSON.stringify(summary, null, 2));
  } else if (cmd === "standings") {
    const { standingsMarkdown } = require("./standings") as typeof import("./standings");
    const dirs = rest.filter((a) => !a.startsWith("--")).map((d) => path.resolve(d));
    const md = standingsMarkdown(dirs);
    if (args["out"]) {
      fs.writeFileSync(path.resolve(String(args["out"])), md);
      console.log(`standings written: ${args["out"]}`);
    } else {
      console.log(md);
    }
  } else {
    console.log(
      "usage:\n  laplacebench arena --team-a <spec> --team-b <spec> [--games N] [--swap] [--seed N] [--max-plies N] [--output-token-budget N] [--turn-timeout-ms N]\n  laplacebench summarize <runDir>\n  laplacebench regret <runDir> [--oracle product-cpu:cpu-v4:level_5]  (offline per-move regret vs product oracle)\n  laplacebench export-web <runDir> [--out <dir>]   (verify + export replay JSON)\n  laplacebench verify <runDir...>                  (deterministic replay verification)\n  laplacebench standings <runDir...> [--out <md>]  (aggregate standings table)\n\nmatch resources:\n  --output-token-budget N  per team/game, in-game output tokens; default 250000 for LLM matches (canonical envelope), none for baseline-only\n  --turn-timeout-ms N      shared across both attempts in a turn; default 1200000 for LLM matches (backstop), 300000 otherwise\n  --max-plies N            default 100 (canonical cap for laplace-8x8-v1 matches)\n\nproduct CPU (arena + regret):\n  --product-repo <path>    product checkout (or env LAPLACE_PRODUCT_REPO)\n  --product-commit <sha>   required commit pin (or env LAPLACE_PRODUCT_COMMIT)\n\nagent specs: random | greedy | chaos | takeshi | takeshi:dN | product-cpu:<policy>:<level_1..5> | anthropic:<model> | claude-cli[:<model>] | codex-cli[:<model>]\n  (claude-cli/codex-cli run under your Claude/ChatGPT subscription — no API key)"
    );
    process.exitCode = 1;
  }
}

// Guarded so tests can import arena() without executing the CLI entry point.
// The packaged binary (bin/laplacebench.js) calls runCli() explicitly.
export function runCli(): void {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}

if (require.main === module) {
  runCli();
}
