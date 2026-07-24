import "../env";
import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { buildInstructions, extractMove, observationFromInput, turnMessage } from "../prompt";
import type { Agent, AgentReply, TeamId, TurnInput } from "../types";
import { normalizeAnthropicUsage, normalizeOpenAIUsage } from "../usage";

const DISALLOWED_CLAUDE_TOOLS = [
  "Bash",
  "Read",
  "Write",
  "Edit",
  "Glob",
  "Grep",
  "WebFetch",
  "WebSearch",
  "Task",
  "TodoWrite",
  "NotebookEdit",
].join(",");

interface Spawned {
  stdout: string;
  stderr: string;
  code: number | null;
  timedOut: boolean;
}

/**
 * Child environment for CLI agents. The bench's contract is that run
 * conditions are labeled in agent names; ambient session variables must not
 * silently change them. CLAUDE_EFFORT leaked from a launching Claude Code
 * session and ran the whole 2026-07-24 pilot at effort=high without any
 * label — the explicit `--effort` flag is the only sanctioned channel.
 */
export function buildChildEnv(
  base: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
  const env = { ...base };
  delete env.CLAUDE_EFFORT;
  return env;
}

/**
 * Diagnostic line for a failed CLI reply. Each field is bounded
 * individually — the provider cause (`error`, then `result`) must survive
 * the event-log truncation no matter how large the other fields are. At a
 * single 400-char bound the usage block swallowed the actual error message
 * during the 2026-07-24 rate-limit incident.
 */
export function formatCliResultError(parsed: Record<string, unknown>): string {
  const bounded = (v: unknown, n: number) =>
    v === undefined ? undefined : JSON.stringify(v)?.slice(0, n);
  const head = {
    is_error: parsed.is_error,
    error: bounded(parsed.error, 300),
    result: bounded(parsed.result, 300),
  };
  return `CLI_RESULT_ERROR: ${JSON.stringify(head)} | full: ${JSON.stringify(parsed).slice(0, 600)}`;
}

function run(
  cmd: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
  input?: string
): Promise<Spawned> {
  return new Promise((resolve) => {
    const child = execFile(
      cmd,
      args,
      {
        cwd,
        timeout: Math.max(1, timeoutMs),
        maxBuffer: 64 * 1024 * 1024,
        env: buildChildEnv(),
      },
      (err, stdout, stderr) => {
        resolve({
          stdout: stdout ?? "",
          stderr: stderr ?? "",
          code: (err as any)?.code ?? 0,
          timedOut: Boolean((err as any)?.killed),
        });
      }
    );
    // Always close stdin. codex exec prints "Reading additional input from
    // stdin..." and blocks if it sees an open pipe with a positional prompt.
    if (child.stdin) {
      if (input !== undefined) child.stdin.write(input);
      child.stdin.end();
    }
  });
}

function scratchDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function uuid(): string {
  // Node >=14.17 has crypto.randomUUID
  return require("node:crypto").randomUUID();
}

/**
 * Subscription-driven adapter that drives the Claude Code CLI as a
 * subprocess. Persistent context is the CLI's own session: --session-id on
 * the first turn, --resume thereafter. All Claude Code tools are disabled so
 * the model only reasons and returns a move. Runs under the user's Claude
 * subscription, so no API key or per-token billing.
 *
 * Caveat: the CLI injects its own large Claude Code system prompt ahead of
 * our rulebook (sent as the first user message). This is a confound versus
 * the clean-slate API track and must be labeled as a distinct condition.
 */
export function claudeCliAgent(opts: {
  model?: string;
  effort?: string;
  /** Override the display/metrics name (used by wrappers). */
  name?: string;
  /** Called at startGame; returned text is appended after the rulebook in the first message. */
  preludeProvider?: () => string;
}): Agent {
  const model = opts.model ?? "sonnet";
  const cwd = scratchDir("laplace-claude-");
  let sessionId = "";
  let started = false;
  let team: TeamId = "A";
  let prelude = "";

  return {
    name: opts.name ?? `claude-cli:${model}${opts.effort ? `@${opts.effort}` : ""}`,
    usageProfile: { provider: "anthropic", source: "claude-cli" },
    startGame(t: TeamId) {
      team = t;
      sessionId = uuid();
      started = false;
      prelude = opts.preludeProvider?.() ?? "";
    },
    async act(input: TurnInput): Promise<AgentReply> {
      const obsJson = JSON.stringify(
        observationFromInput(input)
      );
      let userText = turnMessage(obsJson, input.attempt, input.error?.code, input.ply);
      if (!started) {
        const parts = [buildInstructions(team, { outputTokenBudget: input.outputTokenBudget })];
        if (prelude) parts.push(prelude);
        parts.push(userText);
        userText = parts.join("\n\n---\n\n");
      }

      const args = ["-p", userText, "--output-format", "json", "--model", model];
      if (opts.effort) args.push("--effort", opts.effort);
      if (!started) {
        args.push("--session-id", sessionId, "--disallowedTools", DISALLOWED_CLAUDE_TOOLS);
      } else {
        args.push("--resume", sessionId);
      }

      const start = Date.now();
      const { stdout, stderr, code, timedOut } = await run(
        "claude",
        args,
        cwd,
        input.deadlineAtMs - Date.now()
      );
      const latencyMs = Date.now() - start;
      started = true;

      if (timedOut || Date.now() >= input.deadlineAtMs) {
        // The killed session may contain a dangling user turn or partial
        // assistant output. Restart from the next full-state observation.
        sessionId = uuid();
        started = false;
        return {
          move: null,
          raw: `TURN_TIMEOUT: stderr=${stderr.slice(0, 300)}`,
          latencyMs,
          timedOut: true,
        };
      }

      let parsed: any;
      try {
        parsed = JSON.parse(stdout.trim());
      } catch {
        return {
          move: null,
          raw: `CLI_ERROR: exit=${code} stderr=${stderr.slice(0, 300)} stdout=${stdout.slice(0, 300)}`,
          latencyMs,
        };
      }

      if (parsed.is_error || typeof parsed.result !== "string") {
        return {
          move: null,
          raw: formatCliResultError(parsed),
          latencyMs,
        };
      }

      const text: string = parsed.result;
      const usage = parsed.usage ?? {};
      return {
        move: extractMove(text),
        raw: text,
        latencyMs,
        usage: normalizeAnthropicUsage(
          usage,
          "claude-cli",
          userText,
          text
        ),
      };
    },
    endGame() {
      try {
        fs.rmSync(cwd, { recursive: true, force: true });
      } catch {}
    },
  };
}

/**
 * Subscription-driven adapter for the Codex CLI (`codex exec`). Persistent
 * context via `codex exec resume <thread_id>`. Output is a JSONL event
 * stream; we read the thread id from thread.started, the answer from the last
 * agent_message, and usage from turn.completed. Runs under the user's ChatGPT
 * subscription.
 *
 * Note: an empty `model` uses the ChatGPT plan's default model (gpt-5-codex
 * is rejected on ChatGPT-account auth). Same harness-system-prompt confound
 * as the Claude CLI track.
 */
export function codexCliAgent(opts: { model?: string; effort?: string }): Agent {
  const model = opts.model ?? "";
  const cwd = scratchDir("laplace-codex-");
  let threadId = "";
  let started = false;
  let team: TeamId = "A";
  const effortArgs = opts.effort
    ? ["-c", `model_reasoning_effort="${opts.effort}"`]
    : [];

  return {
    name: `codex-cli:${model || "default"}${opts.effort ? `@${opts.effort}` : ""}`,
    usageProfile: { provider: "openai", source: "codex-cli" },
    startGame(t: TeamId) {
      team = t;
      threadId = "";
      started = false;
    },
    async act(input: TurnInput): Promise<AgentReply> {
      const obsJson = JSON.stringify(
        observationFromInput(input)
      );
      let userText = turnMessage(obsJson, input.attempt, input.error?.code, input.ply);
      if (!started) {
        userText = `${buildInstructions(team, { outputTokenBudget: input.outputTokenBudget })}\n\n---\n\n${userText}`;
      }

      const base = ["exec", "--json", "--skip-git-repo-check", ...effortArgs];
      if (model) base.push("-m", model);
      const args = started
        ? ["exec", "resume", threadId, "--json", "--skip-git-repo-check", ...effortArgs, ...(model ? ["-m", model] : []), userText]
        : [...base, userText];

      const start = Date.now();
      const { stdout, stderr, code, timedOut } = await run(
        "codex",
        args,
        cwd,
        input.deadlineAtMs - Date.now()
      );
      const latencyMs = Date.now() - start;

      if (timedOut || Date.now() >= input.deadlineAtMs) {
        // Do not resume a thread whose last turn was interrupted and whose
        // move was discarded by the referee.
        threadId = "";
        started = false;
        return {
          move: null,
          raw: `TURN_TIMEOUT: stderr=${stderr.slice(0, 300)}`,
          latencyMs,
          timedOut: true,
        };
      }

      const events = stdout
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .map((l) => {
          try {
            return JSON.parse(l);
          } catch {
            return null;
          }
        })
        .filter(Boolean);

      const threadStarted = events.find((e: any) => e.type === "thread.started");
      if (threadStarted) threadId = threadStarted.thread_id;
      started = true;

      const failed = events.find(
        (e: any) => e.type === "turn.failed" || e.type === "error"
      );
      const messages = events.filter(
        (e: any) => e.type === "item.completed" && e.item?.type === "agent_message"
      );

      if (messages.length === 0) {
        return {
          move: null,
          raw: `CLI_ERROR: exit=${code} failed=${JSON.stringify(failed ?? null).slice(0, 300)} stderr=${stderr.slice(0, 200)}`,
          latencyMs,
        };
      }

      // Concatenate all agent messages so the move is found wherever codex
      // put it (reasoning narration may precede the final answer).
      const text: string = messages.map((m: any) => m.item.text ?? "").join("\n");
      const usageEvent = events.find((e: any) => e.type === "turn.completed");
      const u = usageEvent?.usage ?? {};
      return {
        move: extractMove(text),
        raw: text,
        latencyMs,
        usage: normalizeOpenAIUsage(u, "codex-cli", userText, text),
      };
    },
    endGame() {
      try {
        fs.rmSync(cwd, { recursive: true, force: true });
      } catch {}
    },
  };
}
