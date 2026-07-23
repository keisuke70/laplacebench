---
name: codex-impl-review
description: Review implementation code using the shared Codex runner with persistent resume state.
user-invocable: true
metadata:
  tags: implementation, review, codex, quality
---

# Implementation Review Skill

## When to Apply

Apply this skill when:
- User invokes `/codex-impl-review`
- Repo instructions require an implementation review before reporting completion
- The change touches behavior, schema, or the concept model, or you are not fully confident in it — regardless of file count. Mechanical low-risk edits (typos, config values, docs, simple renames) may skip review even when large. When unsure, review.

Tier composition (risk-tier rules: project CLAUDE.md):
- **Light slices**: this review is the only gate (after verify + regression gate). Include the implementer's 6-item defense in the prompt. For a bounded corrective change, also include the tier defense: exact prior/user contract, prohibited semantic deltas confirmed absent, bounded blast radius, and failing regression reproducer.
- **Standard slices**: no separate impl interrogation runs; the 6-item defense (see interrogation skill, Implementation checkpoint) is bundled into this review's prompt and the reviewer verifies defense-vs-diff.
- **Heavy slices** (migration, data semantics, money, permissions, cutover, irreversible migration): the impl interrogation runs first; its adjudication entries are passed in as settled decisions.

## Required Runner

Always use the shared runner. Do not call raw `codex exec`, `codex exec resume`, or manage `CODEX_THREAD_ID` manually.

```bash
bash .agents/scripts/run-codex-review.sh impl <session-key> < review-prompt.txt
```

- Always pass the same stable `session-key` on the CLI for every round of the same implementation review
- The runner injects the same `Session-Key:` header into the prompt automatically
- The runner persists sessions under `.agents/state/`
- The runner now writes the thread id as soon as the review starts and rejects duplicate in-flight runs for the same `session-key`
- On re-review, the runner resumes the same thread and injects the previous verdict plus a scoped file-change summary so fixes are re-evaluated against the current files
- The runner handles structured output parsing, resume fallback, and session reset behavior
- Run the command from the repo root

### Runner wait discipline

- After starting the runner, wait until the process exits by itself. The runner has its own timeout (`CODEX_REVIEW_TIMEOUT_SECONDS`, default 300s) and prints heartbeat lines while Codex is still working.
- A heartbeat such as `[run-codex-review] still running...` is progress, not failure. Keep polling the running tool session; do not press Ctrl-C, start a retry, or count a failed attempt while the original process is still alive.
- Count a runner failure only after the command exits non-zero, the runner reports timeout/error, or the user explicitly cancels the review. If the user asks for status while it is running, report that it is still running and continue waiting.
- Do not shorten the runner timeout or wrap it in a smaller shell timeout unless the user explicitly asks for a shorter bound for that run.

## Prompt Requirements

The review prompt should include:
- changed files, explicitly enumerated
- related Decision Records, explicitly enumerated
- plan reference if one exists (its leading `## Direction Brief` is the intent source)
- **the implementer's 6-item defense** (light/standard slices — this replaces the separate impl interrogation; the reviewer verifies the defense against the diff)
- for bounded corrective light changes, the tier defense and an explicit instruction to return a blocking `tier-escalation` finding if the diff introduces schema/state/contract, authorization enforcement or identity trust, payment/accounting semantics, legacy data meaning, cutover/irreversible operations, external integration semantics, new concepts, or if any predicate is unknown. Read-only legacy interpretation changes and credential/trust-validation changes are heavy counterexamples, not light corrections
- review criteria focused on the post-implementation question: `Did / How / What leaked`, plus the Fixed Checks below
- an explicit reviewer boundary: the reviewer must inspect the scoped diff directly and must not invoke `/codex-impl-review`, `/codex-plan-review`, `run-codex-review.*`, raw `codex exec`, or another review agent
- on re-review, a `Parent-Adjudication:` block with exactly one ordered disposition per prior issue, in the prior issue order: `1. ACCEPT ...`, `2. REJECT ...`, or `3. DEFER ...`; missing, duplicate, extra, or out-of-order lines deliberately retain full review
- the impl-checkpoint adjudication entries for this slice from the adjudication log, when the impl interrogation ran (heavy slices) — settled decisions and promised revisions

Keep the review scope tight:
- Prefer a concrete changed-file list over "inspect the repo" wording
- Limit target files to the minimum needed for the review, ideally 3-10 paths and at most 15
- Limit Decision Records to the specific relevant paths, not `docs/decisions/` as a whole
- Ask the reviewer to read only minimal neighboring files needed to validate a claim
- Keep `Parent-Adjudication:` concise and limited to the latest round; the shared runner owns any bounded compact/full pilot assignment

Default review stance for early-stage development:
- Do not assume backward compatibility, legacy fallbacks, or old/new dual-path support are required just because the previous version worked that way.
- If active users or an explicit requirement do not justify them, treat compatibility-only branches, silent fallbacks, and temporary migration shims as likely design debt to remove rather than preserve.

## Fixed Checks（固定チェック — 毎回評価する）

Distilled from repeated review findings the earlier checkpoints kept missing (2026-07-03 distillation, `Q(review/...)` types with 2+ recurrences). Evaluate each against the diff; skip only with a stated reason:

1. **Enforcement boundary**: every UI-level guard (sold guard, feature flag, preview boundary, inactive-row lock) must hold at the backend boundary too — direct API call, service/core path, CLI. A frontend-only invariant is a finding.
2. **Fail-closed counterexamples**: NULL / empty set / zero / zero-date / one-sided absence must not resolve to success, ignore, or safe. Ask for the negative test.
3. **Composite identity**: legacy/current linkage, migration sources, grouping, archive reads must key on the full tuple (tenant/world/sourceSystem/source id), not a single id or display name.
4. **Stale-wording sweep**: after any decision change, grep plan text, validation messages, status docs, test names, and external-answer drafts for leftovers of the overturned decision.
5. **Immutable issued artifacts**: issued receipts/orders/tickets and confirmed outputs must not change when live settings, assets, route policies, or product names change later — values are snapshotted at issue time.
6. **Pinned invariants**: implemented blockers, replay no-ops, idempotency, and fail-closed branches must be pinned by tests, or a refactor regresses them silently.
7. **Leakage**: checksums, reports, smoke artifacts, raw snapshots must not leak PII or stable oracles.
8. **Concurrency/atomicity**: double submit, concurrent scans, load/parse/delete races, transaction rollback paths are counterexamples to enumerate, not afterthoughts.

## Review Boundary

Division of labor: `/human-direction-proxy` settles direction before planning; for heavy slices only, `/interrogation` then pre-clears unplanned artifacts, plan deviations, and premises discovered during implementation, and its `revise(...)` rulings are commitments. This review verifies the artifact: **that adjudicated revisions actually landed in the diff** (or, for light/standard slices, that the bundled 6-item defense matches the diff — unplanned artifacts cite a requirement source or are presumed removable), plus bugs, logic errors, invariant enforcement, concept-boundary integrity in code, security, and test alignment. Re-open an adjudicated decision only with new evidence. **If neither an adjudication record nor a defense is supplied, apply the full question set below yourself.**

Implementation review is not the first place to redesign the product concept. Its default job is to compare the actual diff against the accepted intent and catch ways the implementation betrayed it. If a plan exists, the plan is the primary intent source. If no plan exists, use the user's request, change narrative, relevant Decision Records, and established project norms.

Use this split:
- Plan Review: `Should / Why / What not`
- Implementation Review: `Did / How / What leaked`

If implementation reveals that the accepted intent is wrong or underspecified, block with "return to planning/clarification" rather than inventing a new design inside implementation review. Otherwise, keep findings grounded in the diff, tests, and the available intent source.

## Required Review Questions

Ask the reviewer to evaluate these points explicitly:

1. **Intent fidelity**: Does the diff implement the accepted concept model, lifecycle, scope, and value hierarchy from the plan if present, otherwise from the user request and change narrative?
2. **Unauthorized defenses**: Did the implementation add unstated compatibility shims, legacy fallbacks, archive paths, merge logic, broad queries, or "just in case" branches?
3. **Old-concept removal**: Were concepts, fields, UI surfaces, and branches that the accepted intent said to remove actually removed, rather than hidden behind new code?
4. **Concept boundary integrity**: Do APIs, queries, services, and UI surfaces keep concept layers separate, especially when storage tables are reused?
5. **Invariant implementation**: Are the required invariants enforced in code and tests, including semantic duplicate prevention, ownership boundaries, and lifecycle rules?
6. **Absence closure**: Are required capabilities present in the actual product surface, including edit, delete, discard, empty, error, disabled, and navigation states?
7. **UX reality check**: Does the implemented screen or flow behave naturally, without dead controls, duplicate surfaces, unexplained labels, or unnecessary steps?
8. **Test alignment**: Do tests verify user-visible behavior and invariants, not merely implementation details or happy-path plumbing? For stateful UI, do tests cover **transitions**, not only initial renders: when the source of a derived display, validation, or payload changes through user interaction, is there a test asserting the derivative follows? A derivation computed from initial/saved/props copies instead of the current canonical state is a defect even if every initial-render test passes.

When an adjudication record is supplied, questions 1–3 are usually settled there: verify the recorded rulings are reflected in the actual diff, instead of re-litigating them, and concentrate scrutiny on 4–8.

Flag any code that makes the final system harder to explain even if it appears locally safe. Prefer findings that identify leaked old assumptions, missing planned deletions, or unreviewed compatibility logic over generic style advice.

## Review Loop

1. Run the review with the runner.
2. If verdict is `NEEDS_CHANGES`, judge each issue before editing: `accept`, `reject`, or `defer`.
3. Add the exact ordered `Parent-Adjudication:` dispositions to the next review prompt so the reviewer sees your judgment.
4. Fix only accepted material findings.
5. Re-run the same runner command with the same `session-key`.
6. Repeat until `APPROVED`.
7. If the review is not converging after a few rounds, stop looping: report the unresolved issues to the user and let them decide, instead of claiming completion.

After the review, close the loop into the adjudication log (`docs/interrogation/adjudications/` — one file per work item, `YYYY-MM-DD-<slug>.md`; canonical format: interrogation skill, Record section):
- Record each accepted finding that touched a decision — a missed invariant, a wrong lifecycle or scope, not a mere code defect — as a `Q(review/...)` entry under the work item (finding restated as a question, defense, ruling; revise rulings carry `class: A|B|C`), so review findings feed distillation like interrogation exchanges do.
- If a finding blocks implementation with return-to-planning because runtime/diff evidence overturns a completed direction trace's concept, owner, lifecycle, scope, value hierarchy, adopted direction, discarded alternative, or stated absence, run `node .agents/scripts/append-direction-correction.mjs <work-item-file> --event-id <event-id> --source impl-review --families <comma-list> --effect <effect> --high-risk <true|false> --summary '<sanitized summary>'` before updating the brief/plan and repeating plan review. A code bug or fixed-check finding that leaves the brief intact is not a correction.
- On `APPROVED`, append the closing line `- ラウンド n・指摘計 m 件で APPROVED（confidence x.xx、条件があれば付記）` (`m` = total issues raised across all rounds). The work-item heading must carry the `（tier: light|standard|heavy）` tag. This applies even when no interrogation ran for the slice — create the work-item heading just for the closing line. The hygiene loop mines review-round KPIs from these lines.

## Fallback

- If Codex is unavailable or repeatedly fails, report the task as blocked instead of skipping review.
- Failures are surfaced as sanitized `[run-codex-review] ...` summaries with categorized hints, not raw stderr passthrough.
- Minor style-only issues are not blocking.
