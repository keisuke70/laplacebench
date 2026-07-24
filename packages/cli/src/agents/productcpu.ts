import { spawn, type ChildProcess } from "node:child_process";
import * as path from "node:path";
import * as readline from "node:readline";
import type { Agent, AgentReply, Move, TurnInput } from "../types";
import type { GameState } from "laplace-engine";

export const BRIDGE_PROTOCOL = "product-cpu-bridge-v1";
const BRIDGE_SCRIPT = path.join(__dirname, "..", "..", "bridge", "product_cpu_bridge.py");
const MOVE_TIMEOUT_MS = 60_000;
const SCORE_TIMEOUT_MS = 120_000;
const HELLO_TIMEOUT_MS = 60_000;

export interface BridgeHello {
  protocol: string;
  policy_version: string;
  product_commit: string;
  product_dirty: boolean;
  python: string;
  visible_tiers: { level_id: string; profile_name: string; p95_limit_seconds: number }[];
}

export interface ProductCpuOptions {
  productRepo: string;
  /** Required commit pin; a hello reporting any other commit is rejected. */
  expectedCommit: string;
  /** Policy segment of the agent spec (e.g. "cpu-v4"). */
  expectedPolicy: string;
  /** Test hook: overrides the spawned command (default: python3 bridge). */
  bridgeCommand?: { command: string; args: string[] };
  /** Test hooks: shrink deadlines. Production defaults apply when omitted. */
  moveTimeoutMs?: number;
  scoreTimeoutMs?: number;
  helloTimeoutMs?: number;
}

export interface ScoredRoot {
  move: { from: [number, number]; to: [number, number] };
  value: number;
  rank: number;
  selectionClass: number;
  immediateWin: boolean;
  unsafe: boolean;
}

interface Pending {
  resolve: (v: any) => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout;
}

/**
 * Line-delimited JSON client over a bridge child process. Fail-closed:
 * child exit, non-JSON output, or a per-request deadline rejects every
 * pending request; dispose() is idempotent and kills the child.
 */
export class ProductCpuBridge {
  private child: ChildProcess;
  private pending = new Map<number, Pending>();
  private nextId = 1;
  private stderrTail: string[] = [];
  private closed = false;
  private moveTimeoutMs: number;
  private scoreTimeoutMs: number;
  readonly hello: Promise<BridgeHello>;

  constructor(opts: ProductCpuOptions) {
    this.moveTimeoutMs = opts.moveTimeoutMs ?? MOVE_TIMEOUT_MS;
    this.scoreTimeoutMs = opts.scoreTimeoutMs ?? SCORE_TIMEOUT_MS;
    const cmd = opts.bridgeCommand ?? {
      command: "python3",
      args: [BRIDGE_SCRIPT, "--product-repo", opts.productRepo],
    };
    this.child = spawn(cmd.command, cmd.args, { stdio: ["pipe", "pipe", "pipe"] });
    this.child.stderr!.on("data", (d: Buffer) => {
      this.stderrTail.push(d.toString());
      if (this.stderrTail.length > 20) this.stderrTail.shift();
      // Contractually fatal (fail-closed): the bridge never writes stderr in
      // healthy operation, so any output rejects all pending requests rather
      // than leaving them to hit their deadlines.
      if (!this.closed) this.failAll("bridge wrote to stderr");
    });

    let helloResolve!: (h: BridgeHello) => void;
    let helloReject!: (e: Error) => void;
    this.hello = new Promise<BridgeHello>((res, rej) => {
      helloResolve = res;
      helloReject = rej;
    });
    const helloTimer = setTimeout(() => {
      helloReject(this.fail("bridge hello timed out"));
    }, opts.helloTimeoutMs ?? HELLO_TIMEOUT_MS);

    let gotHello = false;
    const rl = readline.createInterface({ input: this.child.stdout! });
    rl.on("line", (line) => {
      if (!line.trim()) return;
      let msg: any;
      try {
        msg = JSON.parse(line);
      } catch {
        this.failAll(`bridge emitted non-JSON output: ${line.slice(0, 200)}`);
        return;
      }
      if (!gotHello) {
        gotHello = true;
        clearTimeout(helloTimer);
        const h = msg as BridgeHello;
        if (
          msg.t !== "hello" ||
          h.protocol !== BRIDGE_PROTOCOL ||
          typeof h.policy_version !== "string" ||
          typeof h.product_commit !== "string" ||
          typeof h.product_dirty !== "boolean" ||
          typeof h.python !== "string" ||
          !Array.isArray(h.visible_tiers)
        ) {
          helloReject(this.fail(`malformed bridge hello: ${line.slice(0, 200)}`));
          return;
        }
        helloResolve(h);
        return;
      }
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.error) p.reject(new Error(`bridge error: ${msg.error}`));
      else p.resolve(msg);
    });
    this.child.on("exit", (code) => {
      if (!this.closed) {
        const err = this.failAll(`bridge exited (code ${code})`);
        if (!gotHello) {
          gotHello = true;
          clearTimeout(helloTimer);
          helloReject(err);
        }
      }
    });
    this.child.on("error", (err) => {
      const wrapped = this.failAll(`bridge spawn failed: ${err.message}`);
      if (!gotHello) {
        gotHello = true;
        clearTimeout(helloTimer);
        helloReject(wrapped);
      }
    });
  }

  private fail(reason: string): Error {
    const stderr = this.stderrTail.join("").trim();
    return new Error(stderr ? `${reason}\nbridge stderr:\n${stderr}` : reason);
  }

  private failAll(reason: string): Error {
    const err = this.fail(reason);
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(err);
    }
    this.pending.clear();
    return err;
  }

  request(payload: object, timeoutMs: number): Promise<any> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      if (this.closed || this.child.exitCode !== null) {
        reject(this.fail("bridge is closed"));
        return;
      }
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(this.fail(`bridge request timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin!.write(JSON.stringify({ id, ...payload }) + "\n");
    });
  }

  move(levelId: string, seed: number, state: object): Promise<any> {
    return this.request({ op: "move", level_id: levelId, seed, state }, this.moveTimeoutMs);
  }

  scoreRoots(levelId: string, state: object): Promise<{ depth: number; roots: ScoredRoot[] }> {
    return this.request({ op: "score_roots", level_id: levelId, state }, this.scoreTimeoutMs);
  }

  dispose(): void {
    if (this.closed) return;
    this.closed = true;
    this.failAll("bridge disposed");
    this.child.stdin?.end();
    this.child.kill("SIGTERM");
  }
}

/** MoveRequest-shaped view of the bench GameState (product API contract). */
export function toMoveRequestState(state: GameState): object {
  return {
    board: state.board.map((row) =>
      row.map((cell) => (cell ? { player: cell.player, isDead: !!cell.isDead } : null))
    ),
    currentPlayer: state.currentPlayer,
    boardSize: state.boardSize,
    eliminatedPlayers: state.eliminatedPlayers,
    capturedPieces: state.capturedPieces,
  };
}

/** Validate a hello against the spec's expectations. Fail-closed. */
export function validateHello(hello: BridgeHello, opts: ProductCpuOptions, levelId: string): void {
  if (hello.policy_version !== opts.expectedPolicy) {
    throw new Error(
      `product CPU policy_version mismatch: spec says ${opts.expectedPolicy}, bridge reports ${hello.policy_version}`
    );
  }
  if (hello.product_commit !== opts.expectedCommit) {
    throw new Error(
      `product commit mismatch: pinned ${opts.expectedCommit}, checkout is ${hello.product_commit}`
    );
  }
  if (hello.product_dirty) {
    throw new Error("product checkout has uncommitted changes; refusing a dirty snapshot");
  }
  if (!hello.visible_tiers.some((t) => t.level_id === levelId)) {
    throw new Error(
      `${levelId} is not a visible tier (visible: ${hello.visible_tiers.map((t) => t.level_id).join(", ")})`
    );
  }
}

export function perMoveSeed(agentSeed: number, ply: number): number {
  // Contract: (agentSeed * 1_000_003 + ply) mod 2^31, nonnegative. Inputs up
  // to 2^31 keep the product under 2^51, safely inside Number precision.
  const MOD = 2 ** 31;
  return (((agentSeed * 1_000_003 + ply) % MOD) + MOD) % MOD;
}

/**
 * Metadata-only preflight: spawn, validate, capture provenance, dispose.
 * Used by the CLI before run.json is written.
 */
export async function preflightProductCpu(
  opts: ProductCpuOptions,
  levelId: string
): Promise<BridgeHello> {
  const bridge = new ProductCpuBridge(opts);
  try {
    const hello = await bridge.hello;
    validateHello(hello, opts, levelId);
    return hello;
  } finally {
    bridge.dispose();
  }
}

/** Per-game agent: fresh bridge + handshake, disposed by the runner. */
export async function createProductCpuAgent(
  levelId: string,
  agentSeed: number,
  opts: ProductCpuOptions
): Promise<Agent> {
  const bridge = new ProductCpuBridge(opts);
  let hello: BridgeHello;
  try {
    hello = await bridge.hello;
    validateHello(hello, opts, levelId);
  } catch (err) {
    bridge.dispose();
    throw err;
  }
  return {
    name: `product-cpu:${hello.policy_version}:${levelId}`,
    async act(input: TurnInput): Promise<AgentReply> {
      const seed = perMoveSeed(agentSeed, input.ply);
      const started = Date.now();
      const res = await bridge.move(levelId, seed, toMoveRequestState(input.state));
      const move: Move = {
        from: { row: res.move.from[0], col: res.move.from[1] },
        to: { row: res.move.to[0], col: res.move.to[1] },
      };
      return {
        move,
        latencyMs: Date.now() - started,
        meta: { product_seed: res.seed_used, bridge_elapsed_ms: res.elapsed_ms },
      };
    },
    dispose() {
      bridge.dispose();
    },
  };
}
