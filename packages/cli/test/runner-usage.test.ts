import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import { randomAgent } from "../src/agents/random";
import { playGame } from "../src/runner";
import {
  MODEL_USAGE_SCHEMA,
  type Agent,
  type ModelUsage,
} from "../src/types";

function usage(input: number, output: number): ModelUsage {
  return {
    schema: MODEL_USAGE_SCHEMA,
    provider: "anthropic",
    source: "claude-cli",
    inputTotalTokens: input,
    inputUncachedTokens: input - 2,
    cacheReadTokens: 2,
    cacheWriteTokens: 1,
    outputTotalTokens: output,
    reasoningTokens: null,
    applicationInputBytes: 10,
    applicationOutputBytes: 5,
  };
}

test("runner counts both in-game repair attempts in the match usage ledger", async () => {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "laplace-runner-usage-"));
  const metered: Agent = {
    name: "metered-test",
    usageProfile: { provider: "anthropic", source: "claude-cli" },
    act(input) {
      return input.attempt === 1
        ? { move: null, usage: usage(20, 3) }
        : { move: input.legal[0], usage: usage(30, 4) };
    },
  };

  try {
    const result = await playGame({
      gameId: "game-000",
      runDir,
      seed: 42,
      maxPlies: 1,
      agents: { A: metered, B: randomAgent(7) },
    });

    const ledger = result.teams.A.usage;
    assert.equal(ledger.adapterCalls, 2);
    assert.equal(ledger.reportedCalls, 2);
    assert.equal(ledger.inputTotalTokens, 50);
    assert.equal(ledger.outputTotalTokens, 7);
    assert.equal(ledger.cacheReadTokens, 4);
    assert.equal(result.teams.A.inputTokens, 50);

    const usageEvents = fs
      .readFileSync(path.join(runDir, "games/game-000/events.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line))
      .filter((event) => event.t === "usage");
    assert.deepEqual(
      usageEvents.map((event) => event.phase),
      ["play", "play"]
    );

    const written = JSON.parse(
      fs.readFileSync(path.join(runDir, "games/game-000/final.json"), "utf8")
    );
    assert.equal(written.teams.A.usage.inputTotalTokens, 50);
  } finally {
    fs.rmSync(runDir, { recursive: true, force: true });
  }
});

test("output-token budget admits a whole turn, permits overshoot, then skips", async () => {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "laplace-budget-"));
  let calls = 0;
  const metered: Agent = {
    name: "budget-test",
    usageProfile: { provider: "anthropic", source: "claude-cli" },
    act(input) {
      calls++;
      return { move: input.legal[0], usage: usage(10, 6) };
    },
  };

  try {
    const result = await playGame({
      gameId: "game-000",
      runDir,
      seed: 42,
      maxPlies: 5,
      outputTokenBudget: 10,
      agents: { A: metered, B: randomAgent(7) },
    });

    assert.equal(calls, 2);
    assert.equal(result.teams.A.usage.outputTotalTokens, 12);
    assert.equal(result.teams.A.tokenBudgetSkips, 1);

    const events = fs
      .readFileSync(path.join(runDir, "games/game-000/events.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const skip = events.find(
      (event) => event.t === "pass" && event.reason === "token_budget"
    );
    assert.equal(skip.output_tokens_used, 12);
    assert.equal(skip.output_token_budget, 10);
  } finally {
    fs.rmSync(runDir, { recursive: true, force: true });
  }
});

test("late reply is discarded and the product turn advances as a timeout pass", async () => {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "laplace-timeout-"));
  const slow: Agent = {
    name: "slow-test",
    usageProfile: { provider: "anthropic", source: "claude-cli" },
    async act(input) {
      await new Promise((resolve) => setTimeout(resolve, 15));
      return { move: input.legal[0], usage: usage(10, 2) };
    },
  };

  try {
    const result = await playGame({
      gameId: "game-000",
      runDir,
      seed: 42,
      maxPlies: 1,
      turnTimeoutMs: 2,
      agents: { A: slow, B: randomAgent(7) },
    });

    assert.equal(result.teams.A.moves, 0);
    assert.equal(result.teams.A.failedTurns, 1);
    assert.equal(result.teams.A.timeoutSkips, 1);
    assert.equal(result.teams.A.usage.outputTotalTokens, 2);

    const events = fs
      .readFileSync(path.join(runDir, "games/game-000/events.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.ok(events.some((event) => event.t === "failure" && event.kind === "timeout"));
    assert.ok(events.some((event) => event.t === "pass" && event.reason === "timeout"));
  } finally {
    fs.rmSync(runDir, { recursive: true, force: true });
  }
});
