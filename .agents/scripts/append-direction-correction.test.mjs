import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildDirectionCorrection, parseDirectionArtifacts } from './append-direction-correction.mjs';

const trace = {
  event: {
    event_id: 'event-test', work_item_id: 'work-test', session_key: 'direction-work-test', occurred_at: '2026-07-19T00:00:00Z',
    phase: 'direction', method: 'human_direction_proxy', method_version: 'method-test', dialogue_status: 'completed', decision: 'CHANGE',
    tensions: [{ id: 'T001', families: ['concept'], question: 'owner?', context_refs: [], author_position: 'REVISE', outcome: 'changed', effect: 'simplified', requested_evidence: null }],
    duration_ms: 100, input_tokens: 20, cached_input_tokens: 0, output_tokens: 5, tool_calls: 0,
    active_provider: 'claude', providers_used: ['claude'], fallback_count: 0,
    accounting_records: [{ turn: 1, provider: 'claude', mode: 'per_turn', prior_raw_total: null,
      current_raw_total: { input_tokens: 20, cached_input_tokens: 0, output_tokens: 5 },
      normalized_delta: { input_tokens: 20, cached_input_tokens: 0, output_tokens: 5 }, reason: null }],
  },
  transcript_hash: 'a'.repeat(64), decision_context_hash: 'b'.repeat(64), method_version: 'method-test', turns: 1,
};
const block = `\`\`\`json\n${JSON.stringify({ direction_trace_v1: trace }, null, 2)}\n\`\`\``;
const correction = buildDirectionCorrection({
  text: block, eventId: 'event-test', source: 'author-runtime', missedFamilies: ['concept'],
  effect: 'premise-corrected', highRisk: true, summary: '  Runtime   evidence changed ownership.  ',
  correctionId: 'correction-test', occurredAt: '2026-07-19T01:00:00Z',
});
assert.equal(correction.summary, 'Runtime evidence changed ownership.');
assert.equal(parseDirectionArtifacts(block).traces.length, 1);
assert.throws(() => buildDirectionCorrection({ text: block, eventId: 'missing', source: 'human', missedFamilies: ['concept'], effect: 'no-change', highRisk: false, summary: 'x' }), /No valid completed/);
assert.throws(() => buildDirectionCorrection({ text: block, eventId: 'event-test', source: 'bad', missedFamilies: ['concept'], effect: 'no-change', highRisk: false, summary: 'x' }), /Invalid correction source/);
assert.throws(() => buildDirectionCorrection({ text: block, eventId: 'event-test', source: 'human', missedFamilies: ['bad'], effect: 'no-change', highRisk: false, summary: 'x' }), /missed families/);
assert.throws(() => buildDirectionCorrection({ text: block, eventId: 'event-test', source: 'human', missedFamilies: ['concept'], effect: 'bad', highRisk: false, summary: 'x' }), /Invalid correction effect/);
const withCorrection = `${block}\n\`\`\`json\n${JSON.stringify({ direction_correction_v1: correction })}\n\`\`\``;
assert.throws(() => buildDirectionCorrection({ text: withCorrection, eventId: 'event-test', source: 'author-runtime', missedFamilies: ['concept'], effect: 'premise-corrected', highRisk: true, summary: correction.summary }), /already exists/);

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'direction-correction-'));
try {
  const file = path.join(tempDir, 'adjudication.md');
  await fs.writeFile(file, block, 'utf8');
  const cli = spawnSync(process.execPath, [
    fileURLToPath(new URL('./append-direction-correction.mjs', import.meta.url)), file,
    '--event-id', 'event-test', '--source', 'impl-interrogation', '--families', 'concept,external-reality',
    '--effect', 'premise-corrected', '--high-risk', 'true', '--summary', 'Runtime premise changed.',
  ], { encoding: 'utf8' });
  assert.equal(cli.status, 0, cli.stderr);
  const appended = parseDirectionArtifacts(await fs.readFile(file, 'utf8'));
  assert.equal(appended.corrections.length, 1);
  assert.equal(appended.corrections[0].source, 'impl-interrogation');
} finally {
  await fs.rm(tempDir, { recursive: true, force: true });
}
process.stdout.write('append-direction-correction tests passed\n');
