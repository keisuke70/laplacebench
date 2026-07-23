---
name: interrogation
description: Run the implementation checkpoint for heavy slices after an approved plan and before implementation review. Use for migration, data semantics, payment/money, permissions/security, cutover, or irreversible changes to challenge only plan deltas, newly discovered premise failures, and runtime consequences; direction dialogue is owned by human-direction-proxy.
user-invocable: true
metadata:
  tags: implementation, checkpoint, high-risk, review, loop
---

# Interrogation（重量スライスの実装チェックポイント）

## Boundary

This skill owns only the post-implementation checkpoint for **heavy** slices. Plan-before-direction dialogue is owned by `human-direction-proxy`; plan completeness is owned by plan review; ordinary implementation defects are owned by implementation review.

Run this checkpoint after implementation verification and before `/codex-impl-review` when the slice touches migration, data meaning, money/payment, permissions/security, cutover, or irreversible operations. Standard and light slices skip it and send the six-item defense directly to implementation review.

Do not reopen a direction or plan decision without new evidence. If implementation evidence overturns the Direction Brief, stop patching: update the brief and plan, then repeat plan review.

## Valid targets

Challenge only:

1. artifacts added outside the approved plan;
2. implementation discoveries that invalidate a plan premise;
3. consequences visible only after execution, such as real DB behavior, rendered output, test counterexamples, or an implementation compromise.

Do not ask about documentation inventory, spelling, record completeness, or tests merely to manufacture findings. Settled questions stay settled.

## Implementer defense

Before running the checkpoint, write a concise and honest defense:

1. **Purpose:** what this change optimizes.
2. **Requirement source:** quote the source for any screen, concept, control, or behavior added outside the plan; mark uncited additions as self-initiated.
3. **Means:** what changed and any deviation from the approved plan.
4. **Removed / retained:** what was deleted and why any suspect existing artifact remains.
5. **Rejected options:** compatibility, defenses, abstractions, or alternatives intentionally not added.
6. **Tradeoffs and discoveries:** what was sacrificed and which plan premises changed during implementation.

Marketing language is a defect. Supply changed-file paths, the approved plan/brief, relevant runtime evidence, the project question bank, and prior adjudications.

## Required runner

Use the shared runner and one stable session key for every round:

```bash
bash .agents/scripts/run-claude-interrogation.sh impl interrogate-<slug> < interrogation-prompt.txt
```

Do not call raw `claude -p`, manage session IDs, or invoke another interrogation recursively. The runner provides a fresh read-only Claude session, validates structured output, persists resume state, and appends per-round metrics.

### Wait discipline

- Let the runner exit by itself. Its timeout defaults to 600 seconds.
- Heartbeats or silence are progress, not failure. Do not cancel, retry, or count a failure while it runs.
- In harnesses that require polling, poll at the maximum interval and emit no “still waiting” narration between polls.
- Count only nonzero exit, runner timeout/error, or explicit user cancellation as failure.
- After two consecutive infrastructure failures, report the skipped checkpoint to the user and give implementation review the full premise-monitoring scope. Do not silently waive it.

## Output contract

The runner uses the shared review schema:

- `NEEDS_CHANGES`: one or more implementation questions remain.
- `APPROVED`: no unresolved question remains.
- `issues[].problem`: the question, phrased as a question.
- `issues[].suggestion`: why it matters and what evidence would settle it.
- `summary`: the weakest remaining premise or approval basis.

A question is not automatically a change request. The implementer must try to disprove it before accepting it. Limit a round to the small set of questions that can change the implementation; the existing checkpoint resource bound is at most five questions and five rounds.

## Adjudication

For each exchange:

1. **Auto-pass:** current evidence and the approved brief support the implementation.
2. **Auto-revise:** the question exposes a defect and the resolution follows from the brief, project norms, decisions, or regression rules. Cite the source and record class A/B/C.
3. **Plan revisit:** implementation evidence changes a direction-level decision. Return to the brief and plan review.
4. **Human escalation:** available norms and evidence cannot settle a value choice. Present the question, defense, options, predicted ruling, confidence, and strongest contrary reason.

Evidence from a current database, runtime, external requirement, or code path outranks a remembered episode. Repository summaries do not replace external requirement text when the external meaning itself is disputed.

## Record

Append every exchange to the work-item adjudication file:

```text
## YYYY-MM-DD <slice> [impl]（tier: heavy）
- Q(<id>): <question>
  - 弁明: <evidence-backed answer>
  - 裁定: pass | revise(<source>; class: A|B|C) | plan-revisit | human(<ruling>)
  - by: auto | human
  - prediction: hit | miss | none
- ラウンド n・指摘計 m 件で APPROVED（confidence x.xx）
```

- A = decision, behavior, schema, or bug change.
- B = code/test reinforcement without direction change.
- C = record/document only.
- Human interventions outside the checkpoint are recorded too; `prediction:none` means spontaneous intervention.
- A later implementation-review finding that touches a decision is recorded as `Q(review/...)` in the same work item.
- A `plan-revisit` that overturns a completed direction trace's concept, owner, lifecycle, scope, value hierarchy, adopted direction, discarded alternative, or stated absence must first run `node .agents/scripts/append-direction-correction.mjs <work-item-file> --event-id <event-id> --source impl-interrogation --families <comma-list> --effect <effect> --high-risk <true|false> --summary '<sanitized summary>'`. Do not append one for test/inventory/wording-only gaps or code defects that leave the brief intact.
- Do not create a second episode ledger. Status, implemented plans, decisions, adjudications, and intent-bearing commit messages remain the episode sources.

## Discipline

- Prefer one consequential question over five predictable checks.
- Never treat APPROVED-with-unresolved-issues as approval.
- Do not add compatibility, fallback, or “just in case” protection without an explicit requirement.
- Do not use this checkpoint as a substitute for real DB verification, browser acceptance, plan review, or implementation review.
