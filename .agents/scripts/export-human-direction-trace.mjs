#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { validCompletedResult } from './human-direction-proxy-validation.mjs';

const sessionKey = String(process.argv[2] ?? '').replace(/[^a-zA-Z0-9._-]/g, '-').replace(/^-+|-+$/g, '');
if (!sessionKey) {
  console.error('Usage: node .agents/scripts/export-human-direction-trace.mjs <session-key>');
  process.exit(2);
}

const repoRoot = path.resolve(process.env.HUMAN_DIRECTION_REPO_ROOT ?? process.cwd());
const resultPath = path.join(repoRoot, '.agents', 'state', `human-direction-${sessionKey}.result.json`);
let result;
try {
  result = JSON.parse(await fs.readFile(resultPath, 'utf8'));
} catch (error) {
  console.error(`Cannot read completed Human Direction Proxy result: ${error.message}`);
  process.exit(2);
}

if (!validCompletedResult(result)) {
  console.error('Only a completed Human Direction Proxy result can be exported');
  process.exit(3);
}
const event = result.event.direction_event_v1;

const trace = {
  direction_trace_v1: {
    event,
    transcript_hash: result.transcript_hash,
    decision_context_hash: result.decision_context_hash,
    method_version: result.method_version,
    turns: result.cumulative?.turns,
  },
};
process.stdout.write(`\`\`\`json\n${JSON.stringify(trace, null, 2)}\n\`\`\`\n`);
