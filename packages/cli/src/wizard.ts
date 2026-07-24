import * as readline from "node:readline";
import { PROVIDERS, type ProviderEntry } from "./catalog";
import { STANDINGS_REGEN_COMMAND } from "./standings";

/** Injectable I/O so the whole flow is testable with scripted answers. */
export interface WizardIO {
  select(title: string, options: string[]): Promise<number>;
  input(prompt: string, def?: string): Promise<string>;
  print(line: string): void;
}

export interface WizardDeps {
  env: NodeJS.ProcessEnv;
  /** Command presence check (injectable; real impl uses `<cmd> --version`). */
  checkCommand(cmd: string): { ok: boolean; version?: string };
  /** Seed source (injectable for determinism in tests). */
  randomSeed(): number;
}

export interface WizardPlan {
  specA: string;
  specB: string;
  games: number;
  swap: boolean;
  seed: number;
  /** Extra arena args (e.g. product repo/commit collected interactively). */
  extraArgs: Record<string, string>;
  summaryLines: string[];
}

export type WizardResult = WizardPlan | { cancelled: true };

export function isCancelled(r: WizardResult): r is { cancelled: true } {
  return (r as { cancelled?: boolean }).cancelled === true;
}

/** Strict integer prompt: the WHOLE input must be an integer and satisfy
 * `valid`; otherwise re-prompt. `0` and negatives are legal where `valid`
 * allows them — no silent fallback replaces a parseable answer. */
async function promptInteger(
  io: WizardIO,
  prompt: string,
  def: string,
  valid: (n: number) => boolean
): Promise<number> {
  for (;;) {
    const text = (await io.input(prompt, def)).trim();
    if (/^-?\d+$/.test(text)) {
      const n = parseInt(text, 10);
      if (Number.isSafeInteger(n) && valid(n)) return n;
    }
    io.print("整数を入力してください");
  }
}

async function pickTeam(io: WizardIO, teamName: string): Promise<{ spec: string; provider: ProviderEntry }> {
  const p = await io.select(
    `Team ${teamName} のAIを選択:`,
    PROVIDERS.map((x) => x.label)
  );
  const provider = PROVIDERS[p];

  const modelOptions = provider.models.map((m) => m.label);
  if (provider.allowCustomModel) modelOptions.push("(手入力)");
  const mi = await io.select("モデル:", modelOptions);
  let model: string;
  if (provider.allowCustomModel && mi === provider.models.length) {
    model = (await io.input("モデルIDを入力:")).trim();
  } else {
    model = provider.models[mi].value;
  }

  let effort = "";
  if (provider.efforts.length > 1) {
    const ei = await io.select(
      "effort:",
      provider.efforts.map((e) => (e === "" ? "default" : e))
    );
    effort = provider.efforts[ei];
  }

  return { spec: provider.buildSpec(model, effort), provider };
}

/**
 * Auth checks run LAST, over the union of the two selected providers'
 * requirements. Fail-closed: the plan is only returned once every
 * requirement passes (or the user aborts).
 */
async function authGate(
  io: WizardIO,
  deps: WizardDeps,
  providers: ProviderEntry[],
  extraArgs: Record<string, string>
): Promise<"ok" | "cancelled"> {
  for (;;) {
    const failures: string[] = [];
    io.print("── 認証チェック ──");
    const seen = new Set<string>();
    for (const p of providers) {
      if (seen.has(p.key)) continue;
      seen.add(p.key);
      for (const cmd of p.auth.commands) {
        const res = deps.checkCommand(cmd);
        if (res.ok) {
          io.print(`  ✓ ${cmd} CLI: ${res.version ?? "found"}`);
        } else {
          io.print(`  ✗ ${cmd} CLI が見つかりません — インストール/ログイン後に再チェックしてください`);
          failures.push(cmd);
        }
      }
      for (const envVar of p.auth.envVars) {
        if (p.key === "product-cpu") continue; // handled below (interactive)
        if (deps.env[envVar]) {
          io.print(`  ✓ ${envVar}: 設定済み`);
        } else {
          io.print(`  ✗ ${envVar} が未設定です — export ${envVar}=... を実行してください`);
          failures.push(envVar);
        }
      }
      if (p.key === "product-cpu") {
        const repo =
          extraArgs["product-repo"] ?? deps.env.LAPLACE_PRODUCT_REPO ?? "";
        const commit =
          extraArgs["product-commit"] ?? deps.env.LAPLACE_PRODUCT_COMMIT ?? "";
        if (repo && commit) {
          extraArgs["product-repo"] = repo;
          extraArgs["product-commit"] = commit;
          io.print(`  ✓ product checkout: ${repo} @ ${commit.slice(0, 12)}`);
        } else {
          const r = (await io.input("product checkout のパス:", repo)).trim();
          const c = (await io.input("pin するコミットSHA:", commit)).trim();
          if (r && c) {
            extraArgs["product-repo"] = r;
            extraArgs["product-commit"] = c;
            io.print(`  ✓ product checkout: ${r} @ ${c.slice(0, 12)}`);
          } else {
            io.print("  ✗ product checkout のパスとコミット pin が必要です");
            failures.push("product-cpu");
          }
        }
      }
      if (p.auth.note && (p.auth.commands.length || p.auth.envVars.length)) {
        io.print(`    (${p.auth.note})`);
      }
    }
    if (failures.length === 0) return "ok";
    const choice = await io.select("解決後に再チェックしますか?", [
      "再チェック",
      "中止",
    ]);
    if (choice === 1) return "cancelled";
  }
}

export async function runWizardFlow(
  io: WizardIO,
  deps: WizardDeps
): Promise<WizardResult> {
  const a = await pickTeam(io, "A");
  const b = await pickTeam(io, "B");

  const preset = await io.select("対局数:", [
    "2局・スワップあり (推奨=正準ペア)",
    "カスタム",
  ]);
  let games = 2;
  let swap = true;
  if (preset === 1) {
    games = await promptInteger(io, "対局数:", "2", (n) => n >= 1);
    swap = (await io.select("サイドスワップ:", ["あり", "なし"])) === 0;
  }

  const defaultSeed = deps.randomSeed();
  const seed = await promptInteger(io, "seed:", String(defaultSeed), () => true);

  const extraArgs: Record<string, string> = {};
  const gate = await authGate(io, deps, [a.provider, b.provider], extraArgs);
  if (gate === "cancelled") return { cancelled: true };

  const summaryLines = [
    `Team A: ${a.spec}`,
    `Team B: ${b.spec}`,
    `games=${games} swap=${swap ? "on" : "off"} seed=${seed}`,
  ];
  return { specA: a.spec, specB: b.spec, games, swap, seed, extraArgs, summaryLines };
}

/** Same sanitization as arena's default run-id derivation. */
export function wizardRunId(specA: string, specB: string, now: Date): string {
  return (
    now.toISOString().replace(/[:.]/g, "").slice(0, 15) +
    `-${specA}-vs-${specB}`.replace(/[^a-zA-Z0-9_-]/g, "_")
  );
}

export function submissionGuidance(runId: string): string[] {
  return [
    "── community 提出(任意) ──",
    "このランを公開台帳に載せるには:",
    `  cp -R runs/${runId} community/runs/<github名>--${runId}`,
    `  ${STANDINGS_REGEN_COMMAND}`,
    "その後 laplacebench リポジトリへ pull request を送ってください。",
    "CI が全対局を凍結エンジンでリプレイ検証し、standings の整合も",
    "検査します。マージで公開台帳に反映されます (community/README.md 参照)。",
  ];
}

function makeReadlineIO(): WizardIO & { close(): void } {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const ask = (q: string) =>
    new Promise<string>((res) => rl.question(q, res));
  return {
    async select(title, options) {
      for (;;) {
        console.log(`\n${title}`);
        options.forEach((o, i) => console.log(`  ${i + 1}) ${o}`));
        const ans = (await ask("> ")).trim();
        const n = parseInt(ans, 10);
        if (Number.isInteger(n) && n >= 1 && n <= options.length) return n - 1;
        console.log(`1〜${options.length} の番号を入力してください`);
      }
    },
    async input(prompt, def) {
      const ans = (await ask(`${prompt}${def !== undefined ? ` [${def}]` : ""} `)).trim();
      return ans === "" && def !== undefined ? def : ans;
    },
    print(line) {
      console.log(line);
    },
    close() {
      rl.close();
    },
  };
}

export interface RunPlayDeps extends WizardDeps {
  runArena(args: Record<string, string | boolean>): Promise<void>;
  isTTY: boolean;
  now(): Date;
}

/** Entry point for `laplacebench play`. Single execution path: composes
 * arena args and rides the existing canonical defaults. */
export async function runPlay(
  deps: RunPlayDeps,
  io?: WizardIO
): Promise<number> {
  if (!deps.isTTY) {
    console.error(
      "laplacebench play は対話型です (TTY が必要)。スクリプトからは arena をフラグで使ってください:\n" +
        "  laplacebench arena --team-a claude-cli:sonnet --team-b product-cpu:cpu-v4:level_3 --games 2 --swap"
    );
    return 1;
  }
  const rlio = io ?? makeReadlineIO();
  try {
    const result = await runWizardFlow(rlio, deps);
    if (isCancelled(result)) {
      rlio.print("中止しました。対局は開始されていません。");
      return 1;
    }
    rlio.print("── 対局開始 ──");
    result.summaryLines.forEach((l) => rlio.print(`  ${l}`));
    const runId = wizardRunId(result.specA, result.specB, deps.now());
    await deps.runArena({
      "team-a": result.specA,
      "team-b": result.specB,
      games: String(result.games),
      ...(result.swap ? { swap: true } : {}),
      seed: String(result.seed),
      "run-id": runId,
      ...result.extraArgs,
    });
    submissionGuidance(runId).forEach((l) => rlio.print(l));
    return 0;
  } finally {
    (rlio as { close?: () => void }).close?.();
  }
}
