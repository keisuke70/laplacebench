---
name: agent-skills-upstream-sync
description: Sync shared skill, runner, and shared-instructions changes between the current project and the sibling ../agent-skills repo. Use when a project-local edit should become the shared source of truth, or when the latest shared skills should be pulled back into the current project.
---

# Agent Skills Sync Workflow

The sibling repo `../agent-skills` is the **single source of truth** for shared skills, the review runner, and the shared-instructions block. Project copies are build artifacts of `sync.sh` — never edit them directly.

## Layout

| Upstream (`../agent-skills`) | Synced to (each project) |
|---|---|
| `skills/claude/<name>/` | `.claude/skills/<name>/` |
| `skills/agents/<name>/` | `.agents/skills/<name>/` |
| `skills/mobile/<name>/` | `.claude/skills/<name>/` (only with `--mobile`) |
| `scripts/*` (runner, review-schema) | `.agents/scripts/*` (+ `review-schema.json` → `.claude/skills/`) |
| `instructions/shared-instructions.md` | `BEGIN/END SHARED INSTRUCTIONS` block in `CLAUDE.md` and `AGENTS.md` |

## Iron rules

1. **Dual-tree parity**: a shared skill that exists for both Claude and Codex (codex-plan-review, codex-impl-review, interrogation, …) must be **byte-identical** in `skills/claude/` and `skills/agents/`. Edit one, `cp` to the other in the same change. `sync.sh` warns on drift — treat the warning as a defect (a 2026-06 drift left Claude running a weaker review for two weeks)
2. **Run `sync.sh` from the project root**, never from inside `agent-skills` (it refuses)
3. **Deletions propagate automatically**: remove the skill from both upstream trees and run sync — project copies carrying the `.synced-from-agent-skills` marker are pruned. Project-local skills (no marker) are never touched
4. **Finish the job**: after any upstream change, run sync in affected projects and **commit & push both repos** in the same task — no per-step confirmation needed (standing user instruction, 2026-06-10)

## Standard flows

### Change a shared skill (or runner / shared-instructions)

```bash
# 1. edit upstream — both trees stay identical
vi ~/agent-skills/skills/claude/<name>/SKILL.md
cp ~/agent-skills/skills/claude/<name>/SKILL.md ~/agent-skills/skills/agents/<name>/SKILL.md

# 2. distribute (from the project root)
bash ~/agent-skills/sync.sh --no-pull

# 3. verify, then commit & push BOTH repos
git -C ~/agent-skills diff; git diff
```

### Project-first edit → promote upstream

When a shared asset was edited inside a project first: copy the project file to **both** upstream trees (or `instructions/shared-instructions.md` for the shared block, `scripts/` for the runner), then re-run sync so the project copy is regenerated from upstream, then commit & push both repos. Review the upstream diff so project-only content does not leak in.

### Add a new shared skill

Create `skills/claude/<name>/SKILL.md`; if Codex should see it too, `cp -r` to `skills/agents/<name>/`. Sync, commit & push.

### Remove a shared skill

`rm -rf` it from both upstream trees, sync in each project (prune handles the project copies), commit & push everywhere.

## Out of scope

- **Project-local skills and twins** (`linket-reconcile`, `.agents/loop/*`, project question banks, ledgers): not managed by sync. When such a skill has `.claude`/`.agents` twins, update both by hand in the same change — the only intentional difference is CLAUDE.md↔AGENTS.md wording
- Project-specific app logic, docs, and bindings (e.g. `docs/interrogation/question-bank.md`) stay in the project

## Notes

- The shared-instructions block is replaced wholesale between the `BEGIN/END SHARED INSTRUCTIONS` markers; project-specific sections outside the markers are untouched
- `sync.sh --no-pull` skips the upstream `git pull`; use plain `sync.sh` when you want to fast-forward first
- Always inspect both repos' diffs before committing; commit first, then push, then verify the remote advanced
