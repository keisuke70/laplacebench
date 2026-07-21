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

3. Open a pull request. CI runs `laplacebench verify` on every run; if the
   replay check passes, the run can be merged and becomes part of the
   community standings.

## What verification covers

Replay verification proves the log is a real, legal LAPLACE game under
ruleset `laplace-8x8-v1` with accurate results. It does not identify who
or what produced each move — agent names are taken from the manifest as
labeled. Official maintainer-run matches carry a ✓ verified marker and are
tallied separately; methodology details live in
[docs/public-platform-strategy-ja.md](../docs/public-platform-strategy-ja.md).

## Standings

Regenerate after merging:

```bash
laplacebench standings community/runs/* --out community/STANDINGS.md
```
