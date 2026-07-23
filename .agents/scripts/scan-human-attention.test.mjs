#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scanCodexRoot } from './scan-human-attention.mjs';

const roots = [];
const makeRoot = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'attention-scan-'));
  roots.push(root);
  return root;
};
const write = (root, name, records) => fs.writeFileSync(path.join(root, name), `${records.map((record) => typeof record === 'string' ? record : JSON.stringify(record)).join('\n')}\n`);
const msg = (text, ts, turnId = null) => ({
  timestamp: ts,
  type: 'response_item',
  payload: {
    type: 'message',
    role: 'user',
    content: [{ type: 'input_text', text }],
    ...(turnId ? { internal_chat_message_metadata_passthrough: { turn_id: turnId } } : {}),
  },
});
const event = (type, id, ts) => ({ timestamp: ts, type: 'event_msg', payload: { type, turn_id: id } });
const meta = (id, source = 'vscode', threadSource = 'user') => ({ type: 'session_meta', payload: { session_id: id, cwd: '/repo', originator: 'Codex Desktop', source, thread_source: threadSource } });
const noise = { type: 'event_msg', payload: { type: 'token_count' } };

const root = makeRoot();
const mainRecords = [
  meta('main-1'),
  msg('PDFの表示を直して', '2026-07-14T23:50:00Z', 'turn-1'),
  event('task_started', 'turn-1', '2026-07-14T23:50:01Z'),
  event('task_complete', 'turn-1', '2026-07-14T23:55:00Z'),
  msg('今どうなってる？', '2026-07-15T00:01:00Z', 'turn-2'),
  event('task_started', 'turn-2', '2026-07-15T00:01:01Z'),
  event('task_complete', 'turn-2', '2026-07-15T00:02:00Z'),
  msg('ローカルではPDFを確認できないからいいよ token=abcdefghijklmnopqrstuvwxyz /Users/kei/private +81 90-1234-5678', '2026-07-15T00:03:00Z', 'turn-3'),
  event('task_started', 'turn-3', '2026-07-15T00:03:01Z'),
  event('task_complete', 'turn-3', '2026-07-15T00:04:00Z'),
];
write(root, 'main.jsonl', mainRecords);
write(root, 'runner.jsonl', [meta('runner-1', 'exec'), msg('Session-Key: review-x\nReview scope rules:', '2026-07-15T00:00:00Z'), msg('何やってる？', '2026-07-15T00:00:02Z')]);

const first = scanCodexRoot(root, { repo: '/repo' });
assert.equal(first.sourceComplete, true);
assert.equal(first.userOwnedSessions, 1);
assert.equal(first.candidates.length, 2);
assert.deepEqual(first.candidates.map((c) => c.category), ['progress-probe', 'capability-correction']);
assert.equal(first.coverage['2026-W29'].completedWorkUnitIds.length, 3);
assert.deepEqual(first.candidates.map((candidate) => candidate.workUnitId), ['main-1:turn-2', 'main-1:turn-3']);
assert.ok(first.candidates.every((candidate) => candidate.completedAt));
assert.ok(first.candidates.every((candidate) => candidate.sourceRef && candidate.messageHash));
const sanitized = first.candidates.find((candidate) => candidate.category === 'capability-correction').excerpt;
assert.ok(sanitized.includes('[secret]') && sanitized.includes('[path]') && sanitized.includes('[phone]'));
assert.ok(!sanitized.includes('abcdefghijklmnopqrstuvwxyz') && !sanitized.includes('/Users/kei'));

// Stable IDs use provider item identity, not JSONL line position.
write(root, 'main.jsonl', [mainRecords[0], noise, ...mainRecords.slice(1)]);
const shifted = scanCodexRoot(root, { repo: '/repo' });
assert.deepEqual(first.candidates.map((c) => c.id), shifted.candidates.map((c) => c.id));

// Older/newer app log orderings both resolve to a completed enclosing turn.
write(root, 'started-before-message.jsonl', [
  meta('main-2'),
  msg('最初の依頼', '2026-07-15T01:00:00Z', 'turn-a'),
  event('task_started', 'turn-a', '2026-07-15T01:00:01Z'),
  event('task_complete', 'turn-a', '2026-07-15T01:01:00Z'),
  event('task_started', 'turn-b', '2026-07-15T01:02:00Z'),
  msg('続けて', '2026-07-15T01:02:01Z', 'turn-b'),
  event('task_complete', 'turn-b', '2026-07-15T01:03:00Z'),
]);
const ordering = scanCodexRoot(root, { repo: '/repo' });
assert.equal(ordering.candidates.find((candidate) => candidate.sessionId === 'main-2').workUnitId, 'main-2:turn-b');

// A user turn is pending until task_complete supplies the denominator unit.
const pendingRoot = makeRoot();
write(pendingRoot, 'pending.jsonl', [meta('pending-1'), msg('最初', '2026-07-15T02:00:00Z', 'p1'), event('task_started', 'p1', '2026-07-15T02:00:01Z'), event('task_complete', 'p1', '2026-07-15T02:01:00Z'), event('task_started', 'p2', '2026-07-15T02:02:00Z'), msg('続けて', '2026-07-15T02:02:01Z', 'p2')]);
const pending = scanCodexRoot(pendingRoot, { repo: '/repo' });
assert.equal(pending.candidates.length, 0);
assert.equal(pending.pendingCandidateCount, 1);

// CLI is a supported user source; unknown interactive sources make coverage incomplete.
const sourceRoot = makeRoot();
write(sourceRoot, 'cli.jsonl', [meta('cli-1', 'cli'), msg('最初', '2026-07-15T03:00:00Z', 'c1'), event('task_started', 'c1', '2026-07-15T03:00:01Z'), event('task_complete', 'c1', '2026-07-15T03:01:00Z')]);
let sources = scanCodexRoot(sourceRoot, { repo: '/repo' });
assert.equal(sources.userOwnedSessions, 1);
write(sourceRoot, 'future.jsonl', [meta('future-1', 'future-ui'), msg('最初', '2026-07-15T03:00:00Z')]);
sources = scanCodexRoot(sourceRoot, { repo: '/repo' });
assert.equal(sources.sourceComplete, false);
assert.equal(sources.unsupportedSessions, 1);

// Malformed JSON is a partial source, never silently complete.
const malformedRoot = makeRoot();
write(malformedRoot, 'broken.jsonl', [meta('broken-1'), '{not-json', msg('最初', '2026-07-15T04:00:00Z', 'b1'), event('task_started', 'b1', '2026-07-15T04:00:01Z'), event('task_complete', 'b1', '2026-07-15T04:01:00Z')]);
const malformed = scanCodexRoot(malformedRoot, { repo: '/repo' });
assert.equal(malformed.sourceComplete, false);
assert.equal(malformed.errors.length, 1);

// A Sunday candidate whose turn completes Monday belongs with its denominator
// in completion week. 2027-01-03 is 2026-W53; Jan 4 is 2027-W01.
const weekRoot = makeRoot();
write(weekRoot, 'week.jsonl', [
  meta('week-1'),
  msg('最初', '2027-01-03T10:00:00Z', 'w1'), event('task_started', 'w1', '2027-01-03T10:00:01Z'), event('task_complete', 'w1', '2027-01-03T10:01:00Z'),
  msg('続けて', '2027-01-03T23:59:50Z', 'w2'), event('task_started', 'w2', '2027-01-03T23:59:51Z'), event('task_complete', 'w2', '2027-01-04T00:01:00Z'),
]);
const weeks = scanCodexRoot(weekRoot, { repo: '/repo' });
assert.equal(weeks.coverage['2026-W53'].completedWorkUnitIds.length, 1);
assert.equal(weeks.coverage['2027-W01'].completedWorkUnitIds.length, 1);
assert.equal(weeks.candidates[0].week, '2027-W01');
assert.equal(weeks.candidates[0].occurredAt, '2027-01-03T23:59:50Z');
const cutoffWeeks = scanCodexRoot(weekRoot, { repo: '/repo', since: new Date('2027-01-04T00:00:00Z') });
assert.equal(cutoffWeeks.coverage['2027-W01'].completedWorkUnitIds.length, 1);
assert.equal(cutoffWeeks.coverage['2027-W01'].candidateIds.length, 1);
assert.equal(cutoffWeeks.candidates[0].occurredAt, '2027-01-03T23:59:50Z');

const missing = scanCodexRoot(path.join(root, 'missing'));
assert.equal(missing.sourceAvailable, false);
assert.equal(missing.sourceComplete, false);
assert.equal(missing.candidates.length, 0);

for (const dir of roots) fs.rmSync(dir, { recursive: true, force: true });
process.stdout.write('scan-human-attention tests passed\n');
