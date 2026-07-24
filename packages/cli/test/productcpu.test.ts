import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import { randomAgent } from "../src/agents/random";
import { summarize } from "../src/metrics";
import { playGame } from "../src/runner";
import { standingsMarkdown } from "../src/standings";
import type { Agent } from "../src/types";

// ---------------------------------------------------------------------------
// Repo-independent coverage: runner disposal + colon-name handling.
// ---------------------------------------------------------------------------

test("runner disposes agents even when act throws", async () => {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "laplace-dispose-"));
  const disposals: string[] = [];
  const bomb: Agent = {
    name: "bomb-test",
    act() {
      throw new Error("agent exploded");
    },
    dispose() {
      disposals.push("bomb");
    },
  };
  const quiet: Agent = {
    ...randomAgent(3),
    dispose() {
      disposals.push("quiet");
    },
  };
  await assert.rejects(
    playGame({
      gameId: "game-000",
      runDir,
      seed: 1,
      maxPlies: 10,
      agents: { A: bomb, B: quiet },
    }),
    /agent exploded/
  );
  assert.deepEqual(disposals.sort(), ["bomb", "quiet"]);
});

test("colon-containing agent names stay verbatim in run data, summary, standings", async () => {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "laplace-colon-"));
  const named: Agent = { ...randomAgent(1), name: "product-cpu:cpu-v4:level_3" };
  const result = await playGame({
    gameId: "game-000",
    runDir,
    seed: 4,
    maxPlies: 8,
    agents: { A: named, B: randomAgent(2) },
  });
  assert.equal(result.teams.A.agent, "product-cpu:cpu-v4:level_3");

  const events = fs
    .readFileSync(path.join(runDir, "games/game-000/events.jsonl"), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
  assert.equal(events.find((e) => e.t === "game_start").team_a, "product-cpu:cpu-v4:level_3");

  const summary = summarize(runDir) as { agents: Record<string, object> };
  assert.ok(summary.agents["product-cpu:cpu-v4:level_3"]);

  const md = standingsMarkdown([runDir]);
  assert.match(md, /`product-cpu:cpu-v4:level_3`/);
});

// ---------------------------------------------------------------------------
// Real-product integration (env-gated; CI has no product checkout).
// ---------------------------------------------------------------------------

const PRODUCT_REPO = process.env.LAPLACE_PRODUCT_REPO;
const PRODUCT_COMMIT = process.env.LAPLACE_PRODUCT_COMMIT;
const gated = PRODUCT_REPO && PRODUCT_COMMIT ? test : test.skip;
if (!PRODUCT_REPO || !PRODUCT_COMMIT) {
  console.log(
    "productcpu.test.ts: skipping real-product integration tests — set LAPLACE_PRODUCT_REPO and LAPLACE_PRODUCT_COMMIT to run them (CI has no product checkout)"
  );
}

gated("real bridge: hello reports cpu-v4 with five visible tiers", async () => {
  const { preflightProductCpu } = await import("../src/agents/productcpu");
  const hello = await preflightProductCpu(
    { productRepo: PRODUCT_REPO!, expectedCommit: PRODUCT_COMMIT!, expectedPolicy: "cpu-v4" },
    "level_3"
  );
  assert.equal(hello.policy_version, "cpu-v4");
  assert.equal(hello.visible_tiers.length, 5);
  assert.equal(hello.product_dirty, false);
});

gated("real bridge: same seed + position => same move (stochastic tier)", async () => {
  const { ProductCpuBridge, toMoveRequestState } = await import("../src/agents/productcpu");
  const { newGame } = await import("../src/engine");
  const bridge = new ProductCpuBridge({
    productRepo: PRODUCT_REPO!,
    expectedCommit: PRODUCT_COMMIT!,
    expectedPolicy: "cpu-v4",
  });
  try {
    await bridge.hello;
    const state = toMoveRequestState(newGame().state);
    const a = await bridge.move("level_1", 12345, state);
    const b = await bridge.move("level_1", 12345, state);
    assert.deepEqual(a.move, b.move);
    const scored = await bridge.scoreRoots("level_5", state);
    assert.ok(scored.roots.length > 0);
    const best = scored.roots.find((r) => r.rank === 1);
    assert.ok(best && Number.isFinite(best.value));
  } finally {
    bridge.dispose();
  }
});

gated("real arena game: names and provenance are consistent end to end", async () => {
  const { arena } = await import("../src/cli");
  const prevCwd = process.cwd();
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "laplace-product-arena-"));
  try {
    process.chdir(workDir);
    await arena({
      "team-a": "product-cpu:cpu-v4:level_1",
      "team-b": "random",
      games: "1",
      seed: "11",
      "max-plies": "20",
      "run-id": "product-integration",
      "product-repo": PRODUCT_REPO!,
      "product-commit": PRODUCT_COMMIT!,
    });
  } finally {
    process.chdir(prevCwd);
  }
  const runDir = path.join(workDir, "runs", "product-integration");
  const runJson = JSON.parse(fs.readFileSync(path.join(runDir, "run.json"), "utf8"));
  assert.equal(runJson.product_cpu.policy_version, "cpu-v4");
  assert.equal(runJson.product_cpu.product_commit.startsWith(PRODUCT_COMMIT!.slice(0, 7)), true);
  assert.deepEqual(runJson.product_cpu.teams.A, {
    spec: "product-cpu:cpu-v4:level_1",
    level_id: "level_1",
  });

  const events = fs
    .readFileSync(path.join(runDir, "games/game-000/events.jsonl"), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
  const start = events.find((e) => e.t === "game_start");
  assert.equal(start.team_a, "product-cpu:cpu-v4:level_1");
  const moveWithSeed = events.find((e) => e.t === "move" && e.meta?.product_seed !== undefined);
  assert.ok(moveWithSeed, "product moves record their effective seed");

  const finalJson = JSON.parse(
    fs.readFileSync(path.join(runDir, "games/game-000/final.json"), "utf8")
  );
  assert.equal(finalJson.teams.A.agent, "product-cpu:cpu-v4:level_1");
  const summary = JSON.parse(fs.readFileSync(path.join(runDir, "summary.json"), "utf8"));
  assert.ok(summary.agents["product-cpu:cpu-v4:level_1"]);
  const md = standingsMarkdown([runDir]);
  assert.match(md, /`product-cpu:cpu-v4:level_1`/);
});
