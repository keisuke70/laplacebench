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

test("runner includes repair/play and post-game model calls in one usage ledger", async () => {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "laplace-runner-usage-"));
  const metered: Agent = {
    name: "metered-test",
    usageProfile: { provider: "anthropic", source: "claude-cli" },
    act(input) {
      return { move: input.legal[0], usage: usage(20, 3) };
    },
    endGame() {
      return { usageReports: [usage(30, 4)] };
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
      ["play", "postgame"]
    );

    const written = JSON.parse(
      fs.readFileSync(path.join(runDir, "games/game-000/final.json"), "utf8")
    );
    assert.equal(written.teams.A.usage.inputTotalTokens, 50);
  } finally {
    fs.rmSync(runDir, { recursive: true, force: true });
  }
});
