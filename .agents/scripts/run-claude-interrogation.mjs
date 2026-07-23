import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const usage = `Usage: node .agents/scripts/run-claude-interrogation.mjs <impl|plan> <session-key> [--fresh]

Reads the heavy implementation-checkpoint prompt from stdin and runs a fresh
Claude session (default model, read-only) with persisted resume state.

Checkpoint types: "impl" (implementation checkpoint, heavy slices), "plan"
(legacy post-plan interrogation, kept for historical compatibility only).

Pre-plan direction dialogue is owned by run-human-direction-proxy.sh.

The session-key is required and is treated as the canonical resume key.`;

const checkpointType = process.argv[2];
if (!checkpointType || ['-h', '--help'].includes(checkpointType)) {
  console.log(usage);
  process.exit(checkpointType ? 0 : 2);
}

if (!['impl', 'plan'].includes(checkpointType)) {
  console.error(`Unknown checkpoint type: ${checkpointType}`);
  console.error(usage);
  process.exit(2);
}

if (process.env.CLAUDE_INTERROGATION_ACTIVE === '1') {
  console.error(
    '[run-claude-interrogation] nested interrogation runner blocked; the interrogator must answer directly, not invoke this runner recursively.',
  );
  process.exit(9);
}

const extraArgs = process.argv.slice(3);
const freshOnly = extraArgs.includes('--fresh');
const rawSessionKey = extraArgs.find((arg) => !arg.startsWith('-')) ?? '';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const sourceRepoRoot = path.resolve(scriptDir, '..');
const projectRepoRoot = path.resolve(scriptDir, '..', '..');
const repoRoot =
  existsSync(path.join(sourceRepoRoot, 'sync.sh')) && existsSync(path.join(sourceRepoRoot, 'skills'))
    ? sourceRepoRoot
    : projectRepoRoot;
const stateDir = path.join(repoRoot, '.agents', 'state');
const schemaPath = path.join(scriptDir, 'review-schema.json');
function parseNonNegativeInt(value, fallback) {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const timeoutSeconds = parsePositiveInt(process.env.CLAUDE_INTERROGATION_TIMEOUT_SECONDS, 600);
const heartbeatSeconds = parseNonNegativeInt(
  process.env.CLAUDE_INTERROGATION_HEARTBEAT_SECONDS,
  0,
);

function sanitizeSessionKey(value) {
  const sanitized = value.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return sanitized || checkpointType;
}

const sessionKey = sanitizeSessionKey(rawSessionKey);
if (!rawSessionKey || !sessionKey) {
  console.error(`A stable session-key is required for ${checkpointType} interrogation.`);
  process.exit(2);
}

const sessionFile = path.join(stateDir, `claude-${checkpointType}-${sessionKey}.session`);
const logFile = path.join(stateDir, `claude-${checkpointType}-${sessionKey}.log.json`);
const metricsFile = path.join(stateDir, `claude-${checkpointType}-${sessionKey}.log.jsonl`);

function validateStructuredOutput(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  if (!['APPROVED', 'NEEDS_CHANGES'].includes(data.verdict)) return false;
  if (typeof data.summary !== 'string') return false;
  if (typeof data.confidence !== 'number' || Number.isNaN(data.confidence)) return false;
  if (data.confidence < 0 || data.confidence > 1) return false;
  if (!Array.isArray(data.issues)) return false;
  for (const issue of data.issues) {
    if (!issue || typeof issue !== 'object' || Array.isArray(issue)) return false;
    if (!['critical', 'major', 'minor'].includes(issue.severity)) return false;
    for (const key of ['location', 'problem', 'suggestion']) {
      if (typeof issue[key] !== 'string') return false;
    }
  }
  return true;
}

function looksResettable(text) {
  return [
    /no conversation found/i,
    /session .*not found/i,
    /unknown session/i,
    /invalid session/i,
    /unable to resume/i,
    /could not resume/i,
  ].some((pattern) => pattern.test(text));
}

function formatDuration(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes <= 0) return `${seconds}s`;
  return `${minutes}m${String(seconds).padStart(2, '0')}s`;
}

async function runClaude(promptText, resumeSessionId) {
  const schemaString = (await fs.readFile(schemaPath, 'utf8')).trim();
  const newSessionId = resumeSessionId ? null : randomUUID();
  const args = [
    '-p',
    '--output-format',
    'json',
    '--json-schema',
    schemaString,
    '--disallowedTools',
    'Edit,Write,NotebookEdit,Task',
  ];
  if (resumeSessionId) {
    args.push('--resume', resumeSessionId);
  } else {
    args.push('--session-id', newSessionId);
  }

  const child = spawn('claude', args, {
    cwd: repoRoot,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, CLAUDE_INTERROGATION_ACTIVE: '1' },
  });
  child.stdin.end(promptText);

  const stdoutChunks = [];
  const stderrChunks = [];
  child.stdout.on('data', (chunk) => stdoutChunks.push(chunk.toString()));
  child.stderr.on('data', (chunk) => stderrChunks.push(chunk.toString()));

  const startedAtMs = Date.now();
  const heartbeat =
    heartbeatSeconds > 0
      ? setInterval(() => {
          const elapsedSeconds = Math.floor((Date.now() - startedAtMs) / 1000);
          const remainingSeconds = Math.max(timeoutSeconds - elapsedSeconds, 0);
          process.stderr.write(
            `[run-claude-interrogation] still running; elapsed ${formatDuration(
              elapsedSeconds,
            )}, timeout in ${formatDuration(remainingSeconds)}\n`,
          );
        }, heartbeatSeconds * 1000)
      : null;
  const timeout = setTimeout(() => {
    process.stderr.write(
      `[run-claude-interrogation] timed out after ${formatDuration(
        timeoutSeconds,
      )}; killing Claude process\n`,
    );
    child.kill('SIGKILL');
  }, timeoutSeconds * 1000);

  const exitCode = await new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', resolve);
  });
  if (heartbeat) clearInterval(heartbeat);
  clearTimeout(timeout);

  return {
    exitCode: exitCode ?? 1,
    stdout: stdoutChunks.join(''),
    stderr: stderrChunks.join(''),
    sessionId: resumeSessionId ?? newSessionId,
  };
}

function extractStructuredOutput(stdout) {
  let envelope = null;
  try {
    envelope = JSON.parse(stdout);
  } catch {
    return { envelope: null, parsed: null };
  }
  const candidates = [];
  if (envelope.structured_output !== undefined) candidates.push(envelope.structured_output);
  if (typeof envelope.result === 'string') {
    try {
      candidates.push(JSON.parse(envelope.result));
    } catch {}
  } else if (envelope.result !== undefined) {
    candidates.push(envelope.result);
  }
  for (const candidate of candidates) {
    if (validateStructuredOutput(candidate)) {
      return { envelope, parsed: candidate };
    }
  }
  return { envelope, parsed: null };
}

const promptText = await new Promise((resolve, reject) => {
  const chunks = [];
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => chunks.push(chunk));
  process.stdin.on('end', () => resolve(chunks.join('')));
  process.stdin.on('error', reject);
});

if (!promptText.trim()) {
  console.error('Interrogation prompt must be provided on stdin.');
  process.exit(2);
}

await fs.access(schemaPath);
await fs.mkdir(stateDir, { recursive: true });

let resumeSessionId = null;
if (!freshOnly) {
  try {
    resumeSessionId = (await fs.readFile(sessionFile, 'utf8')).trim() || null;
  } catch {}
}

let result = await runClaude(promptText, resumeSessionId);

if (resumeSessionId && result.exitCode !== 0 && looksResettable(result.stdout + result.stderr)) {
  process.stderr.write('[run-claude-interrogation] resume failed; starting a fresh session\n');
  await fs.rm(sessionFile, { force: true });
  result = await runClaude(promptText, null);
}

const { envelope, parsed } = extractStructuredOutput(result.stdout);
await fs.writeFile(
  logFile,
  JSON.stringify(
    { exitCode: result.exitCode, stderr: result.stderr.slice(-4000), envelope },
    null,
    2,
  ),
  'utf8',
);

// Per-round metrics, append-only (KPI source: per-slice verification time/cost).
try {
  await fs.appendFile(
    metricsFile,
    `${JSON.stringify({
      ts: new Date().toISOString(),
      checkpointType,
      sessionKey,
      exitCode: result.exitCode,
      durationMs: envelope?.duration_ms ?? null,
      costUsd: envelope?.total_cost_usd ?? null,
      numTurns: envelope?.num_turns ?? null,
      outputTokens: envelope?.usage?.output_tokens ?? null,
      verdict: parsed?.verdict ?? null,
      issueCount: parsed?.issues?.length ?? null,
    })}\n`,
    'utf8',
  );
} catch {}

if (result.exitCode === 0 && parsed) {
  await fs.writeFile(sessionFile, `${envelope?.session_id ?? result.sessionId}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify(parsed)}\n`);
  process.exit(0);
}

console.error(
  `[run-claude-interrogation] failed (exit ${result.exitCode}); raw output saved to ${logFile}. Retry with the same session-key.`,
);
const detail = (result.stderr || result.stdout).trim().split(/\r?\n/).slice(-2).join('\n');
if (detail) console.error(`[run-claude-interrogation] detail: ${detail.slice(0, 400)}`);
process.exit(1);
