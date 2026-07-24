import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import { randomAgent } from "../src/agents/random";
import { legalMoves } from "../src/engine";
import { evaluateChosenMove, analyzeRunRegret } from "../src/regret";
import { ProductCpuBridge, type ScoredRoot } from "../src/agents/productcpu";
import { playGame } from "../src/runner";

function root(
  from: [number, number],
  to: [number, number],
  value: number,
  rank: number,
  cls = 1,
  extra: Partial<ScoredRoot> = {}
): ScoredRoot {
  return {
    move: { from, to },
    value,
    rank,
    selectionClass: cls,
    immediateWin: false,
    unsafe: false,
    ...extra,
  };
}

test("regret scalar: zero for the best move, positive within the same class", () => {
  const roots = [root([0, 0], [1, 0], 10, 1), root([0, 1], [1, 1], 4, 2)];
  const best = evaluateChosenMove(roots, { from: [0, 0], to: [1, 0] });
  assert.equal(best.regret_value, 0);
  assert.equal(best.chosen_rank, 1);
  const worse = evaluateChosenMove(roots, { from: [0, 1], to: [1, 1] });
  assert.equal(worse.regret_value, 6);
  assert.ok(worse.regret_value! >= 0);
});

test("class override: missed immediate win yields null scalar + categorical flag", () => {
  // The winning move has LOWER raw value than the greedy alternative, but
  // selectionClass 2 outranks it — exactly the lexicographic case where
  // value(rank1) - value(chosen) would have been negative and misleading.
  const roots = [
    root([0, 0], [1, 0], 3, 1, 2, { immediateWin: true }),
    root([0, 1], [1, 1], 50, 2, 1),
  ];
  const r = evaluateChosenMove(roots, { from: [0, 1], to: [1, 1] });
  assert.equal(r.regret_value, null);
  assert.equal(r.missed_immediate_win, true);
  assert.equal(r.chose_unsafe, false);
});

test("class override: unsafe choice when a safe move existed", () => {
  const roots = [
    root([0, 0], [1, 0], 5, 1, 1),
    root([0, 1], [1, 1], 90, 2, 0, { unsafe: true }),
  ];
  const r = evaluateChosenMove(roots, { from: [0, 1], to: [1, 1] });
  assert.equal(r.regret_value, null);
  assert.equal(r.chose_unsafe, true);
});

test("formationPressure tie-break keeps same-class scalar nonnegative", () => {
  // Two equal-value roots split by formation pressure into ranks 1/2.
  const roots = [root([0, 0], [1, 0], 7, 1), root([0, 1], [1, 1], 7, 2)];
  const r = evaluateChosenMove(roots, { from: [0, 1], to: [1, 1] });
  assert.equal(r.regret_value, 0);
  assert.equal(r.chosen_rank, 2);
});

test("chosen move missing from oracle roots throws (replay inconsistency)", () => {
  const roots = [root([0, 0], [1, 0], 10, 1)];
  assert.throws(
    () => evaluateChosenMove(roots, { from: [7, 7], to: [6, 7] }),
    /not among the oracle's legal roots/
  );
});

const REGRET_OPTS = {
  productRepo: "unused",
  expectedCommit: "d316b30",
  expectedPolicy: "cpu-v4",
  oracleLevelId: "level_5",
};

/**
 * In-process fake oracle. "ok" mode scores every legal move of the request
 * state (via the bench engine's own generator), so any logged move matches;
 * "fail" mode throws on the first scoreRoots call.
 */
function fakeOracle(mode: "ok" | "fail", disposals: string[]): ProductCpuBridge {
  return {
    hello: Promise.resolve({
      protocol: "product-cpu-bridge-v1",
      policy_version: "cpu-v4",
      product_commit: "d316b30",
      product_dirty: false,
      python: "fake",
      visible_tiers: [{ level_id: "level_5", profile_name: "x", p95_limit_seconds: 1 }],
    }),
    async scoreRoots(_level: string, state: never) {
      if (mode === "fail") throw new Error("oracle exploded");
      const moves = legalMoves(state);
      return {
        depth: 1,
        roots: moves.map((m, i) =>
          root([m.from.row, m.from.col], [m.to.row, m.to.col], moves.length - i, i + 1)
        ),
      };
    },
    dispose() {
      disposals.push(`dispose:${mode}`);
    },
  } as unknown as ProductCpuBridge;
}

test("regret command writes outputs and disposes its oracle bridge on success", async () => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "laplace-regret-ok-"));
  await playGame({
    gameId: "game-000",
    runDir: workDir,
    seed: 9,
    maxPlies: 6,
    agents: { A: randomAgent(1), B: randomAgent(2) },
  });
  const disposals: string[] = [];
  const summary = (await analyzeRunRegret(workDir, REGRET_OPTS, () =>
    fakeOracle("ok", disposals)
  )) as { oracle: { spec: string; product_commit: string }; agents: Record<string, object> };

  assert.deepEqual(disposals, ["dispose:ok"]);
  assert.equal(summary.oracle.spec, "product-cpu:cpu-v4:level_5");
  assert.equal(summary.oracle.product_commit, "d316b30");
  const perGame = JSON.parse(
    fs.readFileSync(path.join(workDir, "games/game-000/regret.json"), "utf8")
  );
  assert.equal(perGame.oracle.spec, "product-cpu:cpu-v4:level_5");
  assert.ok(perGame.moves.length > 0);
  for (const m of perGame.moves) {
    assert.ok(m.regret_value === null || m.regret_value >= 0);
    assert.ok(m.chosen_rank >= 1);
  }
  assert.ok(fs.existsSync(path.join(workDir, "regret-summary.json")));
});

test("regret refuses a truncated game (missing game_end)", async () => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "laplace-regret-trunc-"));
  await playGame({
    gameId: "game-000",
    runDir: workDir,
    seed: 9,
    maxPlies: 6,
    agents: { A: randomAgent(1), B: randomAgent(2) },
  });
  const eventsPath = path.join(workDir, "games/game-000/events.jsonl");
  const truncated = fs
    .readFileSync(eventsPath, "utf8")
    .split("\n")
    .filter((l) => l && !l.includes('"game_end"'))
    .join("\n");
  fs.writeFileSync(eventsPath, truncated + "\n");
  const disposals: string[] = [];
  await assert.rejects(
    analyzeRunRegret(workDir, REGRET_OPTS, () => fakeOracle("ok", disposals)),
    /missing game_end/
  );
  assert.deepEqual(disposals, ["dispose:ok"]);
});

test("regret command disposes its oracle bridge when the oracle fails mid-replay", async () => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "laplace-regret-fail-"));
  await playGame({
    gameId: "game-000",
    runDir: workDir,
    seed: 9,
    maxPlies: 6,
    agents: { A: randomAgent(1), B: randomAgent(2) },
  });
  const disposals: string[] = [];
  await assert.rejects(
    analyzeRunRegret(workDir, REGRET_OPTS, () => fakeOracle("fail", disposals)),
    /oracle exploded/
  );
  assert.deepEqual(disposals, ["dispose:fail"]);
});
