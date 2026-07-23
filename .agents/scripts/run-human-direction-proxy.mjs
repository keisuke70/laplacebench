#!/usr/bin/env node

import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildHumanDirectionContext } from './build-human-direction-context.mjs';
import { mergeResumeDelta, validatePayloadDetailed, validPersistedState } from './human-direction-proxy-validation.mjs';

const usage = `Usage: bash .agents/scripts/run-human-direction-proxy.sh <session-key> [--fresh]

Reads a short requirement/proposal or author reply from stdin. Prints only the
Proxy's natural-language utterance; hidden state and metrics are persisted.`;
const rawSessionKey = process.argv[2] ?? '';
if (!rawSessionKey || ['-h', '--help'].includes(rawSessionKey)) {
  console.log(usage);
  process.exit(rawSessionKey ? 0 : 2);
}
if (process.env.HUMAN_DIRECTION_PROXY_ACTIVE === '1') {
  console.error('[run-human-direction-proxy] nested proxy runner blocked');
  process.exit(9);
}

const PROVIDERS = ['claude', 'codex'];
const CLAUDE_MODEL = 'fable';
const CLAUDE_EFFORT = 'medium';
const CODEX_REASONING_EFFORT = 'high';
const freshOnly = process.argv.includes('--fresh');
const providerMode = process.env.HUMAN_DIRECTION_PROVIDER ?? 'auto';
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const sourceRepoRoot = path.resolve(scriptDir, '..');
const projectRepoRoot = path.resolve(scriptDir, '..', '..');
const repoRoot = process.env.HUMAN_DIRECTION_REPO_ROOT
  ? path.resolve(process.env.HUMAN_DIRECTION_REPO_ROOT)
  : existsSync(path.join(sourceRepoRoot, 'sync.sh')) && existsSync(path.join(sourceRepoRoot, 'skills'))
    ? sourceRepoRoot
    : projectRepoRoot;
const stateDir = path.join(repoRoot, '.agents', 'state');
const schemaPath = path.join(scriptDir, 'human-direction-proxy-schema.json');
const resumeSchemaPath = path.join(scriptDir, 'human-direction-proxy-resume-schema.json');

const hash = (value) => createHash('sha256').update(value).digest('hex');
const sanitize = (value) => value.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
const sessionKey = sanitize(rawSessionKey);
if (!sessionKey) throw new Error('stable session-key is required');
const workItemId = sanitize(process.env.HUMAN_DIRECTION_WORK_ITEM_ID ?? sessionKey.replace(/^direction-/, ''));
const sessionFile = path.join(stateDir, `human-direction-${sessionKey}.session`);
const stateFile = path.join(stateDir, `human-direction-${sessionKey}.state.json`);
const resultFile = path.join(stateDir, `human-direction-${sessionKey}.result.json`);
const metricsFile = path.join(stateDir, `human-direction-${sessionKey}.result.jsonl`);
const lockFile = path.join(stateDir, `human-direction-${sessionKey}.lock`);
const recoveryLockFile = `${lockFile}.recovery`;
const positiveInt = (name, fallback) => {
  const value = Number.parseInt(process.env[name] ?? fallback, 10);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
};
let perTurnTimeoutMs = 120000;

async function stdin() {
  let value = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) value += chunk;
  return value;
}

function object(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function extractEnvelope(envelope, previous, payloadMode) {
  const values = [envelope?.structured_output, envelope?.result];
  let rawPayload = null;
  let validationReason = 'schema-invalid';
  for (let value of values) {
    if (typeof value === 'string') {
      try { value = JSON.parse(value); } catch { continue; }
    }
    if (!object(value)) continue;
    if (!rawPayload && object(value)) rawPayload = value;
    const validation = payloadMode === 'delta'
      ? mergeResumeDelta(value, previous)
      : validatePayloadDetailed(value, previous);
    if (validation.ok) return { envelope, payload: validation.payload, rawPayload: value, validationReason: null };
    validationReason = validation.reason;
  }
  return { envelope, payload: null, rawPayload, validationReason };
}

function skillPath() {
  const candidates = [
    path.join(repoRoot, '.claude/skills/human-direction-proxy/SKILL.md'),
    path.join(repoRoot, '.agents/skills/human-direction-proxy/SKILL.md'),
    path.join(repoRoot, 'skills/claude/human-direction-proxy/SKILL.md'),
  ];
  return candidates.find(existsSync) ?? null;
}

function resolveCommand(envName, command) {
  if (process.env[envName]) return process.env[envName];
  const extensions = process.platform === 'win32'
    ? (process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';')
    : [''];
  for (const entry of (process.env.PATH ?? '').split(path.delimiter).filter(Boolean)) {
    for (const extension of extensions) {
      const candidate = path.join(entry, `${command}${extension.toLowerCase()}`);
      if (existsSync(candidate)) return candidate;
    }
  }
  return command;
}

async function spawnProvider(command, args, prompt) {
  const startedAt = Date.now();
  let child;
  try {
    child = spawn(command, args, {
      cwd: repoRoot,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      env: { ...process.env, HUMAN_DIRECTION_PROXY_ACTIVE: '1' },
    });
  } catch (spawnError) {
    return { exitCode: 1, stdout: '', stderr: '', spawnError, timedOut: false, elapsedMs: Date.now() - startedAt };
  }
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill('SIGKILL');
  }, perTurnTimeoutMs);
  const completion = new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    child.on('error', (spawnError) => finish({ exitCode: 1, spawnError }));
    child.on('close', (exitCode) => finish({ exitCode: exitCode ?? 1, spawnError: null }));
  });
  child.stdin.on('error', () => {});
  child.stdin.end(prompt);
  const completed = await completion;
  clearTimeout(timer);
  return { ...completed, stdout, stderr, timedOut, elapsedMs: Date.now() - startedAt };
}

function parseJson(value) {
  try { return JSON.parse(value); } catch { return null; }
}

async function runClaude(prompt, resumeId, outputSchemaPath) {
  const schema = (await fs.readFile(outputSchemaPath, 'utf8')).trim();
  const id = resumeId ?? randomUUID();
  const args = [
    '-p',
    '--model', CLAUDE_MODEL,
    '--effort', CLAUDE_EFFORT,
    '--output-format', 'json',
    '--json-schema', schema,
    '--tools', '',
  ];
  if (resumeId) args.push('--resume', resumeId);
  else args.push('--session-id', id);
  const run = await spawnProvider(resolveCommand('HUMAN_DIRECTION_CLAUDE_BIN', 'claude'), args, prompt);
  const envelope = parseJson(run.stdout);
  const explicitEnvelopeError = object(envelope) && (envelope.is_error === true || envelope.type === 'error' || Boolean(envelope.error));
  const rawUsage = envelope?.usage;
  const normalizedUsage = rawUsage && Number.isFinite(rawUsage.input_tokens) && Number.isFinite(rawUsage.output_tokens)
    ? {
        input_tokens: rawUsage.input_tokens
          + (Number.isFinite(rawUsage.cache_creation_input_tokens) ? rawUsage.cache_creation_input_tokens : 0)
          + (Number.isFinite(rawUsage.cache_read_input_tokens) ? rawUsage.cache_read_input_tokens : 0),
        cached_input_tokens: Number.isFinite(rawUsage.cache_read_input_tokens) ? rawUsage.cache_read_input_tokens : 0,
        output_tokens: rawUsage.output_tokens,
      }
    : null;
  const responseGenerated = Boolean(envelope?.structured_output)
    || Boolean(!explicitEnvelopeError && typeof envelope?.result === 'string' && envelope.result.trim());
  return {
    ...run,
    provider: 'claude',
    providerSessionId: envelope?.session_id ?? id,
    envelope,
    usage: normalizedUsage,
    modelIds: Object.keys(envelope?.modelUsage ?? {}),
    responseGenerated,
    toolCalls: 0,
  };
}

function parseCodexLog(stdout) {
  let threadId = null;
  let lastMessage = '';
  let responseGenerated = false;
  let toolCalls = 0;
  const usage = { input_tokens: 0, cached_input_tokens: 0, output_tokens: 0 };
  let usageEvents = 0;
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const event = parseJson(line);
    if (!event) continue;
    if (event.type === 'thread.started' && typeof event.thread_id === 'string') threadId = event.thread_id;
    if (event.type === 'item.completed' && event.item?.type === 'agent_message' && typeof event.item.text === 'string') {
      responseGenerated = true;
      lastMessage = event.item.text;
    }
    if (event.type === 'item.started' && event.item?.type && !['agent_message', 'reasoning'].includes(event.item.type)) toolCalls += 1;
    if (event.type === 'turn.completed' && object(event.usage)) {
      if (Number.isFinite(event.usage.input_tokens) && Number.isFinite(event.usage.output_tokens)) {
        usage.input_tokens += event.usage.input_tokens;
        usage.cached_input_tokens += Number.isFinite(event.usage.cached_input_tokens) ? event.usage.cached_input_tokens : 0;
        usage.output_tokens += event.usage.output_tokens;
        usageEvents += 1;
      }
    }
  }
  return { threadId, lastMessage, responseGenerated, toolCalls, usage: usageEvents ? usage : null };
}

async function runCodex(prompt, resumeId, outputSchemaPath) {
  const args = ['-a', 'never', '-C', repoRoot];
  args.push(
    '-c', `model_reasoning_effort="${CODEX_REASONING_EFFORT}"`,
    '--enable', 'fast_mode',
    'exec', '--ignore-user-config', '--ignore-rules', '-s', 'read-only',
  );
  if (resumeId) args.push('resume', '--json', '--output-schema', outputSchemaPath, resumeId, '-');
  else args.push('--json', '--output-schema', outputSchemaPath, '-');
  const run = await spawnProvider(resolveCommand('HUMAN_DIRECTION_CODEX_BIN', 'codex'), args, prompt);
  const parsed = parseCodexLog(run.stdout);
  const sessionIdentityError = run.exitCode === 0 && (
    !parsed.threadId
    || (resumeId && parsed.threadId !== resumeId)
  )
    ? (resumeId ? 'Codex resume returned a missing or different thread id' : 'Codex fresh call returned no thread id')
    : null;
  const envelope = {
    session_id: parsed.threadId ?? resumeId,
    structured_output: parsed.lastMessage,
    usage: parsed.usage,
  };
  return {
    ...run,
    provider: 'codex',
    providerSessionId: parsed.threadId,
    envelope,
    usage: parsed.usage,
    modelIds: ['codex-cli-default'],
    responseGenerated: parsed.responseGenerated,
    toolCalls: parsed.toolCalls,
    sessionIdentityError,
  };
}

async function runProvider(provider, prompt, resumeId, outputSchemaPath, { phase, promptMode }) {
  const run = provider === 'claude'
    ? await runClaude(prompt, resumeId, outputSchemaPath)
    : await runCodex(prompt, resumeId, outputSchemaPath);
  return { ...run, phase, promptMode, promptBytes: Buffer.byteLength(prompt, 'utf8'), outputSchemaPath };
}

function resettableSessionFailure(run) {
  return run.exitCode !== 0 && /no conversation found|session .*not found|unknown session|invalid session|failed to load session|unable to resume|could not resume/i.test(`${run.stderr}\n${run.stdout}`);
}

function accountProviderUsage(run, metadata) {
  if (!run.usage) return;
  if (run.provider === 'claude') {
    const current = structuredClone(run.usage);
    run.accountingRecord = {
      provider: 'claude',
      mode: 'per_turn',
      prior_raw_total: null,
      current_raw_total: current,
      normalized_delta: structuredClone(current),
      reason: null,
    };
    return;
  }
  const raw = {
    input_tokens: run.usage.input_tokens,
    cached_input_tokens: run.usage.cached_input_tokens ?? 0,
    output_tokens: run.usage.output_tokens,
  };
  const prior = run.resumed ? metadata.provider_usage_totals.codex : null;
  let delta = raw;
  if (prior) {
    delta = {
      input_tokens: raw.input_tokens - prior.input_tokens,
      cached_input_tokens: raw.cached_input_tokens - prior.cached_input_tokens,
      output_tokens: raw.output_tokens - prior.output_tokens,
    };
    if (!Object.values(delta).every((value) => Number.isFinite(value) && value >= 0)) {
      run.usage = null;
      run.accountingError = 'provider cumulative usage regressed below persisted baseline';
      return;
    }
  }
  run.usage = delta;
  run.accountingRecord = {
    provider: 'codex',
    mode: prior ? 'thread_cumulative_delta' : 'fresh_total',
    prior_raw_total: prior ? structuredClone(prior) : null,
    current_raw_total: structuredClone(raw),
    normalized_delta: structuredClone(delta),
    reason: null,
  };
  metadata.provider_usage_totals.codex = raw;
}

async function runWithResumeRecovery(provider, freshPrompt, resumePrompt, resumeId, runs, metadata, { schema, phase, freshMode = 'full' }) {
  let run = await runProvider(provider, resumeId ? resumePrompt : freshPrompt, resumeId, schema, {
    phase, promptMode: resumeId ? 'compact' : freshMode,
  });
  run.resumed = Boolean(resumeId);
  accountProviderUsage(run, metadata);
  runs.push(run);
  if (resumeId && resettableSessionFailure(run)) {
    if (provider === 'codex') metadata.provider_usage_totals.codex = null;
    run = await runProvider(provider, freshPrompt, null, schema, { phase: 'resume_recovery', promptMode: 'reconstruction' });
    run.resumed = false;
    accountProviderUsage(run, metadata);
    run.resetFromMissingSession = true;
    runs.push(run);
  }
  return run;
}

function trustedClaudeError(run) {
  const envelope = parseJson(run.stdout);
  const pieces = [run.stderr];
  const explicitEnvelopeError = object(envelope) && (envelope.is_error === true || envelope.type === 'error' || Boolean(envelope.error));
  if (explicitEnvelopeError) {
    if (typeof envelope.result === 'string') pieces.push(envelope.result);
    if (typeof envelope.code === 'string') pieces.push(envelope.code);
    if (typeof envelope.error === 'string') pieces.push(envelope.error);
    if (typeof envelope.error?.code === 'string') pieces.push(envelope.error.code);
    if (typeof envelope.error?.type === 'string') pieces.push(envelope.error.type);
    if (typeof envelope.error?.message === 'string') pieces.push(envelope.error.message);
  }
  return { text: pieces.join('\n'), explicitEnvelopeError };
}

function eligibleClaudeFallback(run) {
  if (run.responseGenerated) return false;
  if (run.spawnError?.code === 'ENOENT') return true;
  if (run.timedOut) return false;
  const trusted = trustedClaudeError(run);
  if (run.exitCode === 0 && !trusted.explicitEnvelopeError) return false;
  const trustedCapacityFailure = /usage\s*limit|rate\s*limit|quota\s+(?:exhausted|exceeded|reached)|service\s+(?:at\s+)?capacity|capacity\s+(?:reached|unavailable)|overloaded|(?:http\s*|status\s*|error(?:\s+code)?\s*)429|you(?:'|’)ve\s+hit\s+your\s+(?:usage\s+)?limit/i.test(trusted.text);
  const selectedModelUnavailable = /\bmodel_not_found\b|\b(?:fable(?:\s+\d+)?|claude-fable-[a-z0-9._-]+)\b[^\r\n]{0,80}\b(?:not\s+available|unavailable)\b/i.test(trusted.text);
  return trustedCapacityFailure || selectedModelUnavailable;
}

function emptyProviderMetadata() {
  return {
    schema_version: 'human_direction_provider_session_v1',
    session_key: sessionKey,
    active_provider: null,
    provider_sessions: { claude: null, codex: null },
    provider_usage_totals: { codex: null },
    providers_used: [],
    fallback_count: 0,
  };
}

function validSessionMetadata(value) {
  if (!object(value) || value.schema_version !== 'human_direction_provider_session_v1' || value.session_key !== sessionKey) return false;
  if (!PROVIDERS.includes(value.active_provider) || !object(value.provider_sessions)) return false;
  if (Object.keys(value.provider_sessions).sort().join() !== 'claude,codex') return false;
  if (!PROVIDERS.every((provider) => value.provider_sessions[provider] === null || (typeof value.provider_sessions[provider] === 'string' && value.provider_sessions[provider].trim()))) return false;
  if (!object(value.provider_usage_totals) || Object.keys(value.provider_usage_totals).join() !== 'codex') return false;
  const codexUsage = value.provider_usage_totals.codex;
  if (codexUsage !== null && (!object(codexUsage) || !['input_tokens', 'cached_input_tokens', 'output_tokens'].every((key) => Number.isFinite(codexUsage[key]) && codexUsage[key] >= 0))) return false;
  if (!Array.isArray(value.providers_used) || value.providers_used.length === 0 || new Set(value.providers_used).size !== value.providers_used.length) return false;
  if (!value.providers_used.every((provider) => PROVIDERS.includes(provider)) || !value.providers_used.includes(value.active_provider)) return false;
  return Number.isInteger(value.fallback_count) && value.fallback_count >= 0;
}

function metadataFromState(state) {
  return {
    schema_version: 'human_direction_provider_session_v1',
    session_key: sessionKey,
    active_provider: state.active_provider,
    provider_sessions: structuredClone(state.provider_sessions),
    provider_usage_totals: structuredClone(state.provider_usage_totals),
    providers_used: [...state.providers_used],
    fallback_count: state.fallback_count,
  };
}

function metadataMatchesState(metadata, state) {
  return metadata.active_provider === state.active_provider
    && JSON.stringify(metadata.provider_sessions) === JSON.stringify(state.provider_sessions)
    && JSON.stringify(metadata.provider_usage_totals) === JSON.stringify(state.provider_usage_totals)
    && JSON.stringify(metadata.providers_used) === JSON.stringify(state.providers_used)
    && metadata.fallback_count === state.fallback_count;
}

function addProvider(metadata, provider) {
  if (!metadata.providers_used.includes(provider)) metadata.providers_used.push(provider);
  metadata.active_provider = provider;
}

function providerStateFields(metadata) {
  return {
    active_provider: metadata.active_provider,
    provider_sessions: structuredClone(metadata.provider_sessions),
    provider_usage_totals: structuredClone(metadata.provider_usage_totals),
    providers_used: [...metadata.providers_used],
    fallback_count: metadata.fallback_count,
  };
}

async function atomicWriteText(target, text) {
  const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}.${randomUUID()}.tmp`);
  let handle;
  try {
    handle = await fs.open(temporary, 'wx');
    await handle.writeFile(text, 'utf8');
    await handle.sync();
    await handle.close();
    handle = null;
    await fs.rename(temporary, target);
    try {
      const directory = await fs.open(path.dirname(target), 'r');
      await directory.sync();
      await directory.close();
    } catch {}
  } finally {
    if (handle) await handle.close().catch(() => {});
    await fs.rm(temporary, { force: true }).catch(() => {});
  }
}

const zeroTokens = () => ({ input_tokens: 0, cached_input_tokens: 0, output_tokens: 0 });
let attemptStarted = false;
let attemptFinalized = false;
let attemptId = null;
let sessionLockHandle = null;
let attemptAppendFaultInjected = false;
let runs = [];
let activeProvider = null;
let attemptFallbackCount = 0;
let attemptPromptMode = 'none';
let attemptPromptBytes = 0;
let attemptContextBytes = 0;
let validationReason = null;
let repairAttempted = false;
let repairSucceeded = false;

function runAccounting(run) {
  return run.accountingRecord ?? {
    provider: run.provider,
    mode: 'unavailable',
    prior_raw_total: null,
    current_raw_total: null,
    normalized_delta: zeroTokens(),
    reason: run.accountingError ?? 'provider token accounting unavailable',
  };
}

function processAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return error?.code === 'EPERM'; }
}

async function acquireSessionLock() {
  while (!sessionLockHandle) {
    try {
      sessionLockHandle = await fs.open(lockFile, 'wx');
      await sessionLockHandle.writeFile(`${JSON.stringify({ pid: process.pid, attempt_id: attemptId, acquired_at: new Date().toISOString() })}\n`);
      await sessionLockHandle.sync();
      return;
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      let owner = null;
      let ageMs = 0;
      try {
        owner = JSON.parse(await fs.readFile(lockFile, 'utf8'));
        ageMs = Date.now() - (await fs.stat(lockFile)).mtimeMs;
      } catch {}
      if ((owner && !processAlive(owner.pid)) || (!owner && ageMs > 1000)) await recoverStaleSessionLock();
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
}

async function readLockOwner(target) {
  try { return JSON.parse(await fs.readFile(target, 'utf8')); } catch { return null; }
}

async function acquireRecoveryLock() {
  while (true) {
    let handle = null;
    try {
      handle = await fs.open(recoveryLockFile, 'wx');
      if (process.env.HDP_TEST_RECOVERY_LOCK_INIT_FAILURE === '1') throw new Error('injected recovery lock owner-write failure');
      await handle.writeFile(`${JSON.stringify({ pid: process.pid, attempt_id: attemptId, acquired_at: new Date().toISOString() })}\n`);
      await handle.sync();
      return handle;
    } catch (error) {
      if (handle) {
        await handle.close().catch(() => {});
        await fs.rm(recoveryLockFile, { force: true }).catch(() => {});
        throw error;
      }
      if (error?.code !== 'EEXIST') throw error;
      const owner = await readLockOwner(recoveryLockFile);
      let ageMs = 0;
      try { ageMs = Date.now() - (await fs.stat(recoveryLockFile)).mtimeMs; } catch { continue; }
      if ((owner && !processAlive(owner.pid)) || (!owner && ageMs > 1000)) {
        throw new Error(`stale recovery lock requires explicit cleanup: ${recoveryLockFile}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
}

async function recoverStaleSessionLock() {
  const recoveryHandle = await acquireRecoveryLock();
  try {
    const owner = await readLockOwner(lockFile);
    let ageMs = 0;
    try { ageMs = Date.now() - (await fs.stat(lockFile)).mtimeMs; } catch { return; }
    if ((owner && processAlive(owner.pid)) || (!owner && ageMs <= 1000)) return;
    await fs.rm(lockFile, { force: true });
    try {
      sessionLockHandle = await fs.open(lockFile, 'wx');
      await sessionLockHandle.writeFile(`${JSON.stringify({ pid: process.pid, attempt_id: attemptId, acquired_at: new Date().toISOString() })}\n`);
      await sessionLockHandle.sync();
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      sessionLockHandle = null;
    }
  } finally {
    await recoveryHandle.close().catch(() => {});
    await fs.rm(recoveryLockFile, { force: true });
  }
}

async function releaseSessionLock() {
  if (!sessionLockHandle) return;
  const handle = sessionLockHandle;
  sessionLockHandle = null;
  await handle.close().catch(() => {});
  await fs.rm(lockFile, { force: true });
}

async function attemptAlreadyAppended() {
  try {
    for (const line of (await fs.readFile(metricsFile, 'utf8')).split('\n')) {
      if (!line.trim()) continue;
      try {
        if (JSON.parse(line)?.human_direction_attempt_v1?.attempt_id === attemptId) return true;
      } catch {}
    }
  } catch {}
  return false;
}

async function appendAttemptDurably(line) {
  for (let tryIndex = 0; tryIndex < 2; tryIndex += 1) {
    if (await attemptAlreadyAppended()) return;
    let handle;
    let priorSize = 0;
    try {
      try { priorSize = (await fs.stat(metricsFile)).size; } catch {}
      handle = await fs.open(metricsFile, 'a');
      await handle.writeFile(line, 'utf8');
      await handle.sync();
      await handle.close();
      handle = null;
      if (process.env.HDP_TEST_ATTEMPT_APPEND_FAILURE === 'after-write-once' && !attemptAppendFaultInjected) {
        attemptAppendFaultInjected = true;
        throw new Error('injected attempt append failure after write');
      }
      return;
    } catch (error) {
      if (handle) await handle.close().catch(() => {});
      if (await attemptAlreadyAppended()) return;
      await fs.truncate(metricsFile, priorSize).catch(() => {});
      if (tryIndex === 1) throw error;
    }
  }
}

async function finalizeAttempt(result, decision = null) {
  if (!attemptStarted || attemptFinalized) return;
  const providerRuns = runs.map((run, index) => {
    const accounting = runAccounting(run);
    return {
      run_index: index + 1,
      provider: run.provider,
      phase: run.phase,
      exit_code: run.exitCode,
      timed_out: Boolean(run.timedOut),
      session_id: run.providerSessionId ?? null,
      session_identity_error: run.sessionIdentityError ?? null,
      resumed: Boolean(run.resumed),
      elapsed_ms: run.elapsedMs,
      prompt_mode: run.promptMode,
      prompt_bytes: run.promptBytes,
      accounting_mode: accounting.mode,
      normalized_delta: accounting.normalized_delta,
      accounting_gap_reason: accounting.reason,
    };
  });
  const total = providerRuns.reduce((sum, run) => ({
    input_tokens: sum.input_tokens + run.normalized_delta.input_tokens,
    cached_input_tokens: sum.cached_input_tokens + run.normalized_delta.cached_input_tokens,
    output_tokens: sum.output_tokens + run.normalized_delta.output_tokens,
  }), zeroTokens());
  const gaps = providerRuns.filter((run) => run.accounting_gap_reason).map((run) => `run ${run.run_index}: ${run.accounting_gap_reason}`);
  const providersUsed = [...new Set(providerRuns.map((run) => run.provider))];
  const attemptEvent = {
    human_direction_attempt_v1: {
      attempt_id: attemptId,
      session_key: sessionKey,
      work_item_id: workItemId,
      occurred_at: new Date().toISOString(),
      result,
      decision: result === 'completed' ? decision : null,
      prompt_mode: attemptPromptMode,
      prompt_bytes: attemptPromptBytes,
      context_bytes: attemptContextBytes,
      validation_reason: validationReason,
      repair_attempted: repairAttempted,
      repair_succeeded: repairSucceeded,
      active_provider: activeProvider,
      providers_used: providersUsed,
      fallback_count: attemptFallbackCount,
      duration_ms: providerRuns.reduce((sum, run) => sum + run.elapsed_ms, 0),
      input_tokens: total.input_tokens,
      cached_input_tokens: total.cached_input_tokens,
      output_tokens: total.output_tokens,
      accounting_status: providerRuns.length === 0 ? 'not_started' : gaps.length ? 'partial' : 'complete',
      accounting_gap_reason: gaps.length ? gaps.join('; ') : null,
      provider_runs: providerRuns,
    },
  };
  await appendAttemptDurably(`${JSON.stringify(attemptEvent)}\n`);
  attemptFinalized = true;
}

async function outcome(exitCode, result, { decision = null, stdout = '', stderr = '' } = {}) {
  await finalizeAttempt(result, decision);
  await releaseSessionLock();
  if (stderr) console.error(stderr);
  return { exitCode, stdout };
}

async function stateLost(reason, details = {}) {
  validationReason ??= details.validation_reason ?? null;
  await atomicWriteText(resultFile, `${JSON.stringify({ result: 'STATE_LOST', reason, ...details }, null, 2)}\n`);
  return outcome(8, 'state_lost', { stderr: `[run-human-direction-proxy] STATE_LOST: ${reason}` });
}

async function execute() {
  await fs.mkdir(stateDir, { recursive: true });
  attemptStarted = true;
  attemptId = randomUUID();
  await acquireSessionLock();

  const authorText = await stdin();
  if (!authorText.trim()) return outcome(2, 'preflight_rejected', { stderr: 'proposal or author reply must be provided on stdin' });
  if (!['auto', ...PROVIDERS].includes(providerMode)) {
    return outcome(2, 'preflight_rejected', { stderr: '[run-human-direction-proxy] HUMAN_DIRECTION_PROVIDER must be auto, claude, or codex' });
  }
  try { perTurnTimeoutMs = positiveInt('HUMAN_DIRECTION_TURN_TIMEOUT_MS', '120000'); } catch (error) {
    return outcome(2, 'preflight_rejected', { stderr: `[run-human-direction-proxy] ${error.message}` });
  }
  if (freshOnly) {
    await Promise.all([fs.rm(sessionFile, { force: true }), fs.rm(stateFile, { force: true }), fs.rm(resultFile, { force: true })]);
  }

  let previous = null;
  const stateFileExists = existsSync(stateFile);
  try { previous = JSON.parse(await fs.readFile(stateFile, 'utf8')); } catch {}
  if (stateFileExists && !previous) return stateLost('persisted state is unreadable', { validation_reason: 'immutable-state-corrupt' });
  if (previous?.result === 'STATE_LOST') return stateLost(previous.state_lost_reason ?? 'persisted state is not resumable', { validation_reason: 'immutable-state-corrupt' });
  if (previous && (!validPersistedState(previous, { sessionKey, workItemId })
    || previous.transcript_hash !== hash(JSON.stringify(previous.transcript))
    || previous.decision_context_hash !== hash(JSON.stringify(previous.context)))) {
    return stateLost('persisted resume bundle is missing or corrupt', { validation_reason: 'immutable-state-corrupt' });
  }
  if (previous?.result?.startsWith('COMPLETED_')) {
    return outcome(2, 'preflight_rejected', { stderr: '[run-human-direction-proxy] dialogue is already completed; use a new session-key for a new direction' });
  }

  let sessionMetadata = null;
  const sessionFileExists = existsSync(sessionFile);
  try { sessionMetadata = JSON.parse(await fs.readFile(sessionFile, 'utf8')); } catch {}
  if (sessionFileExists && !validSessionMetadata(sessionMetadata)) {
    if (!previous) return stateLost('provider session metadata is unreadable or corrupt', { validation_reason: 'immutable-state-corrupt' });
    sessionMetadata = metadataFromState(previous);
  }
  if (sessionMetadata && !previous) return stateLost('provider session exists without hidden state', { validation_reason: 'immutable-state-corrupt' });
  if (sessionMetadata && previous && !metadataMatchesState(sessionMetadata, previous)) sessionMetadata = metadataFromState(previous);
  if (!sessionMetadata) sessionMetadata = previous ? metadataFromState(previous) : emptyProviderMetadata();

  const cumulative = previous?.cumulative ?? { duration_ms: 0, input_tokens: 0, cached_input_tokens: 0, output_tokens: 0, turns: 0 };
  const resolvedSkillPath = skillPath();
  if (!resolvedSkillPath) return outcome(2, 'preflight_rejected', { stderr: '[run-human-direction-proxy] human-direction-proxy skill not found' });
  const [skill, context, runnerSource, retrievalSource] = await Promise.all([
    fs.readFile(resolvedSkillPath, 'utf8'),
    previous?.context ?? buildHumanDirectionContext(repoRoot, authorText),
    fs.readFile(fileURLToPath(import.meta.url)),
    fs.readFile(path.join(scriptDir, 'build-human-direction-context.mjs')),
  ]);
  attemptContextBytes = Buffer.byteLength(JSON.stringify(context), 'utf8');
  const transcript = [...(previous?.transcript ?? []), { role: 'author', text: authorText.trim() }];
  const payloadMode = previous ? 'delta' : 'full';
  const outputSchema = previous ? resumeSchemaPath : schemaPath;
  const prompt = `${skill}\n\nYou are running through the Human Direction Proxy runner.\n- Speak to the author in the short natural-language utterance.\n- Keep IDs and projection fields hidden; never mention them in the utterance.\n- On continuation, return mutable updates for every prior open tension exactly once; never restate resolved tensions.\n- Do not use tools. Ask the author for targeted evidence when facts matter.\n\nWORK ITEM: ${workItemId}\n\nORIGINAL PROPOSAL\n${previous?.proposal ?? authorText.trim()}\n\nDIRECTION CONTEXT\n${JSON.stringify(context)}\n\nPRIOR HIDDEN STATE\n${JSON.stringify(previous?.projection ?? null)}\n\nTRANSCRIPT\n${transcript.map((turn) => `${turn.role.toUpperCase()}: ${turn.text}`).join('\n')}\n`;
  const compactResumePrompt = `Continue the same Human Direction Proxy dialogue using native session history. Return only the next resume-delta payload: update every previously open tension ID exactly once, omit resolved tensions, and add only genuinely new tensions. React briefly to the latest author reply. Do not use tools.\n\nLATEST AUTHOR REPLY\n${authorText.trim()}`;

  activeProvider = providerMode === 'auto' ? (sessionMetadata.active_provider ?? 'claude') : providerMode;
  const providerChanged = Boolean(previous?.active_provider && previous.active_provider !== activeProvider);
  addProvider(sessionMetadata, activeProvider);
  const nativeResumeId = providerChanged ? null : sessionMetadata.provider_sessions[activeProvider];
  attemptPromptMode = nativeResumeId ? 'compact' : previous ? 'reconstruction' : 'full';
  attemptPromptBytes = Buffer.byteLength(nativeResumeId ? compactResumePrompt : prompt, 'utf8');
  let result = await runWithResumeRecovery(
    activeProvider, prompt, compactResumePrompt, nativeResumeId, runs, sessionMetadata,
    { schema: outputSchema, phase: 'main', freshMode: previous ? 'reconstruction' : 'full' },
  );
  if (result.resetFromMissingSession && result.exitCode !== 0) sessionMetadata.provider_sessions[activeProvider] = null;
  else if (result.exitCode === 0 && !result.sessionIdentityError && result.providerSessionId) sessionMetadata.provider_sessions[activeProvider] = result.providerSessionId;
  if (providerMode === 'auto' && activeProvider === 'claude' && eligibleClaudeFallback(result)) {
    sessionMetadata.fallback_count += 1;
    attemptFallbackCount += 1;
    activeProvider = 'codex';
    addProvider(sessionMetadata, activeProvider);
    sessionMetadata.provider_usage_totals.codex = null;
    result = await runWithResumeRecovery(
      activeProvider, prompt, compactResumePrompt, null, runs, sessionMetadata,
      { schema: outputSchema, phase: 'provider_fallback', freshMode: previous ? 'reconstruction' : 'full' },
    );
    if (result.resetFromMissingSession && result.exitCode !== 0) sessionMetadata.provider_sessions[activeProvider] = null;
    else if (result.exitCode === 0 && !result.sessionIdentityError && result.providerSessionId) sessionMetadata.provider_sessions[activeProvider] = result.providerSessionId;
  }

  let extracted = extractEnvelope(result.envelope, previous, payloadMode);
  let { payload, rawPayload } = extracted;
  validationReason = extracted.validationReason;
  if (result.toolCalls > 0 || result.sessionIdentityError) payload = null;
  if (result.exitCode === 0 && result.toolCalls === 0 && !result.sessionIdentityError && !payload && typeof rawPayload?.utterance === 'string' && rawPayload.utterance.trim()) {
    repairAttempted = true;
    const invalidProjection = previous ? { updates: rawPayload?.updates ?? null, new_tensions: rawPayload?.new_tensions ?? null } : rawPayload?.projection ?? null;
    const repairPrompt = `Projection repair only. Preserve the exact visible utterance and return a valid ${previous ? 'resume delta' : 'fresh hidden projection'}. Do not continue the dialogue, alter the utterance, or add a question. Do not use tools.\n\nVALIDATION REASON\n${validationReason}\n\nEXACT UTTERANCE\n${rawPayload.utterance.trim()}\n\nPRIOR HIDDEN STATE\n${JSON.stringify(previous?.projection ?? null)}\n\nTRANSCRIPT INCLUDING THE UTTERANCE\n${[...transcript, { role: 'proxy', text: rawPayload.utterance.trim() }].map((turn) => `${turn.role.toUpperCase()}: ${turn.text}`).join('\n')}\n\nINVALID PROJECTION\n${JSON.stringify(invalidProjection)}`;
    const repair = await runProvider(activeProvider, repairPrompt, result.providerSessionId, outputSchema, { phase: 'projection_repair', promptMode: 'reconstruction' });
    repair.resumed = Boolean(result.providerSessionId);
    accountProviderUsage(repair, sessionMetadata);
    runs.push(repair);
    if (!repair.sessionIdentityError && repair.providerSessionId) sessionMetadata.provider_sessions[activeProvider] = repair.providerSessionId;
    const repaired = extractEnvelope(repair.envelope, previous, payloadMode);
    validationReason = repaired.validationReason ?? validationReason;
    if (!repair.accountingError && repair.exitCode === 0 && repair.toolCalls === 0 && !repair.sessionIdentityError && repaired.payload
      && repaired.payload.utterance.trim() === rawPayload.utterance.trim()) {
      payload = repaired.payload;
      rawPayload = repaired.rawPayload;
      result = repair;
      repairSucceeded = true;
    }
  }
  const accountingIntegrityError = runs.find((run) => run.accountingError === 'provider cumulative usage regressed below persisted baseline')?.accountingError ?? null;
  if (accountingIntegrityError) validationReason = 'immutable-state-corrupt';
  if (result.exitCode !== 0 || !payload || result.toolCalls > 0 || result.sessionIdentityError || accountingIntegrityError) {
    const visibleUtterance = typeof rawPayload?.utterance === 'string' ? rawPayload.utterance.trim() : '';
    const recoveryTranscript = visibleUtterance ? [...transcript, { role: 'proxy', text: visibleUtterance }] : transcript;
    if (visibleUtterance) {
      const lostState = {
        schema_version: 'human_direction_state_v1', session_key: sessionKey, work_item_id: workItemId,
        proposal: previous?.proposal ?? authorText.trim(), result: 'STATE_LOST',
        state_lost_reason: accountingIntegrityError ?? result.sessionIdentityError ?? (result.toolCalls > 0 ? 'provider used tools' : 'hidden projection could not be reconstructed'),
        projection: previous?.projection ?? null, transcript: recoveryTranscript,
        transcript_hash: hash(JSON.stringify(recoveryTranscript)), context,
        decision_context_hash: hash(JSON.stringify(context)), cumulative,
        ...providerStateFields(sessionMetadata),
      };
      await atomicWriteText(stateFile, `${JSON.stringify(lostState, null, 2)}\n`);
    }
    await atomicWriteText(resultFile, `${JSON.stringify({
      result: visibleUtterance ? 'STATE_LOST' : 'TRANSIENT_RUNNER_FAILURE', provider: activeProvider,
      exit_code: result.exitCode,
      reason: accountingIntegrityError ?? result.sessionIdentityError ?? (result.toolCalls > 0 ? 'provider used tools' : (result.timedOut ? 'provider timed out' : 'provider failed')),
      validation_reason: validationReason, stderr: result.stderr.slice(-2000), recovery_transcript: recoveryTranscript,
      ...providerStateFields(sessionMetadata),
    }, null, 2)}\n`);
    return outcome(visibleUtterance ? 8 : 1, visibleUtterance ? 'state_lost' : 'transient_failure', {
      stderr: `[run-human-direction-proxy] failed; raw result saved to ${resultFile}`,
    });
  }

  const successfulRuns = runs.filter((run) => run.exitCode === 0 && !(run.provider === 'claude' && trustedClaudeError(run).explicitEnvelopeError));
  const visibleTranscript = [...transcript, { role: 'proxy', text: payload.utterance.trim() }];
  const turnAccountingRecords = runs.map((run) => ({ turn: cumulative.turns + 1, ...runAccounting(run) }));
  const accountingRecords = [...(previous?.accounting_records ?? []), ...turnAccountingRecords];
  const turnTotals = turnAccountingRecords.reduce((sum, record) => ({
    input_tokens: sum.input_tokens + record.normalized_delta.input_tokens,
    cached_input_tokens: sum.cached_input_tokens + record.normalized_delta.cached_input_tokens,
    output_tokens: sum.output_tokens + record.normalized_delta.output_tokens,
  }), zeroTokens());
  const nextCumulative = {
    duration_ms: cumulative.duration_ms + runs.reduce((sum, run) => sum + run.elapsedMs, 0),
    input_tokens: cumulative.input_tokens + turnTotals.input_tokens,
    cached_input_tokens: cumulative.cached_input_tokens + turnTotals.cached_input_tokens,
    output_tokens: cumulative.output_tokens + turnTotals.output_tokens,
    turns: cumulative.turns + 1,
  };
  const skillHash = hash(skill);
  const contextHash = hash(JSON.stringify(context));
  const schemaHash = hash(Buffer.concat([await fs.readFile(schemaPath), await fs.readFile(resumeSchemaPath)]));
  const modelIds = [...new Set(successfulRuns.flatMap((run) => run.modelIds))];
  const modelVersion = modelIds.length ? modelIds.sort().join(',') : 'cli-default-unreported';
  const methodVersion = `skill:${skillHash};runner-prompt:${hash(runnerSource)};schema:${schemaHash};providers:${sessionMetadata.providers_used.join(',')};model:${modelVersion};retrieval:${hash(retrievalSource)}`;
  const storedResult = payload.result;
  const committedProjection = payload.projection;
  const providerFields = providerStateFields(sessionMetadata);
  const event = { direction_event_v1: {
    event_id: randomUUID(), work_item_id: workItemId, session_key: sessionKey, occurred_at: new Date().toISOString(),
    phase: 'direction', method: 'human_direction_proxy', method_version: methodVersion,
    decision: payload.projection.decision ?? 'INCOMPLETE', dialogue_status: storedResult.startsWith('COMPLETED_') ? 'completed' : 'open',
    tensions: committedProjection.tensions.map(({ id, families, question, context_refs, author_position, outcome, effect, requested_evidence }) => ({
      id, families, question, context_refs, author_position, outcome, effect, requested_evidence,
    })),
    duration_ms: nextCumulative.duration_ms, input_tokens: nextCumulative.input_tokens,
    cached_input_tokens: nextCumulative.cached_input_tokens, output_tokens: nextCumulative.output_tokens,
    tool_calls: 0, accounting_records: accountingRecords, active_provider: providerFields.active_provider,
    providers_used: providerFields.providers_used, fallback_count: providerFields.fallback_count,
  } };
  const nextState = {
    schema_version: 'human_direction_state_v1', session_key: sessionKey, work_item_id: workItemId,
    proposal: previous?.proposal ?? authorText.trim(), result: storedResult, projection: committedProjection,
    transcript: visibleTranscript, transcript_hash: hash(JSON.stringify(visibleTranscript)), context,
    decision_context_hash: contextHash, method_version: methodVersion, cumulative: nextCumulative,
    accounting_records: accountingRecords, ...providerFields, event,
  };
  // State is canonical. Persist it first, then its duplicate provider-session
  // cache, then the human-facing result. A crash between files is recoverable:
  // the next invocation reconstructs a corrupt/mismatched session cache from
  // the hash-validated state instead of accepting the cache as an authority.
  await atomicWriteText(stateFile, `${JSON.stringify(nextState, null, 2)}\n`);
  await atomicWriteText(sessionFile, `${JSON.stringify(sessionMetadata, null, 2)}\n`);
  await atomicWriteText(resultFile, `${JSON.stringify({
    exit_code: result.exitCode, provider_session_id: sessionMetadata.provider_sessions[activeProvider], ...nextState,
  }, null, 2)}\n`);
  return outcome(0, storedResult.startsWith('COMPLETED_') ? 'completed' : 'awaiting_author', {
    decision: payload.projection.decision, stdout: `${payload.utterance.trim()}\n`,
  });
}

let finalOutcome;
try {
  finalOutcome = await execute();
} catch (error) {
  if (attemptStarted && !attemptFinalized) {
    try { await finalizeAttempt('transient_failure'); } catch {}
  }
  await releaseSessionLock().catch(() => {});
  console.error(`[run-human-direction-proxy] ${error?.stack ?? error}`);
  finalOutcome = { exitCode: 1, stdout: '' };
}
if (finalOutcome.stdout) process.stdout.write(finalOutcome.stdout);
process.exitCode = finalOutcome.exitCode;
