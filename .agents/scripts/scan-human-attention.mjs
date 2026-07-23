#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const GENERATED_PROMPT_RE = /^(Session-Key:|Return only a JSON object|Review scope rules:|<recommended_plugins>)/;
const INJECTED_PREFIXES = [
  '# AGENTS.md instructions',
  '<environment_context>',
  '<permissions instructions>',
  '<app-context>',
  '<collaboration_mode>',
  '<skills_instructions>',
  '<apps_instructions>',
  '<plugins_instructions>',
  '<recommended_plugins>',
];

function isoWeek(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const utc = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = (utc.getUTCDay() + 6) % 7;
  utc.setUTCDate(utc.getUTCDate() - day + 3);
  const jan4 = new Date(Date.UTC(utc.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((utc - jan4) / 86400000 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
  return `${utc.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function stripAmbient(text) {
  return text
    .replace(/<in-app-browser-context[\s\S]*?<\/in-app-browser-context>\s*/g, '')
    .replace(/^## My request for Codex:\s*/m, '')
    .trim();
}

function isInjected(text) {
  return INJECTED_PREFIXES.some((prefix) => text.startsWith(prefix));
}

function userMessage(payload) {
  if (payload?.type !== 'message' || payload?.role !== 'user') return null;
  const text = (payload.content ?? [])
    .filter((part) => part.type === 'input_text')
    .map((part) => part.text ?? '')
    .join('\n')
    .trim();
  if (!text || isInjected(text)) return null;
  return {
    text: stripAmbient(text),
    itemId: payload.internal_chat_message_metadata_passthrough?.turn_id ?? payload.id ?? null,
  };
}

function categoriesFor(text) {
  const normalized = text.replace(/\s+/g, ' ').trim();
  const categories = [];
  if (/^(今どうなってる|今どうなってるの|何やってる|何をやってる|進捗(?:は|どう)?|どこまで(?:進んだ|できた)?|まだ(?:ですか|終わらない|終わってない|かかる))[？?。!！]*$/i.test(normalized)) {
    categories.push('progress-probe');
  }
  if (/^(進めて|続けて|そのまま進めて|再開して|お願い|go)[。!！]*$/i.test(normalized)) {
    categories.push('continuation-nudge');
  }
  if (/(ローカル|ブラウザ|PDF|ダウンロード|環境|ツール|tool).*(できない|無理|使えない|見えない)|(?:できない|無理|使えない).*(ローカル|ブラウザ|PDF|ダウンロード|環境|ツール|tool)|やらなくていい|確認(?:は|しなくて)?不要/.test(normalized)) {
    categories.push('capability-correction');
  }
  if (/(前にも|さっき|これまで|既に).*(言った|伝えた|確認した|直した)|同じこと/.test(normalized)) {
    categories.push('repeated-requirement');
  }
  return categories;
}

function sanitizeExcerpt(text) {
  return text
    .replace(/https?:\/\/\S+/g, '[url]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
    .replace(/\b(?:authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password|passwd)\s*[:=]\s*\S+/gi, '[secret]')
    .replace(/\bBearer\s+\S+/gi, '[token]')
    .replace(/\b[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{10,}(?:\.[A-Za-z0-9_-]{10,})?\b/g, '[token]')
    .replace(/(?:\/Users\/|\/home\/|\/tmp\/|[A-Za-z]:\\)[^\s]+/g, '[path]')
    .replace(/(?:\+?\d[\d ()-]{8,}\d)/g, '[phone]')
    .replace(/\b[A-Za-z0-9_+/=-]{24,}\b/g, '[opaque-id]')
    .replace(/\s+/g, ' ')
    .slice(0, 160);
}

function stableId(...parts) {
  return crypto.createHash('sha256').update(parts.join('\0')).digest('hex');
}

function listJsonl(root) {
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.endsWith('.jsonl')) files.push(full);
    }
  };
  walk(root);
  return files.sort();
}

function parseFile(file) {
  const records = [];
  const errors = [];
  let body;
  try {
    body = fs.readFileSync(file, 'utf8');
  } catch (error) {
    return { records, errors: [`${path.basename(file)}:read:${error.code ?? error.message}`] };
  }
  for (const [index, line] of body.split('\n').entries()) {
    if (!line.trim()) continue;
    try {
      records.push({ index, record: JSON.parse(line) });
    } catch (error) {
      errors.push(`${path.basename(file)}:${index + 1}:${error.message}`);
    }
  }
  return { records, errors };
}

function sessionKind(meta, firstText) {
  if (!meta || !firstText || GENERATED_PROMPT_RE.test(firstText)) return 'runner';
  if (meta.thread_source && meta.thread_source !== 'user') return 'runner';
  if (typeof meta.source !== 'string' || meta.source === 'exec') return 'runner';
  if (meta.source === 'vscode' || meta.source === 'cli') return 'user';
  return 'unsupported';
}

export function scanCodexRoot(root, { repo = null, since = null } = {}) {
  const sourceAvailable = fs.existsSync(root);
  const output = {
    provider: 'codex',
    sourceAvailable,
    sourceComplete: sourceAvailable,
    root,
    scannedFiles: 0,
    userOwnedSessions: 0,
    unsupportedSessions: 0,
    pendingCandidateCount: 0,
    errors: [],
    candidates: [],
    coverage: {},
  };
  if (!output.sourceAvailable) return output;

  let files;
  try {
    files = listJsonl(root);
  } catch (error) {
    output.sourceComplete = false;
    output.errors.push(`root:${error.code ?? error.message}`);
    return output;
  }
  for (const file of files) {
    const parsed = parseFile(file);
    const { records } = parsed;
    output.scannedFiles += 1;
    const meta = records.find(({ record }) => record.type === 'session_meta')?.record.payload;
    if (parsed.errors.length) {
      output.sourceComplete = false;
      output.errors.push(...parsed.errors);
    }
    const messages = [];
    const starts = [];
    const completes = [];
    for (const { index, record } of records) {
      if (record.type === 'response_item') {
        const message = userMessage(record.payload);
        if (message?.text) messages.push({ index, ...message, timestamp: record.timestamp ?? null });
      }
      if (record.type === 'event_msg' && record.payload?.type === 'task_started') {
        starts.push({ index, id: record.payload.turn_id ?? null, timestamp: record.timestamp ?? null });
      }
      if (record.type === 'event_msg' && record.payload?.type === 'task_complete') {
        completes.push({ index, id: record.payload.turn_id ?? null, timestamp: record.timestamp ?? null });
      }
    }
    const first = messages[0]?.text ?? null;
    if (repo && meta?.cwd !== repo) continue;
    const kind = sessionKind(meta, first);
    if (kind === 'unsupported') {
      output.unsupportedSessions += 1;
      output.sourceComplete = false;
      output.errors.push(`${path.basename(file)}:unsupported-source:${String(meta?.source)}`);
      continue;
    }
    if (kind !== 'user') continue;
    output.userOwnedSessions += 1;
    const sessionId = meta.session_id ?? meta.id ?? path.basename(file);

    for (const complete of completes) {
      if (!complete.id || !complete.timestamp) continue;
      if (since && new Date(complete.timestamp) < since) continue;
      const week = isoWeek(complete.timestamp);
      output.coverage[week] ??= { completedWorkUnitIds: [], candidateIds: [] };
      output.coverage[week].completedWorkUnitIds.push(`${sessionId}:${complete.id}`);
    }

    for (const message of messages.slice(1)) {
      const categories = categoriesFor(message.text);
      if (!categories.length) continue;
      // Codex log ordering differs across app versions: task_started may be
      // immediately before or immediately after the user response_item. Prefer
      // the started turn whose matching completion encloses this message, then
      // fall back to the next start for older logs.
      const directCompletion = message.itemId
        ? completes.find((complete) => complete.id === message.itemId && complete.index > message.index)
        : null;
      const enclosingStart = [...starts].reverse().find((start) =>
        start.index < message.index
        && start.id
        && completes.some((complete) => complete.id === start.id && complete.index > message.index));
      const nextStart = starts.find((start) => start.index > message.index
        && start.id
        && completes.some((complete) => complete.id === start.id && complete.index > message.index));
      const workId = directCompletion?.id ?? enclosingStart?.id ?? nextStart?.id ?? null;
      const workCompletion = directCompletion ?? completes.find((complete) => complete.id === workId && complete.index > message.index);
      if (!workId || !workCompletion?.timestamp) {
        output.pendingCandidateCount += categories.length;
        continue;
      }
      // The rolling window follows the same completion evidence as the
      // denominator. A pre-cutoff message whose turn completes in-window must
      // not disappear while its completed work unit remains counted.
      if (since && new Date(workCompletion.timestamp) < since) continue;
      const workUnitId = `${sessionId}:${workId}`;
      for (const category of categories) {
        const messageIdentity = message.itemId ?? stableId(message.timestamp ?? '', message.text);
        const id = stableId('codex', sessionId, messageIdentity, category);
        const occurredAt = message.timestamp
          ?? enclosingStart?.timestamp
          ?? nextStart?.timestamp
          ?? directCompletion?.timestamp
          ?? null;
        const candidate = {
          id,
          provider: 'codex',
          sessionId,
          workUnitId,
          occurredAt,
          completedAt: workCompletion.timestamp,
          // Numerator and denominator share the completion week. occurredAt is
          // retained as evidence but does not split one work unit across weeks.
          week: isoWeek(workCompletion.timestamp),
          category,
          excerpt: sanitizeExcerpt(message.text),
          messageHash: stableId(message.text),
          sourceRef: `${path.basename(file)}:${message.index + 1}`,
        };
        output.candidates.push(candidate);
        if (candidate.week) {
          output.coverage[candidate.week] ??= { completedWorkUnitIds: [], candidateIds: [] };
          output.coverage[candidate.week].candidateIds.push(id);
        }
      }
    }
  }

  for (const bucket of Object.values(output.coverage)) {
    bucket.completedWorkUnitIds = [...new Set(bucket.completedWorkUnitIds)].sort();
    bucket.candidateIds = [...new Set(bucket.candidateIds)].sort();
  }
  output.candidates.sort((a, b) => (a.occurredAt ?? '').localeCompare(b.occurredAt ?? '') || a.id.localeCompare(b.id));
  return output;
}

function parseArgs(argv) {
  const args = { format: 'json', days: 7, root: process.env.CODEX_HOME ? path.join(process.env.CODEX_HOME, 'sessions') : path.join(os.homedir(), '.codex', 'sessions'), repo: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--root') args.root = path.resolve(argv[++i]);
    else if (argv[i] === '--repo') args.repo = path.resolve(argv[++i]);
    else if (argv[i] === '--days') args.days = Number.parseInt(argv[++i], 10);
    else if (argv[i] === '--format') args.format = argv[++i];
    else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  return args;
}

function markdown(result) {
  const lines = [
    '# human-attention candidates',
    '',
    `- provider: ${result.provider}`,
    `- source available: ${result.sourceAvailable}`,
    `- source complete: ${result.sourceComplete}`,
    `- scanned files: ${result.scannedFiles}`,
    `- user-owned sessions: ${result.userOwnedSessions}`,
    `- unsupported sessions: ${result.unsupportedSessions}`,
    `- pending candidates: ${result.pendingCandidateCount}`,
    `- candidates: ${result.candidates.length}`,
    '',
  ];
  for (const candidate of result.candidates) lines.push(`- ${candidate.week ?? 'unknown'} ${candidate.category} ${candidate.id.slice(0, 12)}: ${candidate.excerpt}`);
  return `${lines.join('\n')}\n`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const since = Number.isFinite(args.days) && args.days > 0 ? new Date(Date.now() - args.days * 86400000) : null;
    const result = scanCodexRoot(args.root, { repo: args.repo, since });
    process.stdout.write(args.format === 'markdown' ? markdown(result) : `${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`[scan-human-attention] ${error.message}\n`);
    process.exitCode = 1;
  }
}
