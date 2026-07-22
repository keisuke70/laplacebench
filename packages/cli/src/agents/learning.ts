import "../env";
import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { colorName, playerTeam } from "../engine";
import type { Agent, EndGameInfo, ModelUsage, TeamId } from "../types";
import { normalizeAnthropicUsage } from "../usage";
import { claudeCliAgent } from "./cli";

const SKILLS_DIR = path.join(__dirname, "..", "..", "skills");
const ANALYSIS_SKILL = fs.readFileSync(path.join(SKILLS_DIR, "postgame-analysis.md"), "utf8");
const STRATEGY_FORMAT = fs.readFileSync(path.join(SKILLS_DIR, "strategy-format.md"), "utf8");

/** Human-readable ground-truth game record from the referee event log. */
export function formatGameRecord(eventsPath: string, myTeam: TeamId): string {
  const events = fs
    .readFileSync(eventsPath, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
  const lines: string[] = [];
  for (const e of events) {
    if (e.t === "move") {
      const team = playerTeam(e.player);
      const who = `${colorName(e.player)} (Team ${team}${team === myTeam ? " = YOU" : ""})`;
      const caps = (e.captures ?? [])
        .map((c: any) => ` CAPTURED ${c.owner}@(${c.at[0]},${c.at[1]})`)
        .join("");
      const elim = e.eliminated ? ` -> ${e.eliminated} ELIMINATED` : "";
      const win = e.winner ? ` -> TEAM ${e.winner} WINS` : "";
      lines.push(
        `ply ${e.ply}: ${who} moved (${e.from[0]},${e.from[1]}) -> (${e.to[0]},${e.to[1]})${caps}${elim}${win}`
      );
    } else if (e.t === "pass") {
      lines.push(`ply ${e.ply}: PASS (${e.reason})${e.eliminated ? ` -> ${e.eliminated} ELIMINATED` : ""}`);
    } else if (e.t === "failure") {
      lines.push(`  (ply ${e.ply}: rejected attempt ${e.attempt}, ${e.kind}${e.code ? ` ${e.code}` : ""})`);
    } else if (e.t === "game_end") {
      lines.push(
        `RESULT: winner ${e.winner ?? "none (draw)"} by ${e.reason} after ${e.plies} plies. Losses: ${JSON.stringify(e.losses)}`
      );
    }
  }
  return lines.join("\n");
}

function runClaude(args: string[], timeoutMs = 600_000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "claude",
      args,
      { timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err && !stdout) return reject(new Error(`${err.message} ${stderr.slice(0, 200)}`));
        resolve(stdout ?? "");
      }
    );
  });
}

/**
 * The "learning" condition: identical to claudeCliAgent during play, except
 * (a) the accumulated strategy document is injected after the rulebook at
 * game start, and (b) after each game a fresh analysis session reads the
 * referee's ground-truth record and rewrites the strategy document following
 * the strategy-format skill. Strategy persists across games in runDir/learn/.
 * The whole loop (play + analysis) uses the same model and effort, so any
 * strength difference vs the cold twin is attributable to the accumulation
 * loop alone.
 */
export function learningClaudeCliAgent(opts: {
  model?: string;
  effort?: string;
  runDir: string;
}): Agent {
  const model = opts.model ?? "sonnet";
  const learnDir = path.join(opts.runDir, "learn");
  const strategyPath = path.join(learnDir, "strategy.md");

  const base = claudeCliAgent({
    model,
    effort: opts.effort,
    name: `claude-cli-learn:${model}${opts.effort ? `@${opts.effort}` : ""}`,
    preludeProvider: () => {
      if (!fs.existsSync(strategyPath)) return "";
      return `## Your accumulated strategy notes\n\nYou have played this opponent before in this series. These are the strategy notes you wrote after analyzing those games. Apply them.\n\n${fs.readFileSync(strategyPath, "utf8")}`;
    },
  });

  return {
    ...base,
    async endGame(info?: EndGameInfo) {
      await base.endGame?.(info);
      if (!info) return;
      fs.mkdirSync(learnDir, { recursive: true });

      const record = formatGameRecord(info.eventsPath, info.team);
      const current = fs.existsSync(strategyPath)
        ? fs.readFileSync(strategyPath, "utf8")
        : "(none yet — this was your first game; create the document from scratch)";
      const colors = info.team === "A" ? "Red and Yellow" : "Blue and Green";
      const prompt = [
        ANALYSIS_SKILL,
        "---",
        STRATEGY_FORMAT,
        "---",
        `You were Team ${info.team}, controlling ${colors}. Result: you ${info.result === "draw" ? "drew" : info.result === "win" ? "won" : "lost"} (${info.reason}, ${info.plies} plies).`,
        "## Current strategy document",
        current,
        "## Full game record (ground truth from the referee)",
        record,
        "Now follow the analysis procedure and reply with ONLY the complete updated strategy document.",
      ].join("\n\n");

      let usageReport: ModelUsage | null = null;
      try {
        const stdout = await runClaude([
          "-p",
          prompt,
          "--output-format",
          "json",
          "--model",
          model,
          ...(opts.effort ? ["--effort", opts.effort] : []),
          "--disallowedTools",
          "Bash,Read,Write,Edit,Glob,Grep,WebFetch,WebSearch,Task,TodoWrite,NotebookEdit",
        ]);
        const parsed = JSON.parse(stdout.trim());
        const text: unknown = parsed?.result;
        usageReport =
          normalizeAnthropicUsage(
            parsed?.usage,
            "claude-cli",
            prompt,
            typeof text === "string" ? text : ""
          ) ?? null;
        if (typeof text === "string" && text.trim().length > 200) {
          fs.writeFileSync(strategyPath, text.trim() + "\n");
          fs.writeFileSync(
            path.join(learnDir, `strategy-after-${info.gameId}.md`),
            text.trim() + "\n"
          );
          console.log(`  [learn] strategy updated after ${info.gameId} (${text.trim().length} chars)`);
        } else {
          console.warn(`  [learn] analysis reply too short after ${info.gameId}; keeping previous strategy`);
        }
      } catch (err: any) {
        console.warn(`  [learn] analysis failed after ${info.gameId}: ${err?.message ?? err}`);
      }
      return { usageReports: [usageReport] };
    },
  };
}
