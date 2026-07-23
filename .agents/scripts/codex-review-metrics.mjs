export const REVIEW_USAGE_FIELDS = [
  'input_tokens',
  'cached_input_tokens',
  'output_tokens',
  'reasoning_output_tokens',
];

export function hasScopedChanges(scopeDelta) {
  return ['changed', 'added', 'removed'].some((field) => (scopeDelta?.[field]?.length ?? 0) > 0);
}

export function validOrderedAdjudication(block, issueCount) {
  if (!Number.isInteger(issueCount) || issueCount <= 0 || typeof block !== 'string') return false;
  const lines = block.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length !== issueCount) return false;
  return lines.every((line, index) => {
    const match = line.match(/^(\d+)\.\s+(ACCEPT|REJECT|DEFER)\b/i);
    return match && Number(match[1]) === index + 1;
  });
}

export function selectResumeInspection({
  previousVerdict,
  previousIssueCount,
  adjudicationBlock,
  scopeDelta,
  historyIntegrityOk = true,
}) {
  const eligible = previousVerdict === 'NEEDS_CHANGES'
    && validOrderedAdjudication(adjudicationBlock, previousIssueCount)
    && hasScopedChanges(scopeDelta);
  if (!eligible) return { resumeInspectionMode: 'full_ineligible' };
  if (!historyIntegrityOk) return { resumeInspectionMode: 'full_history_gap' };
  return { resumeInspectionMode: 'compact_delta' };
}

export function normalizeRawUsageShape(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const normalized = {
    input_tokens: value.input_tokens,
    cached_input_tokens: value.cached_input_tokens,
    output_tokens: value.output_tokens,
    reasoning_output_tokens: value.reasoning_output_tokens ?? 0,
  };
  if (!REVIEW_USAGE_FIELDS.every((field) => Number.isFinite(normalized[field]) && normalized[field] >= 0)) {
    return null;
  }
  if (normalized.cached_input_tokens > normalized.input_tokens) return null;
  return normalized;
}

export function extractLastTurnUsage(logText) {
  let observedTurnStarted = false;
  let observedTurnCompleted = false;
  let lastRawUsage = null;
  for (const line of String(logText ?? '').split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const payload = JSON.parse(line);
      if (payload.type === 'turn.started') observedTurnStarted = true;
      if (payload.type !== 'turn.completed') continue;
      observedTurnCompleted = true;
      lastRawUsage = normalizeRawUsageShape(payload.usage);
    } catch {}
  }
  return { observedTurnStarted, observedTurnCompleted, rawTotal: lastRawUsage };
}

export function subtractUsage(current, prior) {
  const normalizedCurrent = normalizeRawUsageShape(current);
  const normalizedPrior = normalizeRawUsageShape(prior);
  if (!normalizedCurrent || !normalizedPrior) return null;
  const delta = Object.fromEntries(
    REVIEW_USAGE_FIELDS.map((field) => [field, normalizedCurrent[field] - normalizedPrior[field]]),
  );
  return normalizeRawUsageShape(delta);
}

export function withUncached(usage) {
  if (!usage) return null;
  return {
    ...usage,
    uncached_input_tokens: usage.input_tokens - usage.cached_input_tokens,
  };
}

export function normalizeReviewUsageObservation({
  runMode,
  observedThreadId,
  observation,
  baseline,
}) {
  const rawTotal = normalizeRawUsageShape(observation?.rawTotal);
  const observedTurnCompleted = observation?.observedTurnCompleted === true;
  const prior = baseline && typeof baseline === 'object' ? baseline : null;

  if (!rawTotal) {
    const reason = observedTurnCompleted ? 'invalid_or_partial_usage' : 'review_usage_not_observed';
    return {
      reviewUsage: {
        accountingMode: 'unavailable',
        accountingGapReason: reason,
        rawTotal: null,
        normalizedDelta: null,
      },
      nextBaseline: prior
        ? { ...prior, tainted: true, reason }
        : null,
    };
  }

  const establish = (reason) => ({
    reviewUsage: {
      accountingMode: 'unavailable',
      accountingGapReason: reason,
      rawTotal: withUncached(rawTotal),
      normalizedDelta: null,
    },
    nextBaseline: {
      schemaVersion: 'codex_review_usage_baseline_v1',
      threadId: observedThreadId,
      rawTotal,
      tainted: false,
      reason,
    },
  });

  if (runMode === 'fresh') {
    return {
      reviewUsage: {
        accountingMode: 'fresh_total',
        accountingGapReason: null,
        rawTotal: withUncached(rawTotal),
        normalizedDelta: withUncached(rawTotal),
      },
      nextBaseline: {
        schemaVersion: 'codex_review_usage_baseline_v1',
        threadId: observedThreadId,
        rawTotal,
        tainted: false,
        reason: null,
      },
    };
  }

  if (!prior?.rawTotal) return establish('missing_prior_raw_total');
  if (!observedThreadId || !prior.threadId || observedThreadId !== prior.threadId) {
    return establish('thread_mismatch');
  }
  if (prior.tainted === true) return establish('unavailable_after_usage_gap');
  const delta = subtractUsage(rawTotal, prior.rawTotal);
  if (!delta) return establish('non_monotonic_raw_total');

  return {
    reviewUsage: {
      accountingMode: 'thread_cumulative_delta',
      accountingGapReason: null,
      rawTotal: withUncached(rawTotal),
      normalizedDelta: withUncached(delta),
    },
    nextBaseline: {
      schemaVersion: 'codex_review_usage_baseline_v1',
      threadId: observedThreadId,
      rawTotal,
      tainted: false,
      reason: null,
    },
  };
}

export function isCompletedReviewRecord(record) {
  return record?.status === 'completed' && ['APPROVED', 'NEEDS_CHANGES'].includes(record.verdict);
}

export function deriveNextApprovalPosition(records) {
  let approvalCycle = 1;
  let roundInCycle = 1;
  let priorCompletedVerdict = null;
  let historyGapCount = 0;

  for (const record of records ?? []) {
    if (isCompletedReviewRecord(record)) {
      priorCompletedVerdict = record.verdict;
      if (record.verdict === 'APPROVED') {
        approvalCycle += 1;
        roundInCycle = 1;
      } else {
        roundInCycle += 1;
      }
    } else if (record?.status !== 'failed') {
      historyGapCount += 1;
    }
  }
  return { approvalCycle, roundInCycle, priorCompletedVerdict, historyGapCount };
}

export function reconstructApprovalCycles(records) {
  const cycles = [];
  let current = null;
  let gapCount = 0;
  let failedAttempts = 0;
  for (const record of records ?? []) {
    if (record?.status === 'failed') {
      failedAttempts += 1;
      continue;
    }
    if (!isCompletedReviewRecord(record)) {
      gapCount += 1;
      continue;
    }
    if (!current || current.closed) {
      current = { cycle: cycles.length + 1, rounds: 0, closed: false };
      cycles.push(current);
    }
    current.rounds += 1;
    if (record.verdict === 'APPROVED') current.closed = true;
  }
  return { cycles, gapCount, failedAttempts };
}
