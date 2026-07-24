import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import { isLlmSpec, resolveMatchResources } from "../src/cli";
import { randomAgent } from "../src/agents/random";
import {
  buildInstructions,
  observationFromInput,
  PROMPT_REV,
} from "../src/prompt";
import {
  CANONICAL_OUTPUT_TOKEN_BUDGET,
  LLM_TURN_TIMEOUT_MS,
  playGame,
} from "../src/runner";
import { newGame } from "../src/engine";
import {
  MODEL_USAGE_SCHEMA,
  type Agent,
  type ModelUsage,
  type TurnInput,
} from "../src/types";

function turnInput(extra: Partial<TurnInput>): TurnInput {
  return {
    state: newGame().state,
    ply: 0,
    actingPlayer: 1,
    team: "A",
    legal: [],
    recent: [],
    attempt: 1,
    maxPlies: 100,
    deadlineAtMs: Date.now() + 1000,
    ...extra,
  };
}

test("isLlmSpec: token envelope applies to model-driven specs only", () => {
  for (const s of ["claude-cli", "claude-cli:opus@high", "claude-cli-learn", "codex-cli", "anthropic:claude-sonnet-5"]) {
    assert.equal(isLlmSpec(s), true, s);
  }
  for (const s of ["random", "greedy", "takeshi:d2", "product-cpu:cpu-v4:level_5", "chaos"]) {
    assert.equal(isLlmSpec(s), false, s);
  }
});

test("resolveMatchResources: canonical defaults for LLM matches, legacy for baselines, flags win", () => {
  const llm = resolveMatchResources({}, "claude-cli:haiku", "product-cpu:cpu-v4:level_3");
  assert.equal(llm.outputTokenBudget, CANONICAL_OUTPUT_TOKEN_BUDGET);
  assert.equal(llm.turnTimeoutMs, LLM_TURN_TIMEOUT_MS);

  const baseline = resolveMatchResources({}, "random", "takeshi:d2");
  assert.equal(baseline.outputTokenBudget, undefined);
  assert.equal(baseline.turnTimeoutMs, 300_000);

  const overridden = resolveMatchResources(
    { "output-token-budget": "5000", "turn-timeout-ms": "60000" },
    "claude-cli:haiku",
    "random"
  );
  assert.equal(overridden.outputTokenBudget, 5000);
  assert.equal(overridden.turnTimeoutMs, 60_000);
});

test("observationFromInput: budget fields present exactly when the match has an envelope", () => {
  const withBudget = observationFromInput(
    turnInput({ outputTokenBudget: 250_000, outputTokensUsed: 1234 })
  ) as Record<string, unknown>;
  assert.equal(withBudget.output_token_budget, 250_000);
  assert.equal(withBudget.output_tokens_used, 1234);

  const without = observationFromInput(turnInput({})) as Record<string, unknown>;
  assert.ok(!("output_token_budget" in without));
  assert.ok(!("output_tokens_used" in without));
});

test("buildInstructions discloses the budget only when one exists", () => {
  const disclosed = buildInstructions("A", { outputTokenBudget: 250_000 });
  assert.match(disclosed, /total output-token budget of 250000/);
  assert.match(disclosed, /passed automatically/);
  // The rulebook's generic §8 wording stays; only the concrete-value
  // disclosure sentence must be conditional.
  const plain = buildInstructions("A");
  assert.ok(!plain.includes("total output-token budget of"));
});

test("playGame rejects a nonpositive token budget", async () => {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "laplace-budget0-"));
  await assert.rejects(
    playGame({
      gameId: "game-000",
      runDir,
      seed: 1,
      maxPlies: 4,
      outputTokenBudget: 0,
      agents: { A: randomAgent(1), B: randomAgent(2) },
    }),
    /must be positive/
  );
});

function usage(output: number): ModelUsage {
  return {
    schema: MODEL_USAGE_SCHEMA,
    provider: "anthropic",
    source: "claude-cli",
    inputTotalTokens: 10,
    inputUncachedTokens: 10,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    outputTotalTokens: output,
    reasoningTokens: null,
    applicationInputBytes: 1,
    applicationOutputBytes: 1,
  };
}

test("runner threads budget and running usage into TurnInput (disclosure = enforcement ledger)", async () => {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "laplace-thread-"));
  const seen: { budget?: number; used?: number }[] = [];
  const metered: Agent = {
    name: "metered-thread-test",
    usageProfile: { provider: "anthropic", source: "claude-cli" },
    act(input) {
      seen.push({ budget: input.outputTokenBudget, used: input.outputTokensUsed });
      return { move: input.legal[0], usage: usage(1000) };
    },
  };
  await playGame({
    gameId: "game-000",
    runDir,
    seed: 3,
    maxPlies: 8,
    outputTokenBudget: 250_000,
    agents: { A: metered, B: randomAgent(2) },
  });
  assert.ok(seen.length >= 2);
  assert.equal(seen[0].budget, 250_000);
  assert.equal(seen[0].used, 0);
  // Second metered turn must reflect the first turn's spend.
  assert.equal(seen[1].used, 1000);
});

test("game_start and TurnInput carry prompt_rev / budget consistently", async () => {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "laplace-promptrev-"));
  await playGame({
    gameId: "game-000",
    runDir,
    seed: 3,
    maxPlies: 4,
    outputTokenBudget: 9999,
    agents: { A: randomAgent(1), B: randomAgent(2) },
  });
  const start = fs
    .readFileSync(path.join(runDir, "games/game-000/events.jsonl"), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l))
    .find((e) => e.t === "game_start");
  assert.equal(start.prompt_rev, PROMPT_REV);
  assert.equal(start.output_token_budget_per_team, 9999);
});

test("in-game ledger records only act-reply usage (postgame work has no usage channel)", async () => {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "laplace-ledger-"));
  let endGameRan = false;
  const metered: Agent = {
    name: "ledger-test",
    usageProfile: { provider: "anthropic", source: "claude-cli" },
    act(input) {
      return { move: input.legal[0], usage: usage(500) };
    },
    endGame() {
      // Postgame analysis happens here in the learning agent; there is no
      // usage sink on this path, so the wallet cannot include it.
      endGameRan = true;
    },
  };
  const result = await playGame({
    gameId: "game-000",
    runDir,
    seed: 3,
    maxPlies: 6,
    outputTokenBudget: 250_000,
    agents: { A: metered, B: randomAgent(2) },
  });
  assert.ok(endGameRan);
  const acts = result.teams.A.actCalls;
  assert.equal(result.teams.A.usage.outputTotalTokens, acts * 500);
});
