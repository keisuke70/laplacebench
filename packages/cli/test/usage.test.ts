import assert from "node:assert/strict";
import test from "node:test";
import {
  blankUsage,
  normalizeAnthropicUsage,
  normalizeOpenAIUsage,
  recordUsageCall,
  usageSummary,
} from "../src/usage";

test("normalizes Anthropic's three additive input buckets", () => {
  const usage = normalizeAnthropicUsage(
    {
      input_tokens: 2,
      cache_creation_input_tokens: 10_314,
      cache_read_input_tokens: 14_777,
      output_tokens: 4,
    },
    "claude-cli",
    "Reply only with OK.",
    "OK"
  );

  assert.ok(usage);
  assert.equal(usage.inputTotalTokens, 25_093);
  assert.equal(usage.inputUncachedTokens, 10_316);
  assert.equal(usage.cacheReadTokens, 14_777);
  assert.equal(usage.cacheWriteTokens, 10_314);
  assert.equal(usage.outputTotalTokens, 4);
  assert.equal(usage.reasoningTokens, null);
});

test("normalizes OpenAI cached input as a subset, not an additive bucket", () => {
  const usage = normalizeOpenAIUsage(
    {
      input_tokens: 13_362,
      cached_input_tokens: 5_888,
      output_tokens: 5,
      reasoning_output_tokens: 0,
    },
    "codex-cli",
    "Reply only with OK.",
    "OK"
  );

  assert.ok(usage);
  assert.equal(usage.inputTotalTokens, 13_362);
  assert.equal(usage.inputUncachedTokens, 7_474);
  assert.equal(usage.cacheReadTokens, 5_888);
  assert.equal(usage.cacheWriteTokens, null);
  assert.equal(usage.outputTotalTokens, 5);
  assert.equal(usage.reasoningTokens, 0);
});

test("rejects malformed provider usage instead of silently recording zero", () => {
  assert.equal(
    normalizeAnthropicUsage(
      { input_tokens: 1, output_tokens: "unknown" },
      "claude-cli",
      "x",
      "y"
    ),
    undefined
  );
  assert.equal(
    normalizeOpenAIUsage(
      { input_tokens: 10, cached_input_tokens: 11, output_tokens: 1 },
      "codex-cli",
      "x",
      "y"
    ),
    undefined
  );
});

test("reports coverage and preserves unknown cache/reasoning buckets", () => {
  const aggregate = blankUsage({ provider: "openai", source: "codex-cli" });
  const usage = normalizeOpenAIUsage(
    { input_tokens: 100, cached_input_tokens: 80, output_tokens: 10 },
    "codex-cli",
    "盤面",
    "move"
  );
  assert.ok(usage);

  recordUsageCall(aggregate, usage);
  recordUsageCall(aggregate, undefined, {
    provider: "openai",
    source: "codex-cli",
  });

  const summary = usageSummary(aggregate) as Record<string, unknown>;
  assert.equal(summary.status, "partial");
  assert.equal(summary.adapter_calls, 2);
  assert.equal(summary.reported_calls, 1);
  assert.equal(summary.unreported_calls, 1);
  assert.equal(summary.total_tokens, 110);
  assert.equal(summary.fresh_tokens, 30);
  assert.equal(summary.cache_write_tokens, null);
  assert.equal(summary.reasoning_tokens, null);
  assert.equal(summary.application_input_bytes, 6);
  assert.equal(summary.averages, null);
});

test("publishes normalized averages only with complete telemetry", () => {
  const aggregate = blankUsage({ provider: "openai", source: "codex-cli" });
  const usage = normalizeOpenAIUsage(
    {
      input_tokens: 100,
      cached_input_tokens: 80,
      output_tokens: 20,
      reasoning_output_tokens: 10,
    },
    "codex-cli",
    "abcd",
    "ok"
  );
  assert.ok(usage);
  recordUsageCall(aggregate, usage);

  const summary = usageSummary(aggregate, {
    games: 2,
    turns: 4,
  }) as any;
  assert.equal(summary.averages.per_reported_call.total_tokens, 120);
  assert.equal(summary.averages.per_game.total_tokens, 60);
  assert.equal(summary.averages.per_turn.total_tokens, 30);
});
