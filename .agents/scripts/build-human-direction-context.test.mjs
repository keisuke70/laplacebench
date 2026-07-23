#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { buildHumanDirectionContext } from './build-human-direction-context.mjs';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'human-direction-context-'));
const write = async (relative, body) => {
  const target = path.join(root, relative);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, body);
};
const plan = (title, purpose, direction) => `---\nstatus: implemented\n---\n# ${title}\n## Direction Brief\n| field | value |\n|---|---|\n| 目的 | ${purpose} |\n| 採用方向 | ${direction} |\n| 消えるもの | 不要な分岐 |\n`;
const refs = (context) => context.proposal_linked_episodes.map((item) => item.ref);

try {
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'eval@example.invalid'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Eval'], { cwd: root });
  await write('docs/norms/human-decision-model.md', '# Human Decision Model\n- 根因を除去し、不要な恒久分岐を作らない。\n');
  await write('docs/norms/product-normative-model.md', '# Norms\n## Carrier contract\nCarrier read model must preserve display semantics.\n');
  await write('docs/plans/2026-01-01-carrier-base.md', plan('Carrier base plan', 'carrier display contract と carrier-row mapping', 'carrier表示契約をread modelで一意にする'));
  await write('docs/plans/2026-01-02-server-buildout.md', plan('Server buildout', 'server buildout and capacity provisioning', 'server imageを更新する'));
  await write('docs/plans/2026-01-03-set-ticket.md', plan('Set ticket', 'set-ticket issue command', 'ticket statusを更新する'));
  await write('docs/plans/2026-01-04-staging-reflection.md', plan('Staging reflection baseline', 'staging reflection baseline correction', 'deployed SHAをbaselineにする'));
  await write('docs/plans/2026-01-05-ui-error.md', plan('UI error copy', 'dashboard error copy and English UI', 'error文言を短くする'));
  await write('docs/plans/2026-01-06-scheduler.md', plan('Scheduler deploy owner', 'scheduler disable recurrence in deploy script', 'disable処理自体を削除する'));
  await write('docs/plans/2026-01-07-migration.md', plan('Legacy migration unit grain', 'legacy migration canonical unit grain', 'unit台帳をcanonicalにする'));
  await write('docs/plans/2026-01-08-seat-policy.md', plan('座席再配置', '座席再配置の衝突規則を定める', '座席再配置は発行済み座席を保護する'));
  await write('docs/plans/2026-01-09-generic.md', plan('Generic change', '処理の変更と確認を行う', '実装の処理を変更する'));
  await write('docs/plans/2026-01-10-abandoned.md', '---\nstatus: abandoned\n---\n# scheduler disable exact decoy\n## Direction Brief\n目的 scheduler disable recurrence\n');
  await write('docs/interrogation/adjudications/2026-01-11-seat.md', '# log\n- Q(human/NEW): 座席再配置で発行済み座席を守るか\n  - ruling: 発行済み座席を優先する\n  - by: human\n');
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-q', '-m', 'Record carrier contract', '-m', '意図: carrier display contractを固定する\n\nやったこと: carrier read modelを整理した'], { cwd: root });

  const carrier = await buildHumanDirectionContext(root, 'carrier display contract のrow mappingを見直す');
  assert.ok(refs(carrier).some((ref) => ref.includes('carrier-base')), 'direct carrier memory must be recalled');
  assert.ok(!refs(carrier).some((ref) => ref.includes('server-buildout') || ref.includes('set-ticket')), 'weak episode padding must not occur');
  assert.ok(carrier.proposal_linked_episodes.length <= 4);
  assert.ok(carrier.proposal_linked_episodes.every((item) => !Object.hasOwn(item, 'score')));
  assert.ok(carrier.proposal_linked_episodes.every((item) => (item.detail?.length ?? 0) <= 700));
  const carrierMemory = carrier.proposal_linked_episodes.find((item) => item.ref.includes('carrier-base'));
  assert.match(carrierMemory.purpose, /carrier display contract/);
  assert.match(carrierMemory.detail, /carrier表示契約をread modelで一意にする/, 'compact memory must retain adopted direction, not only fit a byte limit');

  const reflection = await buildHumanDirectionContext(root, 'staging reflection baseline correctionを再確認する');
  assert.ok(refs(reflection).some((ref) => ref.includes('staging-reflection')));
  assert.ok(!refs(reflection).some((ref) => ref.includes('ui-error')));

  const scheduler = await buildHumanDirectionContext(root, 'scheduler disable recurrenceを根因から直す');
  assert.deepEqual(refs(scheduler).filter((ref) => ref.includes('plans/')), ['docs/plans/2026-01-06-scheduler.md']);
  await write('docs/plans/2026-01-06-scheduler.md', plan('Former scheduler note', 'scheduler disable recurrence in deploy script', 'disable処理を検討する').replace('status: implemented', 'status: abandoned'));
  const schedulerWithoutOwner = await buildHumanDirectionContext(root, 'scheduler disable recurrenceを根因から直す');
  assert.equal(schedulerWithoutOwner.proposal_linked_episodes.length, 0, 'scheduler query without a current owner must not be padded');
  await write('docs/plans/2026-01-06-scheduler.md', plan('Scheduler deploy owner', 'scheduler disable recurrence in deploy script', 'disable処理自体を削除する'));

  const migration = await buildHumanDirectionContext(root, 'legacy migration canonical unit grainを決める');
  assert.ok(refs(migration).some((ref) => ref.includes('migration')));
  assert.ok(!refs(migration).some((ref) => ref.includes('carrier') || ref.includes('server')));

  const japanese = await buildHumanDirectionContext(root, '座席再配置の衝突規則を見直す');
  assert.ok(refs(japanese).some((ref) => ref.includes('seat')), 'rare Japanese concept must recall its ruling or plan');
  assert.ok(!refs(japanese).some((ref) => ref.includes('generic')));

  const noMatch = await buildHumanDirectionContext(root, '月次請求書の源泉税率を検討する');
  assert.equal(noMatch.proposal_linked_episodes.length, 0, 'no distinctive match must produce zero episodes');
  const genericEnglish = await buildHumanDirectionContext(root, 'Proposal: add a permanent compatibility fallback for disposable local development data even though no production or external consumer uses it.');
  assert.equal(genericEnglish.proposal_linked_episodes.length, 0, 'generic English prose and trailing punctuation must not become identifiers');

  await fs.appendFile(path.join(root, 'docs/plans/2026-01-06-scheduler.md'), '\nworking\n');
  await fs.appendFile(path.join(root, 'docs/plans/2026-01-05-ui-error.md'), '\nworking\n');
  const active = await buildHumanDirectionContext(root, 'scheduler disable recurrenceを根因から直す');
  assert.equal(active.known_active_work.roster.length, 2, 'all known active work remains in the one-line roster');
  assert.ok(active.known_active_work.roster.some((item) => item.ref.includes('ui-error')));
  assert.ok(active.known_active_work.related_expansion.some((item) => item.ref.includes('scheduler')));
  assert.ok(!active.known_active_work.related_expansion.some((item) => item.ref.includes('ui-error')));
  assert.equal(active.known_active_work.complete, false);
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
console.log('human direction context tests passed');
