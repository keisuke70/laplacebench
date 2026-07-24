# Product CPU adapter — naming and interface spec

> **Revision 2026-07-24 — implemented, transport changed to a local Python
> bridge.** The naming convention below is unchanged and now live
> (`product-cpu:cpu-v4:level_1` … `level_5`). The HTTP transport this spec
> originally assumed (kept below as historical record) was replaced because:
> (1) the per-move regret oracle requires `MinimaxAgent.
> score_root_moves_for_analysis`, which the product HTTP API does not expose
> (`/api/health` and `/api/move` only); (2) the product checkout's venv lacks
> `uvicorn`, so the HTTP server cannot run without modifying the product
> environment; (3) one contract now serves both the arena baseline and the
> regret oracle. The bridge (`packages/cli/bridge/product_cpu_bridge.py`,
> protocol `product-cpu-bridge-v1`, stdlib-only, bare python3) replicates
> `app.py`'s resolution path (`get_cpu_level` → `MinimaxAgent(profile,
> strict_profile=True)`, fresh agent per request) and fail-closes on
> policy/commit/dirty/tier mismatches; provenance (policy_version, product
> commit, python version) is recorded in `run.json` and all regret outputs.
> Only the five cpu-v4 visible tiers are addressable; `level_6`…`level_13`
> compat aliases are deliberately not exposed. See
> `docs/plans/2026-07-24-product-cpu-import-and-regret.md`.

Status: implemented (bridge transport). The remainder of this document is the
original 2026-07-23 design; sections that conflict with the revision note
above are historical. This document exists so that
when the product repository's CPU strengthening slice finishes
(`docs/plans/2026-07-23-laplace-cpu-ai-strength-and-speed.md` in
`laplace-main`), wiring its result into LaplaceBench as a new baseline is a
slot-in against an already-agreed interface, not a redesign done under time
pressure. It does not require or imply any change to `laplace-main`, and it
is explicitly deferred there (see that plan's "Deferred follow-ons" item 4).

## Why this needs a spec before any code

Two independent systems both use the string `v1` for unrelated things:

- `laplace-main`'s `ai/src/agents/cpu_levels.py`:
  `CPU_POLICY_VERSION = "cpu-v1"` — a Python search/weight-profile version.
- `laplacebench`'s `laplace-engine` package: ruleset `laplace-8x8-v1` — a
  rules-freeze version.

A future product CPU baseline in LaplaceBench sits at the intersection of
both and must not collapse them into one ambiguous "v1" in run logs,
schemas, or a public leaderboard. The rest of this document exists mainly to
pin that apart before it ships anywhere.

## Naming convention

Agent spec strings (the `--team-a` / `--team-b` values `makeAgent` in
`packages/cli/src/cli.ts` resolves) for a product CPU baseline:

```text
product-cpu:<policy_version>:<level_id>

examples:
  product-cpu:cpu-v1:level_9
  product-cpu:cpu-v1:level_13
```

- `policy_version` is read verbatim from the product API's reported
  `policy_version` (currently `cpu-v1`, from `CPU_POLICY_VERSION`), never
  hand-typed, so a future `cpu-v2` cannot silently alias onto old results.
- `level_id` is the stable public identifier (`level_1` … `level_13`), not
  the internal profile name (`expert`, `practical_expert_v2`, …). Profile
  names are an implementation detail the product's own deterministic
  mapping rule can change; the level ID is the stable contract, matching
  how the product plan itself treats `level_12`/`level_13` as the only
  externally addressable remap targets.
- There is deliberately no `product-cpu:cpu-v1:practical_expert_v2` spec.
  Per that plan's Phase 4, a candidate is only ever reachable through
  whichever level ID it gets mapped to (12, 13, or neither if no comparator
  passes) — never as a freestanding name. LaplaceBench should not invent an
  addressing scheme the product itself does not expose.
- This is unrelated to the frozen `takeshi` / `takeshi:dN` baselines, which
  keep their existing names permanently (`packages/engine/src/core/TakeshiPolicy.ts`,
  a distinct, older, unmaintained policy — see the README's "Difference from
  takeshi" note). Nothing here renames or retires them.

## Transport

The product already exposes `POST /api/move` (`ai/src/api/app.py`,
`MoveRequest`/`predict_move`, read on 2026-07-23) that takes a full board
state and a `difficulty: CpuLevelId` and returns a move, plus
`GET /api/health` reporting `policy_version`, `difficulty_map`, and
`cpu_levels`. This is close to a ready-made transport for an HTTP-based
`Agent` (`packages/cli/src/types.ts`), the same shape as the existing
`claude-cli`/`codex-cli` adapters — a request/response client, not a shared
process or shared rules implementation.

Sketch of the future adapter (not implemented):

```ts
// packages/cli/src/agents/productcpu.ts (future)
export function productCpuAgent(levelId: CpuLevelId, baseUrl: string): Agent {
  return {
    name: `product-cpu:cpu-v1:${levelId}`, // policy_version confirmed at startGame, not hardcoded
    async startGame() {
      const health = await fetch(`${baseUrl}/api/health`).then((r) => r.json());
      if (health.policy_version !== "cpu-v1") {
        throw new Error(
          `product CPU policy_version drifted: expected cpu-v1, got ${health.policy_version}`
        );
      }
    },
    async act(input) {
      const res = await fetch(`${baseUrl}/api/move`, {
        method: "POST",
        body: JSON.stringify({
          board: input.state.board,
          currentPlayer: input.state.currentPlayer,
          boardSize: input.state.boardSize,
          eliminatedPlayers: input.state.eliminatedPlayers,
          capturedPieces: input.state.capturedPieces,
          difficulty: levelId,
        }),
      }).then((r) => r.json());
      return { move: /* map res.from/res.to to {row,col} */ null };
    },
  };
}
```

## Required provenance in `run.json`

Any run using a `product-cpu:*` spec must additionally record, mirroring
the fields the product's own `cpu-match-log-v1` schema already tracks
(`ai/evaluation/schemas/cpu-match-log-v1.json` once that plan lands):

- `policy_version` and `level_id` (already in the spec string, but restated
  structured for tooling that parses `run.json` without a regex);
- the product API's reported source commit if exposed, or otherwise the
  date and manual note of which product deployment was queried;
- `boardSize` compatibility: the product API currently validates
  `Literal[7, 8, 9]`, which does **not** include the ruleset's canonical 8 as
  a hardcoded default — confirm 8 is accepted and matches `laplace-8x8-v1`
  before trusting a captured/elimination comparison, since a silent
  board-size mismatch would invalidate everything (the exact failure class
  `design-v0.1.md` section 10 already warns about).

## Non-goals for this spec

- No import of the Python CPU into LaplaceBench happens until the product
  plan's Phase 4 completes (accept or explicit reject) — importing an
  unaccepted candidate would misrepresent it as a settled baseline.
- No change to `laplace-main` is implied or required by this document.
- This does not cover a same-process/native Python bridge; HTTP is the
  assumed transport unless a future revision of this spec says otherwise.
