import assert from "node:assert/strict";
import test from "node:test";
import { getEliminationThreshold } from "../src/core";

/**
 * Direct regression guard for the bug design-v0.1.md section 10 records as
 * resolved 2026-07-20: the threshold must be the fixed value 3 for every
 * board size, not the old derived `boardSize - 5` (which silently changed
 * meaning as the product added 9x9/10x10 support).
 */

test("elimination threshold is fixed at 3, independent of board size", () => {
  for (const boardSize of [7, 8, 9, 10]) {
    assert.equal(getEliminationThreshold(boardSize), 3, `boardSize=${boardSize}`);
  }
});

test("elimination threshold ignores an undefined board size", () => {
  assert.equal(getEliminationThreshold(undefined), 3);
});
