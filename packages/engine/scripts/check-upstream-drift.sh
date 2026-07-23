#!/usr/bin/env bash
# Informational, maintainer-run only -- never wired into CI and never called
# automatically. laplace-8x8-v1 is a deliberate freeze: this script does not
# sync anything, it only tells you whether the product's packages/game-shared
# core has moved since the freeze, so a real drift becomes a conscious choice
# (cut laplace-8x8-v2, or confirm the drift doesn't touch anything the
# fixtures rely on) instead of unnoticed staleness in either direction.
#
# Usage:
#   packages/engine/scripts/check-upstream-drift.sh /path/to/laplace-main
set -euo pipefail

PRODUCT_PATH="${1:-}"
if [[ -z "$PRODUCT_PATH" ]]; then
  echo "Usage: $0 /path/to/laplace-main" >&2
  exit 2
fi

PRODUCT_CORE="$PRODUCT_PATH/packages/game-shared/src/core"
BENCH_CORE="$(cd "$(dirname "$0")/.." && pwd)/src/core"

if [[ ! -d "$PRODUCT_CORE" ]]; then
  echo "Not found: $PRODUCT_CORE" >&2
  exit 2
fi

echo "Frozen (bench):  $BENCH_CORE"
echo "Live (product):  $PRODUCT_CORE"
if command -v git >/dev/null 2>&1 && git -C "$PRODUCT_PATH" rev-parse HEAD >/dev/null 2>&1; then
  echo "Product commit:  $(git -C "$PRODUCT_PATH" rev-parse HEAD)"
fi
echo ""

if diff -rq "$BENCH_CORE" "$PRODUCT_CORE"; then
  echo ""
  echo "No drift: packages/engine/src/core is still byte-identical to the product's"
  echo "packages/game-shared/src/core. laplace-8x8-v1 remains an exact freeze, not"
  echo "just a behaviorally-equivalent fork."
  exit 0
else
  echo ""
  echo "Drift detected (listed above). This is not automatically a bug in either"
  echo "repository -- laplace-8x8-v1 is meant to stay frozen while the product"
  echo "evolves. Next step is a deliberate decision, not a sync:"
  echo "  1. Read the diff and decide whether it touches any rule the"
  echo "     conformance fixtures (test/fixtures/rulegym-v1.json) depend on."
  echo "  2. If yes, run scripts/verify-against-product.cjs to see which"
  echo "     fixtures now diverge, then decide whether to cut laplace-8x8-v2."
  echo "  3. If no (e.g. a comment, a type-only refactor, an unrelated export),"
  echo "     no action is required -- this script will keep reporting it as"
  echo "     drift, which is expected and fine."
  exit 1
fi
