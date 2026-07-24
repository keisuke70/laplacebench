"""LaplaceBench <-> product CPU bridge (protocol: product-cpu-bridge-v1).

Speaks line-delimited JSON on stdin/stdout. Imports the product repository's
``ai/src`` read-only; stdlib only, so it runs on bare python3 (3.11+) with no
venv. Replicates the product API's resolution path exactly:
``get_cpu_level(level_id)`` -> ``MinimaxAgent(profile, strict_profile=True)``
with a fresh agent per request, matching ``ai/src/api/app.py``.
"""

import argparse
import contextlib
import io
import json
import subprocess
import sys
import time


def _git(product_repo: str, *args: str) -> str:
    return subprocess.run(
        ["git", "-C", product_repo, *args],
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--product-repo", required=True)
    args = parser.parse_args()

    sys.path.insert(0, f"{args.product_repo}/ai/src")
    from agents.cpu_levels import (  # noqa: E402
        CPU_POLICY_VERSION,
        CPU_V4_VISIBLE_TIERS,
        get_cpu_level,
    )
    from agents.minimax import MinimaxAgent  # noqa: E402
    from agents.weight_profiles import WEIGHT_PROFILES  # noqa: E402

    # Mirror app.py's _validate_active_cpu_profiles, limited to visible tiers.
    for tier in CPU_V4_VISIBLE_TIERS:
        if tier.profile_name not in WEIGHT_PROFILES:
            print(f"missing profile: {tier.profile_name}", file=sys.stderr)
            return 1
        agent = MinimaxAgent(
            profile_name=tier.profile_name,
            error_policy="raise",
            strict_profile=True,
        )
        if agent.weight_profile_name != tier.profile_name:
            print(f"profile resolution mismatch: {tier.profile_name}", file=sys.stderr)
            return 1

    visible = {tier.level_id: tier for tier in CPU_V4_VISIBLE_TIERS}
    emit = sys.stdout
    print(
        json.dumps(
            {
                "t": "hello",
                "protocol": "product-cpu-bridge-v1",
                "policy_version": CPU_POLICY_VERSION,
                "product_commit": _git(args.product_repo, "rev-parse", "HEAD"),
                "product_dirty": bool(_git(args.product_repo, "status", "--porcelain")),
                "python": sys.version,
                "visible_tiers": [
                    {
                        "level_id": tier.level_id,
                        "profile_name": tier.profile_name,
                        "p95_limit_seconds": tier.p95_limit_seconds,
                    }
                    for tier in CPU_V4_VISIBLE_TIERS
                ],
            }
        ),
        file=emit,
        flush=True,
    )

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        req_id = None
        try:
            req = json.loads(line)
            req_id = req.get("id")
            op = req.get("op")
            level_id = req.get("level_id")
            if level_id not in visible:
                raise ValueError(f"level_id not a visible tier: {level_id}")
            profile = get_cpu_level(level_id).profile_name
            state = req["state"]
            started = time.monotonic()
            if op == "move":
                seed = req.get("seed")
                agent = MinimaxAgent(
                    profile_name=profile, strict_profile=True, seed=seed
                )
                with contextlib.redirect_stdout(io.StringIO()):
                    prediction = agent.predict(state)
                if prediction is None:
                    raise ValueError("no legal move for acting player")
                resp = {
                    "id": req_id,
                    "move": {
                        "from": list(prediction["from"]),
                        "to": list(prediction["to"]),
                    },
                    "seed_used": seed,
                    "elapsed_ms": round((time.monotonic() - started) * 1000),
                }
            elif op == "score_roots":
                agent = MinimaxAgent(profile_name=profile, strict_profile=True)
                with contextlib.redirect_stdout(io.StringIO()):
                    analysis = agent.score_root_moves_for_analysis(state)
                resp = {
                    "id": req_id,
                    "depth": analysis["depth"],
                    "roots": [
                        {
                            "move": root["move"],
                            "value": root["value"],
                            "rank": root["rank"],
                            "selectionClass": root["selectionClass"],
                            "immediateWin": root["immediateWin"],
                            "unsafe": root["unsafe"],
                        }
                        for root in analysis["roots"]
                    ],
                    "elapsed_ms": round((time.monotonic() - started) * 1000),
                }
            else:
                raise ValueError(f"unknown op: {op}")
        except Exception as exc:  # protocol errors answer, never kill the process
            resp = {"id": req_id, "error": f"{type(exc).__name__}: {exc}"}
        print(json.dumps(resp), file=emit, flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
