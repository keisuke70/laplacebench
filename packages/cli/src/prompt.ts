import * as fs from "node:fs";
import * as path from "node:path";
import { observation } from "./engine";
import type { Move, TeamId, TurnInput } from "./types";

/**
 * Prompt generation label. Canonical-run comparisons are valid only within
 * one generation (same discipline as the regret oracle generation).
 * p2: token-budget disclosure added (docs/plans/2026-07-24-token-budget.md).
 */
export const PROMPT_REV = "p2-token-budget";

const RULEBOOK = fs.readFileSync(
  path.join(__dirname, "..", "rulebook", "laplace-8x8-v1.md"),
  "utf8"
);

/**
 * The full instructions given to a model at game start. Used as the system
 * prompt by the API adapter and as the first user-message preamble by the
 * subscription-CLI adapters, so all three tracks see identical rules text.
 */
export function buildInstructions(
  team: TeamId,
  opts?: { outputTokenBudget?: number }
): string {
  const colors = team === "A" ? "Red and Yellow" : "Blue and Green";
  const enemy = team === "A" ? "Blue and Green" : "Red and Yellow";
  const budgetLine = opts?.outputTokenBudget
    ? `\n- Your team has a total output-token budget of ${opts.outputTokenBudget} for the whole game (thinking included). When it is exhausted, your remaining turns are passed automatically — budget your thinking.`
    : "";
  return `You are playing the board game LAPLACE as Team ${team}, controlling BOTH the ${colors} colors for the entire game. Your opponent controls ${enemy}. The complete rulebook follows; it is the only rules authority.

${RULEBOOK}

## How this match is played

- This conversation persists for the whole game. Each of your turns arrives as a message containing an observation JSON with: the current ply, which color is acting now, the board, per-color loss counts, eliminated colors, and every event since your previous turn (opponent moves, captures, passes).
- Board encoding: an array of 8 strings, row 0 (top) first. "." = empty, R/B/Y/G = normal Red/Blue/Yellow/Green pieces, lowercase r/b/y/g = Void pieces. Column 0 is the leftmost character.
- You are NOT given a list of legal moves. You must derive legality from the rules yourself.
- Reply with your chosen move as a JSON object, exactly one move for the acting color:

  {"move": {"from": {"row": R, "col": C}, "to": {"row": R, "col": C}}}

- You may think out loud and keep notes or plans in your reply before the JSON; this text stays in the conversation and is a good place to accumulate strategy across turns. The LAST valid JSON object in your reply is taken as your move.
- If your reply is malformed or the move is illegal, you get exactly one corrective chance with an error code; a second failure forfeits the turn, and two consecutive forfeits eliminate the acting color.${budgetLine}

Play to win.`;
}

/**
 * Observation JSON for a turn — the single construction path shared by all
 * LLM adapters (API, claude-cli, codex-cli), so match-resource disclosure
 * stays identical across tracks by construction. Budget fields are present
 * exactly when the match has a token envelope.
 */
export function observationFromInput(input: TurnInput): object {
  const base = observation(
    input.state,
    input.ply,
    input.maxPlies,
    input.team,
    input.recent
  ) as Record<string, unknown>;
  if (input.outputTokenBudget !== undefined) {
    base.output_token_budget = input.outputTokenBudget;
    base.output_tokens_used = input.outputTokensUsed ?? 0;
  }
  return base;
}

/** Extract the last valid move JSON from free-form model text. */
export function extractMove(text: string): Move | null {
  let best: Move | null = null;
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== "{") continue;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let j = i; j < text.length; j++) {
      const ch = text[j];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === '"') inString = !inString;
      if (inString) continue;
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          const candidate = tryParseMove(text.slice(i, j + 1));
          if (candidate) best = candidate;
          break;
        }
      }
    }
  }
  return best;
}

function tryParseMove(json: string): Move | null {
  let parsed: any;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  const m = parsed?.move ?? parsed;
  const from = coerceRC(m?.from);
  const to = coerceRC(m?.to);
  if (!from || !to) return null;
  return { from, to };
}

/**
 * Accept either {row,col} objects or [row,col] arrays (the arrays were the
 * original schema shape). We deliberately do NOT accept chess algebraic
 * notation ("e2e4") — using it is a genuine failure to adopt the game's
 * coordinate system, which the benchmark should record, not paper over.
 */
function coerceRC(v: any): { row: number; col: number } | null {
  let row: unknown;
  let col: unknown;
  if (Array.isArray(v) && v.length === 2) {
    [row, col] = v;
  } else if (v && typeof v === "object") {
    row = v.row;
    col = v.col;
  } else {
    return null;
  }
  if (
    Number.isInteger(row) &&
    Number.isInteger(col) &&
    (row as number) >= 0 &&
    (row as number) <= 7 &&
    (col as number) >= 0 &&
    (col as number) <= 7
  ) {
    return { row: row as number, col: col as number };
  }
  return null;
}

/** The per-turn observation text (attempt 1) or repair message (attempt 2+). */
export function turnMessage(
  obsJson: string,
  attempt: number,
  errorCode: string | undefined,
  ply: number
): string {
  if (attempt === 1) return obsJson;
  return `Your previous reply was rejected (${errorCode}). It is still ply ${ply} and the same color's turn. Reply again, ending with your move as JSON in exactly this shape:

{"move": {"from": {"row": R, "col": C}, "to": {"row": R, "col": C}}}

where row and col are integers 0-7 (row 0 = top edge, col 0 = left edge). Use row/col integers, NOT chess notation. The move must be legal for the acting color under the rules.`;
}
