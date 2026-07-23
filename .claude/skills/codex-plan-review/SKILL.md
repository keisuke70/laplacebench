---
name: codex-plan-review
description: Review implementation plans using the shared Codex runner with persistent resume state.
user-invocable: true
metadata:
  tags: plan, review, codex, quality
---

# Plan Review Skill

## When to Apply

Apply this skill when:
- User invokes `/codex-plan-review`
- A plan must be approved before implementation
- Repo instructions require plan-mode review before ExitPlanMode
- A plan exists only as inline notes and must be formalized into `docs/plans/...` before review

Tier note: plan review runs for standard and heavy slices. Light slices (per the project's risk-tier rules in CLAUDE.md) skip planning and plan review entirely; their only gate is implementation review.

## Plan Mode Compatibility

- Some Codex Plan Mode variants say not to mutate repo-tracked files.
- In repos that require formal plan review, treat `docs/plans/...` creation/update, temporary review-prompt file creation, and `bash .agents/scripts/run-codex-review.sh plan ...` as required plan-finalization work, not implementation.
- Do not stop at `<proposed_plan>` or a chat-only plan because built-in Plan Mode asked for a non-mutating finish.
- If the environment truly hard-blocks those steps, report the task as blocked by plan-mode/tooling incompatibility instead of silently skipping review.

## Required Runner

Always use the shared runner. Do not call raw `codex exec`, `codex exec resume`, or manage `CODEX_THREAD_ID` manually.

```bash
bash .agents/scripts/run-codex-review.sh plan <session-key> < review-prompt.txt
```

- Always pass the same stable `session-key` on the CLI for every round of the same plan review
- The runner injects the same `Session-Key:` header into the prompt automatically
- The runner persists sessions under `.agents/state/`
- The runner now writes the thread id as soon as the review starts and rejects duplicate in-flight runs for the same `session-key`
- On re-review, the runner resumes the same thread and injects the previous verdict plus a scoped file-change summary so updated plans are re-evaluated against the current files
- The runner handles structured output parsing, resume fallback, and session reset behavior
- Run the command from the repo root

### Runner wait discipline

- After starting the runner, wait until the process exits by itself. The runner has its own timeout (`CODEX_REVIEW_TIMEOUT_SECONDS`, default 300s) and prints heartbeat lines while Codex is still working.
- A heartbeat such as `[run-codex-review] still running...` is progress, not failure. Keep polling the running tool session; do not press Ctrl-C, start a retry, or count a failed attempt while the original process is still alive.
- Count a runner failure only after the command exits non-zero, the runner reports timeout/error, or the user explicitly cancels the review. If the user asks for status while it is running, report that it is still running and continue waiting.
- Do not shorten the runner timeout or wrap it in a smaller shell timeout unless the user explicitly asks for a shorter bound for that run.

## Prompt Requirements

The review prompt should include:
- the target plan path, ideally under `docs/plans/`. The plan must open with a `## Direction Brief` section and carry `direction: <session-key> | exempt` frontmatter (see Review Boundary); a missing brief on a non-exempt plan is a blocking issue in itself
- related files and Decision Records, explicitly enumerated instead of broad directories
- for concept moves, ownership changes, field removals, or UI/API consolidation: the repo-wide search terms used and a source-of-truth inventory that classifies matching fields/routes/UI as `canonical`, `derived copy`, `snapshot/history`, `legacy residue`, or `delete`
- review criteria focused on the pre-implementation question: `Should / Why / What not`
- on re-review, a `Parent-Adjudication:` block with exactly one ordered disposition per prior issue, in the prior issue order: `1. ACCEPT ...`, `2. REJECT ...`, or `3. DEFER ...`; missing, duplicate, extra, or out-of-order lines deliberately retain full review
- the Human Direction Proxy dialogue/adjudication entries for this work item (`[direction]` heading) when the dialogue ran — these are settled decisions

Keep the review scope tight:
- Prefer a concrete file list over "search the repo" wording
- Limit related files to the minimum needed for the plan, ideally under 12 paths
- Limit Decision Records to the specific relevant paths, not `docs/decisions/` as a whole
- Keep `Parent-Adjudication:` concise and limited to the latest round; the shared runner owns any bounded compact/full pilot assignment

Exception for root-model changes:
- If the plan moves a source of truth, removes a concept, merges/splits entities, changes ownership, or replaces an old UI/API surface, the reviewer must not be constrained to the enumerated files.
- Require a semantic search across same-name and same-meaning fields, routes, UI labels, migrations, seeds, fixtures, import scripts, and Decision Records before accepting the plan's scope.
- Treat missing search evidence or an unclassified matching field as a blocking issue, even if the proposed edits themselves look coherent.

Compatibility / backfill / fallback suggestions are out of scope by default:
- The review goal is the quality of the final deliverable, not preservation of the old system.
- Do not raise issues asking the plan to add backward-compatibility shims, legacy-data backfill, old/new dual-path support, "just in case" branches, or migration-period fallbacks unless the plan itself names such a requirement (production data migration, released public API, parallel-run period, external-integration contract, etc.).
- Treat plans that target the new spec only as legitimate; do not assume coexistence with existing local data, dev-DB seeds, or prior API shapes is required.
- This restriction applies only to *adding* compatibility concerns. If the plan itself proposes unnecessary fallbacks or dual paths, flagging them as over-engineering is still in scope.

If the plan is still inline only, create the dated `docs/plans/...` file first. Reviewing a chat-only plan is not sufficient for this repo.

## Review Boundary

Division of labor with `/human-direction-proxy`: decision-level challenges (purpose, root premise, best/normal form, necessity, value tradeoffs, scope) are settled through proposal-visible dialogue **before the plan is written** and arrive as (a) the plan's leading `## Direction Brief` section and (b) `[direction]` adjudication entries. This review verifies the resulting document — that the plan faithfully implements its own brief (no scope drift, no re-decided direction, discarded alternatives stay discarded), plus inventory completeness, concept-model clarity, absence enumeration, search evidence, validation design, internal consistency, implementability. Re-open a brief-settled decision only with evidence the dialogue did not have. **If the plan has no Direction Brief and no `direction: exempt` marker, block it. If adjudication entries are missing but the brief exists, apply the full question set below yourself.**

Plan review is the place to question the premise before code exists. It should optimize for minimum future rework by forcing the plan to state the product norm that implementation must follow.

Use this split:
- Plan Review: `Should / Why / What not`
- Implementation Review: `Did / How / What leaked`

Do not defer root conceptual questions to implementation review. If the plan cannot explain the target concept model, deleted concepts, value tradeoffs, and validation shape, it is not ready for implementation.

The reviewer must challenge the frame of the plan, not only its internal consistency. A plan can be well written and still wrong if it accepts an old table, field, route, UI control, seed fixture, or compatibility path as a harmless detail when the new concept model should delete it. When a change says "X now belongs to Y", the default review stance is: every old owner of X is suspect until classified.

For source-of-truth moves and concept cleanup, block the plan unless it includes a classification table like:

```text
Concept/field: <name and synonyms>
Target canonical owner: <table/service/UI/API>
Current occurrences:
- <path or table/field>: canonical | derived copy | snapshot/history | legacy residue | delete
Deletion/rejection rule:
- <old payload/UI/field> is rejected/removed because <reason>
Evidence:
- rg/search terms used: <terms>
- migrations/seeds/imports checked: <paths>
```

## Required Review Questions

Two groups with different jobs. D-points were adjudicated upstream in the direction dialogue and live in the plan's `## Direction Brief` (including its 消えるもの・守らないもの field): verify the plan text **records** each outcome; re-litigate only with evidence the dialogue did not have. R-points are owned by this review: evaluate them fresh every time. If no Direction Brief or adjudication record is supplied (e.g. `direction: exempt`), evaluate the D-points yourself in full.

**D. Settled by direction — verify the recording, do not re-derive**

- D1. **Root premise challenge**: Is the plan solving the right problem, or has it accepted an old modeling assumption as fixed? What would be deleted or simplified if the new concept were taken literally?
- D2. **Premise audit**: Which existing code, schema, UI, seed data, import scripts, migrations, docs, or API assumptions should be treated as historical residue rather than truth?
- D3. **Negative ontology**: Does the plan state what concepts, branches, compatibility paths, options, fields, routes, payloads, fixtures, or UI surfaces should not exist after the change?
- D4. **Deletion bias**: When a concept moves, does the plan delete old owners by default and justify every retained copy as a derived copy or snapshot with an expiry/cleanup path?
- D5. **Value hierarchy**: Does the plan say what not to protect, such as local test data, old API shapes, legacy fields, temporary drafts, or unused fallbacks?

**R. Owned by this review — evaluate fresh every time**

- R1. **Brief fidelity**: Does the plan implement its `## Direction Brief` — same purpose, same adopted direction, discarded alternatives not reintroduced, residual escalations still open rather than silently decided?
- R2. **Source-of-truth inventory**: For every moved/removed/consolidated concept, does the plan enumerate all current owners and classify each as canonical, derived copy, snapshot/history, legacy residue, or delete?
- R3. **Concept model**: Are the entities, lifecycles, relationships, and ownership boundaries clear enough that implementation has one target?
- R4. **Absence hunt**: Does the plan enumerate required but easy-to-miss capabilities: create, edit, delete, discard, error, empty, disabled, and surrounding navigation states?
- R5. **Concept-graph blast radius**: Does it cover semantically connected areas, not just files likely to be edited? Did it search synonyms and sibling concepts, not only the obvious field name?
- R6. **Validation design**: Does it define what evidence proves success, including semantic UI checks, invariant tests, migration checks, absence checks, and browser flows where relevant?

Block plans that only describe code edits but do not settle the underlying product norm. Also block plans that lack an occurrence inventory for moved/removed concepts, classify old owners as harmless without proof, or keep old fields/UI/routes because they are "metadata" without explaining why they are not the displaced concept. Flag plans that add compatibility, archive, fallback, merge, or "just in case" branches without a stated requirement and expiry.

## Review Loop

1. Run the review with the runner.
2. If verdict is `NEEDS_CHANGES`, judge each issue before editing: `accept`, `reject`, or `defer`.
3. Add the exact ordered `Parent-Adjudication:` dispositions to the next review prompt so the reviewer sees your judgment.
4. Update the plan file only for accepted issues, not just the chat response.
5. Re-run the same runner command with the same `session-key`.
6. Repeat until `APPROVED`.
7. If the review is not converging after a few rounds, stop looping: summarize the unresolved issues and ask the user whether to proceed, revise, or drop them. Do not exit plan mode silently without approval or user sign-off.

After the review, close the loop into the adjudication log (`docs/interrogation/adjudications/` — one file per work item, `YYYY-MM-DD-<slug>.md`; canonical format: interrogation skill, Record section):
- Record each accepted finding that touched a decision — a wrong premise, scope, or ownership, not a mere document gap — as a `Q(review/...)` entry under the work item (finding restated as a question, defense, ruling; revise rulings carry `class: A|B|C`), so review findings feed distillation like interrogation exchanges do.
- If that accepted finding overturns a completed direction trace's concept, owner, lifecycle, scope, value hierarchy, adopted direction, discarded alternative, or stated absence, run `node .agents/scripts/append-direction-correction.mjs <work-item-file> --event-id <event-id> --source plan-review --families <comma-list> --effect <effect> --high-risk <true|false> --summary '<sanitized summary>'` before updating the brief and repeating plan review. Do not emit a correction for inventory, tests, rollback detail, wording, or other mechanical completeness findings that leave the brief intact.
- On `APPROVED`, append the closing line `- ラウンド n・指摘計 m 件で APPROVED（confidence x.xx、条件があれば付記）` (`m` = total issues raised across all rounds). The work-item heading must carry the `（tier: light|standard|heavy）` tag. This applies even when the direction dialogue was skipped — create the work-item heading just for the closing line. The hygiene loop mines review-round KPIs from these lines.

Do not treat a runner-path mistake or transient review failure as permission to skip the review.

## Fallback

- If Codex is unavailable or repeatedly fails, report the task as blocked instead of exiting plan mode without approval.
- Failures are surfaced as sanitized `[run-codex-review] ...` summaries with categorized hints, not raw stderr passthrough.
- Minor style-only issues are not blocking.
