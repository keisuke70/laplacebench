#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mergeResumeDelta, validDirectionEvent, validPersistedState, validatePayload } from './human-direction-proxy-validation.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const runner = path.join(scriptDir, 'run-human-direction-proxy.mjs');
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'human-direction-runner-'));
const assertFlagValueOnce = (args, flag, expectedValue) => {
  const indexes = args.flatMap((arg, index) => arg === flag ? [index] : []);
  assert.equal(indexes.length, 1, `${flag} must occur exactly once`);
  assert.equal(args[indexes[0] + 1], expectedValue);
};
assert.equal(validatePayload({
  utterance: 'done', result: 'COMPLETED_ACCEPT', projection: { decision: 'ACCEPT', tensions: [{
    id: 'T001', families: ['concept'], question: 'owner?', context_refs: [],
    author_position: 'DEFEND', outcome: 'defended-and-clarified', effect: 'no-change', requested_evidence: null,
  }] },
}), false, 'completed tension without status must be rejected');
assert.equal(validatePayload({
  utterance: 'evidence?', result: 'AWAITING_EVIDENCE', projection: { decision: null, tensions: [{
    id: 'T001', families: ['external-reality'], question: 'external contract?', context_refs: [], status: 'open',
    author_position: 'NEED_EVIDENCE', outcome: null, effect: null, requested_evidence: 'contract source',
  }] },
}), false, 'legacy evidence-specific result must be rejected');
const priorForDelta = { projection: { decision: null, tensions: [{
  id: 'T001', families: ['concept'], question: 'owner?', context_refs: ['plan:a'], status: 'open',
  author_position: null, outcome: null, effect: null, requested_evidence: null,
}] } };
const validDelta = {
  utterance: 'done', result: 'COMPLETED_ACCEPT', updates: [{
    id: 'T001', status: 'resolved', author_position: 'DEFEND', outcome: 'defended-and-clarified', effect: 'no-change', requested_evidence: null,
  }], new_tensions: [],
};
const mergedDelta = mergeResumeDelta(validDelta, priorForDelta);
assert.equal(mergedDelta.ok, true);
assert.equal(mergedDelta.payload.projection.tensions[0].question, 'owner?', 'runner preserves immutable identity');
assert.equal(mergeResumeDelta({ ...validDelta, updates: [] }, priorForDelta).reason, 'missing-open-tension-update');
assert.equal(mergeResumeDelta({ ...validDelta, updates: [validDelta.updates[0], validDelta.updates[0]] }, priorForDelta).reason, 'unknown-or-duplicate-tension-id');
assert.equal(mergeResumeDelta({ ...validDelta, updates: [{ ...validDelta.updates[0], id: 'T999' }] }, priorForDelta).reason, 'unknown-or-duplicate-tension-id');
const write = async (relative, body, mode) => {
  const target = path.join(root, relative);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, body, mode ? { mode } : undefined);
  return target;
};
const spawnResult = (command, commandArgs, options) => new Promise((resolve) => {
  const child = spawn(command, commandArgs, { ...options, stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.on('close', (status) => resolve({ status, stdout, stderr }));
  child.stdin.end(options.input ?? '');
});
try {
  execFileSync('git', ['init', '-q'], { cwd: root });
  await write('.claude/skills/human-direction-proxy/SKILL.md', '# Proxy\nAsk naturally and settle direction.\n');
  await write('docs/norms/human-decision-model.md', '# Model\nPrefer deletion over needless compatibility.\n');
  const countFile = path.join(root, 'count');
  const argsFile = path.join(root, 'args.json');
  const inputFile = path.join(root, 'input.txt');
  const fake = await write('fake-claude.mjs', `#!/usr/bin/env node
import fs from 'node:fs';
let input=''; process.stdin.setEncoding('utf8'); for await (const chunk of process.stdin) input += chunk;
fs.writeFileSync(process.env.FAKE_INPUT_FILE,input);
const count=Number(fs.existsSync(process.env.FAKE_COUNT_FILE)?fs.readFileSync(process.env.FAKE_COUNT_FILE,'utf8'):0)+1;
fs.writeFileSync(process.env.FAKE_COUNT_FILE,String(count)); fs.writeFileSync(process.env.FAKE_ARGS_FILE,JSON.stringify(process.argv.slice(2)));
if(process.env.FAKE_CLAUDE_MODE==='usage') { process.stderr.write('usage limit reached'); process.exit(1); }
if(process.env.FAKE_CLAUDE_MODE==='auth') { process.stderr.write('authentication required'); process.exit(1); }
if(process.env.FAKE_CLAUDE_MODE==='quota-config') { process.stderr.write('quota configuration invalid'); process.exit(1); }
if(process.env.FAKE_CLAUDE_MODE==='recursion-limit') { process.stderr.write('reached recursion limit'); process.exit(1); }
if(process.env.FAKE_CLAUDE_MODE==='capacity-setting') { process.stderr.write('invalid capacity setting'); process.exit(1); }
if(process.env.FAKE_CLAUDE_MODE==='fable-unavailable') { process.stderr.write("Model 'claude-fable-5' is not available."); process.exit(1); }
if(process.env.FAKE_CLAUDE_MODE==='model-not-found') { process.stderr.write('model_not_found'); process.exit(1); }
if(process.env.FAKE_CLAUDE_MODE==='other-model-unavailable') { process.stderr.write("Model 'claude-opus-4-8' is not available."); process.exit(1); }
if(process.env.FAKE_CLAUDE_MODE==='generic-model-unavailable') { process.stderr.write('model unavailable'); process.exit(1); }
if(process.env.FAKE_CLAUDE_MODE==='model-configuration') { process.stderr.write('invalid model configuration'); process.exit(1); }
if(process.env.FAKE_CLAUDE_MODE==='envelope-model-not-found') {
  process.stdout.write(JSON.stringify({session_id:'11111111-1111-4111-8111-111111111111',is_error:true,error:{code:'model_not_found',message:'selected model could not be resolved'}}));
  process.exit(0);
}
if(process.env.FAKE_CLAUDE_MODE==='slow') await new Promise((resolve)=>setTimeout(resolve,200));
const authorTurns=(input.match(/^AUTHOR:/gm)||[]).length;
const first={utterance:'その互換分岐は本番要件ですか？',result:'AWAITING_AUTHOR',projection:{decision:null,tensions:[{id:'T001',families:['non-entity','value-cost'],question:'互換分岐は必要か',context_refs:[],status:'open',author_position:null,outcome:null,effect:null,requested_evidence:null}]}};
const second={utterance:'開発データだけなら互換分岐は不要です。この方向で進めてください。',result:'COMPLETED_ACCEPT',projection:{decision:'ACCEPT',tensions:[{id:'T001',families:['non-entity','value-cost'],question:'互換分岐は必要か',context_refs:[],status:'resolved',author_position:'DEFEND',outcome:'defended-and-clarified',effect:'no-change',requested_evidence:null}]}};
const secondDelta={utterance:second.utterance,result:second.result,updates:[{id:'T001',status:'resolved',author_position:'DEFEND',outcome:'defended-and-clarified',effect:'no-change',requested_evidence:null}],new_tensions:[]};
const multi1={utterance:'根因と外部前提の二点を確認したいです。',result:'AWAITING_AUTHOR',projection:{decision:null,tensions:[{id:'T001',families:['recurrence'],question:'共通根因か',context_refs:['commit:a'],status:'open',author_position:null,outcome:null,effect:null,requested_evidence:null},{id:'T002',families:['external-reality'],question:'外部契約は確認済みか',context_refs:[],status:'open',author_position:null,outcome:null,effect:null,requested_evidence:null}]}};
const multi2={utterance:'根因は確認できました。外部契約の証拠はありますか？',result:'AWAITING_AUTHOR',projection:{decision:null,tensions:[{id:'T001',families:['recurrence'],question:'共通根因か',context_refs:['commit:a'],status:'resolved',author_position:'REVISE',outcome:'changed',effect:'premise-corrected',requested_evidence:null},{id:'T002',families:['external-reality'],question:'外部契約は確認済みか',context_refs:[],status:'open',author_position:'NEED_EVIDENCE',outcome:null,effect:null,requested_evidence:'契約原文'}]}};
const multi3={utterance:'証拠も揃ったので根因から方向を変えてください。',result:'COMPLETED_CHANGE',projection:{decision:'CHANGE',tensions:[{id:'T001',families:['recurrence'],question:'共通根因か',context_refs:['commit:a'],status:'resolved',author_position:'REVISE',outcome:'changed',effect:'premise-corrected',requested_evidence:null},{id:'T002',families:['external-reality'],question:'外部契約は確認済みか',context_refs:[],status:'resolved',author_position:'NEED_EVIDENCE',outcome:'evidence-found',effect:'complexity-exposed',requested_evidence:'契約原文'}]}};
const multi2Delta={utterance:multi2.utterance,result:multi2.result,updates:[{id:'T001',status:'resolved',author_position:'REVISE',outcome:'changed',effect:'premise-corrected',requested_evidence:null},{id:'T002',status:'open',author_position:'NEED_EVIDENCE',outcome:null,effect:null,requested_evidence:'契約原文'}],new_tensions:[]};
const multi3Delta={utterance:multi3.utterance,result:multi3.result,updates:[{id:'T002',status:'resolved',author_position:'NEED_EVIDENCE',outcome:'evidence-found',effect:'complexity-exposed',requested_evidence:'契約原文'}],new_tensions:[]};
const invalidResumeDelta={utterance:'この返答のhidden deltaをrepairしてください。',result:'COMPLETED_ACCEPT',updates:[],new_tensions:[]};
let payload;
if(input.includes('Projection repair only.')&&process.env.FAKE_CLAUDE_MODE==='resume-invalid-repair-fail') payload=invalidResumeDelta;
else if(input.includes('Projection repair only.')&&input.includes('この返答のhidden deltaをrepairしてください。')) payload={...secondDelta,utterance:'この返答のhidden deltaをrepairしてください。'};
else if(input.includes('Projection repair only.')&&input.includes('この問いだけ表示してください。')) payload={...first,utterance:'この問いだけ表示してください。'};
else if(input.includes('Projection repair only.')) payload=first;
else if(process.argv.includes('--resume')&&['resume-invalid','resume-invalid-repair-fail'].includes(process.env.FAKE_CLAUDE_MODE)) payload=invalidResumeDelta;
else if(input.includes('MALFORMED_CASE')) payload={utterance:'この問いだけ表示してください。',result:'AWAITING_AUTHOR',projection:{decision:null,tensions:[]}};
else if(input.includes('MULTI_CASE root cause reply')) payload=multi2Delta;
else if(input.includes('MULTI_CASE evidence reply')) payload=multi3Delta;
else if(input.includes('MULTI_CASE')) payload=multi1;
else payload=process.argv.includes('--resume')?secondDelta:first;
if(process.env.FAKE_CLAUDE_MODE==='output-fable-unavailable') payload={...payload,utterance:"Model 'claude-fable-5' is not available."};
const envelope={session_id:'11111111-1111-4111-8111-111111111111',duration_ms:25,structured_output:payload};
if(process.env.FAKE_MISSING_USAGE!=='1') envelope.usage=process.env.FAKE_CLAUDE_CACHE_USAGE==='1'
  ?{input_tokens:10,cache_creation_input_tokens:20,cache_read_input_tokens:30,output_tokens:5}
  :{input_tokens:100,output_tokens:10};
process.stdout.write(JSON.stringify(envelope));
if(process.env.FAKE_CLAUDE_MODE==='response-capacity') { process.stderr.write('capacity unavailable'); process.exitCode=1; }
if(process.env.FAKE_CLAUDE_MODE==='response-fable-unavailable') { process.stderr.write("Model 'claude-fable-5' is not available."); process.exitCode=1; }
`, 0o755);
  // Remove patch markers embedded in the template for readability above.
  const fakeBody = (await fs.readFile(fake, 'utf8')).replace(/^\+/gm, '');
  await fs.writeFile(fake, fakeBody, { mode: 0o755 });
  const env = {
    ...process.env,
    HUMAN_DIRECTION_REPO_ROOT: root,
    HUMAN_DIRECTION_CLAUDE_BIN: fake,
    FAKE_COUNT_FILE: countFile,
    FAKE_ARGS_FILE: argsFile,
    FAKE_INPUT_FILE: inputFile,
  };
  const codexCountFile = path.join(root, 'codex-count');
  const codexArgsFile = path.join(root, 'codex-args.json');
  const codexInputFile = path.join(root, 'codex-input.txt');
  const fakeCodex = await write('fake-codex.mjs', `#!/usr/bin/env node
import fs from 'node:fs';
let input=''; process.stdin.setEncoding('utf8'); for await (const chunk of process.stdin) input += chunk;
fs.writeFileSync(process.env.FAKE_CODEX_INPUT_FILE,input);
const count=Number(fs.existsSync(process.env.FAKE_CODEX_COUNT_FILE)?fs.readFileSync(process.env.FAKE_CODEX_COUNT_FILE,'utf8'):0)+1;
fs.writeFileSync(process.env.FAKE_CODEX_COUNT_FILE,String(count)); fs.writeFileSync(process.env.FAKE_CODEX_ARGS_FILE,JSON.stringify(process.argv.slice(2)));
if(process.env.FAKE_CODEX_MODE==='failure') { process.stderr.write('codex unavailable'); process.exit(1); }
if(process.env.FAKE_CODEX_MODE==='slow') await new Promise((resolve)=>setTimeout(resolve,200));
if(process.env.FAKE_CODEX_MODE==='resume-missing' && process.argv.includes('resume')) { process.stderr.write('session not found'); process.exit(1); }
const authorTurns=(input.match(/^AUTHOR:/gm)||[]).length;
const first={utterance:'Codex代理: その互換分岐は本番要件ですか？',result:'AWAITING_AUTHOR',projection:{decision:null,tensions:[{id:'T001',families:['non-entity','value-cost'],question:'互換分岐は必要か',context_refs:[],status:'open',author_position:null,outcome:null,effect:null,requested_evidence:null}]}};
const second={utterance:'Codex代理: 開発データだけならこの方向で進めてください。',result:'COMPLETED_ACCEPT',projection:{decision:'ACCEPT',tensions:[{id:'T001',families:['non-entity','value-cost'],question:'互換分岐は必要か',context_refs:[],status:'resolved',author_position:'DEFEND',outcome:'defended-and-clarified',effect:'no-change',requested_evidence:null}]}};
const secondDelta={utterance:second.utterance,result:second.result,updates:[{id:'T001',status:'resolved',author_position:'DEFEND',outcome:'defended-and-clarified',effect:'no-change',requested_evidence:null}],new_tensions:[]};
const usesResumeSchema=process.argv.some((arg)=>arg.includes('human-direction-proxy-resume-schema.json'));
const payload=usesResumeSchema?secondDelta:first;
const events=[
  ...(process.env.FAKE_CODEX_MODE==='missing-thread'?[]:[{type:'thread.started',thread_id:process.env.FAKE_CODEX_MODE==='thread-mismatch'&&process.argv.includes('resume')?'33333333-3333-4333-8333-333333333333':'22222222-2222-4222-8222-222222222222'}]),
  ...(process.env.FAKE_CODEX_MODE==='tool'?[{type:'item.started',item:{type:'command_execution',command:'pwd'}}]:[]),
  {type:'item.completed',item:{type:'agent_message',text:process.env.FAKE_CODEX_MODE==='malformed'?'not-json':JSON.stringify(payload)}},
  {type:'turn.completed',usage:process.env.FAKE_CODEX_MODE==='usage-regression'&&process.argv.includes('resume')
    ?{input_tokens:70,cached_input_tokens:0,output_tokens:7}
    :(process.argv.includes('resume')?{input_tokens:160,cached_input_tokens:70,output_tokens:16}:{input_tokens:80,cached_input_tokens:0,output_tokens:8})},
];
process.stdout.write(events.map(JSON.stringify).join('\\n')+'\\n');
`, 0o755);
  Object.assign(env, {
    HUMAN_DIRECTION_CODEX_BIN: fakeCodex,
    FAKE_CODEX_COUNT_FILE: codexCountFile,
    FAKE_CODEX_ARGS_FILE: codexArgsFile,
    FAKE_CODEX_INPUT_FILE: codexInputFile,
  });
  const first = spawnSync(process.execPath, [runner, 'direction-test'], {
    input: 'Old local data differs. Add a permanent fallback.', encoding: 'utf8', env,
  });
  assert.equal(first.status, 0, first.stderr);
  assert.equal(first.stdout, 'その互換分岐は本番要件ですか？\n');
  assert.ok(!first.stdout.includes('T001'));
  const args = JSON.parse(await fs.readFile(argsFile, 'utf8'));
  assertFlagValueOnce(args, '--model', 'fable');
  assertFlagValueOnce(args, '--effort', 'medium');
  assert.ok(args.includes('--tools'));
  assert.equal(args[args.indexOf('--tools') + 1], '');
  const statePath = path.join(root, '.agents/state/human-direction-direction-test.state.json');
  let state = JSON.parse(await fs.readFile(statePath, 'utf8'));
  assert.equal(state.result, 'AWAITING_AUTHOR');
  assert.equal(state.event.direction_event_v1.method, 'human_direction_proxy');
  assert.equal(state.event.direction_event_v1.tool_calls, 0);
  assert.equal(state.event.direction_event_v1.dialogue_status, 'open');
  assert.equal(state.event.direction_event_v1.tensions[0].question, '互換分岐は必要か');
  assert.ok(state.decision_context_hash);
  assert.ok(state.transcript_hash);
  assert.equal(state.method_version.includes('retrieval:'), true);
  const legacyEvidenceState = structuredClone(state);
  legacyEvidenceState.result = 'AWAITING_EVIDENCE';
  legacyEvidenceState.projection.tensions[0].author_position = 'NEED_EVIDENCE';
  legacyEvidenceState.projection.tensions[0].requested_evidence = 'production requirement';
  legacyEvidenceState.event.direction_event_v1.decision = 'REQUEST_EVIDENCE';
  legacyEvidenceState.event.direction_event_v1.tensions[0].author_position = 'NEED_EVIDENCE';
  legacyEvidenceState.event.direction_event_v1.tensions[0].requested_evidence = 'production requirement';
  assert.equal(validDirectionEvent(legacyEvidenceState.event.direction_event_v1, legacyEvidenceState), false, 'legacy event decision must be rejected');
  assert.equal(validPersistedState(legacyEvidenceState, { sessionKey: 'direction-test', workItemId: 'direction-test' }), false, 'legacy persisted result must be rejected');

  const second = spawnSync(process.execPath, [runner, 'direction-test'], {
    input: 'It is disposable development data; production and external clients never use it.', encoding: 'utf8', env,
  });
  assert.equal(second.status, 0, second.stderr);
  state = JSON.parse(await fs.readFile(statePath, 'utf8'));
  assert.equal(state.result, 'COMPLETED_ACCEPT');
  assert.equal(state.projection.tensions[0].status, 'resolved');
  assert.equal(state.transcript.length, 4);
  assert.equal(state.event.direction_event_v1.input_tokens, 200);
  assert.equal(state.event.direction_event_v1.output_tokens, 20);
  assert.equal(state.event.direction_event_v1.dialogue_status, 'completed');
  const compactClaudeInput = await fs.readFile(inputFile, 'utf8');
  assert.match(compactClaudeInput, /LATEST AUTHOR REPLY/);
  assert.ok(!compactClaudeInput.includes('DIRECTION CONTEXT'));
  assert.ok(!compactClaudeInput.includes('ORIGINAL PROPOSAL'));
  const compactClaudeArgs = JSON.parse(await fs.readFile(argsFile, 'utf8'));
  assertFlagValueOnce(compactClaudeArgs, '--model', 'fable');
  assertFlagValueOnce(compactClaudeArgs, '--effort', 'medium');
  assert.ok(compactClaudeArgs.includes('--resume'));
  assert.match(compactClaudeArgs[compactClaudeArgs.indexOf('--json-schema') + 1], /"updates"/);
  const attemptPath = path.join(root, '.agents/state/human-direction-direction-test.result.jsonl');
  let attempts = (await fs.readFile(attemptPath, 'utf8')).trim().split('\n').map((line) => JSON.parse(line).human_direction_attempt_v1);
  assert.equal(attempts.length, 2);
  assert.equal(attempts[0].result, 'awaiting_author');
  assert.equal(attempts[0].prompt_mode, 'full');
  assert.equal(attempts[1].result, 'completed');
  assert.equal(attempts[1].prompt_mode, 'compact');
  assert.ok(attempts[1].prompt_bytes < attempts[0].prompt_bytes);
  assert.deepEqual(attempts[1].provider_runs.map((run) => run.run_index), [1]);
  assert.equal(attempts[1].provider_runs[0].prompt_mode, 'compact');

  const completedAgain = spawnSync(process.execPath, [runner, 'direction-test'], { input: 'again', encoding: 'utf8', env });
  assert.equal(completedAgain.status, 2);
  attempts = (await fs.readFile(attemptPath, 'utf8')).trim().split('\n').map((line) => JSON.parse(line).human_direction_attempt_v1);
  assert.equal(attempts.length, 3, 'completed-session rejection appends exactly one attempt');
  assert.equal(attempts[2].result, 'preflight_rejected');
  assert.equal(attempts[2].accounting_status, 'not_started');

  const emptyKey = 'direction-empty-input';
  const empty = spawnSync(process.execPath, [runner, emptyKey], { input: '', encoding: 'utf8', env });
  assert.equal(empty.status, 2);
  const emptyAttempts = (await fs.readFile(path.join(root, `.agents/state/human-direction-${emptyKey}.result.jsonl`), 'utf8')).trim().split('\n');
  assert.equal(emptyAttempts.length, 1);
  assert.equal(JSON.parse(emptyAttempts[0]).human_direction_attempt_v1.result, 'preflight_rejected');

  const appendFaultKey = 'direction-attempt-append-fault';
  const appendFault = spawnSync(process.execPath, [runner, appendFaultKey], {
    input: 'proposal', encoding: 'utf8', env: { ...env, HDP_TEST_ATTEMPT_APPEND_FAILURE: 'after-write-once' },
  });
  assert.equal(appendFault.status, 0, appendFault.stderr);
  const appendFaultLines = (await fs.readFile(path.join(root, `.agents/state/human-direction-${appendFaultKey}.result.jsonl`), 'utf8')).trim().split('\n');
  assert.equal(appendFaultLines.length, 1, 'retry after an ambiguous append must remain idempotent');
  assert.equal(JSON.parse(appendFaultLines[0]).human_direction_attempt_v1.result, 'awaiting_author');

  await fs.rm(statePath);
  const lost = spawnSync(process.execPath, [runner, 'direction-test'], {
    input: 'continue', encoding: 'utf8', env,
  });
  assert.equal(lost.status, 8);
  assert.match(lost.stderr, /STATE_LOST/);

  // Removed cumulative-limit environment variables do not gate an open or
  // completed turn. Cost remains observable but never invalidates a payload.
  const noCumulativeLimitKey = 'direction-no-cumulative-limit';
  const obsoleteLimitEnv = {
    ...env,
    HUMAN_DIRECTION_MAX_WALL_MS: '1',
    HUMAN_DIRECTION_MAX_TOKENS: '1',
    HUMAN_DIRECTION_MAX_OUTPUT_TOKENS: '1',
  };
  const noLimitFirst = spawnSync(process.execPath, [runner, noCumulativeLimitKey], {
    input: 'Add a permanent fallback.', encoding: 'utf8', env: obsoleteLimitEnv,
  });
  assert.equal(noLimitFirst.status, 0, noLimitFirst.stderr);
  const noLimitSecond = spawnSync(process.execPath, [runner, noCumulativeLimitKey], {
    input: 'This is disposable data.', encoding: 'utf8', env: obsoleteLimitEnv,
  });
  assert.equal(noLimitSecond.status, 0, noLimitSecond.stderr);
  const noLimitState = JSON.parse(await fs.readFile(path.join(root, `.agents/state/human-direction-${noCumulativeLimitKey}.state.json`), 'utf8'));
  assert.equal(noLimitState.result, 'COMPLETED_ACCEPT');
  assert.equal(noLimitState.event.direction_event_v1.decision, 'ACCEPT');
  assert.equal(noLimitState.cumulative.input_tokens, 200);
  assert.equal(noLimitState.cumulative.output_tokens, 20);

  // Canonical multi-tension state retains resolved and still-open tensions
  // across resumes, and the transferable event carries aggregate cost.
  const multiKey = 'direction-multi-case';
  const multiReplies = ['MULTI_CASE proposal', 'MULTI_CASE root cause reply', 'MULTI_CASE evidence reply'];
  for (const [index, reply] of multiReplies.entries()) {
    const turn = spawnSync(process.execPath, [runner, multiKey], { input: reply, encoding: 'utf8', env });
    assert.equal(turn.status, 0, turn.stderr);
    if (index === 1) {
      const awaitingEvidence = JSON.parse(await fs.readFile(path.join(root, '.agents/state/human-direction-direction-multi-case.state.json'), 'utf8'));
      assert.equal(awaitingEvidence.result, 'AWAITING_AUTHOR');
      assert.equal(awaitingEvidence.event.direction_event_v1.decision, 'INCOMPLETE');
      assert.equal(awaitingEvidence.projection.tensions[1].requested_evidence, '契約原文');
    }
  }
  const multiState = JSON.parse(await fs.readFile(path.join(root, '.agents/state/human-direction-direction-multi-case.state.json'), 'utf8'));
  assert.equal(multiState.result, 'COMPLETED_CHANGE');
  assert.deepEqual(multiState.projection.tensions.map((item) => item.id), ['T001', 'T002']);
  assert.equal(multiState.event.direction_event_v1.input_tokens, 300);
  assert.equal(multiState.event.direction_event_v1.output_tokens, 30);
  assert.equal(multiState.event.direction_event_v1.tensions[1].requested_evidence, '契約原文');

  // A malformed hidden projection is repaired without replacing the natural utterance.
  const repaired = spawnSync(process.execPath, [runner, 'direction-malformed-case'], {
    input: 'MALFORMED_CASE proposal', encoding: 'utf8', env,
  });
  assert.equal(repaired.status, 0, repaired.stderr);
  assert.equal(repaired.stdout, 'この問いだけ表示してください。\n');
  const repairedState = JSON.parse(await fs.readFile(path.join(root, '.agents/state/human-direction-direction-malformed-case.state.json'), 'utf8'));
  assert.equal(repairedState.event.direction_event_v1.input_tokens, 200);
  const repairedAttempt = JSON.parse((await fs.readFile(path.join(root, '.agents/state/human-direction-direction-malformed-case.result.jsonl'), 'utf8')).trim()).human_direction_attempt_v1;
  assert.equal(repairedAttempt.repair_attempted, true);
  assert.equal(repairedAttempt.repair_succeeded, true);
  assert.equal(repairedAttempt.validation_reason, 'result-open-mismatch');
  assert.deepEqual(repairedAttempt.provider_runs.map((run) => run.phase), ['main', 'projection_repair']);
  assert.deepEqual(repairedAttempt.provider_runs.map((run) => run.run_index), [1, 2]);
  assert.equal(repairedAttempt.input_tokens, repairedAttempt.provider_runs.reduce((sum, run) => sum + run.normalized_delta.input_tokens, 0));

  // Resume models update mutable disposition only. Invalid deltas get one
  // same-provider repair; a second invalid delta fails closed.
  const deltaRepairKey = 'direction-delta-repair';
  assert.equal(spawnSync(process.execPath, [runner, deltaRepairKey], { input: 'proposal', encoding: 'utf8', env }).status, 0);
  const deltaRepaired = spawnSync(process.execPath, [runner, deltaRepairKey], {
    input: 'disposable data', encoding: 'utf8', env: { ...env, FAKE_CLAUDE_MODE: 'resume-invalid' },
  });
  assert.equal(deltaRepaired.status, 0, deltaRepaired.stderr);
  const deltaRepairState = JSON.parse(await fs.readFile(path.join(root, `.agents/state/human-direction-${deltaRepairKey}.state.json`), 'utf8'));
  assert.equal(deltaRepairState.result, 'COMPLETED_ACCEPT');
  assert.equal(deltaRepairState.projection.tensions[0].question, '互換分岐は必要か');
  const deltaRepairAttempts = (await fs.readFile(path.join(root, `.agents/state/human-direction-${deltaRepairKey}.result.jsonl`), 'utf8')).trim().split('\n').map((line) => JSON.parse(line).human_direction_attempt_v1);
  assert.equal(deltaRepairAttempts[1].repair_succeeded, true);
  assert.equal(deltaRepairAttempts[1].validation_reason, 'missing-open-tension-update');

  const deltaFailKey = 'direction-delta-repair-fail';
  assert.equal(spawnSync(process.execPath, [runner, deltaFailKey], { input: 'proposal', encoding: 'utf8', env }).status, 0);
  const deltaFailed = spawnSync(process.execPath, [runner, deltaFailKey], {
    input: 'disposable data', encoding: 'utf8', env: { ...env, FAKE_CLAUDE_MODE: 'resume-invalid-repair-fail' },
  });
  assert.equal(deltaFailed.status, 8);
  const deltaFailedAttempts = (await fs.readFile(path.join(root, `.agents/state/human-direction-${deltaFailKey}.result.jsonl`), 'utf8')).trim().split('\n').map((line) => JSON.parse(line).human_direction_attempt_v1);
  assert.equal(deltaFailedAttempts.length, 2);
  assert.equal(deltaFailedAttempts[1].result, 'state_lost');
  assert.equal(deltaFailedAttempts[1].repair_attempted, true);
  assert.equal(deltaFailedAttempts[1].repair_succeeded, false);

  // Missing provider accounting is an observable gap, not a reason to discard
  // a schema-valid dialogue turn or corrupt its resume state.
  const missing = spawnSync(process.execPath, [runner, 'direction-missing-usage'], {
    input: 'Missing usage proposal', encoding: 'utf8', env: { ...env, FAKE_MISSING_USAGE: '1' },
  });
  assert.equal(missing.status, 0, missing.stderr);
  let missingState = JSON.parse(await fs.readFile(path.join(root, '.agents/state/human-direction-direction-missing-usage.state.json'), 'utf8'));
  assert.equal(missingState.result, 'AWAITING_AUTHOR');
  assert.equal(missingState.cumulative.input_tokens, 0);
  assert.equal(missingState.cumulative.output_tokens, 0);
  assert.deepEqual(missingState.accounting_records[0], {
    turn: 1, provider: 'claude', mode: 'unavailable', prior_raw_total: null, current_raw_total: null,
    normalized_delta: { input_tokens: 0, cached_input_tokens: 0, output_tokens: 0 },
    reason: 'provider token accounting unavailable',
  });
  const afterMissing = spawnSync(process.execPath, [runner, 'direction-missing-usage'], {
    input: 'This is disposable data.', encoding: 'utf8', env,
  });
  assert.equal(afterMissing.status, 0, afterMissing.stderr);
  missingState = JSON.parse(await fs.readFile(path.join(root, '.agents/state/human-direction-direction-missing-usage.state.json'), 'utf8'));
  assert.equal(missingState.result, 'COMPLETED_ACCEPT');
  assert.equal(missingState.accounting_records[0].mode, 'unavailable');
  assert.equal(missingState.accounting_records[1].mode, 'per_turn');
  const missingAttempts = (await fs.readFile(path.join(root, '.agents/state/human-direction-direction-missing-usage.result.jsonl'), 'utf8')).trim().split('\n').map((line) => JSON.parse(line).human_direction_attempt_v1);
  assert.equal(missingAttempts[0].accounting_status, 'partial');
  assert.match(missingAttempts[0].accounting_gap_reason, /unavailable/);

  const claudeCache = spawnSync(process.execPath, [runner, 'direction-claude-cache-usage'], {
    input: 'Cache accounting proposal', encoding: 'utf8', env: { ...env, FAKE_CLAUDE_CACHE_USAGE: '1' },
  });
  assert.equal(claudeCache.status, 0, claudeCache.stderr);
  const claudeCacheState = JSON.parse(await fs.readFile(path.join(root, '.agents/state/human-direction-direction-claude-cache-usage.state.json'), 'utf8'));
  assert.equal(claudeCacheState.cumulative.input_tokens, 60);
  assert.equal(claudeCacheState.cumulative.cached_input_tokens, 30);
  assert.equal(claudeCacheState.cumulative.output_tokens, 5);

  // Syntactically valid resume-state tampering fails before the provider runs.
  for (const [key, mutate] of [
    ['direction-tampered-transcript', (value) => { value.transcript[0].text = 'changed'; }],
    ['direction-tampered-counter', (value) => { delete value.cumulative.output_tokens; }],
  ]) {
    const initial = spawnSync(process.execPath, [runner, key], { input: 'Add a permanent fallback.', encoding: 'utf8', env });
    assert.equal(initial.status, 0, initial.stderr);
    const tamperedPath = path.join(root, `.agents/state/human-direction-${key}.state.json`);
    const tampered = JSON.parse(await fs.readFile(tamperedPath, 'utf8'));
    mutate(tampered);
    await fs.writeFile(tamperedPath, JSON.stringify(tampered));
    const callsBefore = await fs.readFile(countFile, 'utf8');
    const resumed = spawnSync(process.execPath, [runner, key], { input: 'continue', encoding: 'utf8', env });
    assert.equal(resumed.status, 8);
    assert.match(resumed.stderr, /resume bundle is missing or corrupt/);
    assert.equal(await fs.readFile(countFile, 'utf8'), callsBefore);
    const tamperedAttempts = (await fs.readFile(path.join(root, `.agents/state/human-direction-${key}.result.jsonl`), 'utf8')).trim().split('\n').map((line) => JSON.parse(line).human_direction_attempt_v1);
    assert.equal(tamperedAttempts.length, 2);
    assert.equal(tamperedAttempts[1].result, 'state_lost');
    assert.deepEqual(tamperedAttempts[1].provider_runs, []);
  }

  // Auto mode switches immediately from a trusted Claude usage failure to a
  // separate Codex direction session, then keeps Codex sticky on later turns.
  await fs.writeFile(countFile, '0');
  await fs.writeFile(codexCountFile, '0');
  const fallbackKey = 'direction-provider-fallback';
  const fallback = spawnSync(process.execPath, [runner, fallbackKey], {
    input: 'Add a permanent fallback.',
    encoding: 'utf8',
    env: {
      ...env,
      FAKE_CLAUDE_MODE: 'usage',
      HUMAN_DIRECTION_CODEX_MODEL: 'forbidden-model-override',
      HUMAN_DIRECTION_CODEX_REASONING_EFFORT: 'low',
    },
  });
  assert.equal(fallback.status, 0, fallback.stderr);
  assert.match(fallback.stdout, /^Codex代理:/);
  let fallbackState = JSON.parse(await fs.readFile(path.join(root, `.agents/state/human-direction-${fallbackKey}.state.json`), 'utf8'));
  assert.equal(fallbackState.active_provider, 'codex');
  assert.deepEqual(fallbackState.providers_used, ['claude', 'codex']);
  assert.equal(fallbackState.fallback_count, 1);
  assert.equal(fallbackState.event.direction_event_v1.active_provider, 'codex');
  assert.deepEqual(fallbackState.event.direction_event_v1.providers_used, ['claude', 'codex']);
  const claudeCallsAfterFallback = await fs.readFile(countFile, 'utf8');
  const fallbackSecond = spawnSync(process.execPath, [runner, fallbackKey], {
    input: 'It is disposable development data.', encoding: 'utf8', env: { ...env, FAKE_CLAUDE_MODE: 'usage' },
  });
  assert.equal(fallbackSecond.status, 0, fallbackSecond.stderr);
  assert.equal(await fs.readFile(countFile, 'utf8'), claudeCallsAfterFallback, 'sticky Codex turn must not retry Claude');
  const codexArgs = JSON.parse(await fs.readFile(codexArgsFile, 'utf8'));
  assert.ok(!codexArgs.includes('-m'));
  assertFlagValueOnce(codexArgs, '-c', 'model_reasoning_effort="high"');
  assert.ok(codexArgs.includes('resume'));
  assert.ok(codexArgs.includes('--output-schema'));
  assert.ok(codexArgs.includes('22222222-2222-4222-8222-222222222222'));
  fallbackState = JSON.parse(await fs.readFile(path.join(root, `.agents/state/human-direction-${fallbackKey}.state.json`), 'utf8'));
  assert.equal(fallbackState.result, 'COMPLETED_ACCEPT');
  assert.equal(fallbackState.event.direction_event_v1.input_tokens, 160);
  assert.equal(fallbackState.event.direction_event_v1.cached_input_tokens, 70);
  assert.equal(fallbackState.event.direction_event_v1.output_tokens, 16);
  const compactCodexInput = await fs.readFile(codexInputFile, 'utf8');
  assert.match(compactCodexInput, /LATEST AUTHOR REPLY/);
  assert.ok(!compactCodexInput.includes('DIRECTION CONTEXT'));
  const fallbackAttempts = (await fs.readFile(path.join(root, `.agents/state/human-direction-${fallbackKey}.result.jsonl`), 'utf8')).trim().split('\n').map((line) => JSON.parse(line).human_direction_attempt_v1);
  assert.deepEqual(fallbackAttempts[0].provider_runs.map((run) => run.phase), ['main', 'provider_fallback']);
  assert.equal(fallbackAttempts[0].fallback_count, 1);
  assert.equal(fallbackAttempts[0].accounting_status, 'partial');

  // Only selected Fable model failures from trusted provider error channels
  // may use the model-unavailable fallback.
  for (const mode of ['fable-unavailable', 'model-not-found', 'envelope-model-not-found']) {
    const selectedModelFailure = spawnSync(process.execPath, [runner, `direction-${mode}`], {
      input: 'proposal', encoding: 'utf8', env: { ...env, FAKE_CLAUDE_MODE: mode },
    });
    assert.equal(selectedModelFailure.status, 0, `${mode}: ${selectedModelFailure.stderr}`);
    assert.match(selectedModelFailure.stdout, /^Codex代理:/);
  }
  // Forced modes never cross providers, and ordinary/auth failures or model
  // text containing capacity words are not mistaken for a trusted limit.
  const codexCallsBeforeForced = Number(await fs.readFile(codexCountFile, 'utf8'));
  const forcedClaude = spawnSync(process.execPath, [runner, 'direction-forced-claude'], {
    input: 'proposal', encoding: 'utf8', env: { ...env, HUMAN_DIRECTION_PROVIDER: 'claude', FAKE_CLAUDE_MODE: 'usage' },
  });
  assert.equal(forcedClaude.status, 1);
  assert.equal(Number(await fs.readFile(codexCountFile, 'utf8')), codexCallsBeforeForced);
  const forcedCodex = spawnSync(process.execPath, [runner, 'direction-forced-codex'], {
    input: 'proposal', encoding: 'utf8', env: { ...env, HUMAN_DIRECTION_PROVIDER: 'codex' },
  });
  assert.equal(forcedCodex.status, 0, forcedCodex.stderr);
  const afterForcedCodex = Number(await fs.readFile(codexCountFile, 'utf8'));
  const auth = spawnSync(process.execPath, [runner, 'direction-auth-failure'], {
    input: 'proposal', encoding: 'utf8', env: { ...env, FAKE_CLAUDE_MODE: 'auth' },
  });
  assert.equal(auth.status, 1);
  assert.equal(Number(await fs.readFile(codexCountFile, 'utf8')), afterForcedCodex);
  for (const mode of ['quota-config', 'recursion-limit', 'capacity-setting']) {
    const falseCapacity = spawnSync(process.execPath, [runner, `direction-false-capacity-${mode}`], {
      input: 'proposal', encoding: 'utf8', env: { ...env, FAKE_CLAUDE_MODE: mode },
    });
    assert.equal(falseCapacity.status, 1, `${mode}: ${falseCapacity.stderr}`);
    assert.equal(Number(await fs.readFile(codexCountFile, 'utf8')), afterForcedCodex);
  }
  for (const mode of ['other-model-unavailable', 'generic-model-unavailable', 'model-configuration']) {
    const falseModelFailure = spawnSync(process.execPath, [runner, `direction-false-${mode}`], {
      input: 'proposal', encoding: 'utf8', env: { ...env, FAKE_CLAUDE_MODE: mode },
    });
    assert.equal(falseModelFailure.status, 1, `${mode}: ${falseModelFailure.stderr}`);
    assert.equal(Number(await fs.readFile(codexCountFile, 'utf8')), afterForcedCodex);
  }
  const falsePositive = spawnSync(process.execPath, [runner, 'direction-false-positive'], {
    input: "The proposal literally says usage limit, HTTP 429, and Model 'claude-fable-5' is not available.", encoding: 'utf8', env,
  });
  assert.equal(falsePositive.status, 0, falsePositive.stderr);
  assert.equal(Number(await fs.readFile(codexCountFile, 'utf8')), afterForcedCodex);
  const outputFalsePositive = spawnSync(process.execPath, [runner, 'direction-output-fable-unavailable'], {
    input: 'proposal', encoding: 'utf8', env: { ...env, FAKE_CLAUDE_MODE: 'output-fable-unavailable' },
  });
  assert.equal(outputFalsePositive.status, 0, outputFalsePositive.stderr);
  assert.equal(Number(await fs.readFile(codexCountFile, 'utf8')), afterForcedCodex);
  const responseThenCapacity = spawnSync(process.execPath, [runner, 'direction-response-capacity'], {
    input: 'proposal', encoding: 'utf8', env: { ...env, FAKE_CLAUDE_MODE: 'response-capacity' },
  });
  assert.equal(responseThenCapacity.status, 8);
  assert.equal(Number(await fs.readFile(codexCountFile, 'utf8')), afterForcedCodex);
  const responseThenModelFailure = spawnSync(process.execPath, [runner, 'direction-response-fable-unavailable'], {
    input: 'proposal', encoding: 'utf8', env: { ...env, FAKE_CLAUDE_MODE: 'response-fable-unavailable' },
  });
  assert.equal(responseThenModelFailure.status, 8);
  assert.equal(Number(await fs.readFile(codexCountFile, 'utf8')), afterForcedCodex);

  const commandMissing = spawnSync(process.execPath, [runner, 'direction-command-missing'], {
    input: 'proposal', encoding: 'utf8', env: { ...env, HUMAN_DIRECTION_CLAUDE_BIN: path.join(root, 'does-not-exist') },
  });
  assert.equal(commandMissing.status, 0, commandMissing.stderr);
  const malformedCodex = spawnSync(process.execPath, [runner, 'direction-codex-malformed'], {
    input: 'proposal', encoding: 'utf8', env: { ...env, HUMAN_DIRECTION_PROVIDER: 'codex', FAKE_CODEX_MODE: 'malformed' },
  });
  assert.equal(malformedCodex.status, 1);
  const toolCodex = spawnSync(process.execPath, [runner, 'direction-codex-tool'], {
    input: 'proposal', encoding: 'utf8', env: { ...env, HUMAN_DIRECTION_PROVIDER: 'codex', FAKE_CODEX_MODE: 'tool' },
  });
  assert.equal(toolCodex.status, 8);
  const missingThreadCodex = spawnSync(process.execPath, [runner, 'direction-codex-missing-thread'], {
    input: 'proposal', encoding: 'utf8', env: { ...env, HUMAN_DIRECTION_PROVIDER: 'codex', FAKE_CODEX_MODE: 'missing-thread' },
  });
  assert.equal(missingThreadCodex.status, 8);
  assert.match(missingThreadCodex.stderr, /failed/);
  const timedOutCodex = spawnSync(process.execPath, [runner, 'direction-codex-timeout'], {
    input: 'proposal', encoding: 'utf8', env: { ...env, HUMAN_DIRECTION_PROVIDER: 'codex', HUMAN_DIRECTION_TURN_TIMEOUT_MS: '10', FAKE_CODEX_MODE: 'slow' },
  });
  assert.equal(timedOutCodex.status, 1);

  // A missing native Codex resume is retried once with the same provider and
  // the full persisted prompt; its cumulative token baseline is reset.
  const freshContinuationKey = 'direction-codex-resume-reset';
  const resumeResetFirst = spawnSync(process.execPath, [runner, freshContinuationKey], {
    input: 'proposal', encoding: 'utf8', env: { ...env, HUMAN_DIRECTION_PROVIDER: 'codex' },
  });
  assert.equal(resumeResetFirst.status, 0, resumeResetFirst.stderr);
  const codexBeforeReset = Number(await fs.readFile(codexCountFile, 'utf8'));
  const resumeResetSecond = spawnSync(process.execPath, [runner, freshContinuationKey], {
    input: 'disposable data', encoding: 'utf8', env: { ...env, HUMAN_DIRECTION_PROVIDER: 'codex', FAKE_CODEX_MODE: 'resume-missing' },
  });
  assert.equal(resumeResetSecond.status, 0, resumeResetSecond.stderr);
  assert.equal(Number(await fs.readFile(codexCountFile, 'utf8')), codexBeforeReset + 2);
  const freshContinuationArgs = JSON.parse(await fs.readFile(codexArgsFile, 'utf8'));
  assert.ok(!freshContinuationArgs.includes('resume'));
  const resumeResetAttempts = (await fs.readFile(path.join(root, `.agents/state/human-direction-${freshContinuationKey}.result.jsonl`), 'utf8')).trim().split('\n').map((line) => JSON.parse(line).human_direction_attempt_v1);
  assert.deepEqual(resumeResetAttempts[1].provider_runs.map((run) => run.phase), ['main', 'resume_recovery']);
  assert.deepEqual(resumeResetAttempts[1].provider_runs.map((run) => run.run_index), [1, 2]);
  assert.equal(resumeResetAttempts[1].prompt_mode, 'compact');

  const mismatchKey = 'direction-codex-thread-mismatch';
  const mismatchFirst = spawnSync(process.execPath, [runner, mismatchKey], {
    input: 'proposal', encoding: 'utf8', env: { ...env, HUMAN_DIRECTION_PROVIDER: 'codex' },
  });
  assert.equal(mismatchFirst.status, 0, mismatchFirst.stderr);
  const mismatchSecond = spawnSync(process.execPath, [runner, mismatchKey], {
    input: 'disposable data', encoding: 'utf8', env: { ...env, HUMAN_DIRECTION_PROVIDER: 'codex', FAKE_CODEX_MODE: 'thread-mismatch' },
  });
  assert.equal(mismatchSecond.status, 8);

  const usageRegressionKey = 'direction-codex-usage-regression';
  const usageRegressionFirst = spawnSync(process.execPath, [runner, usageRegressionKey], {
    input: 'proposal', encoding: 'utf8', env: { ...env, HUMAN_DIRECTION_PROVIDER: 'codex' },
  });
  assert.equal(usageRegressionFirst.status, 0, usageRegressionFirst.stderr);
  const usageRegressionSecond = spawnSync(process.execPath, [runner, usageRegressionKey], {
    input: 'disposable data', encoding: 'utf8', env: { ...env, HUMAN_DIRECTION_PROVIDER: 'codex', FAKE_CODEX_MODE: 'usage-regression' },
  });
  assert.equal(usageRegressionSecond.status, 8, usageRegressionSecond.stderr);
  const usageRegressionState = JSON.parse(await fs.readFile(path.join(root, `.agents/state/human-direction-${usageRegressionKey}.state.json`), 'utf8'));
  assert.equal(usageRegressionState.result, 'STATE_LOST');
  assert.equal(usageRegressionState.state_lost_reason, 'provider cumulative usage regressed below persisted baseline');
  const usageRegressionAttempts = (await fs.readFile(path.join(root, `.agents/state/human-direction-${usageRegressionKey}.result.jsonl`), 'utf8')).trim().split('\n').map((line) => JSON.parse(line).human_direction_attempt_v1);
  assert.equal(usageRegressionAttempts[1].result, 'state_lost');
  assert.equal(usageRegressionAttempts[1].accounting_status, 'partial');
  assert.equal(usageRegressionAttempts[1].provider_runs[0].accounting_gap_reason, 'provider cumulative usage regressed below persisted baseline');

  // If the fallback provider also fails, the direction checkpoint fails
  // closed; it is never transferred to a Codex review runner.
  const dualFailure = spawnSync(process.execPath, [runner, 'direction-dual-failure'], {
    input: 'proposal', encoding: 'utf8', env: { ...env, FAKE_CLAUDE_MODE: 'usage', FAKE_CODEX_MODE: 'failure' },
  });
  assert.equal(dualFailure.status, 1);
  const dualResult = JSON.parse(await fs.readFile(path.join(root, '.agents/state/human-direction-direction-dual-failure.result.json'), 'utf8'));
  assert.equal(dualResult.result, 'TRANSIENT_RUNNER_FAILURE');
  assert.equal(dualResult.active_provider, 'codex');

  // The hash-validated state is canonical. A mismatched duplicate provider
  // cache is repaired atomically from it, never accepted as an authority.
  const corruptKey = 'direction-provider-corrupt';
  const corruptInitial = spawnSync(process.execPath, [runner, corruptKey], { input: 'proposal', encoding: 'utf8', env });
  assert.equal(corruptInitial.status, 0, corruptInitial.stderr);
  const corruptSessionPath = path.join(root, `.agents/state/human-direction-${corruptKey}.session`);
  const corruptSession = JSON.parse(await fs.readFile(corruptSessionPath, 'utf8'));
  corruptSession.active_provider = 'codex';
  await fs.writeFile(corruptSessionPath, JSON.stringify(corruptSession));
  const claudeBeforeCorrupt = await fs.readFile(countFile, 'utf8');
  const codexBeforeCorrupt = await fs.readFile(codexCountFile, 'utf8');
  const corruptResume = spawnSync(process.execPath, [runner, corruptKey], { input: 'continue', encoding: 'utf8', env });
  assert.equal(corruptResume.status, 0, corruptResume.stderr);
  assert.equal(Number(await fs.readFile(countFile, 'utf8')), Number(claudeBeforeCorrupt) + 1);
  assert.equal(await fs.readFile(codexCountFile, 'utf8'), codexBeforeCorrupt);
  const recoveredSession = JSON.parse(await fs.readFile(corruptSessionPath, 'utf8'));
  assert.equal(recoveredSession.active_provider, 'claude');

  // Same-key invocations serialize behind an exclusive per-session lock, so
  // neither the author turn nor provider accounting can be overwritten.
  const concurrentKey = 'direction-concurrent';
  const concurrentEnv = { ...env, FAKE_CLAUDE_MODE: 'slow' };
  const firstConcurrent = spawnResult(process.execPath, [runner, concurrentKey], { cwd: root, env: concurrentEnv, input: 'proposal' });
  await new Promise((resolve) => setTimeout(resolve, 40));
  const secondConcurrent = spawnResult(process.execPath, [runner, concurrentKey], { cwd: root, env: concurrentEnv, input: 'disposable data' });
  const [firstConcurrentResult, secondConcurrentResult] = await Promise.all([firstConcurrent, secondConcurrent]);
  assert.equal(firstConcurrentResult.status, 0, firstConcurrentResult.stderr);
  assert.equal(secondConcurrentResult.status, 0, secondConcurrentResult.stderr);
  const concurrentState = JSON.parse(await fs.readFile(path.join(root, `.agents/state/human-direction-${concurrentKey}.state.json`), 'utf8'));
  assert.equal(concurrentState.result, 'COMPLETED_ACCEPT');
  assert.equal(concurrentState.transcript.length, 4);
  assert.equal(concurrentState.cumulative.input_tokens, 200);
  const concurrentAttempts = (await fs.readFile(path.join(root, `.agents/state/human-direction-${concurrentKey}.result.jsonl`), 'utf8')).trim().split('\n').map((line) => JSON.parse(line).human_direction_attempt_v1);
  assert.equal(concurrentAttempts.length, 2);
  assert.equal(new Set(concurrentAttempts.map((attempt) => attempt.attempt_id)).size, 2);
  assert.equal(await fs.stat(path.join(root, '.agents/state')).then(async () => fs.access(path.join(root, `.agents/state/human-direction-${concurrentKey}.lock`)).then(() => false, () => true)), true);

  // Stale takeover itself is serialized by a separate recovery mutex. Two
  // simultaneous waiters cannot unlink a newly acquired primary lock.
  const staleConcurrentKey = 'direction-stale-concurrent';
  const staleLockPath = path.join(root, `.agents/state/human-direction-${staleConcurrentKey}.lock`);
  await fs.writeFile(staleLockPath, `${JSON.stringify({ pid: 99999999, attempt_id: 'dead-owner', acquired_at: '2020-01-01T00:00:00Z' })}\n`);
  const staleFirst = spawnResult(process.execPath, [runner, staleConcurrentKey], { cwd: root, env: concurrentEnv, input: 'proposal' });
  const staleSecond = spawnResult(process.execPath, [runner, staleConcurrentKey], { cwd: root, env: concurrentEnv, input: 'disposable data' });
  const staleResults = await Promise.all([staleFirst, staleSecond]);
  assert.ok(staleResults.every((item) => item.status === 0), staleResults.map((item) => item.stderr).join('\n'));
  const staleState = JSON.parse(await fs.readFile(path.join(root, `.agents/state/human-direction-${staleConcurrentKey}.state.json`), 'utf8'));
  assert.equal(staleState.result, 'COMPLETED_ACCEPT');
  assert.equal(staleState.transcript.length, 4);
  assert.equal(staleState.cumulative.input_tokens, 200);
  const staleAttempts = (await fs.readFile(path.join(root, `.agents/state/human-direction-${staleConcurrentKey}.result.jsonl`), 'utf8')).trim().split('\n').map((line) => JSON.parse(line).human_direction_attempt_v1);
  assert.equal(staleAttempts.length, 2);
  await assert.rejects(fs.access(staleLockPath));
  await assert.rejects(fs.access(`${staleLockPath}.recovery`));

  // A crash before recovery-owner initialization is never auto-reclaimed.
  // After a short grace period it fails bounded with explicit cleanup rather
  // than waiting forever or deleting a lock it cannot identify.
  const malformedRecoveryKey = 'direction-malformed-recovery-lock';
  const malformedPrimary = path.join(root, `.agents/state/human-direction-${malformedRecoveryKey}.lock`);
  const malformedRecovery = `${malformedPrimary}.recovery`;
  await fs.writeFile(malformedPrimary, `${JSON.stringify({ pid: 99999999, attempt_id: 'dead-owner' })}\n`);
  await fs.writeFile(malformedRecovery, '');
  const old = new Date(Date.now() - 5000);
  await fs.utimes(malformedRecovery, old, old);
  const malformedRecoveryRun = spawnSync(process.execPath, [runner, malformedRecoveryKey], {
    input: 'proposal', encoding: 'utf8', env, timeout: 3000,
  });
  assert.equal(malformedRecoveryRun.status, 1);
  assert.match(malformedRecoveryRun.stderr, /stale recovery lock requires explicit cleanup/);
  assert.equal(malformedRecoveryRun.signal, null, 'runner must fail before the test timeout');
  const malformedRecoveryAttempts = (await fs.readFile(path.join(root, `.agents/state/human-direction-${malformedRecoveryKey}.result.jsonl`), 'utf8')).trim().split('\n');
  assert.equal(malformedRecoveryAttempts.length, 1);
  assert.equal(JSON.parse(malformedRecoveryAttempts[0]).human_direction_attempt_v1.result, 'transient_failure');
  await fs.rm(malformedPrimary, { force: true });
  await fs.rm(malformedRecovery, { force: true });

  // If this process creates the recovery mutex but cannot initialize its
  // owner record, it closes and removes only its own new mutex.
  const recoveryInitKey = 'direction-recovery-init-failure';
  const recoveryInitPrimary = path.join(root, `.agents/state/human-direction-${recoveryInitKey}.lock`);
  await fs.writeFile(recoveryInitPrimary, `${JSON.stringify({ pid: 99999999, attempt_id: 'dead-owner' })}\n`);
  const recoveryInitRun = spawnSync(process.execPath, [runner, recoveryInitKey], {
    input: 'proposal', encoding: 'utf8', env: { ...env, HDP_TEST_RECOVERY_LOCK_INIT_FAILURE: '1' }, timeout: 3000,
  });
  assert.equal(recoveryInitRun.status, 1);
  assert.match(recoveryInitRun.stderr, /injected recovery lock owner-write failure/);
  const recoveryInitAttempts = (await fs.readFile(path.join(root, `.agents/state/human-direction-${recoveryInitKey}.result.jsonl`), 'utf8')).trim().split('\n');
  assert.equal(recoveryInitAttempts.length, 1);
  await assert.rejects(fs.access(`${recoveryInitPrimary}.recovery`));
  await fs.rm(recoveryInitPrimary, { force: true });
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
console.log('human direction proxy runner tests passed');
