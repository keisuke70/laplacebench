/**
 * Canonical catalog of PUBLISHED agent choices — the single owner of
 * "which providers, models, and efforts we advertise" (wizard menus, CLI
 * help, API model shorthands). It is a definition of published options,
 * NOT a restriction: makeAgent keeps accepting free-form spec strings
 * (takeshi:dN, custom models, future policies) unchanged.
 * docs/plans/2026-07-25-play-wizard.md.
 */

/** Anthropic API model shorthands (moved here from agents/llm.ts). */
export const MODEL_SHORTHAND: Record<string, string> = {
  opus: "claude-opus-4-8",
  sonnet: "claude-sonnet-5",
  haiku: "claude-haiku-4-5",
  fable: "claude-fable-5",
};

/** Product policy generation the wizard offers. Bump here when the product
 * ships a new policy; the bridge hello check stays fail-closed at runtime. */
export const PRODUCT_CPU_POLICY = "cpu-v4";

export type ProviderKey =
  | "claude-cli"
  | "codex-cli"
  | "anthropic"
  | "product-cpu"
  | "baseline";

export interface ProviderEntry {
  key: ProviderKey;
  label: string;
  /** Published model choices shown in the menu. */
  models: { value: string; label: string }[];
  /** Whether a free-form model can be typed in. */
  allowCustomModel: boolean;
  /** Published effort choices ("" = provider default, omitted from spec). */
  efforts: string[];
  /** Compose the spec string for a selection. */
  buildSpec(model: string, effort: string): string;
  /** What the auth check needs: commands that must exist, env vars, notes. */
  auth: {
    commands: string[];
    envVars: string[];
    note?: string;
  };
}

export const PROVIDERS: ProviderEntry[] = [
  {
    key: "claude-cli",
    label: "Claude (subscription / claude CLI)",
    models: [
      { value: "opus", label: "opus (Opus 4.8)" },
      { value: "sonnet", label: "sonnet (Sonnet 5)" },
      { value: "haiku", label: "haiku (Haiku 4.5)" },
    ],
    allowCustomModel: true,
    efforts: ["", "low", "medium", "high", "xhigh"],
    buildSpec: (model, effort) =>
      `claude-cli:${model}${effort ? `@${effort}` : ""}`,
    auth: {
      commands: ["claude"],
      envVars: [],
      note: "presence/version only — login state surfaces as an in-game CLI error if missing",
    },
  },
  {
    key: "codex-cli",
    label: "Codex (ChatGPT subscription / codex CLI)",
    models: [{ value: "", label: "default (plan's default model)" }],
    allowCustomModel: true,
    efforts: ["", "low", "medium", "high"],
    buildSpec: (model, effort) =>
      `codex-cli${model ? `:${model}` : effort ? ":" : ""}${effort ? `@${effort}` : ""}`,
    auth: {
      commands: ["codex"],
      envVars: [],
      note: "presence/version only — login state surfaces as an in-game CLI error if missing",
    },
  },
  {
    key: "anthropic",
    label: "Anthropic API (API key)",
    models: Object.keys(MODEL_SHORTHAND).map((k) => ({
      value: k,
      label: `${k} (${MODEL_SHORTHAND[k]})`,
    })),
    allowCustomModel: true,
    efforts: [],
    buildSpec: (model) => `anthropic:${model}`,
    auth: { commands: [], envVars: ["ANTHROPIC_API_KEY"] },
  },
  {
    key: "product-cpu",
    label: `Product CPU (${PRODUCT_CPU_POLICY}, level 1-5)`,
    models: [
      { value: "level_1", label: "level_1 (weakest, p95 <= 0.25s/move)" },
      { value: "level_2", label: "level_2 (p95 <= 0.25s/move)" },
      { value: "level_3", label: "level_3 (default tier, p95 <= 0.5s/move)" },
      { value: "level_4", label: "level_4 (p95 <= 1.2s/move)" },
      { value: "level_5", label: "level_5 (strongest, p95 <= 1.8s/move)" },
    ],
    allowCustomModel: false,
    efforts: [],
    buildSpec: (model) => `product-cpu:${PRODUCT_CPU_POLICY}:${model}`,
    auth: {
      commands: [],
      envVars: ["LAPLACE_PRODUCT_REPO", "LAPLACE_PRODUCT_COMMIT"],
      note: "a pinned product checkout; the wizard will prompt if unset",
    },
  },
  {
    key: "baseline",
    label: "Baseline (no AI cost)",
    models: [
      { value: "random", label: "random (uniform legal moves)" },
      { value: "greedy", label: "greedy (captures first)" },
    ],
    allowCustomModel: false,
    efforts: [],
    buildSpec: (model) => model,
    auth: { commands: [], envVars: [] },
  },
];

/** CLI-help agent-specs lines, generated so help can never drift from the
 * catalog. Free-form specs stay allowed; takeshi:dN etc. remain usable via
 * spec strings even though the wizard does not list them. */
export function usageAgentSpecsLine(): string {
  const published = PROVIDERS.map((p) => {
    const models = p.models.map((m) => m.value || "default").join("/");
    const effort = p.efforts.length > 1 ? "[@effort]" : "";
    const sample = p.buildSpec(
      p.models[0].value,
      p.efforts.length > 1 ? "" : ""
    );
    void sample;
    switch (p.key) {
      case "claude-cli":
        return `claude-cli:<${models}|model>${effort}`;
      case "codex-cli":
        return `codex-cli[:<model>]${effort}`;
      case "anthropic":
        return `anthropic:<${models}|model-id>`;
      case "product-cpu":
        return `product-cpu:${PRODUCT_CPU_POLICY}:<level_1..5>`;
      case "baseline":
        return models;
    }
  }).join(" | ");
  return (
    `agent specs (published): ${published}\n` +
    `  other specs remain accepted as free-form strings (e.g. takeshi:dN, center-greedy, chaos, custom model ids)`
  );
}
