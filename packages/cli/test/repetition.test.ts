import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import { newGame, repetitionKey } from "../src/engine";
import { greedyAgent } from "../src/agents/greedy";
import { randomAgent } from "../src/agents/random";
import { summarize } from "../src/metrics";
import {
  CANONICAL_MAX_PLIES,
  classifyTermination,
  playGame,
  resolveMaxPlies,
  type GameResult,
} from "../src/runner";
import { standingsMarkdown } from "../src/standings";
import type { Agent, Move } from "../src/types";

function sameMove(a: Move, b: Move): boolean {
  return (
    a.from.row === b.from.row &&
    a.from.col === b.from.col &&
    a.to.row === b.to.row &&
    a.to.col === b.to.col
  );
}

/** Moves a piece out and immediately back, per color — forces repetition. */
function shuttleAgent(): Agent {
  const pending = new Map<number, Move>();
  return {
    name: "shuttle-test",
    act(input) {
      const back = pending.get(input.actingPlayer);
      pending.delete(input.actingPlayer);
      if (back && input.legal.some((m) => sameMove(m, back))) {
        return { move: back };
      }
      const m = input.legal[0];
      pending.set(input.actingPlayer, { from: m.to, to: m.from });
      return { move: m };
    },
  };
}

test("repetitionKey distinguishes hidden state that the board cannot show", () => {
  const a = newGame().state;
  const b = newGame().state;
  assert.equal(repetitionKey(a), repetitionKey(b));

  // Forfeit elimination removes pieces without incrementing capturedPieces,
  // so identical boards with different loss counts are reachable states.
  b.capturedPieces[0]++;
  assert.notEqual(repetitionKey(a), repetitionKey(b));
  b.capturedPieces[0]--;

  b.consecutiveTimeouts[2]++;
  assert.notEqual(repetitionKey(a), repetitionKey(b));
  b.consecutiveTimeouts[2]--;

  // Excluded metadata must not affect the key.
  b.turnStartedAt = new Date(0);
  b.lastMoveBy = 3;
  assert.equal(repetitionKey(a), repetitionKey(b));

  // isDead normalization: absent and false serialize identically.
  const c = newGame().state;
  c.board[0][1] = { player: c.board[0][1]!.player } as (typeof c.board)[0][0];
  assert.equal(repetitionKey(a), repetitionKey(c));
});

test("repetitionKey throws on a GameState field the classification does not know", () => {
  const state = newGame().state as unknown as Record<string, unknown>;
  state.futureField = 1;
  assert.throws(
    () => repetitionKey(state as never),
    /unclassified GameState field "futureField"/
  );
});

test("resolveMaxPlies: omission selects the canonical cap, overrides are honored", () => {
  assert.equal(resolveMaxPlies(undefined), CANONICAL_MAX_PLIES);
  assert.equal(CANONICAL_MAX_PLIES, 100);
  assert.equal(resolveMaxPlies("60"), 60);
  assert.throws(() => resolveMaxPlies("0"));
  assert.throws(() => resolveMaxPlies("abc"));
  assert.throws(() => resolveMaxPlies("1.5"));
  assert.throws(() => resolveMaxPlies("100junk"));
  assert.throws(() => resolveMaxPlies("-5"));
});

test("termination precedence: normal end > repetition draw > horizon draw", () => {
  // Real play cannot reach a terminal state that is also a third repetition
  // (the earlier identical states would already have been terminal), so the
  // precedence is pinned at the classifier level for every combination.
  const all = { gameEnded: true, occurrences: 3, ply: 100, maxPlies: 100 };
  assert.equal(classifyTermination(all), "normal_end");
  assert.equal(
    classifyTermination({ ...all, gameEnded: false }),
    "repetition_draw"
  );
  assert.equal(
    classifyTermination({ ...all, gameEnded: false, occurrences: 2 }),
    "horizon_draw"
  );
  assert.equal(
    classifyTermination({
      gameEnded: false,
      occurrences: 1,
      ply: 99,
      maxPlies: 100,
    }),
    null
  );
});

test("shuttling play ends as repetition_draw before the cap, and exactly at the cap boundary", async () => {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "laplace-repetition-"));
  const first = await playGame({
    gameId: "game-000",
    runDir,
    seed: 1,
    maxPlies: CANONICAL_MAX_PLIES,
    agents: { A: shuttleAgent(), B: shuttleAgent() },
  });
  assert.equal(first.reason, "repetition_draw");
  assert.equal(first.winner, null);
  assert.ok(first.plies < CANONICAL_MAX_PLIES);
  const events = fs
    .readFileSync(path.join(runDir, "games/game-000/events.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l));
  const rep = events.find((e) => e.t === "repetition_draw");
  assert.ok(rep);
  assert.equal(rep.occurrences, 3);

  // Boundary regression: with maxPlies set to the exact ply where the third
  // occurrence appears, repetition must win over the horizon classification.
  const boundary = await playGame({
    gameId: "game-001",
    runDir,
    seed: 1,
    maxPlies: first.plies,
    agents: { A: shuttleAgent(), B: shuttleAgent() },
  });
  assert.equal(boundary.reason, "repetition_draw");
});

test("a decisive game keeps its normal end reason over repetition", async () => {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "laplace-decisive-"));
  const result = await playGame({
    gameId: "game-000",
    runDir,
    seed: 2002,
    maxPlies: CANONICAL_MAX_PLIES,
    agents: { A: greedyAgent(1), B: greedyAgent(2) },
  });
  assert.notEqual(result.winner, null);
  assert.ok(result.reason === "center" || result.reason === "elimination");
});

test("random-vs-random terminates within the canonical cap with a separated draw reason", async () => {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "laplace-random-"));
  const result = await playGame({
    gameId: "game-000",
    runDir,
    seed: 2001,
    maxPlies: CANONICAL_MAX_PLIES,
    agents: { A: randomAgent(1), B: randomAgent(2) },
  });
  assert.ok(result.plies <= CANONICAL_MAX_PLIES);
  if (result.winner === null) {
    assert.ok(
      result.reason === "horizon_draw" || result.reason === "repetition_draw"
    );
  }
});

test("game_start records the cap for both default and explicit override", async () => {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "laplace-capfields-"));
  const gameStart = (gameId: string) =>
    fs
      .readFileSync(path.join(runDir, "games", gameId, "events.jsonl"), "utf8")
      .split("\n")
      .filter((l) => l.trim() !== "")
      .map((l) => JSON.parse(l))
      .find((e) => e.t === "game_start");

  await playGame({
    gameId: "game-000",
    runDir,
    seed: 5,
    maxPlies: resolveMaxPlies(undefined),
    agents: { A: randomAgent(1), B: randomAgent(2) },
  });
  assert.equal(gameStart("game-000").max_plies, CANONICAL_MAX_PLIES);

  await playGame({
    gameId: "game-001",
    runDir,
    seed: 5,
    maxPlies: resolveMaxPlies("60"),
    agents: { A: randomAgent(1), B: randomAgent(2) },
  });
  assert.equal(gameStart("game-001").max_plies, 60);
});

test("arena records the cap in run.json: omission -> canonical, override -> its value", async () => {
  const { arena } = await import("../src/cli");
  const prevCwd = process.cwd();
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "laplace-arena-"));
  try {
    process.chdir(workDir);
    await arena({
      "team-a": "random",
      "team-b": "random",
      games: "1",
      seed: "5",
      "max-plies": "6",
      "run-id": "override",
    });
    await arena({
      "team-a": "random",
      "team-b": "random",
      games: "1",
      seed: "5",
      "run-id": "default",
    });
  } finally {
    process.chdir(prevCwd);
  }
  const runJson = (id: string) =>
    JSON.parse(
      fs.readFileSync(path.join(workDir, "runs", id, "run.json"), "utf8")
    );
  assert.equal(runJson("override").max_plies, 6);
  assert.equal(runJson("default").max_plies, CANONICAL_MAX_PLIES);
});

test("packaged bin wrapper still runs the CLI after the entry-point guard", () => {
  // Tests run with cwd = packages/cli. The wrapper requires dist/, so build
  // first — this is the same artifact the published package ships.
  execFileSync("npm", ["run", "build"], { stdio: "ignore" });
  const out = execFileSync("node", ["bin/laplacebench.js", "standings"], {
    encoding: "utf8",
  });
  assert.match(out, /Community standings/);
});

test("summary and standings report draw rates separately by cause", async () => {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "laplace-drawstats-"));
  const games: GameResult[] = [
    await playGame({
      gameId: "game-000",
      runDir,
      seed: 1,
      maxPlies: CANONICAL_MAX_PLIES,
      agents: { A: shuttleAgent(), B: shuttleAgent() },
    }),
    await playGame({
      gameId: "game-001",
      runDir,
      seed: 2001,
      // A cap far below natural termination forces a horizon draw.
      maxPlies: 4,
      agents: { A: randomAgent(1), B: randomAgent(2) },
    }),
  ];
  assert.equal(games[0].reason, "repetition_draw");
  assert.equal(games[1].reason, "horizon_draw");

  const summary = summarize(runDir) as {
    agents: Record<
      string,
      { draw_reasons: Record<string, number>; draw_rate: number }
    >;
  };
  const shuttle = summary.agents["shuttle-test"];
  assert.equal(shuttle.draw_reasons.repetition_draw, 2); // both teams
  assert.equal(shuttle.draw_rate, 1);
  const rand = summary.agents["random"];
  assert.equal(rand.draw_reasons.horizon_draw, 2);

  const md = standingsMarkdown([runDir]);
  assert.match(md, /D:horizon \| D:repetition/);
  const shuttleRow = md.split("\n").find((l) => l.includes("shuttle-test"));
  assert.ok(shuttleRow);
  // G W D L center elim D:horizon D:repetition
  assert.match(shuttleRow, /\| 2 \| 0 \| 2 \| 0 \| 0 \| 0 \| 0 \| 2 \|/);
});
