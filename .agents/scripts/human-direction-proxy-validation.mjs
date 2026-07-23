import { createHash } from 'node:crypto';

const RESULTS = new Set(['AWAITING_AUTHOR', 'COMPLETED_ACCEPT', 'COMPLETED_CHANGE', 'COMPLETED_HUMAN_DECISION']);
const FAMILIES = new Set(['concept', 'non-entity', 'value-cost', 'absence', 'time-scope', 'recurrence', 'external-reality', 'process']);
const POSITIONS = new Set([null, 'DEFEND', 'REVISE', 'NEED_EVIDENCE', 'HUMAN_RESIDUAL']);
const OUTCOMES = new Set([null, 'changed', 'defended-and-clarified', 'evidence-found', 'empty']);
const EFFECTS = new Set([null, 'simplified', 'removed-work', 'complexity-exposed', 'premise-corrected', 'no-change']);
const DECISIONS = new Set([null, 'ACCEPT', 'CHANGE', 'HUMAN_DECISION']);
const TENSION_KEYS = ['id', 'families', 'question', 'context_refs', 'status', 'author_position', 'outcome', 'effect', 'requested_evidence'];
const EVENT_TENSION_KEYS = ['id', 'families', 'question', 'context_refs', 'author_position', 'outcome', 'effect', 'requested_evidence'];
const PROVIDERS = new Set(['claude', 'codex']);
const EVENT_KEYS = ['event_id', 'work_item_id', 'session_key', 'occurred_at', 'phase', 'method', 'method_version', 'decision', 'dialogue_status', 'tensions', 'duration_ms', 'input_tokens', 'cached_input_tokens', 'output_tokens', 'tool_calls', 'active_provider', 'providers_used', 'fallback_count', 'accounting_records'];
const TOKEN_KEYS = ['input_tokens', 'cached_input_tokens', 'output_tokens'];
const UPDATE_KEYS = ['id', 'status', 'author_position', 'outcome', 'effect', 'requested_evidence'];

const object = (value) => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const nonempty = (value) => typeof value === 'string' && value.trim().length > 0;
const strings = (value) => Array.isArray(value) && value.every((item) => typeof item === 'string') && new Set(value).size === value.length;
const exactKeys = (value, keys) => object(value) && Object.keys(value).sort().join('\0') === [...keys].sort().join('\0');
const expectedDecision = (result) => ({
  COMPLETED_ACCEPT: 'ACCEPT', COMPLETED_CHANGE: 'CHANGE', COMPLETED_HUMAN_DECISION: 'HUMAN_DECISION',
}[result] ?? null);
const hash = (value) => createHash('sha256').update(value).digest('hex');

export function validTension(tension) {
  if (!exactKeys(tension, TENSION_KEYS)) return false;
  if (!/^T[0-9]{3,}$/.test(tension.id)) return false;
  if (!Array.isArray(tension.families) || tension.families.length === 0 || new Set(tension.families).size !== tension.families.length) return false;
  if (!tension.families.every((family) => FAMILIES.has(family)) || !nonempty(tension.question) || !strings(tension.context_refs)) return false;
  if (!['open', 'resolved'].includes(tension.status) || !POSITIONS.has(tension.author_position) || !OUTCOMES.has(tension.outcome) || !EFFECTS.has(tension.effect)) return false;
  if (!(tension.requested_evidence === null || nonempty(tension.requested_evidence))) return false;
  if (tension.status === 'resolved' && (!tension.author_position || !tension.outcome || !tension.effect)) return false;
  if (tension.status === 'open' && (tension.outcome !== null || tension.effect !== null)) return false;
  return true;
}

export function validProjection(projection) {
  if (!exactKeys(projection, ['decision', 'tensions']) || !DECISIONS.has(projection.decision) || !Array.isArray(projection.tensions)) return false;
  if (!projection.tensions.every(validTension)) return false;
  const ids = projection.tensions.map((tension) => tension.id);
  return new Set(ids).size === ids.length;
}

export function validatePayload(value, previous = null) {
  return validatePayloadDetailed(value, previous).ok;
}

export function validatePayloadDetailed(value, previous = null) {
  if (!exactKeys(value, ['utterance', 'result', 'projection']) || !nonempty(value.utterance) || !RESULTS.has(value.result) || !validProjection(value.projection)) return { ok: false, reason: 'schema-invalid' };
  const open = value.projection.tensions.filter((tension) => tension.status === 'open');
  if ((value.result.startsWith('COMPLETED_') && open.length) || (value.result === 'AWAITING_AUTHOR' && !open.length)) return { ok: false, reason: 'result-open-mismatch' };
  const decision = expectedDecision(value.result);
  if (value.projection.decision !== decision) return { ok: false, reason: 'decision-mismatch' };
  if (previous) {
    if (!validProjection(previous.projection)) return { ok: false, reason: 'immutable-state-corrupt' };
    const next = new Map(value.projection.tensions.map((tension) => [tension.id, tension]));
    for (const tension of previous.projection?.tensions ?? []) {
      const current = next.get(tension.id);
      if (!current || current.question !== tension.question) return { ok: false, reason: 'immutable-state-corrupt' };
      if (JSON.stringify([...current.families].sort()) !== JSON.stringify([...tension.families].sort())) return { ok: false, reason: 'immutable-state-corrupt' };
      if (JSON.stringify([...current.context_refs].sort()) !== JSON.stringify([...tension.context_refs].sort())) return { ok: false, reason: 'immutable-state-corrupt' };
      if (tension.status === 'resolved' && JSON.stringify(current) !== JSON.stringify(tension)) return { ok: false, reason: 'immutable-state-corrupt' };
    }
  }
  return { ok: true, reason: null, payload: value };
}

function validDisposition(update) {
  if (!exactKeys(update, UPDATE_KEYS) || !/^T[0-9]{3,}$/.test(update.id)) return false;
  if (!['open', 'resolved'].includes(update.status) || !POSITIONS.has(update.author_position) || !OUTCOMES.has(update.outcome) || !EFFECTS.has(update.effect)) return false;
  if (!(update.requested_evidence === null || nonempty(update.requested_evidence))) return false;
  if (update.status === 'resolved' && (!update.author_position || !update.outcome || !update.effect)) return false;
  if (update.status === 'open' && (update.outcome !== null || update.effect !== null)) return false;
  return true;
}

export function mergeResumeDelta(value, previous) {
  if (!previous || !validProjection(previous.projection)) return { ok: false, reason: 'immutable-state-corrupt', payload: null };
  if (!exactKeys(value, ['utterance', 'result', 'updates', 'new_tensions']) || !nonempty(value.utterance)
    || !RESULTS.has(value.result) || !Array.isArray(value.updates) || !Array.isArray(value.new_tensions)) {
    return { ok: false, reason: 'schema-invalid', payload: null };
  }
  const existing = new Map(previous.projection.tensions.map((tension) => [tension.id, tension]));
  const openIds = new Set(previous.projection.tensions.filter((tension) => tension.status === 'open').map((tension) => tension.id));
  const seen = new Set();
  for (const update of value.updates) {
    if (!object(update) || !nonempty(update.id)) return { ok: false, reason: 'schema-invalid', payload: null };
    if (seen.has(update.id) || !existing.has(update.id)) return { ok: false, reason: 'unknown-or-duplicate-tension-id', payload: null };
    seen.add(update.id);
    if (!openIds.has(update.id)) return { ok: false, reason: 'resolved-tension-update', payload: null };
    if (!validDisposition(update)) return { ok: false, reason: 'invalid-disposition', payload: null };
  }
  if ([...openIds].some((id) => !seen.has(id))) return { ok: false, reason: 'missing-open-tension-update', payload: null };
  const newIds = new Set();
  for (const tension of value.new_tensions) {
    if (!validTension(tension) || existing.has(tension.id) || newIds.has(tension.id)) return { ok: false, reason: 'new-tension-invalid', payload: null };
    newIds.add(tension.id);
  }
  const updates = new Map(value.updates.map((update) => [update.id, update]));
  const tensions = previous.projection.tensions.map((tension) => {
    const update = updates.get(tension.id);
    return update ? { ...tension, ...update } : structuredClone(tension);
  }).concat(value.new_tensions.map((tension) => structuredClone(tension)));
  const open = tensions.filter((tension) => tension.status === 'open');
  if ((value.result.startsWith('COMPLETED_') && open.length) || (value.result === 'AWAITING_AUTHOR' && !open.length)) {
    return { ok: false, reason: 'result-open-mismatch', payload: null };
  }
  const payload = {
    utterance: value.utterance,
    result: value.result,
    projection: { decision: expectedDecision(value.result), tensions },
  };
  return { ok: true, reason: null, payload };
}

function eventTension(tension) {
  return {
    id: tension.id, families: tension.families, question: tension.question, context_refs: tension.context_refs,
    author_position: tension.author_position, outcome: tension.outcome, effect: tension.effect,
    requested_evidence: tension.requested_evidence,
  };
}

function validProviderMetadata(value) {
  if (!PROVIDERS.has(value.active_provider) || !strings(value.providers_used) || value.providers_used.length === 0) return false;
  if (!value.providers_used.every((provider) => PROVIDERS.has(provider)) || !value.providers_used.includes(value.active_provider)) return false;
  if (!Number.isInteger(value.fallback_count) || value.fallback_count < 0) return false;
  if (!exactKeys(value.provider_sessions, ['claude', 'codex'])) return false;
  if (!['claude', 'codex'].every((provider) => value.provider_sessions[provider] === null || nonempty(value.provider_sessions[provider]))) return false;
  if (!exactKeys(value.provider_usage_totals, ['codex'])) return false;
  const codexUsage = value.provider_usage_totals.codex;
  if (codexUsage === null) return true;
  if (!exactKeys(codexUsage, ['input_tokens', 'cached_input_tokens', 'output_tokens'])) return false;
  if (![codexUsage.input_tokens, codexUsage.cached_input_tokens, codexUsage.output_tokens].every((count) => Number.isFinite(count) && count >= 0)) return false;
  return codexUsage.cached_input_tokens <= codexUsage.input_tokens;
}

function validTokenTotal(value) {
  return exactKeys(value, TOKEN_KEYS)
    && TOKEN_KEYS.every((key) => Number.isFinite(value[key]) && value[key] >= 0)
    && value.cached_input_tokens <= value.input_tokens;
}

function validAccountingRecords(records, turns) {
  if (!Array.isArray(records) || records.length === 0) return false;
  const seenTurns = new Set();
  for (const record of records) {
    if (!exactKeys(record, ['turn', 'provider', 'mode', 'prior_raw_total', 'current_raw_total', 'normalized_delta', 'reason'])) return false;
    if (!Number.isInteger(record.turn) || record.turn < 1 || record.turn > turns || !PROVIDERS.has(record.provider)) return false;
    if (!['per_turn', 'fresh_total', 'thread_cumulative_delta', 'unavailable'].includes(record.mode)) return false;
    if (record.mode === 'unavailable') {
      if (record.prior_raw_total !== null || record.current_raw_total !== null || !validTokenTotal(record.normalized_delta)) return false;
      if (TOKEN_KEYS.some((key) => record.normalized_delta[key] !== 0) || !nonempty(record.reason)) return false;
      seenTurns.add(record.turn);
      continue;
    }
    if (record.reason !== null) return false;
    if (record.prior_raw_total !== null && !validTokenTotal(record.prior_raw_total)) return false;
    if (!validTokenTotal(record.current_raw_total) || !validTokenTotal(record.normalized_delta)) return false;
    if (record.mode === 'thread_cumulative_delta') {
      if (record.provider !== 'codex' || record.prior_raw_total === null) return false;
      for (const key of TOKEN_KEYS) {
        if (record.current_raw_total[key] - record.prior_raw_total[key] !== record.normalized_delta[key]) return false;
      }
    } else if (record.prior_raw_total !== null || JSON.stringify(record.current_raw_total) !== JSON.stringify(record.normalized_delta)) return false;
    seenTurns.add(record.turn);
  }
  return seenTurns.size === turns && [...seenTurns].every((turn) => turn >= 1 && turn <= turns);
}

export function validDirectionEvent(event, state) {
  if (!object(event) || !nonempty(event.event_id) || event.work_item_id !== state.work_item_id || event.session_key !== state.session_key) return false;
  if (Number.isNaN(new Date(event.occurred_at).getTime()) || event.phase !== 'direction' || event.method !== 'human_direction_proxy') return false;
  if (event.method_version !== state.method_version || !['completed', 'open'].includes(event.dialogue_status)) return false;
  if (!['ACCEPT', 'CHANGE', 'HUMAN_DECISION', 'INCOMPLETE'].includes(event.decision)) return false;
  if (!Array.isArray(event.tensions) || JSON.stringify(event.tensions) !== JSON.stringify(state.projection.tensions.map(eventTension))) return false;
  if (![event.duration_ms, event.input_tokens, event.cached_input_tokens, event.output_tokens].every((value) => Number.isFinite(value) && value >= 0) || event.tool_calls !== 0) return false;
  if (event.cached_input_tokens > event.input_tokens) return false;
  if (event.duration_ms !== state.cumulative.duration_ms || event.input_tokens !== state.cumulative.input_tokens || event.cached_input_tokens !== state.cumulative.cached_input_tokens || event.output_tokens !== state.cumulative.output_tokens) return false;
  if (event.active_provider !== state.active_provider || JSON.stringify(event.providers_used) !== JSON.stringify(state.providers_used) || event.fallback_count !== state.fallback_count) return false;
  if (JSON.stringify(event.accounting_records) !== JSON.stringify(state.accounting_records)) return false;
  const expectedStatus = state.result.startsWith('COMPLETED_') ? 'completed' : 'open';
  const expectedEventDecision = expectedDecision(state.result) ?? 'INCOMPLETE';
  return event.dialogue_status === expectedStatus && event.decision === expectedEventDecision;
}

export function validPersistedState(value, { sessionKey, workItemId }) {
  if (!object(value) || value.schema_version !== 'human_direction_state_v1' || value.session_key !== sessionKey || value.work_item_id !== workItemId) return false;
  if (!nonempty(value.proposal) || !RESULTS.has(value.result) || !validProjection(value.projection)) return false;
  const decision = expectedDecision(value.result);
  if (value.projection.decision !== decision) return false;
  const open = value.projection.tensions.filter((tension) => tension.status === 'open');
  if (value.result.startsWith('COMPLETED_') && open.length) return false;
  if (value.result === 'AWAITING_AUTHOR' && !open.length) return false;
  if (!Array.isArray(value.transcript)) return false;
  for (let index = 0; index < value.transcript.length; index += 1) {
    const turn = value.transcript[index];
    if (!object(turn) || turn.role !== (index % 2 === 0 ? 'author' : 'proxy') || !nonempty(turn.text)) return false;
  }
  if (!nonempty(value.transcript_hash) || !nonempty(value.decision_context_hash) || !nonempty(value.method_version) || !object(value.context)) return false;
  if (!validProviderMetadata(value)) return false;
  if (value.transcript_hash !== hash(JSON.stringify(value.transcript)) || value.decision_context_hash !== hash(JSON.stringify(value.context))) return false;
  const counters = ['duration_ms', 'input_tokens', 'cached_input_tokens', 'output_tokens', 'turns'];
  if (!object(value.cumulative) || counters.some((key) => !Number.isFinite(value.cumulative[key]) || value.cumulative[key] < 0) || !Number.isInteger(value.cumulative.turns)) return false;
  if (value.cumulative.cached_input_tokens > value.cumulative.input_tokens) return false;
  if (!validAccountingRecords(value.accounting_records, value.cumulative.turns)) return false;
  for (const key of TOKEN_KEYS) {
    if (value.accounting_records.reduce((sum, record) => sum + record.normalized_delta[key], 0) !== value.cumulative[key]) return false;
  }
  if (!object(value.event) || !validDirectionEvent(value.event.direction_event_v1, value)) return false;
  return true;
}

export function validCompletedResult(value) {
  return object(value)
    && typeof value.session_key === 'string'
    && typeof value.work_item_id === 'string'
    && value.result?.startsWith('COMPLETED_')
    && validPersistedState(value, { sessionKey: value.session_key, workItemId: value.work_item_id });
}

export function validExportedTrace(trace) {
  if (!exactKeys(trace, ['event', 'transcript_hash', 'decision_context_hash', 'method_version', 'turns'])) return false;
  if (!/^[a-f0-9]{64}$/.test(trace.transcript_hash) || !/^[a-f0-9]{64}$/.test(trace.decision_context_hash) || !nonempty(trace.method_version)) return false;
  if (!Number.isInteger(trace.turns) || trace.turns < 1 || !exactKeys(trace.event, EVENT_KEYS)) return false;
  const event = trace.event;
  if (![event.event_id, event.work_item_id, event.session_key].every(nonempty) || Number.isNaN(new Date(event.occurred_at).getTime())) return false;
  if (event.phase !== 'direction' || event.method !== 'human_direction_proxy' || event.method_version !== trace.method_version || event.dialogue_status !== 'completed') return false;
  if (!PROVIDERS.has(event.active_provider) || !strings(event.providers_used) || !event.providers_used.includes(event.active_provider)) return false;
  if (!event.providers_used.every((provider) => PROVIDERS.has(provider)) || !Number.isInteger(event.fallback_count) || event.fallback_count < 0) return false;
  if (!validAccountingRecords(event.accounting_records, trace.turns)) return false;
  for (const key of TOKEN_KEYS) {
    if (event.accounting_records.reduce((sum, record) => sum + record.normalized_delta[key], 0) !== event[key]) return false;
  }
  if (!['ACCEPT', 'CHANGE', 'HUMAN_DECISION'].includes(event.decision) || !Array.isArray(event.tensions)) return false;
  const ids = new Set();
  for (const tension of event.tensions) {
    if (!exactKeys(tension, EVENT_TENSION_KEYS) || !/^T[0-9]{3,}$/.test(tension.id) || ids.has(tension.id)) return false;
    ids.add(tension.id);
    if (!Array.isArray(tension.families) || tension.families.length === 0 || new Set(tension.families).size !== tension.families.length || !tension.families.every((family) => FAMILIES.has(family))) return false;
    if (!nonempty(tension.question) || !strings(tension.context_refs) || !tension.author_position || !tension.outcome || !tension.effect) return false;
    if (!POSITIONS.has(tension.author_position) || !OUTCOMES.has(tension.outcome) || !EFFECTS.has(tension.effect)) return false;
    if (!(tension.requested_evidence === null || nonempty(tension.requested_evidence))) return false;
  }
  return [event.duration_ms, event.input_tokens, event.cached_input_tokens, event.output_tokens].every((value) => Number.isFinite(value) && value >= 0)
    && event.cached_input_tokens <= event.input_tokens && event.tool_calls === 0;
}
