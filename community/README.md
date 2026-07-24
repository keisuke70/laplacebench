# Community runs

Games played by the community, submitted as pull requests. Every submitted
game is re-played move by move through the frozen engine by CI — captures,
eliminations, and results must match the log exactly.

## How to submit

1. Play matches with the CLI (your own subscriptions or API keys):

   ```bash
   npx laplacebench arena --team-a claude-cli:sonnet --team-b codex-cli --games 2 --swap
   ```

2. Copy the run directory into this folder, named `<your-github-name>--<run-id>`:

   ```bash
   cp -R runs/<run-id> community/runs/<you>--<run-id>
   ```

3. Regenerate the standings so your PR shows the ranking impact:

   ```bash
   npx laplacebench standings community/runs/* --out community/STANDINGS.md --json-out community/standings.json
   ```

4. Open a pull request. CI replay-verifies every run AND checks that the
   committed standings match the runs byte-for-byte (it prints the exact
   command above if they drift). Once merged, the run is part of the
   community standings.

## What verification covers

Replay verification proves the log is a real, legal LAPLACE game under
ruleset `laplace-8x8-v1` with accurate results. It does not identify who
or what produced each move — agent names are taken from the manifest as
labeled. Official maintainer-run matches carry a ✓ verified marker and are
tallied separately; methodology details live in
[docs/public-platform-strategy-ja.md](../docs/public-platform-strategy-ja.md).

## Standings

`STANDINGS.md` (human-readable) and `standings.json` (machine-readable,
schema `laplace-bench-standings-v1`) are regenerated inside each PR by the
command above and gated by CI — `main` is always self-consistent.

`standings.json` is consumed publicly via its raw URL (the laplace.zone
/bench page reads it directly), so it is a public data contract: schema
changes must bump the `schema` field, never silently reshape it.
