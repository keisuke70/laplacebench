#!/usr/bin/env bash
set -euo pipefail
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "$script_dir/../sync.sh" ] && [ -d "$script_dir/../skills" ]; then
  repo_root="$(cd -- "$script_dir/.." && pwd)"
  entry="scripts/run-human-direction-proxy.mjs"
else
  repo_root="$(cd -- "$script_dir/../.." && pwd)"
  entry=".agents/scripts/run-human-direction-proxy.mjs"
fi
(cd "$repo_root" && node "$entry" "$@")
