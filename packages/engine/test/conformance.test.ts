import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { DEFAULT_TURN_TIME_LIMIT, GameStateManager } from "../src/core";
import type { GameBoard, GameState } from "../src/core/types";

/**
 * Stage-0 conformance gate (design-v0.1.md section 10; benchmark-strategy-ja.md
 * section 6.3): pins the frozen referee's behavior for laplace-8x8-v1 against a
 * committed, hand-readable fixture set instead of a one-time manual read-through.
 * A future deliberate rule change should update these fixtures under a new
 * ruleset id (laplace-8x8-v2), not edit them silently.
 */

interface FixturePiece {
  row: number;
  col: number;
  player: 1 | 2 | 3 | 4;
  isDead?: boolean;
}

interface FixtureInitialState {
  boardSize: number;
  currentPlayer: number;
  capturedPieces: [number, number, number, number];
  eliminatedPlayers: [boolean, boolean, boolean, boolean];
  pieces: FixturePiece[];
}

interface FixtureExpect {
  valid: boolean;
  capturedPositions?: [number, number][];
  capturedPieces?: [number, number, number, number];
  eliminatedPlayers?: [boolean, boolean, boolean, boolean];
  gameEnded?: boolean;
  winningTeam?: "A" | "B" | null;
  currentPlayer?: number;
  pieceAt?: {
    row: number;
    col: number;
    expect: null | { player: number; isDead: boolean };
  }[];
}

interface Fixture {
  id: string;
  ruleConcept: string;
  description: string;
  initialState: FixtureInitialState;
  move: { from: [number, number]; to: [number, number] };
  expect: FixtureExpect;
}

interface FixtureFile {
  fixtureSetVersion: string;
  ruleset: string;
  fixtures: Fixture[];
}

function loadFixtures(): FixtureFile {
  const raw = readFileSync(
    join(__dirname, "fixtures", "rulegym-v1.json"),
    "utf-8"
  );
  return JSON.parse(raw) as FixtureFile;
}

function buildState(initial: FixtureInitialState): GameState {
  const board: GameBoard = Array.from({ length: initial.boardSize }, () =>
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
    turnTimeLimit: DEFAULT_TURN_TIME_LIMIT,
    gameStartedAt: now,
    gameEndedAt: null,
    winningTeam: null,
    lastMoveBy: null,
    lastMoveAt: null,
    lastMove: null,
    consecutiveTimeouts: [0, 0, 0, 0],
  };
}

function sortPositions(positions: [number, number][]): [number, number][] {
  return [...positions].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

const { fixtures, ruleset } = loadFixtures();

test(`conformance fixtures target ruleset ${ruleset}`, () => {
  assert.equal(ruleset, "laplace-8x8-v1");
  assert.ok(fixtures.length > 0, "fixture file must not be empty");
});

for (const fixture of fixtures) {
  test(`rulegym-v1: ${fixture.id} [${fixture.ruleConcept}]`, () => {
    const manager = new GameStateManager();
    manager.state = buildState(fixture.initialState);

    const [fromRow, fromCol] = fixture.move.from;
    const [toRow, toCol] = fixture.move.to;
    const result = manager.makeMove(fromRow, fromCol, toRow, toCol);

    assert.equal(result.valid, fixture.expect.valid, fixture.description);

    if (fixture.expect.capturedPositions) {
      const captured = result.state.lastMove?.capturedPositions ?? [];
      assert.deepEqual(
        sortPositions(captured as [number, number][]),
        sortPositions(fixture.expect.capturedPositions)
      );
    }
    if (fixture.expect.capturedPieces) {
      assert.deepEqual(result.state.capturedPieces, fixture.expect.capturedPieces);
    }
    if (fixture.expect.eliminatedPlayers) {
      assert.deepEqual(
        result.state.eliminatedPlayers,
        fixture.expect.eliminatedPlayers
      );
    }
    if (fixture.expect.gameEnded !== undefined) {
      assert.equal(!!result.state.gameEndedAt, fixture.expect.gameEnded);
    }
    if (fixture.expect.winningTeam !== undefined) {
      assert.equal(result.state.winningTeam, fixture.expect.winningTeam);
    }
    if (fixture.expect.currentPlayer !== undefined) {
      assert.equal(result.state.currentPlayer, fixture.expect.currentPlayer);
    }
    for (const spot of fixture.expect.pieceAt ?? []) {
      const cell = result.state.board[spot.row][spot.col];
      if (spot.expect === null) {
        assert.equal(cell, null, `expected (${spot.row},${spot.col}) to be empty`);
      } else {
        assert.ok(cell, `expected a piece at (${spot.row},${spot.col})`);
        assert.equal(cell!.player, spot.expect.player);
        assert.equal(!!cell!.isDead, spot.expect.isDead);
      }
    }
  });
}
