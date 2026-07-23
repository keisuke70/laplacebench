#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';

const execFileAsync = promisify(execFile);
const MAX_EPISODES = 4;
const MAX_RELATED_EXPANSIONS = 3;
const MAX_ROSTER = 30;
const COMMON_ASCII = new Set([
  'about', 'add', 'after', 'before', 'because', 'change', 'compatibility', 'consumer', 'data', 'development',
  'direction', 'disable', 'disposable', 'even', 'external', 'fallback', 'for', 'from', 'human', 'into', 'local', 'material',
  'never', 'only', 'permanent', 'plan', 'production', 'proposal', 'published', 'real', 'requirement', 'should',
  'recurrence', 'spec', 'state', 'system', 'that', 'this', 'though', 'uses', 'with', 'work',
]);
const COMMON_JAPANESE = new Set(['する', 'ある', 'いる', 'こと', 'ため', 'これ', 'それ', '対応', '処理', '変更', '改善', '確認', '実装', '計画', '方向', '追加', '問題']);

function compact(text, limit = 700) {
  return String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function tokenRecord(text) {
  const normalized = String(text ?? '').normalize('NFKC').toLowerCase();
  const ascii = new Set();
  for (const match of normalized.matchAll(/[a-z0-9][a-z0-9_./:-]{2,}/g)) {
    const whole = match[0].replace(/^[./:-]+|[./:-]+$/g, '');
    if (whole.length >= 3 && !COMMON_ASCII.has(whole)) ascii.add(whole);
    for (const part of whole.split(/[./:_-]+/)) if (part.length >= 3 && !COMMON_ASCII.has(part)) ascii.add(part);
  }
  const japanese = new Set();
  for (const chunk of normalized.match(/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]{2,}/gu) ?? []) {
    if (chunk.length <= 12 && !COMMON_JAPANESE.has(chunk)) japanese.add(chunk);
    for (const width of [2, 3, 4]) {
      for (let index = 0; index <= chunk.length - width; index += 1) {
        const token = chunk.slice(index, index + width);
        if (!COMMON_JAPANESE.has(token)) japanese.add(token);
      }
    }
  }
  return { ascii, japanese };
}

function documentFrequency(records, field) {
  const frequencies = new Map();
  for (const record of records) {
    for (const token of record[field]) frequencies.set(token, (frequencies.get(token) ?? 0) + 1);
  }
  return frequencies;
}

function rankCandidates(query, candidates) {
  if (!candidates.length) return [];
  const queryTokens = tokenRecord(query);
  const records = candidates.map((candidate) => tokenRecord(candidate.searchText));
  const asciiDf = documentFrequency(records, 'ascii');
  const japaneseDf = documentFrequency(records, 'japanese');
  const rareLimit = Math.max(1, Math.floor(candidates.length * 0.34));

  return candidates.map((candidate, index) => {
    const record = records[index];
    const sharedAscii = [...queryTokens.ascii].filter((token) => record.ascii.has(token));
    const distinctiveAscii = sharedAscii.filter((token) => (asciiDf.get(token) ?? 0) <= rareLimit);
    const refTokens = tokenRecord(candidate.ref);
    const identifierAscii = distinctiveAscii.filter((token) => /[0-9_./:-]/.test(token) || (token.length >= 5 && refTokens.ascii.has(token)));
    const sharedJapanese = [...queryTokens.japanese].filter((token) => record.japanese.has(token));
    const rareJapanese = sharedJapanese.filter((token) => (japaneseDf.get(token) ?? 0) <= rareLimit);
    const strongJapanese = rareJapanese.filter((token) => token.length >= 3);
    const episodicAscii = ['human-ruling', 'commit-intent'].includes(candidate.type) && distinctiveAscii.length >= 2;
    const japaneseOnly = queryTokens.ascii.size === 0 && (strongJapanese.length >= 2 || (strongJapanese.length >= 1 && rareJapanese.length >= 4));
    const eligible = identifierAscii.length > 0 || episodicAscii || japaneseOnly;
    const idf = (df) => Math.log2((candidates.length + 1) / (df + 0.5));
    const score = distinctiveAscii.reduce((sum, token) => sum + (/[0-9_./:-]/.test(token) ? 5 : 3) * idf(asciiDf.get(token)), 0)
      + rareJapanese.reduce((sum, token) => sum + (token.length >= 3 ? 2 : 0.5) * idf(japaneseDf.get(token)), 0);
    return { candidate, eligible, score, distinctiveAscii, rareJapanese };
  }).filter((entry) => entry.eligible)
    .sort((a, b) => b.score - a.score || a.candidate.ref.localeCompare(b.candidate.ref));
}

async function listMarkdown(dir) {
  try {
    return (await fs.readdir(dir, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
      .map((entry) => path.join(dir, entry.name))
      .sort();
  } catch {
    return [];
  }
}

function directionBrief(text) {
  const match = text.match(/## Direction Brief\s*\n([\s\S]*?)(?=\n## |$)/);
  return match ? compact(match[1], 700) : null;
}

function purpose(text) {
  const brief = directionBrief(text);
  const source = brief ?? text;
  const line = source.split('\n').find((candidate) => /目的|purpose/i.test(candidate));
  return compact(line ?? source.split('\n').find((candidate) => candidate.trim()) ?? '', 220);
}

async function readCandidate(file, type) {
  const body = await fs.readFile(file, 'utf8');
  const item = {
    type,
    ref: file,
    title: compact(body.match(/^#\s+(.+)$/m)?.[1] ?? path.basename(file), 160),
    purpose: purpose(body),
    detail: type === 'direction-brief' ? directionBrief(body) : compact(body, 700),
    body,
  };
  item.searchText = `${item.ref} ${item.title} ${item.purpose} ${body}`;
  return item;
}

function planIsCurrent(body) {
  return /^status:\s*(approved|implemented)\s*$/im.test(body);
}

function decisionIsCurrent(body) {
  const status = body.match(/^\s*(?:-\s*)?\*\*(?:ステータス|status)\*\*:\s*(.+)$/im)?.[1]?.trim().toLowerCase();
  return Boolean(status?.startsWith('accepted') && !/supersed|deprecated|expired|historical/.test(status));
}

async function git(repoRoot, args) {
  try {
    return (await execFileAsync('git', ['-C', repoRoot, ...args], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 })).stdout;
  } catch {
    return '';
  }
}

async function activeWork(repoRoot, proposal) {
  const roster = [];
  let explicit = [];
  try {
    explicit = JSON.parse(process.env.HDP_ACTIVE_WORK_JSON ?? '[]');
    if (!Array.isArray(explicit)) explicit = [];
  } catch {}
  for (const item of explicit) {
    roster.push({
      ref: String(item.ref ?? item.task ?? 'runtime-task'),
      purpose: compact(String(item.purpose ?? item.summary ?? 'active work'), 220),
      area: compact(String(item.area ?? ''), 80),
      owner: item.owner ? compact(String(item.owner), 80) : null,
      source: 'runtime',
    });
  }

  const porcelain = await git(repoRoot, ['status', '--porcelain=v1', '-z']);
  for (const record of porcelain.split('\0').filter(Boolean)) {
    const file = record.slice(3);
    if (!/(^|\/)docs\/(plans|interrogation\/adjudications)\/.+\.md$/.test(file)) continue;
    const absolute = path.join(repoRoot, file);
    let body = '';
    try { body = await fs.readFile(absolute, 'utf8'); } catch {}
    roster.push({
      ref: file,
      purpose: purpose(body) || path.basename(file, '.md'),
      area: file.includes('/plans/') ? 'plan' : 'adjudication',
      owner: null,
      source: 'working-tree',
      detail: directionBrief(body),
    });
  }

  const deduped = [...new Map(roster.map((item) => [item.ref, item])).values()].slice(0, MAX_ROSTER);
  const expandable = deduped.filter((item) => item.detail).map((item) => ({
    ...item,
    searchText: `${item.ref} ${item.purpose} ${item.detail}`,
  }));
  const expandedRefs = new Set(rankCandidates(proposal, expandable).slice(0, MAX_RELATED_EXPANSIONS).map((entry) => entry.candidate.ref));
  return {
    roster: deduped.map(({ detail: _detail, ...item }) => item),
    related_expansion: deduped.filter((item) => item.detail && expandedRefs.has(item.ref)).map((item) => ({ ref: item.ref, direction_brief: item.detail })),
    complete: false,
    note: 'Best-effort background only. Missing work does not block direction.',
  };
}

async function episodes(repoRoot, proposal) {
  const candidates = [];
  for (const file of await listMarkdown(path.join(repoRoot, 'docs/plans'))) {
    const item = await readCandidate(file, 'direction-brief');
    if (item.detail && planIsCurrent(item.body)) candidates.push(item);
  }
  for (const file of await listMarkdown(path.join(repoRoot, 'docs/decisions'))) {
    const item = await readCandidate(file, 'decision');
    if (decisionIsCurrent(item.body)) candidates.push(item);
  }
  for (const file of await listMarkdown(path.join(repoRoot, 'docs/interrogation/adjudications'))) {
    const body = await fs.readFile(file, 'utf8');
    if (!/^\s*-\s*by:\s*human\b/m.test(body)) continue;
    const humanBlocks = body.split(/(?=^- Q\()/m).filter((block) => /^- Q\(/.test(block) && /^\s*-\s*by:\s*human\b/m.test(block));
    for (const block of humanBlocks) {
      const item = {
        type: 'human-ruling', ref: file, title: compact(block.split('\n')[0], 180),
        purpose: compact(block, 260), detail: compact(block, 700), body: block,
      };
      item.searchText = `${item.ref} ${item.title} ${item.purpose} ${item.body}`;
      candidates.push(item);
    }
  }
  const log = await git(repoRoot, ['log', '-200', '--format=%H%x1f%s%x1f%b%x1e']);
  for (const record of log.split('\x1e')) {
    const [commitHash, subject, body] = record.trim().split('\x1f');
    if (!commitHash || !/意図|intent:/i.test(body ?? '')) continue;
    const item = {
      type: 'commit-intent', ref: commitHash, title: compact(subject ?? '', 160),
      purpose: compact(body ?? '', 260), detail: compact(`${subject}\n${body}`, 700), body: `${subject}\n${body}`,
    };
    item.searchText = `${item.title} ${item.purpose} ${item.body}`;
    candidates.push(item);
  }

  return rankCandidates(proposal, candidates).slice(0, MAX_EPISODES).map(({ candidate }) => {
    const { body: _body, searchText: _searchText, ...memory } = candidate;
    if (path.isAbsolute(memory.ref)) memory.ref = path.relative(repoRoot, memory.ref);
    return memory;
  });
}

function simpleSectionScore(proposal, section) {
  const query = tokenRecord(proposal);
  const candidate = tokenRecord(section);
  return [...query.ascii].filter((token) => candidate.ascii.has(token)).length * 3
    + [...query.japanese].filter((token) => candidate.japanese.has(token)).length;
}

async function stableCore(repoRoot, proposal) {
  const files = [
    path.join(repoRoot, 'docs/norms/human-decision-model.md'),
    path.join(repoRoot, 'docs/norms/product-normative-model.md'),
  ];
  const result = [];
  for (const file of files) {
    let body;
    try { body = await fs.readFile(file, 'utf8'); } catch { continue; }
    if (file.endsWith('human-decision-model.md')) {
      result.push({ ref: path.relative(repoRoot, file), excerpt: compact(body, 5000) });
      continue;
    }
    const sections = body.split(/(?=^##?\s)/m)
      .map((section) => ({ section, score: simpleSectionScore(proposal, section) }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);
    if (sections.length) result.push({ ref: path.relative(repoRoot, file), excerpt: compact(sections.map((entry) => entry.section).join('\n'), 3500) });
  }
  return result;
}

export async function buildHumanDirectionContext(repoRoot, proposal) {
  const [core, recalled, active] = await Promise.all([
    stableCore(repoRoot, proposal), episodes(repoRoot, proposal), activeWork(repoRoot, proposal),
  ]);
  return {
    schema_version: 'human_direction_context_v1',
    stable_core: core,
    proposal_linked_episodes: recalled,
    known_active_work: active,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const repoRoot = path.resolve(process.argv[2] ?? process.cwd());
  let proposal = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) proposal += chunk;
  if (!proposal.trim()) {
    console.error('proposal must be provided on stdin');
    process.exit(2);
  }
  process.stdout.write(`${JSON.stringify(await buildHumanDirectionContext(repoRoot, proposal), null, 2)}\n`);
}
