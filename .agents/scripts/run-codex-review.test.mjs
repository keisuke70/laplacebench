import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  COMPACT_RESUME_PILOT,
  deriveNextApprovalPosition,
  extractLastTurnUsage,
  normalizeReviewUsageObservation,
  reconstructApprovalCycles,
  selectResumeInspection,
  validOrderedAdjudication,
} from './codex-review-metrics.mjs';

const raw = (input, cached, output, reasoning = 0) => ({
  input_tokens: input,
  cached_input_tokens: cached,
  output_tokens: output,
  reasoning_output_tokens: reasoning,
});

const fresh = normalizeReviewUsageObservation({
  runMode: 'fresh', observedThreadId: 'thread-1',
  observation: { observedTurnStarted: true, observedTurnCompleted: true, rawTotal: raw(100, 40, 10) },
  baseline: null,
});
assert.equal(fresh.reviewUsage.accountingMode, 'fresh_total');
assert.equal(fresh.reviewUsage.normalizedDelta.uncached_input_tokens, 60);

const resumed = normalizeReviewUsageObservation({
  runMode: 'resume', observedThreadId: 'thread-1',
  observation: { observedTurnStarted: true, observedTurnCompleted: true, rawTotal: raw(180, 100, 20) },
  baseline: fresh.nextBaseline,
});
assert.deepEqual(resumed.reviewUsage.normalizedDelta, { ...raw(80, 60, 10), uncached_input_tokens: 20 });
assert.equal(normalizeReviewUsageObservation({
  runMode: 'resume', observedThreadId: 'thread-1',
  observation: { observedTurnStarted: true, observedTurnCompleted: true, rawTotal: raw(180, 100, 20) }, baseline: null,
}).reviewUsage.accountingGapReason, 'missing_prior_raw_total');
assert.equal(normalizeReviewUsageObservation({
  runMode: 'resume', observedThreadId: 'thread-2',
  observation: { observedTurnStarted: true, observedTurnCompleted: true, rawTotal: raw(200, 120, 20) }, baseline: resumed.nextBaseline,
}).reviewUsage.accountingGapReason, 'thread_mismatch');
assert.equal(normalizeReviewUsageObservation({
  runMode: 'resume', observedThreadId: 'thread-1',
  observation: { observedTurnStarted: true, observedTurnCompleted: true, rawTotal: raw(170, 90, 20) }, baseline: resumed.nextBaseline,
}).reviewUsage.accountingGapReason, 'non_monotonic_raw_total');
assert.equal(extractLastTurnUsage(`${JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 2 } })}\n`).rawTotal, null);

const tainted = normalizeReviewUsageObservation({
  runMode: 'resume', observedThreadId: 'thread-1',
  observation: { observedTurnStarted: true, observedTurnCompleted: false, rawTotal: null }, baseline: resumed.nextBaseline,
});
assert.equal(tainted.nextBaseline.tainted, true);
const taintedWithoutEvents = normalizeReviewUsageObservation({
  runMode: 'resume', observedThreadId: 'thread-1',
  observation: { observedTurnStarted: false, observedTurnCompleted: false, rawTotal: null }, baseline: resumed.nextBaseline,
});
assert.equal(taintedWithoutEvents.nextBaseline.tainted, true);
assert.equal(normalizeReviewUsageObservation({
  runMode: 'resume', observedThreadId: 'thread-1',
  observation: { observedTurnStarted: true, observedTurnCompleted: true, rawTotal: raw(220, 130, 30) }, baseline: tainted.nextBaseline,
}).reviewUsage.accountingGapReason, 'unavailable_after_usage_gap');

const history = [
  { status: 'completed', verdict: 'NEEDS_CHANGES' },
  { status: 'failed', verdict: null },
  { status: 'completed', verdict: 'APPROVED' },
];
assert.deepEqual(deriveNextApprovalPosition(history), {
  approvalCycle: 2, roundInCycle: 1, priorCompletedVerdict: 'APPROVED', historyGapCount: 0,
});
assert.deepEqual(reconstructApprovalCycles([...history, { status: 'completed', verdict: 'APPROVED' }]).cycles, [
  { cycle: 1, rounds: 2, closed: true },
  { cycle: 2, rounds: 1, closed: true },
]);
assert.equal(reconstructApprovalCycles([{ status: 'malformed' }, {}, { status: 'completed', verdict: 'UNKNOWN' }]).gapCount, 3);
assert.equal(deriveNextApprovalPosition([{ status: 'malformed' }, {}, { status: 'completed', verdict: 'UNKNOWN' }]).historyGapCount, 3);
assert.equal(validOrderedAdjudication('1. ACCEPT fixed\n2. REJECT not applicable', 2), true);
for (const invalid of [
  '1. ACCEPT fixed',
  '1. ACCEPT fixed\n1. REJECT duplicate',
  '2. ACCEPT out of order\n1. REJECT wrong',
  '1. ACCEPT fixed\n2. UNKNOWN no',
  '1. ACCEPT fixed\n2. REJECT no\n3. DEFER extra',
]) assert.equal(validOrderedAdjudication(invalid, 2), false);
const pilotBase = {
  reviewType: 'impl', sessionKey: 'candidate', approvalCycle: 1,
  previousVerdict: 'NEEDS_CHANGES', previousIssueCount: 1,
  adjudicationBlock: '1. ACCEPT fixed', scopeDelta: { changed: ['x.ts'], added: [], removed: [] },
  assignedEligibleCycles: 0, now: new Date('2026-07-21T00:00:00Z'),
};
const modes = new Set();
for (let index = 0; index < 100 && modes.size < 2; index += 1) {
  modes.add(selectResumeInspection({ ...pilotBase, sessionKey: `candidate-${index}` }).resumeInspectionMode);
}
assert.deepEqual(modes, new Set(['compact_delta', 'full_control']));
assert.equal(selectResumeInspection({ ...pilotBase, adjudicationBlock: '' }).resumeInspectionMode, 'full_ineligible');
assert.equal(selectResumeInspection({ ...pilotBase, now: new Date('2026-07-20T17:59:59Z') }).resumeInspectionMode, 'full_pilot_not_started');
assert.equal(selectResumeInspection({ ...pilotBase, assignedEligibleCycles: 12 }).resumeInspectionMode, 'full_pilot_stopped');
assert.equal(selectResumeInspection({ ...pilotBase, assignedEligibleCycles: 12 }).pilotReadyToClose, true);
assert.notEqual(selectResumeInspection({
  ...pilotBase, assignedEligibleCycles: 12, currentCycleAlreadyAssigned: true,
}).resumeInspectionMode, 'full_pilot_stopped');
assert.equal(selectResumeInspection({
  ...pilotBase, currentCycleAlreadyAssigned: true, pilotDisabled: true,
}).resumeInspectionMode, 'full_pilot_stopped');
assert.equal(selectResumeInspection({
  ...pilotBase, historyIntegrityOk: false,
}).resumeInspectionMode, 'full_history_gap');
assert.equal(selectResumeInspection({ ...pilotBase, now: new Date(COMPACT_RESUME_PILOT.expiresAt) }).resumeInspectionMode, 'full_pilot_stopped');

// End-to-end runner fixture: fake Codex emits cumulative totals across resumes.
const sourceDir = path.dirname(fileURLToPath(import.meta.url));
const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-review-runner-'));
try {
  const project = path.join(tempRoot, 'project');
  const scriptDir = path.join(project, '.agents', 'scripts');
  const binDir = path.join(tempRoot, 'bin');
  await fs.mkdir(scriptDir, { recursive: true });
  await fs.mkdir(binDir, { recursive: true });
  for (const name of ['run-codex-review.mjs', 'codex-review-metrics.mjs', 'review-schema.json']) {
    await fs.copyFile(path.join(sourceDir, name), path.join(scriptDir, name));
  }
  const counterFile = path.join(tempRoot, 'counter');
  const fakeCodex = path.join(binDir, 'codex');
  await fs.writeFile(fakeCodex, `#!/usr/bin/env node
const fs = require('fs');
const count = Number(fs.existsSync(process.env.FAKE_CODEX_COUNTER) ? fs.readFileSync(process.env.FAKE_CODEX_COUNTER, 'utf8') : 0) + 1;
fs.writeFileSync(process.env.FAKE_CODEX_COUNTER, String(count));
let stdin = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { stdin += chunk; });
process.stdin.on('end', () => {
  if (process.env.FAKE_CODEX_STDIN_CAPTURE) fs.writeFileSync(process.env.FAKE_CODEX_STDIN_CAPTURE, stdin);
  const mode = process.env.FAKE_CODEX_MODE || 'normal';
  const verdict = count === 1 ? 'NEEDS_CHANGES' : 'APPROVED';
  const totals = [null, {input_tokens:100,cached_input_tokens:40,output_tokens:10,reasoning_output_tokens:2}, {input_tokens:180,cached_input_tokens:100,output_tokens:20,reasoning_output_tokens:4}, {input_tokens:230,cached_input_tokens:130,output_tokens:25,reasoning_output_tokens:5}][count];
  const payload = {verdict,issues:verdict === 'NEEDS_CHANGES' ? [{severity:'major',location:'fixture',problem:'fix me',suggestion:'fix'}] : [],summary:'fixture',confidence:1};
  console.log(JSON.stringify({type:'thread.started',thread_id:'thread-fixture'}));
  console.log(JSON.stringify({type:'turn.started'}));
  console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:JSON.stringify(payload)}}));
  if (!(mode === 'failed-gap' && count === 2)) console.log(JSON.stringify({type:'turn.completed',usage:totals}));
  if (mode === 'resettable' && count === 2) console.error('session not found');
  if ((mode === 'failed-valid' && count === 2) || (mode === 'failed-gap' && count === 2) || (mode === 'resettable' && count === 2)) process.exitCode = 1;
});
`);
  await fs.chmod(fakeCodex, 0o755);
  const env = {
    ...process.env,
    PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
    FAKE_CODEX_COUNTER: counterFile,
    CODEX_REVIEW_TIMEOUT_SECONDS: '10',
  };
  for (let index = 0; index < 3; index += 1) {
    const run = spawnSync(process.execPath, [path.join(scriptDir, 'run-codex-review.mjs'), 'impl', 'fixture'], {
      cwd: project, env, input: 'Review fixture.', encoding: 'utf8',
    });
    assert.equal(run.status, 0, run.stderr);
  }
  const metricLines = (await fs.readFile(path.join(project, '.agents', 'state', 'codex-impl-fixture.result.jsonl'), 'utf8'))
    .trim().split('\n').map(JSON.parse);
  assert.deepEqual(metricLines.map((record) => [record.approvalCycle, record.roundInCycle]), [[1, 1], [1, 2], [2, 1]]);
  assert.deepEqual(metricLines.map((record) => record.reviewUsage.normalizedDelta.input_tokens), [100, 80, 50]);
  const normalMetricsPath = path.join(project, '.agents', 'state', 'codex-impl-fixture.result.jsonl');
  await fs.appendFile(normalMetricsPath, '{malformed\n', 'utf8');
  const afterMalformed = spawnSync(process.execPath, [path.join(scriptDir, 'run-codex-review.mjs'), 'impl', 'fixture'], {
    cwd: project, env, input: 'Review fixture.', encoding: 'utf8',
  });
  assert.equal(afterMalformed.status, 0, afterMalformed.stderr);
  const afterMalformedLines = (await fs.readFile(normalMetricsPath, 'utf8')).trim().split('\n');
  const afterMalformedRecord = JSON.parse(afterMalformedLines.at(-1));
  assert.equal(afterMalformedRecord.approvalCycle, 3);
  assert.equal(afterMalformedRecord.roundInCycle, 1);
  assert.equal(afterMalformedRecord.historyGapCount, 1);
  await fs.writeFile(
    normalMetricsPath,
    `${afterMalformedLines.filter((line) => {
      try { JSON.parse(line); return true; } catch { return false; }
    }).join('\n')}\n`,
  );

  await fs.writeFile(counterFile, '0');
  const failedValidEnv = { ...env, FAKE_CODEX_MODE: 'failed-valid' };
  for (const expectedStatus of [0, 1, 0]) {
    const run = spawnSync(process.execPath, [path.join(scriptDir, 'run-codex-review.mjs'), 'impl', 'failed-valid'], {
      cwd: project, env: failedValidEnv, input: 'Review fixture.', encoding: 'utf8',
    });
    assert.equal(run.status, expectedStatus, run.stderr);
  }
  const failedValidMetrics = (await fs.readFile(path.join(project, '.agents', 'state', 'codex-impl-failed-valid.result.jsonl'), 'utf8'))
    .trim().split('\n').map(JSON.parse);
  assert.deepEqual(failedValidMetrics.map((record) => record.status), ['completed', 'failed', 'completed']);
  assert.equal(failedValidMetrics[2].roundInCycle, 2, 'failed attempt must not advance approval round');
  assert.equal(failedValidMetrics[2].reviewUsage.normalizedDelta.input_tokens, 50, 'failed valid usage must advance baseline');

  await fs.writeFile(counterFile, '0');
  const failedGapEnv = { ...env, FAKE_CODEX_MODE: 'failed-gap' };
  for (const expectedStatus of [0, 1, 0]) {
    const run = spawnSync(process.execPath, [path.join(scriptDir, 'run-codex-review.mjs'), 'impl', 'failed-gap'], {
      cwd: project, env: failedGapEnv, input: 'Review fixture.', encoding: 'utf8',
    });
    assert.equal(run.status, expectedStatus, run.stderr);
  }
  const failedGapMetrics = (await fs.readFile(path.join(project, '.agents', 'state', 'codex-impl-failed-gap.result.jsonl'), 'utf8'))
    .trim().split('\n').map(JSON.parse);
  assert.equal(failedGapMetrics[2].roundInCycle, 2);
  assert.equal(failedGapMetrics[2].reviewUsage.accountingGapReason, 'unavailable_after_usage_gap');
  assert.equal(failedGapMetrics[2].reviewUsage.normalizedDelta, null);

  let compactSession = '';
  for (let index = 0; index < 100; index += 1) {
    const candidate = `compact-${index}`;
    if (selectResumeInspection({ ...pilotBase, sessionKey: candidate }).resumeInspectionMode === 'compact_delta') {
      compactSession = candidate;
      break;
    }
  }
  assert.ok(compactSession);
  await fs.writeFile(counterFile, '0');
  const scopedFile = path.join(project, 'scoped.md');
  await fs.writeFile(scopedFile, 'before\n');
  const firstCompact = spawnSync(process.execPath, [path.join(scriptDir, 'run-codex-review.mjs'), 'impl', compactSession], {
    cwd: project, env, input: `FULL-PROMPT-MARKER\n- ${scopedFile}\n`, encoding: 'utf8',
  });
  assert.equal(firstCompact.status, 0, firstCompact.stderr);
  await fs.writeFile(scopedFile, 'after\n');
  const inputCapture = path.join(tempRoot, 'stdin-capture');
  const compactEnv = { ...env, FAKE_CODEX_STDIN_CAPTURE: inputCapture };
  const compactRun = spawnSync(process.execPath, [path.join(scriptDir, 'run-codex-review.mjs'), 'impl', compactSession], {
    cwd: project,
    env: compactEnv,
    input: `FULL-PROMPT-MARKER\n- ${scopedFile}\nParent-Adjudication:\n1. ACCEPT fixed\nValidation:\n- focused test passed\n`,
    encoding: 'utf8',
  });
  assert.equal(compactRun.status, 0, compactRun.stderr);
  const compactInput = await fs.readFile(inputCapture, 'utf8');
  assert.match(compactInput, /Delta-scoped inspection pilot/);
  assert.doesNotMatch(compactInput, /FULL-PROMPT-MARKER/);
  const compactMetrics = (await fs.readFile(path.join(project, '.agents', 'state', `codex-impl-${compactSession}.result.jsonl`), 'utf8'))
    .trim().split('\n').map(JSON.parse);
  assert.equal(compactMetrics[1].resumeInspectionMode, 'compact_delta');
  assert.equal(compactMetrics[1].pilotEligible, true);

  let controlSession = '';
  for (let index = 0; index < 100; index += 1) {
    const candidate = `control-${index}`;
    if (selectResumeInspection({ ...pilotBase, sessionKey: candidate }).resumeInspectionMode === 'full_control') {
      controlSession = candidate;
      break;
    }
  }
  assert.ok(controlSession);
  await fs.writeFile(counterFile, '0');
  await fs.writeFile(scopedFile, 'control-before\n');
  const firstControl = spawnSync(process.execPath, [path.join(scriptDir, 'run-codex-review.mjs'), 'impl', controlSession], {
    cwd: project, env, input: `FULL-CONTROL-MARKER\n- ${scopedFile}\n`, encoding: 'utf8',
  });
  assert.equal(firstControl.status, 0, firstControl.stderr);
  await fs.writeFile(scopedFile, 'control-after\n');
  const controlCapture = path.join(tempRoot, 'control-stdin-capture');
  const controlRun = spawnSync(process.execPath, [path.join(scriptDir, 'run-codex-review.mjs'), 'impl', controlSession], {
    cwd: project,
    env: { ...env, FAKE_CODEX_STDIN_CAPTURE: controlCapture },
    input: `FULL-CONTROL-MARKER\n- ${scopedFile}\nParent-Adjudication:\n1. ACCEPT fixed\nValidation:\n- focused test passed\n`,
    encoding: 'utf8',
  });
  assert.equal(controlRun.status, 0, controlRun.stderr);
  assert.match(await fs.readFile(controlCapture, 'utf8'), /FULL-CONTROL-MARKER/);

  await fs.writeFile(counterFile, '0');
  let failedCompactSession = '';
  for (let index = 0; index < 100; index += 1) {
    const candidate = `failed-compact-${index}`;
    if (selectResumeInspection({ ...pilotBase, sessionKey: candidate }).resumeInspectionMode === 'compact_delta') {
      failedCompactSession = candidate;
      break;
    }
  }
  assert.ok(failedCompactSession);
  await fs.writeFile(scopedFile, 'failure-before\n');
  const firstFailedCompact = spawnSync(process.execPath, [path.join(scriptDir, 'run-codex-review.mjs'), 'impl', failedCompactSession], {
    cwd: project, env, input: `- ${scopedFile}\n`, encoding: 'utf8',
  });
  assert.equal(firstFailedCompact.status, 0, firstFailedCompact.stderr);
  await fs.writeFile(scopedFile, 'failure-after\n');
  const failedCompactRun = spawnSync(process.execPath, [path.join(scriptDir, 'run-codex-review.mjs'), 'impl', failedCompactSession], {
    cwd: project,
    env: { ...env, FAKE_CODEX_MODE: 'failed-valid' },
    input: `- ${scopedFile}\nParent-Adjudication:\n1. ACCEPT fixed\nValidation:\n- focused test failed after reviewer output\n`,
    encoding: 'utf8',
  });
  assert.equal(failedCompactRun.status, 1, failedCompactRun.stderr);
  const failedCompactMetrics = (await fs.readFile(path.join(project, '.agents', 'state', `codex-impl-${failedCompactSession}.result.jsonl`), 'utf8'))
    .trim().split('\n').map(JSON.parse);
  assert.equal(failedCompactMetrics[1].status, 'failed');
  assert.equal(failedCompactMetrics[1].resumeInspectionMode, 'compact_delta');
  const compactRetry = spawnSync(process.execPath, [path.join(scriptDir, 'run-codex-review.mjs'), 'impl', failedCompactSession], {
    cwd: project,
    env,
    input: `- ${scopedFile}\nParent-Adjudication:\n1. ACCEPT fixed\nValidation:\n- retry after transport failure\n`,
    encoding: 'utf8',
  });
  assert.equal(compactRetry.status, 0, compactRetry.stderr);
  const compactRetryMetrics = (await fs.readFile(path.join(project, '.agents', 'state', `codex-impl-${failedCompactSession}.result.jsonl`), 'utf8'))
    .trim().split('\n').map(JSON.parse);
  assert.equal(compactRetryMetrics[2].resumeInspectionMode, 'compact_delta');

  await fs.writeFile(counterFile, '0');
  let resetSession = '';
  for (let index = 0; index < 100; index += 1) {
    const candidate = `reset-compact-${index}`;
    if (selectResumeInspection({ ...pilotBase, sessionKey: candidate }).resumeInspectionMode === 'compact_delta') {
      resetSession = candidate;
      break;
    }
  }
  assert.ok(resetSession);
  await fs.writeFile(scopedFile, 'reset-before\n');
  const firstReset = spawnSync(process.execPath, [path.join(scriptDir, 'run-codex-review.mjs'), 'impl', resetSession], {
    cwd: project, env, input: `- ${scopedFile}\n`, encoding: 'utf8',
  });
  assert.equal(firstReset.status, 0, firstReset.stderr);
  await fs.writeFile(scopedFile, 'reset-after\n');
  const resetRun = spawnSync(process.execPath, [path.join(scriptDir, 'run-codex-review.mjs'), 'impl', resetSession], {
    cwd: project,
    env: { ...env, FAKE_CODEX_MODE: 'resettable' },
    input: `- ${scopedFile}\nParent-Adjudication:\n1. ACCEPT fixed\nValidation:\n- retry from a reset native thread\n`,
    encoding: 'utf8',
  });
  assert.equal(resetRun.status, 0, resetRun.stderr);
  const resetMetrics = (await fs.readFile(path.join(project, '.agents', 'state', `codex-impl-${resetSession}.result.jsonl`), 'utf8'))
    .trim().split('\n').map(JSON.parse);
  assert.deepEqual(resetMetrics.slice(1).map((record) => record.resumeInspectionMode), ['compact_delta', 'full_reset_fallback']);
  assert.equal(resetMetrics[2].pilotArm, 'compact_delta');
  assert.equal(resetMetrics[2].pilotCycleKey, resetMetrics[1].pilotCycleKey);

  await fs.writeFile(counterFile, '0');
  const disabledSession = 'pilot-disabled';
  await fs.writeFile(scopedFile, 'disabled-before\n');
  const firstDisabled = spawnSync(process.execPath, [path.join(scriptDir, 'run-codex-review.mjs'), 'impl', disabledSession], {
    cwd: project, env, input: `- ${scopedFile}\n`, encoding: 'utf8',
  });
  assert.equal(firstDisabled.status, 0, firstDisabled.stderr);
  await fs.writeFile(scopedFile, 'disabled-after\n');
  const disableMarker = path.join(project, '.agents', 'state', `${COMPACT_RESUME_PILOT.id}.disabled`);
  await fs.writeFile(disableMarker, 'known miss\n');
  const disabledRun = spawnSync(process.execPath, [path.join(scriptDir, 'run-codex-review.mjs'), 'impl', disabledSession], {
    cwd: project,
    env,
    input: `- ${scopedFile}\nParent-Adjudication:\n1. ACCEPT fixed\nValidation:\n- focused test passed\n`,
    encoding: 'utf8',
  });
  assert.equal(disabledRun.status, 0, disabledRun.stderr);
  const disabledMetrics = (await fs.readFile(path.join(project, '.agents', 'state', `codex-impl-${disabledSession}.result.jsonl`), 'utf8'))
    .trim().split('\n').map(JSON.parse);
  assert.equal(disabledMetrics[1].resumeInspectionMode, 'full_pilot_stopped');
  assert.equal(disabledMetrics[1].pilotReadyToClose, true);
  await fs.unlink(disableMarker);

  await fs.writeFile(counterFile, '0');
  const localGapSession = 'local-history-gap';
  await fs.writeFile(scopedFile, 'local-gap-before\n');
  const firstLocalGap = spawnSync(process.execPath, [path.join(scriptDir, 'run-codex-review.mjs'), 'impl', localGapSession], {
    cwd: project, env, input: `- ${scopedFile}\n`, encoding: 'utf8',
  });
  assert.equal(firstLocalGap.status, 0, firstLocalGap.stderr);
  await fs.writeFile(scopedFile, 'local-gap-after\n');
  const localGapMetricsPath = path.join(project, '.agents', 'state', `codex-impl-${localGapSession}.result.jsonl`);
  await fs.appendFile(localGapMetricsPath, '{malformed\n');
  const localGapRun = spawnSync(process.execPath, [path.join(scriptDir, 'run-codex-review.mjs'), 'impl', localGapSession], {
    cwd: project,
    env,
    input: `- ${scopedFile}\nParent-Adjudication:\n1. ACCEPT fixed\nValidation:\n- local history gap must retain full review\n`,
    encoding: 'utf8',
  });
  assert.equal(localGapRun.status, 0, localGapRun.stderr);
  const localGapLines = (await fs.readFile(localGapMetricsPath, 'utf8')).trim().split('\n');
  assert.equal(JSON.parse(localGapLines.at(-1)).resumeInspectionMode, 'full_history_gap');
  await fs.writeFile(localGapMetricsPath, `${localGapLines.filter((line) => {
    try { JSON.parse(line); return true; } catch { return false; }
  }).join('\n')}\n`);

  await fs.writeFile(counterFile, '0');
  const globalGapSession = 'global-history-gap';
  await fs.writeFile(scopedFile, 'global-gap-before\n');
  const firstGlobalGap = spawnSync(process.execPath, [path.join(scriptDir, 'run-codex-review.mjs'), 'impl', globalGapSession], {
    cwd: project, env, input: `- ${scopedFile}\n`, encoding: 'utf8',
  });
  assert.equal(firstGlobalGap.status, 0, firstGlobalGap.stderr);
  await fs.writeFile(scopedFile, 'global-gap-after\n');
  const brokenGlobalMetrics = path.join(project, '.agents', 'state', 'codex-impl-unrelated-broken.result.jsonl');
  await fs.writeFile(brokenGlobalMetrics, '{malformed\n');
  const globalGapRun = spawnSync(process.execPath, [path.join(scriptDir, 'run-codex-review.mjs'), 'impl', globalGapSession], {
    cwd: project,
    env,
    input: `- ${scopedFile}\nParent-Adjudication:\n1. ACCEPT fixed\nValidation:\n- global history gap must retain full review\n`,
    encoding: 'utf8',
  });
  assert.equal(globalGapRun.status, 0, globalGapRun.stderr);
  const globalGapMetrics = (await fs.readFile(path.join(project, '.agents', 'state', `codex-impl-${globalGapSession}.result.jsonl`), 'utf8'))
    .trim().split('\n').map(JSON.parse);
  assert.equal(globalGapMetrics[1].resumeInspectionMode, 'full_history_gap');
  await fs.unlink(brokenGlobalMetrics);
} finally {
  await fs.rm(tempRoot, { recursive: true, force: true });
}

process.stdout.write('run-codex-review tests passed\n');
