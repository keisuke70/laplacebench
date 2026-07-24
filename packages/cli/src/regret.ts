import * as fs from "node:fs";
import * as path from "node:path";
import { colorName, newGame, playerTeam } from "./engine";
import {
  ProductCpuBridge,
  toMoveRequestState,
  validateHello,
  type BridgeHello,
  type ProductCpuOptions,
  type ScoredRoot,
} from "./agents/productcpu";
import type { TeamId } from "./types";

/**
 * Per-move regret, faithful to the oracle's lexicographic preference
 * (selectionClass desc, value desc, formationPressure desc): the scalar
 * regret_value is only defined within the best move's selectionClass, where
 * rank order guarantees it is nonnegative. Class mismatches are categorical
 * blunders and are aggregated separately, never mixed into the scalar.
 */
export interface MoveRegret {
  chosen_rank: number;
  n_roots: number;
  chosen_value: number;
  best_value: number;
  chosen_class: number;
  best_class: number;
  regret_value: number | null;
  missed_immediate_win: boolean;
  chose_unsafe: boolean;
}

export function evaluateChosenMove(
  roots: ScoredRoot[],
  chosen: { from: [number, number]; to: [number, number] }
): MoveRegret {
  const best = roots.find((r) => r.rank === 1);
  if (!best) throw new Error("oracle returned no rank-1 root");
  const match = roots.find(
    (r) =>
      r.move.from[0] === chosen.from[0] &&
      r.move.from[1] === chosen.from[1] &&
      r.move.to[0] === chosen.to[0] &&
      r.move.to[1] === chosen.to[1]
  );
  if (!match) {
    throw new Error(
      `chosen move ${JSON.stringify(chosen)} not among the oracle's legal roots — replay inconsistency`
    );
  }
  const sameClass = match.selectionClass === best.selectionClass;
  return {
    chosen_rank: match.rank,
    n_roots: roots.length,
    chosen_value: match.value,
    best_value: best.value,
    chosen_class: match.selectionClass,
    best_class: best.selectionClass,
    regret_value: sameClass ? +(best.value - match.value).toFixed(3) : null,
    missed_immediate_win: best.selectionClass === 2 && match.selectionClass < 2,
    chose_unsafe: match.unsafe && roots.some((r) => !r.unsafe),
  };
}

interface AgentRegretAgg {
  moves: number;
  sameClass: number[];
  missedWins: number;
  unsafeChoices: number;
}

function aggregate(values: AgentRegretAgg) {
  const sorted = [...values.sameClass].sort((a, b) => a - b);
  const q = (p: number) =>
    sorted.length > 0 ? sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] : null;
  const mean =
    sorted.length > 0 ? +(sorted.reduce((s, v) => s + v, 0) / sorted.length).toFixed(3) : null;
  return {
    mean_regret: mean,
    median_regret: q(0.5),
    p90_regret: q(0.9),
    same_class_moves: sorted.length,
    missed_win_rate: values.moves > 0 ? +(values.missedWins / values.moves).toFixed(3) : 0,
    unsafe_rate: values.moves > 0 ? +(values.unsafeChoices / values.moves).toFixed(3) : 0,
    moves: values.moves,
  };
}

export interface RegretOptions extends ProductCpuOptions {
  oracleLevelId: string;
}

/**
 * Offline per-move regret over a finished run. Owns exactly one oracle
 * bridge; the whole replay-and-write pass runs inside try/finally so the
 * bridge is disposed on success, protocol failure, replay inconsistency,
 * and write failure alike.
 */
export async function analyzeRunRegret(
  runDir: string,
  opts: RegretOptions,
  bridgeFactory: (o: ProductCpuOptions) => ProductCpuBridge = (o) => new ProductCpuBridge(o)
): Promise<object> {
  const bridge = bridgeFactory(opts);
  try {
    const hello: BridgeHello = await bridge.hello;
    validateHello(hello, opts, opts.oracleLevelId);
    const oracle = {
      spec: `product-cpu:${hello.policy_version}:${opts.oracleLevelId}`,
      policy_version: hello.policy_version,
      product_commit: hello.product_commit,
      python: hello.python,
      protocol: hello.protocol,
    };

    const gamesDir = path.join(runDir, "games");
    const perAgent = new Map<string, AgentRegretAgg>();
    const agentAgg = (name: string): AgentRegretAgg => {
      let a = perAgent.get(name);
      if (!a) {
        a = { moves: 0, sameClass: [], missedWins: 0, unsafeChoices: 0 };
        perAgent.set(name, a);
      }
      return a;
    };

    for (const gameId of fs.readdirSync(gamesDir).sort()) {
      const eventsPath = path.join(gamesDir, gameId, "events.jsonl");
      if (!fs.existsSync(eventsPath)) continue;
      const events = fs
        .readFileSync(eventsPath, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l));
      const start = events.find((e) => e.t === "game_start");
      if (!start) throw new Error(`${gameId}: missing game_start`);
      const end = events.find((e) => e.t === "game_end");
      if (!end) {
        throw new Error(
          `${gameId}: missing game_end — refusing to score an unfinished or truncated game`
        );
      }
      const teamNames: Record<TeamId, string> = { A: start.team_a, B: start.team_b };

      const manager = newGame();
      const moves: object[] = [];
      const perTeam: Record<TeamId, AgentRegretAgg> = {
        A: { moves: 0, sameClass: [], missedWins: 0, unsafeChoices: 0 },
        B: { moves: 0, sameClass: [], missedWins: 0, unsafeChoices: 0 },
      };

      for (const e of events) {
        if (e.t === "move") {
          const state = manager.state;
          const scored = await bridge.scoreRoots(
            opts.oracleLevelId,
            toMoveRequestState(state)
          );
          const regret = evaluateChosenMove(scored.roots, { from: e.from, to: e.to });
          const team = playerTeam(e.player) as TeamId;
          const agent = teamNames[team];
          moves.push({
            ply: e.ply,
            color: colorName(e.player),
            team,
            agent,
            depth: scored.depth,
            ...regret,
          });
          for (const agg of [perTeam[team], agentAgg(agent)]) {
            agg.moves++;
            if (regret.regret_value !== null) agg.sameClass.push(regret.regret_value);
            if (regret.missed_immediate_win) agg.missedWins++;
            if (regret.chose_unsafe) agg.unsafeChoices++;
          }
          const res = manager.makeMove(e.from[0], e.from[1], e.to[0], e.to[1]);
          if (!res.valid) {
            throw new Error(`${gameId} ply ${e.ply}: logged move rejected on re-play`);
          }
        } else if (e.t === "pass") {
          manager.advanceTurn();
        }
      }

      // Replay-completion check, mirroring exportweb.ts: the replayed final
      // state must match what the game_end event recorded.
      const finalState = manager.state;
      if ((finalState.winningTeam ?? null) !== (end.winner ?? null)) {
        throw new Error(
          `${gameId}: winner mismatch on re-play (logged=${end.winner}, replayed=${finalState.winningTeam})`
        );
      }
      for (let p = 1; p <= 4; p++) {
        const logged = end.losses?.[colorName(p)];
        if (logged !== undefined && logged !== finalState.capturedPieces[p - 1]) {
          throw new Error(
            `${gameId}: loss-count mismatch for ${colorName(p)} on re-play (logged=${logged}, replayed=${finalState.capturedPieces[p - 1]})`
          );
        }
      }

      fs.writeFileSync(
        path.join(gamesDir, gameId, "regret.json"),
        JSON.stringify(
          {
            oracle,
            moves,
            per_team: { A: aggregate(perTeam.A), B: aggregate(perTeam.B) },
          },
          null,
          2
        )
      );
    }

    const summary = {
      run_dir: runDir,
      oracle,
      comparability:
        "regret values are comparable only within the same oracle generation (spec + product_commit)",
      agents: Object.fromEntries(
        [...perAgent.entries()].map(([name, agg]) => [name, aggregate(agg)])
      ),
    };
    fs.writeFileSync(
      path.join(runDir, "regret-summary.json"),
      JSON.stringify(summary, null, 2)
    );
    return summary;
  } finally {
    bridge.dispose();
  }
}
