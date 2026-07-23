#!/usr/bin/env node
"use strict";

/**
 * Manual, maintainer-run cross-check: replay this package's frozen
 * conformance fixtures (test/fixtures/rulegym-v1.json) through the *current*
 * product TypeScript engine (packages/game-shared in a laplace-main
 * checkout) and diff the result against the same expectations the frozen
 * engine's own test suite asserts.
 *
 * This is intentionally NOT part of `npm test` or CI: laplace-8x8-v1 is a
 * frozen ruleset, and the published laplace-engine package must have zero
 * runtime dependency on a sibling repository. This script exists so a
 * maintainer can, on demand, confirm whether the product engine has drifted
 * from the frozen fixtures -- which is the trigger for a deliberate
 * laplace-8x8-v2 cut, not something that should happen silently.
 *
 * Usage:
 *   node scripts/verify-against-product.cjs --product-path /path/to/laplace-main
 *
 * Requires packages/game-shared/dist to already be built in that checkout
 * (`npm run build --workspace @laplace/game-shared` there). This script
 * never builds or otherwise writes into the product checkout.
 */

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

function parseArgs(argv) {
  const args = { productPath: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--product-path") {
      args.productPath = argv[i + 1];
      i++;
    }
  }
  return args;
}

function loadProductCommit(productPath) {
  try {
    return execFileSync("git", ["-C", productPath, "rev-parse", "HEAD"], {
      encoding: "utf-8",
    }).trim();
  } catch {
    return "unknown (not a git checkout or git unavailable)";
  }
}

function buildState(initial) {
  const board = Array.from({ length: initial.boardSize }, () =>
    Array.from({ length: initial.boardSize }, () => null)
  );
  for (const piece of initial.pieces) {
    board[piece.row][piece.col] = {
      player: piece.player,
      isDead: piece.isDead ?? false,
    };
  }
  const now = new Date();
  return {
    board,
    boardSize: initial.boardSize,
    capturedPieces: [...initial.capturedPieces],
    eliminatedPlayers: [...initial.eliminatedPlayers],
    startingPiecesCount: initial.boardSize - 2,
    eliminationThreshold: 3,
    currentPlayer: initial.currentPlayer,
    turnStartedAt: now,
    turnTimeLimit: 120,
    gameStartedAt: now,
    gameEndedAt: null,
    winningTeam: null,
    lastMoveBy: null,
    lastMoveAt: null,
    lastMove: null,
    consecutiveTimeouts: [0, 0, 0, 0],
  };
}

function sortPositions(positions) {
  return [...positions].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function checkFixture(GameStateManager, fixture) {
  const problems = [];
  const manager = new GameStateManager();
  manager.state = buildState(fixture.initialState);

  const [fromRow, fromCol] = fixture.move.from;
  const [toRow, toCol] = fixture.move.to;
  const result = manager.makeMove(fromRow, fromCol, toRow, toCol);
  const expect = fixture.expect;

  if (result.valid !== expect.valid) {
    problems.push(`valid: expected ${expect.valid}, got ${result.valid}`);
  }
  if (expect.capturedPositions) {
    const captured = sortPositions(result.state.lastMove?.capturedPositions ?? []);
    const wanted = sortPositions(expect.capturedPositions);
    if (!deepEqual(captured, wanted)) {
      problems.push(
        `capturedPositions: expected ${JSON.stringify(wanted)}, got ${JSON.stringify(captured)}`
      );
    }
  }
  if (expect.capturedPieces && !deepEqual(result.state.capturedPieces, expect.capturedPieces)) {
    problems.push(
      `capturedPieces: expected ${JSON.stringify(expect.capturedPieces)}, got ${JSON.stringify(result.state.capturedPieces)}`
    );
  }
  if (
    expect.eliminatedPlayers &&
    !deepEqual(result.state.eliminatedPlayers, expect.eliminatedPlayers)
  ) {
    problems.push(
      `eliminatedPlayers: expected ${JSON.stringify(expect.eliminatedPlayers)}, got ${JSON.stringify(result.state.eliminatedPlayers)}`
    );
  }
  if (expect.gameEnded !== undefined && !!result.state.gameEndedAt !== expect.gameEnded) {
    problems.push(`gameEnded: expected ${expect.gameEnded}, got ${!!result.state.gameEndedAt}`);
  }
  if (expect.winningTeam !== undefined && result.state.winningTeam !== expect.winningTeam) {
    problems.push(
      `winningTeam: expected ${expect.winningTeam}, got ${result.state.winningTeam}`
    );
  }
  if (expect.currentPlayer !== undefined && result.state.currentPlayer !== expect.currentPlayer) {
    problems.push(
      `currentPlayer: expected ${expect.currentPlayer}, got ${result.state.currentPlayer}`
    );
  }
  for (const spot of expect.pieceAt ?? []) {
    const cell = result.state.board[spot.row][spot.col];
    if (spot.expect === null) {
      if (cell !== null) {
        problems.push(`pieceAt(${spot.row},${spot.col}): expected empty, got ${JSON.stringify(cell)}`);
      }
    } else if (!cell || cell.player !== spot.expect.player || !!cell.isDead !== spot.expect.isDead) {
      problems.push(
        `pieceAt(${spot.row},${spot.col}): expected ${JSON.stringify(spot.expect)}, got ${JSON.stringify(cell)}`
      );
    }
  }
  return problems;
}

function main() {
  const { productPath } = parseArgs(process.argv.slice(2));
  if (!productPath) {
    console.error("Usage: node verify-against-product.cjs --product-path /path/to/laplace-main");
    process.exit(2);
  }

  const productEntry = path.join(productPath, "packages/game-shared/dist/index.js");
  if (!fs.existsSync(productEntry)) {
    console.error(`Not found: ${productEntry}`);
    console.error("Build the product package first, e.g.:");
    console.error(`  npm run build --workspace @laplace/game-shared --prefix ${productPath}`);
    process.exit(2);
  }

  const { GameStateManager } = require(productEntry);
  const fixtureFile = path.join(__dirname, "..", "test", "fixtures", "rulegym-v1.json");
  const { ruleset, fixtures } = JSON.parse(fs.readFileSync(fixtureFile, "utf-8"));

  console.log(`Ruleset under test: ${ruleset}`);
  console.log(`Product checkout:   ${productPath}`);
  console.log(`Product commit:     ${loadProductCommit(productPath)}`);
  console.log("");

  let failures = 0;
  for (const fixture of fixtures) {
    const problems = checkFixture(GameStateManager, fixture);
    if (problems.length === 0) {
      console.log(`PASS  ${fixture.id}`);
    } else {
      failures++;
      console.log(`FAIL  ${fixture.id}`);
      for (const problem of problems) console.log(`      ${problem}`);
    }
  }

  console.log("");
  if (failures > 0) {
    console.error(
      `${failures}/${fixtures.length} fixtures diverge from the product engine.\n` +
        "This means either the product changed behavior the frozen ruleset relies on\n" +
        "(candidate for a deliberate laplace-8x8-v2 cut), or a fixture is stale.\n" +
        "Do not silently update laplace-engine to match."
    );
    process.exit(1);
  }
  console.log(`All ${fixtures.length} fixtures match the product engine at this commit.`);
}

main();
