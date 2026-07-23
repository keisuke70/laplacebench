---
name: codex-implement
description: Delegate an implementation task to Codex via codex exec with a minimal trust-based contract, keep the session resumable for fix rounds, and keep all verification (review, interrogation, commit) on the caller's side.
user-invocable: true
metadata:
  tags: implementation, delegation, codex
---

# Codex Implementation Delegation

## When to Apply

Apply this skill when:
- User invokes `/codex-implement` or asks to have Codex implement something
- The project's role division assigns implementation to Codex while Claude orchestrates (plan, review, commit)
- An approved plan or an equivalently unambiguous spec exists for the work

## Core Principle: Trust, Don't Micromanage

Every `codex exec` session automatically receives the repo's `AGENTS.md` and the `.agents/skills/` skill list. Codex is a capable engineer that reads the plan and the norms itself. The delegation prompt fixes only the **contract** — goal, references, boundary, report format — and leaves the **how** entirely to Codex.

Do **not** put in the prompt:
- step-by-step implementation instructions, slice-internal ordering, or file-by-file edit lists
- restated repo norms (testing policy, regression gate, doc conventions — AGENTS.md already covers these)
- pasted plan, adjudication, or DR contents — reference paths instead and let Codex read them

If you feel the urge to specify how, that usually means the plan is underspecified — fix the plan, not the prompt.

## Delegation Prompt (the only fixed parts)

Write the prompt to a file (e.g. `/tmp/codex-impl-<slug>.txt`) with exactly four sections:

1. **Goal** — one or two sentences naming the task, plus the plan path. The plan is the spec; do not re-summarize it.
2. **References** — paths only: the plan file, the relevant work-item file under `docs/interrogation/adjudications/` (settled decisions — not to be re-litigated), and specific Decision Record paths if any.
3. **Boundary** —
   - Do not commit. The caller reviews and commits.
   - Do not run interrogation or review skills/runners; verification happens on the caller's side after handoff.
   - Do not revert or modify unrelated changes already present in the working tree.
4. **Completion report** — changed files, a brief summary, verification commands run with their results (typecheck, tests, regression gate), and any deviations from the plan with reasons.

Everything else — implementation order, file choices, migration numbering, test design — is Codex's call, guided by the plan and AGENTS.md.

## Execution

```bash
codex exec --sandbox workspace-write - \
  < /tmp/codex-impl-<slug>.txt \
  > /tmp/codex-impl-<slug>.log 2>&1
```

- `--full-auto` is deprecated; it maps to `--sandbox workspace-write`.
- Run from the repo root.
- Anything that may exceed a few minutes: run in the background (foreground shells typically cap execution time) and read the log when it completes.
- Record the session id for fix rounds. The log header prints it immediately, so this works even while the run is in progress:

```bash
grep -m1 '^session id:' /tmp/codex-impl-<slug>.log | awk '{print $3}' \
  > /tmp/codex-impl-<slug>.session
```

## Fix Rounds

After the caller-side verification produces accepted findings, send them back to the **same session** — never a cold restart, which loses all working context:

```bash
codex exec resume "$(cat /tmp/codex-impl-<slug>.session)" - \
  < /tmp/codex-impl-<slug>-fixes.txt \
  > /tmp/codex-impl-<slug>-r2.log 2>&1
```

- State each issue as **what is wrong and why**, with file references — not how to fix it.
- Restate the boundary in one line (no commit; report back). The rest of the contract persists in the thread.

## Caller's Pipeline After Handoff

The delegated session ends at the completion report. The caller then runs, in order:

1. Caller-side sanity check: confirm the reported typecheck, test, and regression-gate results yourself
2. For heavy slices only, `/interrogation` (impl checkpoint); light and standard slices send the six-item defense directly to review
3. `/codex-impl-review` — the same artifact-verification gate as for any implementation. On heavy slices, interrogation and review catch different defect classes (decision coherence vs. artifact findings); the reviewer being a fresh session is what matters, not which model implemented. Accepted findings go back to the implementing session as fix rounds (above)
4. Commit

None of these are delegated to the implementing session.

## Failure Handling

- Non-zero exit or missing completion report: read the log tail first, then prefer `codex exec resume` with a clarifying instruction over a cold restart.
- If Codex is unavailable or repeatedly fails, report the task as blocked and let the user decide whether the caller should implement instead — do not silently take over the implementation.
