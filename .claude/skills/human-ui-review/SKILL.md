---
name: human-ui-review
description: Review web, mobile, or desktop UI like a real human user, not only as a functional test. Use when checking local browser/simulator acceptance, visual polish, awkward or unnatural UI/UX, confusing copy, broken layout, unclear flows, forms, filters, tables, dialogs, empty/error states, accessibility sanity, or when a project-specific workflow asks for a human-like UX review pass.
---

# Human UI Review

Use this skill for the human judgment layer of UI acceptance: after the UI can be opened and the main action can run, inspect whether it would feel clear, natural, and usable to the intended user.

This skill is intentionally project-neutral. Project-specific skills or runbooks still own environment startup, accounts, DB/API checks, staging rules, artifact paths, and report naming.

## Workflow

1. **Load project context first**
   - Read the task, changed surface, intended role, and any project-specific UI acceptance/runbook instructions.
   - For product-visible work, extract the pre-implementation primary job, default-visible hierarchy, and exposure policy when they exist. Treat them as the hypothesis to evaluate, not as proof that the rendered result is good.
   - If the project has a product vocabulary, design system, recurrence ledger, staging-review notes, or prior human feedback, use those as local expectations.
   - Do not replace project-specific safety or evidence rules with this skill.

2. **Freeze the first-glance state before operating**
   - Capture the default viewport before opening forms, menus, drawers, or dialogs.
   - State the screen's primary job in one sentence and identify what a returning user most often needs to scan or change.
   - Do not let successful task completion retroactively make a cluttered first impression acceptable.

3. **Operate the UI as the target user**
   - Start one step before the changed control when feasible.
   - Complete the main path, then check one adjacent state: empty, error, post-save, back/return, cleared filter, cancelled dialog, or reloaded list.
   - Operate every newly visible or materially changed control at least once. Verify not only that state changes, but that a user can tell which result the control affected and why a disabled, empty, or no-result state occurred.
   - Prefer real browser/simulator interaction over DOM-only inspection for user-visible claims.

4. **Review for human friction**
   - Ask: “If I did not know the implementation, what would feel broken, surprising, unnatural, or unnecessarily hard?”
   - Record findings even if the functional assertion passes.
   - Fix P0/P1 findings in the changed surface before calling the UI acceptable, unless project scope explicitly defers them.

5. **Run an open-ended improvement pass**
   - After operating the journey, ask from the target user's perspective: “How could this screen be clearer, simpler, or faster to use?” Do not limit the answer to the preselected checklist or to defects already suspected from the diff.
   - Give each concrete proposal one disposition:
     - **auto-fix** — it stays inside the accepted direction and changed surface, has clear user benefit, does not add a new concept or risky semantic change, and can be verified by the same journey;
     - **direction revisit** — it changes the screen's primary job, value hierarchy, exposure policy, or another settled product choice;
     - **handoff** — it belongs to an unrelated or currently unowned surface;
     - **reject** — current evidence shows it would not improve the target task or would only move complexity elsewhere.
   - When implementation changes are permitted, apply auto-fix proposals without waiting for a separate polish request, then repeat the first-glance and affected journey. Stop when no P0/P1 and no clear, low-risk, in-scope auto-fix proposal remains; do not loop merely to generate more opinions.

6. **Capture evidence**
   - Keep screenshots or screen recordings when visual layout, spacing, clipping, or state visibility matters.
   - Keep concise DOM/URL/state notes for exact labels, roles, selected values, and control state.
   - Summarize raw artifacts rather than pasting secrets, tokens, full customer data, or bulky payloads into tracked docs.

## Checklist

Use only relevant items; do not force irrelevant checks.

### First glance / visual structure

- Is the primary next action obvious within a few seconds?
- Are headings, sections, cards, and tables grouped the way the target user thinks about the task?
- Are there overlaps, clipped labels, horizontal overflow, excessive whitespace, cramped controls, sticky elements hiding content, or hidden affordances?
- Does the first viewport show useful work context, or does it bury the actual task under summaries or chrome?

### Default-surface compression

Run this pass for management screens, lists, tables, reusable-item libraries, and create/edit surfaces.

1. Inventory the controls and always-open forms visible by default in the changed surface.
2. Classify each as:
   - **primary/frequent** — central to the screen's everyday job;
   - **secondary/occasional** — useful, but not needed for routine scanning or editing;
   - **lifecycle/destructive** — archive, deactivate, delete, reset, or other exceptional action.
3. For every secondary or lifecycle control, ask whether the primary task would become harder if it moved into an edit/detail surface, overflow menu, or contextual state. If not, defer it.
4. Challenge features that exist only because an API or implementation already supports them. Capability does not require a permanently visible affordance.
5. Prefer removing an unproven operation over inventing another menu, drawer, or abstraction merely to retain it.
6. Translate retained implementation states into user lifecycle language when the underlying capability is still necessary, such as preserving linked history through an `Archive` action rather than exposing an internal active flag.

Do not apply a numeric button limit. Dense incident response, bulk editing, and other genuinely frequent multi-action workflows may justify several visible controls; record the concrete user task that justifies each one.

### Copy and domain language

- Is visible copy natural for the product’s users, not raw engineer wording?
- Are internal IDs, raw provider states, stack errors, debug text, or implementation concepts leaking?
- Do empty, error, success, and disabled states explain what happened and what to do next?
- Are terms consistent with the current domain model and existing screens?

### Search, filters, and selection

- Can the user type immediately, or must they clear an all/placeholder value first?
- When a value is already selected, does typing replace it instead of appending in the middle?
- Are placeholder, selected value, clear/reset action, candidate list, and no-result state distinct?
- Do URL/query state, dependent selectors, counts, totals, and rows update together?
- For each visible search or filter control, operate one matching and one empty/no-result state. Is the affected result surface obvious without knowing the implementation?
- Avoid a standalone search field that silently filters a separate native selector unless the scale and task frequency justify both controls. Prefer a plain selector for a bounded option set; when type-ahead is genuinely needed, use one search-enabled combobox in which input, candidates, selection, and clear behavior form a single interaction.
- When candidates disappear or selection is disabled, can the user distinguish “all candidates are already selected,” “nothing matches,” “data is still loading,” and “loading failed”? A technically correct empty selector that looks broken is a UI finding.

### Forms and validation

- Are required fields and disabled buttons understandable before submission?
- On submit failure, does focus/scroll move to the first actionable problem?
- Is the error near the relevant action when a page-top alert would be easy to miss?
- Does back/return navigation preserve user-entered state when users would expect it?

### State feedback and timing

- Are loading, saving, created, copied, sent, disabled/enabled, stopped/resumed, deleted, and cleanup states immediately visible?
- Does the UI avoid duplicated current/previous content, flicker, delayed copy, stale list rows, or status that contradicts DB/API reality?
- Is selected/current state visually distinct without relying only on tiny or low-contrast text?

### Tables, lists, and zero states

- Are count/sum cards clear about scope, such as current filters vs current page?
- Are zero-row states natural and free of range bugs such as “1–0 items”?
- Are row actions visible, named by user intent, and not overloaded with identical labels?
- Does pagination/filtering remain useful for many rows, few rows, and zero rows?
- Is the list itself visible before an always-open creation form when returning users primarily scan, search, or edit existing items?
- Do row actions reflect frequency and risk, or do rare and destructive operations visually compete with the row's content?

### Dialogs and destructive actions

- Is the confirm action label specific enough to avoid confusing it with the opener?
- Are cancel vs execute actions visually and semantically clear?
- Does the post-confirm state prove what changed and offer a recoverable next action when appropriate?

### Accessibility sanity

- Can the key path be reached with ordinary focus order, Enter, Escape, and pointer interaction where expected?
- Do custom controls expose roles/names/states matching behavior, such as combobox/listbox/expanded/selected?
- Are focus indicators, hit targets, and contrast obviously usable? If uncertain, mark a UX note instead of silently passing.

## Severity

| Severity | Meaning | Handling |
| --- | --- | --- |
| P0 | Blocks task completion, risks wrong destructive action, hides critical state, or exposes unsafe/raw information | Must fix or stop |
| P1 | A human reviewer would likely file a UI defect: confusing next action, raw/old copy, clipped content, misleading zero state, recurring friction | Fix before acceptance when inside the changed surface |
| P2 | Polish issue: spacing, wording nuance, non-blocking minor friction, or unrelated adjacent surface | Record; fix if cheap and low-risk, otherwise hand off |

## Report template

When reporting results, include:

```md
## Human UI review

- User role / task:
- UI direction source / primary job / default-visible hierarchy:
- Screens reviewed:
- Main path operated:
- Adjacent state checked:
- Findings:
  - P0/P1/P2:
- Fixes made:
- Remaining UX notes / handoff:
- Default-surface action inventory:
  - Keep visible:
  - Defer/contextualize:
  - Remove or rename:
- Minimality verdict:
- Open-ended improvement proposals and dispositions:
- Auto-fixes applied / rerun result:
- Evidence artifacts:
```

If no blocking issue is observed, say: `No P0/P1 human-UI findings observed in the changed surface.`
