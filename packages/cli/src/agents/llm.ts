import "../env";
import Anthropic from "@anthropic-ai/sdk";
import { buildInstructions, extractMove, observationFromInput, turnMessage } from "../prompt";
import type { Agent, AgentReply, TeamId, TurnInput } from "../types";
import { normalizeAnthropicUsage } from "../usage";

import { MODEL_SHORTHAND } from "../catalog";

/**
 * Persistent-context Anthropic adapter. One append-only conversation per
 * game; the system prompt (rulebook) and the growing transcript are marked
 * for prompt caching so each turn re-reads the prefix at cache rates.
 *
 * Deliberately no server-side fallbacks: in a benchmark, a refusal or
 * failure must be recorded against the model under test, never silently
 * answered by a different model.
 */
export function anthropicAgent(opts: { model: string }): Agent {
  const model = MODEL_SHORTHAND[opts.model] ?? opts.model;
  const client = new Anthropic({ maxRetries: 5 });
  const isLegacyThinking = model.includes("haiku") || model.includes("4-5");
  let messages: Anthropic.MessageParam[] = [];
  let system = "";
  let started = false;

  return {
    name: `anthropic:${model}`,
    usageProfile: { provider: "anthropic", source: "anthropic-api" },
    startGame() {
      messages = [];
      system = "";
      started = false;
    },
    async act(input: TurnInput): Promise<AgentReply> {
      // Built lazily on the first act: match-resource disclosure (token
      // budget) only exists on TurnInput, not at startGame time.
      if (!system) {
        system = buildInstructions(input.team, {
          outputTokenBudget: input.outputTokenBudget,
        });
      }
      const obsJson = JSON.stringify(observationFromInput(input));
      const userText = turnMessage(
        obsJson,
        input.attempt,
        input.error?.code,
        input.ply
      );

      messages.push({
        role: "user",
        content: [{ type: "text", text: userText }],
      });

      const start = Date.now();
      let response: Anthropic.Message;
      try {
        const remainingMs = Math.max(1, input.deadlineAtMs - Date.now());
        response = await client.messages.create(
          {
            model,
            max_tokens: 16000,
            ...(isLegacyThinking ? {} : { thinking: { type: "adaptive" } }),
            system: [
              {
                type: "text",
                text: system,
                cache_control: { type: "ephemeral" },
              },
            ],
            messages: withCacheMarker(messages),
          },
          {
            timeout: remainingMs,
            signal: AbortSignal.timeout(remainingMs),
          }
        );
      } catch (err: any) {
        // Terminal API failure after SDK retries: recorded as a failed reply.
        messages.pop();
        const timedOut = Date.now() >= input.deadlineAtMs;
        return {
          move: null,
          raw: `${timedOut ? "TURN_TIMEOUT" : "API_ERROR"}: ${err?.message ?? String(err)}`,
          latencyMs: Date.now() - start,
          timedOut,
        };
      }
      const latencyMs = Date.now() - start;
      const applicationInput = started
        ? userText
        : `${system}\n\n---\n\n${userText}`;

      const text = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n");

      const move =
        response.stop_reason === "refusal" ? null : extractMove(text);

      if (Date.now() >= input.deadlineAtMs) {
        messages.pop();
        return {
          move: null,
          raw: "TURN_TIMEOUT: response completed after the game-turn deadline",
          latencyMs,
          usage: normalizeAnthropicUsage(
            response.usage as unknown as Record<string, unknown>,
            "anthropic-api",
            applicationInput,
            text
          ),
          timedOut: true,
        };
      }

      started = true;
      // Keep the full content (thinking blocks included) for continuation.
      messages.push({
        role: "assistant",
        content: response.content as unknown as Anthropic.ContentBlockParam[],
      });

      return {
        move,
        raw:
          response.stop_reason === "refusal"
            ? `REFUSAL: ${JSON.stringify(response.stop_details ?? null)}`
            : text,
        latencyMs,
        usage: normalizeAnthropicUsage(
          response.usage as unknown as Record<string, unknown>,
          "anthropic-api",
          applicationInput,
          text
        ),
      };
    },
  };
}

/**
 * Return a copy of the transcript with a cache breakpoint on the newest
 * user message, so the whole prefix up to this turn is cached for the next
 * one. Stored messages stay clean (max 4 breakpoints per request).
 */
function withCacheMarker(
  messages: Anthropic.MessageParam[]
): Anthropic.MessageParam[] {
  const last = messages.length - 1;
  return messages.map((m, i) => {
    if (i !== last || !Array.isArray(m.content)) return m;
    const content = m.content.map((block, j) =>
      j === m.content.length - 1 && block.type === "text"
        ? { ...block, cache_control: { type: "ephemeral" as const } }
        : block
    );
    return { ...m, content };
  });
}
