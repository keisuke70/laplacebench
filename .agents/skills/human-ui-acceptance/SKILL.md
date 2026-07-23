---
name: human-ui-acceptance
description: Compile and execute evidence-based UI acceptance for a changed journey, keeping functional behavior and human UI quality as independent verdicts. Use after implementation in a browser, simulator, or desktop app, especially when a project supplies local or deployed-environment adapters.
---

# Human UI Acceptance

Use this skill to turn a rendered product change into a bounded acceptance journey with explicit evidence. It coordinates functional proof with `human-ui-review`; it does not replace product direction, environment startup, authentication, fixture safety, deployment rules, or project-specific reporting.

## Ownership boundary

- The accepted product direction or prior contract owns the screen's primary job, value hierarchy, exposure policy, and deliberate absences.
- This skill owns journey compilation, evidence separation, two-axis verdicts, and fix/rerun behavior.
- `human-ui-review` owns detailed visual, interaction, copy, accessibility, and human-friction judgment.
- Project adapters own environment startup, accounts and authentication, fixtures, side-effect authorization, cleanup, artifact paths, and local versus deployed scope.

Rendered evidence that disproves the accepted direction returns to direction/planning. A screen that merely fails to implement that direction is fixed and rerun.

## 1. Declare scope before operating

Record:

```text
Environment / direction source:
Target role and routine task:
Entry, changed surface, and adjacent state:
Selected semantic flags:
Selected operations and applicable safety contract:
Required visual, semantic, and persistence evidence:
External or native gap:
```

Select the smallest journey that proves the changed meaning: start one step before the changed control, perform the main action, observe the post-action state, and check the single reload, navigation, recovery, or adjacent read that best proves the outcome. Add roles, states, viewports, or downstream surfaces only when their meaning differs or the change can affect them.

A selected obligation means an attempted obligation. If a selected action or evidence source cannot be attempted, record the observed boundary and mark the affected axis `BLOCKED`; do not silently remove it, infer success, or relabel unavailable evidence as not applicable.

Load protected-operation, authentication, fixture, external-delivery, or failure-diagnostic instructions only when the selected journey needs them. Unknown authorization, ownership, cleanup, or side-effect class means stop or remain read-only according to the project adapter; never guess.

## 2. Compile obligations from semantic delta

Select only applicable flags:

| Semantic delta | Minimum obligation |
| --- | --- |
| `mutation` | action → post-action → reload/readback; include eligibility or recovery when affected |
| `visible-copy` | rendered wording versus the current task and capability |
| `prerequisite` | absent-precondition state; prevent or explain impossible submit before failure |
| `composition` | changed block with surrounding page and default-surface compression |
| `shared-control` | changed instance and one same-kind sibling; prefer the shared component when semantics match |
| `responsive` | primary viewport plus one relevant narrow semantic viewport |
| `cross-surface` | writer action plus one downstream read surface |
| `create-edit` | rendered create/edit field and action comparison, including intentional differences |
| `list-summary` | first viewport plus the relevant zero/one/many or collapsed/expanded contrast |

These flags compile one journey; they are not independent test passes. One mutation can cover state, copy, eligibility, and downstream readback. One surrounding screenshot can cover hierarchy, density, and consistency. Expand only when observed evidence contradicts the expectation or exposes a concrete adjacent risk.

For a deployed environment, also establish the exact deployed revision or state being observed. Deployment health is not UI acceptance, and local evidence does not prove an unobserved deployed revision.

## 3. Capture first glance, then operate

1. Confirm environment, role, route/window, and target identity.
2. Capture the default viewport before opening forms, menus, dialogs, OAuth/provider flows, or native UI. Preserve transient or non-repeatable states before leaving them.
3. Operate every newly visible or materially changed control needed by the selected journey.
4. Observe feedback and the selected reload, navigation, recovery, or adjacent read.
5. Measure the semantic viewport before making responsive claims.
6. Apply `human-ui-review` to the same evidence bundle.

For `composition`, `create-edit`, or `list-summary`, inventory default-visible controls and classify them as primary/frequent, secondary/occasional, or lifecycle/destructive. Decide which stay visible, move into context, disappear, or use user lifecycle language. Justify density with concrete routine tasks, not implementation capability or an arbitrary control limit.

## 4. Keep evidence classes separate

- Use screenshots or recordings plus measured viewport for layout, prominence, spacing, clipping, overflow, tone, and responsive claims.
- Use visible text, accessibility/semantic state, URL/window state, and control state for wording, navigation, eligibility, and feedback.
- Use API, database, filesystem, or other readback only for persistence and invariants, never as visual proof.

DOM or semantic assertions do not prove appearance. A screenshot does not prove persistence. A successful health check does not prove the journey. Tool, authentication, fixture, provider, or native-UI failures are recorded at the boundary actually observed, not converted into an application defect or a pass.

Never retain credentials, cookies, tokens, MFA values, raw email addresses, scannable codes, raw customer data, or stable secret-like identifiers in reports or artifacts.

## 5. Judge two independent axes

### Functional

- the intended action or state transition occurred;
- persistence, deletion, publication, or recovery survived the selected readback;
- selected writer and downstream views agree;
- affected empty, error, disabled, cancel, or recovery behavior works.

### Human UI

- first glance makes purpose, current state, and next action clear;
- copy matches the user's language and current capability;
- hierarchy, density, prominence, tone, and neighboring components are coherent;
- validation and state feedback appear near the action;
- the selected viewport has no clipping, overlap, overflow, or hidden required content.

“It can be clicked” is not a Human-UI pass. “It looks natural” is not functional persistence evidence.

Use:

- `functional_result = PASS | FAIL | BLOCKED | NOT_APPLICABLE`
- `human_ui_result = PASS | FINDINGS | BLOCKED | NOT_APPLICABLE`

`NOT_APPLICABLE` requires a written reason. Functional N/A is appropriate for a genuinely visual-only change. Human-UI N/A requires evidence that there is no rendered delta. Unavailable evidence is `BLOCKED`, not N/A.

Aggregate in this order:

1. functional `FAIL` → `FUNCTIONAL_FAIL`;
2. either axis `BLOCKED` → `BLOCKED`;
3. Human-UI `FINDINGS` → `UI_FINDINGS`;
4. all applicable axes pass, with justified N/A only → `PASS`.

## 6. Fix and rerun

Fix in-scope P0/P1 Human-UI findings and functional failures, then rerun the shortest same journey that proves the correction. Also fix clear, low-risk, in-scope improvements when implementation changes are permitted and the same journey can verify them.

Give other proposals one disposition:

- `direction-revisit` — changes the primary job, value hierarchy, exposure policy, scope, or risk tier;
- `handoff` — belongs to a genuinely different or externally owned surface;
- `reject` — lacks task benefit, merely moves complexity, or contradicts current evidence.

Stop when no functional failure, P0/P1 finding, or evidence-backed in-scope fix remains. Do not repeat critique merely to generate more opinions.

## Screenshot or capture failure

1. Check window/tab inventory, route/title, and one bounded target semantic assertion.
2. Re-establish target identity and retry once only after state materially changed.
3. If needed, try one qualifying target-surface capture path allowed by the project adapter; a control surface can classify tooling failure but cannot prove the target.
4. Keep semantic and viewport evidence separate. Block only the evidence lane that remains unavailable.
5. Do not replay an already-proved irreversible or externally visible mutation merely to recover a screenshot.

## Report template

```text
Environment / revision / observation limit:
Direction source / role / task:
Changed surface and adjacent state:
Selected semantic flags and operations:
Steps actually operated:
First-glance and responsive artifacts:
Semantic and persistence/readback evidence:
Default-surface inventory/minimality, if applicable:
functional_result / human_ui_result / overall:
Findings, fixes, and rerun:
Cleanup or retained state:
Unverified external/native residual and owner:
```

Repeated human misses may sharpen one obligation or justify a scripted scenario. Replace weaker guidance instead of appending incident transcripts or growing a universal checklist.
