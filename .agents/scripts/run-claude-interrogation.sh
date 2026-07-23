#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

if [ -f "$script_dir/../sync.sh" ] && [ -d "$script_dir/../skills" ]; then
  repo_root="$(cd -- "$script_dir/.." && pwd)"
  node_entry="scripts/run-claude-interrogation.mjs"
else
  repo_root="$(cd -- "$script_dir/../.." && pwd)"
  node_entry=".agents/scripts/run-claude-interrogation.mjs"
fi

cd "$repo_root"
node "$node_entry" "$@"
