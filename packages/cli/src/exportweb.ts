import "./env";
import * as fs from "node:fs";
import * as path from "node:path";
import { newGame, playerTeam } from "./engine";
import { COLOR_NAMES } from "./types";

function appRoot(): string {
  const root = process.env.LAPLACE_APP_ROOT;
  if (!root) {
    throw new Error(
      "export-web needs the LAPLACE web app to export into. Set LAPLACE_APP_ROOT to your Laplace product checkout, or pass --out <dir> to write the replay JSON files anywhere."
    );
  }
  return root;
}

interface BenchTeamStats {
  agent: string;
  turns: number;
  moves: number;
  formatFailures: number;
  legalityFailures: number;
  failedTurns: number;
  outputTokens: number;
  cacheReadTokens: number;
  avgLatencyMs: number;
}

interface BenchFailure {
  ply: number;
  attempt: number;
  kind: string;
  code?: string;
  team: "A" | "B";
}

interface BenchCommentary {
  ply: number;
  team: "A" | "B";
  color: string;
  text: string;
}

interface BenchMeta {
  file: string;
  run_id: string;
  game_id: string;
  team_a: string;
  team_b: string;
  winner: "A" | "B" | null;
  reason: string;
  plies: number;
  exported_at: string;
  stats?: { A: BenchTeamStats; B: BenchTeamStats };
  failures?: BenchFailure[];
  commentary?: BenchCommentary[];
}

/**
 * Re-plays a game's events.jsonl through the product engine (the same
 * referee that scored it) and emits the web app's replay payload:
 * {history: GameState[], boardSize, winningTeam}. Because the states are
 * regenerated rather than copied, this doubles as deterministic replay
 * verification — any divergence between the log and the re-play (captures,
 * eliminations, winner) fails the export loudly.
 */
export function exportGame(
  runDir: string,
  gameId: string
): { payload: object; meta: BenchMeta } {
  const runId = path.basename(runDir);
  const gameDir = path.join(runDir, "games", gameId);
  const events = fs
    .readFileSync(path.join(gameDir, "events.jsonl"), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));

  const start = events.find((e) => e.t === "game_start");
  const end = events.find((e) => e.t === "game_end");
  if (!start || !end) throw new Error(`${gameId}: missing game_start/game_end`);

  const manager = newGame();
  const history: object[] = [manager.getState() as unknown as object];
  const failures: BenchFailure[] = [];
  const commentary: BenchCommentary[] = [];

  for (const e of events) {
    if (e.t === "move" && typeof e.raw === "string" && e.raw.trim()) {
      commentary.push({
        ply: e.ply,
        team: playerTeam(e.player),
        color: COLOR_NAMES[e.player - 1],
        text: e.raw.slice(0, 2500),
      });
    }
    if (e.t === "failure") {
      failures.push({
        ply: e.ply,
        attempt: e.attempt,
        kind: e.kind,
        code: e.code,
        team: playerTeam(manager.state.currentPlayer),
      });
    }
    if (e.t === "move") {
      const res = manager.makeMove(e.from[0], e.from[1], e.to[0], e.to[1]);
      if (!res.valid) {
        throw new Error(
          `${gameId} ply ${e.ply}: logged move ${JSON.stringify(e.from)}->${JSON.stringify(e.to)} rejected on re-play (${res.message})`
        );
      }
      const replayCaps = (res.state.lastMove?.capturedPiecesMeta ?? [])
        .map((c) => `${c.position[0]},${c.position[1]}:${COLOR_NAMES[c.player - 1]}`)
        .sort();
      const loggedCaps = (e.captures ?? [])
        .map((c: any) => `${c.at[0]},${c.at[1]}:${c.owner}`)
        .sort();
      if (JSON.stringify(replayCaps) !== JSON.stringify(loggedCaps)) {
        throw new Error(
          `${gameId} ply ${e.ply}: capture mismatch on re-play. logged=${JSON.stringify(loggedCaps)} replayed=${JSON.stringify(replayCaps)}`
        );
      }
      history.push(manager.getState() as unknown as object);
    } else if (e.t === "pass") {
      manager.advanceTurn();
      history.push(manager.getState() as unknown as object);
    }
  }

  const finalState = manager.state;
  if ((finalState.winningTeam ?? null) !== (end.winner ?? null)) {
    throw new Error(
      `${gameId}: winner mismatch. logged=${end.winner} replayed=${finalState.winningTeam}`
    );
  }
  for (let p = 1; p <= 4; p++) {
    const logged = end.losses?.[COLOR_NAMES[p - 1]];
    if (logged !== undefined && logged !== finalState.capturedPieces[p - 1]) {
      throw new Error(
        `${gameId}: loss-count mismatch for ${COLOR_NAMES[p - 1]}: logged=${logged} replayed=${finalState.capturedPieces[p - 1]}`
      );
    }
  }

  let stats: BenchMeta["stats"];
  const finalPath = path.join(gameDir, "final.json");
  if (fs.existsSync(finalPath)) {
    const fin = JSON.parse(fs.readFileSync(finalPath, "utf8"));
    const toStats = (t: any): BenchTeamStats => ({
      agent: t.agent,
      turns: t.turns,
      moves: t.moves,
      formatFailures: t.formatFailures,
      legalityFailures: t.legalityFailures,
      failedTurns: t.failedTurns,
      outputTokens: t.outputTokens,
      cacheReadTokens: t.cacheReadTokens,
      avgLatencyMs: t.actCalls > 0 ? Math.round(t.latencyMs / t.actCalls) : 0,
    });
    stats = { A: toStats(fin.teams.A), B: toStats(fin.teams.B) };
  }

  const meta: BenchMeta = {
    file: `${runId}--${gameId}.json`,
    run_id: runId,
    game_id: gameId,
    team_a: start.team_a,
    team_b: start.team_b,
    winner: end.winner ?? null,
    reason: end.reason,
    plies: end.plies,
    exported_at: new Date().toISOString(),
    stats,
    failures,
    commentary,
  };

  const payload = {
    history,
    boardSize: 8,
    winningTeam: end.winner ?? null,
    bench: meta,
  };
  return { payload, meta };
}

export function exportRun(runDir: string, outDir: string): BenchMeta[] {
  const gamesDir = path.join(runDir, "games");
  const gameIds = fs
    .readdirSync(gamesDir)
    .filter((g) => fs.existsSync(path.join(gamesDir, g, "events.jsonl")))
    .sort();
  fs.mkdirSync(outDir, { recursive: true });

  const metas: BenchMeta[] = [];
  for (const gameId of gameIds) {
    const { payload, meta } = exportGame(runDir, gameId);
    fs.writeFileSync(
      path.join(outDir, meta.file),
      JSON.stringify(payload)
    );
    metas.push(meta);
    console.log(`exported + verified: ${meta.file} (${meta.plies} plies, winner ${meta.winner ?? "draw"} by ${meta.reason})`);
  }

  // Merge into index.json (keyed by file name).
  const indexPath = path.join(outDir, "index.json");
  let index: BenchMeta[] = [];
  if (fs.existsSync(indexPath)) {
    try {
      index = JSON.parse(fs.readFileSync(indexPath, "utf8"));
    } catch {
      index = [];
    }
  }
  const byFile = new Map(index.map((m) => [m.file, m]));
  // Index entries stay light: commentary lives only in the game payload.
  for (const m of metas) byFile.set(m.file, { ...m, commentary: undefined });
  const merged = [...byFile.values()].sort((a, b) =>
    a.exported_at < b.exported_at ? 1 : -1
  );
  fs.writeFileSync(indexPath, JSON.stringify(merged, null, 2));
  console.log(`index updated: ${indexPath} (${merged.length} games)`);
  return metas;
}

export function defaultOutDir(): string {
  return path.join(appRoot(), "web", "public", "bench");
}
