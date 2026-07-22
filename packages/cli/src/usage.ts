import {
  MODEL_USAGE_SCHEMA,
  type ModelUsage,
  type UsageAggregate,
  type UsageProfile,
  type UsageSource,
} from "./types";

type UnknownUsage = Record<string, unknown> | null | undefined;

function requiredCount(value: unknown): number | null {
  return Number.isSafeInteger(value) && (value as number) >= 0
    ? (value as number)
    : null;
}

function optionalCount(value: unknown, fallback = 0): number | null {
  return value === undefined || value === null ? fallback : requiredCount(value);
}

function reportedCount(value: unknown): number | null {
  return value === undefined || value === null ? null : requiredCount(value);
}

function nestedCount(raw: UnknownUsage, path: string[]): number | null {
  let value: unknown = raw;
  for (const key of path) {
    if (typeof value !== "object" || value === null) return null;
    value = (value as Record<string, unknown>)[key];
  }
  return requiredCount(value);
}

export function utf8Bytes(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

/** Normalize Anthropic's additive input buckets. */
export function normalizeAnthropicUsage(
  raw: UnknownUsage,
  source: Extract<UsageSource, "anthropic-api" | "claude-cli">,
  applicationInput: string,
  applicationOutput: string
): ModelUsage | undefined {
  const input = requiredCount(raw?.input_tokens);
  const cacheRead = optionalCount(raw?.cache_read_input_tokens);
  const cacheWrite = optionalCount(raw?.cache_creation_input_tokens);
  const output = requiredCount(raw?.output_tokens);
  if (input === null || cacheRead === null || cacheWrite === null || output === null) {
    return undefined;
  }

  const thinking = nestedCount(raw, ["output_tokens_details", "thinking_tokens"]);
  if (thinking !== null && thinking > output) return undefined;

  return {
    schema: MODEL_USAGE_SCHEMA,
    provider: "anthropic",
    source,
    inputTotalTokens: input + cacheRead + cacheWrite,
    inputUncachedTokens: input + cacheWrite,
    cacheReadTokens: cacheRead,
    cacheWriteTokens: cacheWrite,
    outputTotalTokens: output,
    reasoningTokens: thinking,
    applicationInputBytes: utf8Bytes(applicationInput),
    applicationOutputBytes: utf8Bytes(applicationOutput),
  };
}

/** Normalize OpenAI's total-input-with-cached-subset shape. */
export function normalizeOpenAIUsage(
  raw: UnknownUsage,
  source: Extract<UsageSource, "codex-cli">,
  applicationInput: string,
  applicationOutput: string
): ModelUsage | undefined {
  const inputTotal = requiredCount(raw?.input_tokens);
  const cacheRead = optionalCount(raw?.cached_input_tokens);
  const output = requiredCount(raw?.output_tokens);
  if (inputTotal === null || cacheRead === null || output === null) return undefined;
  if (cacheRead > inputTotal) return undefined;

  const reasoningKnown = reportedCount(raw?.reasoning_output_tokens);
  if (reasoningKnown !== null && reasoningKnown > output) return undefined;

  return {
    schema: MODEL_USAGE_SCHEMA,
    provider: "openai",
    source,
    inputTotalTokens: inputTotal,
    inputUncachedTokens: inputTotal - cacheRead,
    cacheReadTokens: cacheRead,
    // `codex exec --json` does not expose a cache-write bucket.
    cacheWriteTokens: null,
    outputTotalTokens: output,
    reasoningTokens: reasoningKnown,
    applicationInputBytes: utf8Bytes(applicationInput),
    applicationOutputBytes: utf8Bytes(applicationOutput),
  };
}

function addUnique<T>(values: T[], value: T): void {
  if (!values.includes(value)) values.push(value);
}

export function blankUsage(profile?: UsageProfile): UsageAggregate {
  return {
    schema: MODEL_USAGE_SCHEMA,
    adapterCalls: 0,
    reportedCalls: 0,
    unreportedCalls: 0,
    legacyUnversionedCalls: 0,
    providers: profile ? [profile.provider] : [],
    sources: profile ? [profile.source] : [],
    inputTotalTokens: 0,
    inputUncachedTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    cacheWriteReportedCalls: 0,
    outputTotalTokens: 0,
    reasoningTokens: 0,
    reasoningReportedCalls: 0,
    applicationInputBytes: 0,
    applicationOutputBytes: 0,
  };
}

/** Record one adapter invocation. Undefined means telemetry was unavailable. */
export function recordUsageCall(
  aggregate: UsageAggregate,
  usage: ModelUsage | undefined,
  profile?: UsageProfile
): void {
  aggregate.adapterCalls++;
  if (profile) {
    addUnique(aggregate.providers, profile.provider);
    addUnique(aggregate.sources, profile.source);
  }
  if (!usage) {
    aggregate.unreportedCalls++;
    return;
  }

  aggregate.reportedCalls++;
  addUnique(aggregate.providers, usage.provider);
  addUnique(aggregate.sources, usage.source);
  aggregate.inputTotalTokens += usage.inputTotalTokens;
  aggregate.inputUncachedTokens += usage.inputUncachedTokens;
  aggregate.cacheReadTokens += usage.cacheReadTokens;
  if (usage.cacheWriteTokens !== null) {
    aggregate.cacheWriteTokens += usage.cacheWriteTokens;
    aggregate.cacheWriteReportedCalls++;
  }
  aggregate.outputTotalTokens += usage.outputTotalTokens;
  if (usage.reasoningTokens !== null) {
    aggregate.reasoningTokens += usage.reasoningTokens;
    aggregate.reasoningReportedCalls++;
  }
  aggregate.applicationInputBytes += usage.applicationInputBytes;
  aggregate.applicationOutputBytes += usage.applicationOutputBytes;
}

export function mergeUsage(target: UsageAggregate, source: UsageAggregate): void {
  target.adapterCalls += source.adapterCalls;
  target.reportedCalls += source.reportedCalls;
  target.unreportedCalls += source.unreportedCalls;
  target.legacyUnversionedCalls += source.legacyUnversionedCalls;
  for (const provider of source.providers) addUnique(target.providers, provider);
  for (const usageSource of source.sources) addUnique(target.sources, usageSource);
  target.inputTotalTokens += source.inputTotalTokens;
  target.inputUncachedTokens += source.inputUncachedTokens;
  target.cacheReadTokens += source.cacheReadTokens;
  target.cacheWriteTokens += source.cacheWriteTokens;
  target.cacheWriteReportedCalls += source.cacheWriteReportedCalls;
  target.outputTotalTokens += source.outputTotalTokens;
  target.reasoningTokens += source.reasoningTokens;
  target.reasoningReportedCalls += source.reasoningReportedCalls;
  target.applicationInputBytes += source.applicationInputBytes;
  target.applicationOutputBytes += source.applicationOutputBytes;
}

export function isUsageAggregate(value: unknown): value is UsageAggregate {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { schema?: unknown }).schema === MODEL_USAGE_SCHEMA
  );
}

function inferLegacyProfile(agent: string): UsageProfile | undefined {
  if (agent.startsWith("claude-cli")) {
    return { provider: "anthropic", source: "claude-cli" };
  }
  if (agent.startsWith("anthropic:")) {
    return { provider: "anthropic", source: "anthropic-api" };
  }
  if (agent.startsWith("codex-cli")) {
    return { provider: "openai", source: "codex-cli" };
  }
  return undefined;
}

/**
 * Best-effort reader for pre-v1 final.json files. These files did not record
 * Anthropic cache writes, reasoning coverage, or missing-usage calls, so the
 * result is explicitly marked legacy and must not be treated as normalized.
 */
export function legacyUsageFromTeamStats(stats: {
  agent: string;
  actCalls?: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
}): UsageAggregate {
  const profile = inferLegacyProfile(stats.agent);
  const aggregate = blankUsage(profile);
  if (!profile) return aggregate;

  const calls = Math.max(0, stats.actCalls ?? 0);
  const input = Math.max(0, stats.inputTokens ?? 0);
  const output = Math.max(0, stats.outputTokens ?? 0);
  const cacheRead = Math.max(0, stats.cacheReadTokens ?? 0);
  aggregate.adapterCalls = calls;
  aggregate.legacyUnversionedCalls = calls;
  aggregate.outputTotalTokens = output;
  aggregate.cacheReadTokens = cacheRead;

  if (profile.provider === "openai") {
    aggregate.inputTotalTokens = input;
    aggregate.inputUncachedTokens = Math.max(0, input - cacheRead);
  } else {
    // Anthropic's old `inputTokens` excluded cache reads and unrecorded cache
    // writes. Adding known cache reads is closer, but the total is a floor.
    aggregate.inputTotalTokens = input + cacheRead;
    aggregate.inputUncachedTokens = input;
  }
  return aggregate;
}

export function usageStatus(
  usage: UsageAggregate
): "not_applicable" | "complete" | "partial" | "legacy_unversioned" {
  if (usage.legacyUnversionedCalls > 0) return "legacy_unversioned";
  if (usage.adapterCalls === 0) return "not_applicable";
  return usage.unreportedCalls === 0 ? "complete" : "partial";
}

function average(value: number, denominator: number): number | null {
  return denominator > 0 ? Math.round(value / denominator) : null;
}

export function usageSummary(
  usage: UsageAggregate,
  denominators?: { games?: number; turns?: number }
): object {
  const cacheWriteComplete =
    usage.reportedCalls > 0 && usage.cacheWriteReportedCalls === usage.reportedCalls;
  const reasoningComplete =
    usage.reportedCalls > 0 && usage.reasoningReportedCalls === usage.reportedCalls;
  const status = usageStatus(usage);
  const total = usage.inputTotalTokens + usage.outputTotalTokens;
  const fresh = usage.inputUncachedTokens + usage.outputTotalTokens;
  const averages =
    status === "complete"
      ? {
          per_reported_call: {
            total_tokens: average(total, usage.reportedCalls),
            fresh_tokens: average(fresh, usage.reportedCalls),
            application_input_bytes: average(
              usage.applicationInputBytes,
              usage.reportedCalls
            ),
            application_output_bytes: average(
              usage.applicationOutputBytes,
              usage.reportedCalls
            ),
          },
          per_game: {
            total_tokens: average(total, denominators?.games ?? 0),
            fresh_tokens: average(fresh, denominators?.games ?? 0),
          },
          per_turn: {
            total_tokens: average(total, denominators?.turns ?? 0),
            fresh_tokens: average(fresh, denominators?.turns ?? 0),
          },
        }
      : null;
  return {
    schema: usage.schema,
    status,
    adapter_calls: usage.adapterCalls,
    reported_calls: usage.reportedCalls,
    unreported_calls: usage.unreportedCalls,
    legacy_unversioned_calls: usage.legacyUnversionedCalls,
    providers: usage.providers,
    sources: usage.sources,
    input_tokens_total: usage.inputTotalTokens,
    input_tokens_uncached: usage.inputUncachedTokens,
    cache_read_tokens: usage.cacheReadTokens,
    cache_write_tokens: cacheWriteComplete ? usage.cacheWriteTokens : null,
    cache_write_reported_calls: usage.cacheWriteReportedCalls,
    output_tokens_total: usage.outputTotalTokens,
    reasoning_tokens: reasoningComplete ? usage.reasoningTokens : null,
    reasoning_reported_calls: usage.reasoningReportedCalls,
    total_tokens: total,
    fresh_tokens: fresh,
    application_input_bytes: usage.applicationInputBytes,
    application_output_bytes: usage.applicationOutputBytes,
    averages,
  };
}
