#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), 'export-human-direction-trace.mjs');
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'human-direction-trace-'));
try {
  const stateDir = path.join(root, '.agents/state');
  await fs.mkdir(stateDir, { recursive: true });
  const transcript = [{ role: 'author', text: 'proposal' }, { role: 'proxy', text: 'change it' }];
  const context = { stable_core: [] };
  const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  const base = {
    schema_version: 'human_direction_state_v1', session_key: 'direction-work-1', work_item_id: 'work-1',
    proposal: 'proposal', result: 'COMPLETED_CHANGE', projection: { decision: 'CHANGE', tensions: [] },
    transcript, transcript_hash: digest(transcript), context, decision_context_hash: digest(context),
    method_version: 'method-v1',
    cumulative: { duration_ms: 100, input_tokens: 20, cached_input_tokens: 12, output_tokens: 5, turns: 3 },
    accounting_records: [
      { turn: 1, provider: 'codex', mode: 'fresh_total', prior_raw_total: null, current_raw_total: { input_tokens: 8, cached_input_tokens: 0, output_tokens: 2 }, normalized_delta: { input_tokens: 8, cached_input_tokens: 0, output_tokens: 2 }, reason: null },
      { turn: 2, provider: 'codex', mode: 'thread_cumulative_delta', prior_raw_total: { input_tokens: 8, cached_input_tokens: 0, output_tokens: 2 }, current_raw_total: { input_tokens: 14, cached_input_tokens: 6, output_tokens: 4 }, normalized_delta: { input_tokens: 6, cached_input_tokens: 6, output_tokens: 2 }, reason: null },
      { turn: 3, provider: 'codex', mode: 'thread_cumulative_delta', prior_raw_total: { input_tokens: 14, cached_input_tokens: 6, output_tokens: 4 }, current_raw_total: { input_tokens: 20, cached_input_tokens: 12, output_tokens: 5 }, normalized_delta: { input_tokens: 6, cached_input_tokens: 6, output_tokens: 1 }, reason: null },
    ],
    active_provider: 'codex', provider_sessions: { claude: null, codex: 'thread-1' },
    provider_usage_totals: { codex: { input_tokens: 20, cached_input_tokens: 12, output_tokens: 5 } },
    providers_used: ['claude', 'codex'], fallback_count: 1,
    event: { direction_event_v1: {
      event_id: 'event-1', work_item_id: 'work-1', session_key: 'direction-work-1',
      occurred_at: '2026-07-16T00:00:00Z', phase: 'direction', method: 'human_direction_proxy', method_version: 'method-v1',
      dialogue_status: 'completed', decision: 'CHANGE', tensions: [], duration_ms: 100, input_tokens: 20, cached_input_tokens: 12, output_tokens: 5, tool_calls: 0,
      active_provider: 'codex', providers_used: ['claude', 'codex'], fallback_count: 1,
      accounting_records: [],
    } },
  };
  base.event.direction_event_v1.accounting_records = structuredClone(base.accounting_records);
  await fs.writeFile(path.join(stateDir, 'human-direction-direction-work-1.result.json'), JSON.stringify(base));
  const exported = spawnSync(process.execPath, [script, 'direction-work-1'], {
    encoding: 'utf8', env: { ...process.env, HUMAN_DIRECTION_REPO_ROOT: root },
  });
  assert.equal(exported.status, 0, exported.stderr);
  const payload = JSON.parse(exported.stdout.replace(/^```json\n|\n```\n$/g, ''));
  assert.equal(payload.direction_trace_v1.event.event_id, 'event-1');
  assert.equal(payload.direction_trace_v1.turns, 3);

  const accountingGap = structuredClone(base);
  accountingGap.cumulative = { ...accountingGap.cumulative, input_tokens: 14, cached_input_tokens: 6, output_tokens: 4 };
  accountingGap.accounting_records[2] = {
    turn: 3, provider: 'codex', mode: 'unavailable', prior_raw_total: null, current_raw_total: null,
    normalized_delta: { input_tokens: 0, cached_input_tokens: 0, output_tokens: 0 }, reason: 'provider token accounting unavailable',
  };
  Object.assign(accountingGap.event.direction_event_v1, {
    input_tokens: 14, cached_input_tokens: 6, output_tokens: 4,
    accounting_records: structuredClone(accountingGap.accounting_records),
  });
  await fs.writeFile(path.join(stateDir, 'human-direction-direction-accounting-gap.result.json'), JSON.stringify(accountingGap));
  const gapExport = spawnSync(process.execPath, [script, 'direction-accounting-gap'], {
    encoding: 'utf8', env: { ...process.env, HUMAN_DIRECTION_REPO_ROOT: root },
  });
  assert.equal(gapExport.status, 0, gapExport.stderr);

  await fs.writeFile(path.join(stateDir, 'human-direction-direction-open.result.json'), JSON.stringify({
    ...base, result: 'AWAITING_AUTHOR', event: { direction_event_v1: { ...base.event.direction_event_v1, dialogue_status: 'open', decision: 'INCOMPLETE' } },
  }));
  const rejected = spawnSync(process.execPath, [script, 'direction-open'], {
    encoding: 'utf8', env: { ...process.env, HUMAN_DIRECTION_REPO_ROOT: root },
  });
  assert.equal(rejected.status, 3);
  assert.match(rejected.stderr, /Only a completed/);

  for (const [key, mutate] of [
    ['missing-hash', (value) => { delete value.transcript_hash; }],
    ['decision-mismatch', (value) => { value.event.direction_event_v1.decision = 'ACCEPT'; }],
    ['missing-cost', (value) => { delete value.event.direction_event_v1.input_tokens; }],
    ['accounting-mismatch', (value) => { value.event.direction_event_v1.accounting_records[1].normalized_delta.input_tokens += 1; }],
  ]) {
    const tampered = structuredClone(base);
    mutate(tampered);
    await fs.writeFile(path.join(stateDir, `human-direction-direction-${key}.result.json`), JSON.stringify(tampered));
    const result = spawnSync(process.execPath, [script, `direction-${key}`], {
      encoding: 'utf8', env: { ...process.env, HUMAN_DIRECTION_REPO_ROOT: root },
    });
    assert.equal(result.status, 3, `${key}: ${result.stderr}`);
  }
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
console.log('human direction trace export tests passed');
