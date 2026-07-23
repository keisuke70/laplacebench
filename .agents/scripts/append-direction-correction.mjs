#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { validExportedTrace } from './human-direction-proxy-validation.mjs';

export const CORRECTION_SOURCES = new Set([
  'human', 'plan-review', 'impl-review', 'impl-interrogation', 'author-runtime',
]);
export const CORRECTION_FAMILIES = new Set([
  'concept', 'non-entity', 'value-cost', 'absence', 'time-scope', 'recurrence', 'external-reality', 'process',
]);
export const CORRECTION_EFFECTS = new Set([
  'simplified', 'removed-work', 'complexity-exposed', 'premise-corrected', 'no-change',
]);

export function parseDirectionArtifacts(text) {
  const traces = [];
  const corrections = [];
  for (const match of String(text).matchAll(/```json\s*\n([\s\S]*?)\n```/g)) {
    let parsed;
    try { parsed = JSON.parse(match[1]); } catch { continue; }
    if (parsed?.direction_trace_v1) traces.push(parsed.direction_trace_v1);
    if (parsed?.direction_correction_v1) corrections.push(parsed.direction_correction_v1);
  }
  return { traces, corrections };
}

export function buildDirectionCorrection({
  text,
  eventId,
  source,
  missedFamilies,
  effect,
  highRisk,
  summary,
  correctionId = randomUUID(),
  occurredAt = new Date().toISOString(),
}) {
  const { traces, corrections } = parseDirectionArtifacts(text);
  const matchingTrace = traces.find((trace) => trace?.event?.event_id === eventId && validExportedTrace(trace));
  if (!matchingTrace || matchingTrace.event.dialogue_status !== 'completed') {
    throw new Error(`No valid completed direction trace with event ID ${eventId} exists in this file.`);
  }
  if (!CORRECTION_SOURCES.has(source)) throw new Error(`Invalid correction source: ${source}`);
  if (!Array.isArray(missedFamilies) || missedFamilies.length === 0
      || !missedFamilies.every((family) => CORRECTION_FAMILIES.has(family))) {
    throw new Error('missed families must contain only recognized family values.');
  }
  if (!CORRECTION_EFFECTS.has(effect)) throw new Error(`Invalid correction effect: ${effect}`);
  if (typeof highRisk !== 'boolean') throw new Error('high-risk must be true or false.');
  const normalizedSummary = String(summary ?? '').replace(/\s+/g, ' ').trim();
  if (!normalizedSummary || normalizedSummary.length > 500) {
    throw new Error('summary must be 1-500 sanitized characters.');
  }
  if (corrections.some((correction) => (
    correction.related_direction_event_id === eventId
    && correction.source === source
    && String(correction.summary ?? '').replace(/\s+/g, ' ').trim() === normalizedSummary
  ))) {
    throw new Error('An equivalent direction correction already exists in this file.');
  }
  return {
    correction_id: correctionId,
    related_direction_event_id: eventId,
    occurred_at: occurredAt,
    source,
    missed_families: [...new Set(missedFamilies)],
    summary: normalizedSummary,
    effect,
    high_risk: highRisk,
  };
}

function option(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

async function main() {
  const args = process.argv.slice(2);
  const file = args[0] ? path.resolve(args[0]) : null;
  if (!file || args.includes('--help')) {
    process.stdout.write('Usage: append-direction-correction.mjs <adjudication-file> --event-id ID --source SOURCE --families a,b --effect EFFECT --high-risk true|false --summary TEXT\n');
    process.exit(file ? 0 : 2);
  }
  const highRiskRaw = option(args, '--high-risk');
  if (!['true', 'false'].includes(highRiskRaw)) throw new Error('--high-risk must be true or false.');
  const text = await fs.readFile(file, 'utf8');
  const correction = buildDirectionCorrection({
    text,
    eventId: option(args, '--event-id'),
    source: option(args, '--source'),
    missedFamilies: String(option(args, '--families') ?? '').split(',').map((value) => value.trim()).filter(Boolean),
    effect: option(args, '--effect'),
    highRisk: highRiskRaw === 'true',
    summary: option(args, '--summary'),
  });
  await fs.appendFile(file, `\n\n\`\`\`json\n${JSON.stringify({ direction_correction_v1: correction }, null, 2)}\n\`\`\`\n`, 'utf8');
  process.stdout.write(`${JSON.stringify(correction)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    process.stderr.write(`[append-direction-correction] ${error.message}\n`);
    process.exit(1);
  });
}
