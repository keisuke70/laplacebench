---
status: implemented
direction: direction-play-wizard
owner: bench
risk_tier: standard
last_updated: 2026-07-25
---

# Interactive play wizard + canonical choice catalog

## Direction Brief

1. **Purpose** — 参加ファネル「回す」の摩擦低減(public-platform-strategy-ja.md
   §1)。現状の対局開始はスペック文字列文法・環境変数・正準フラグの知識が
   前提で、初見の参加者には高い。`laplacebench play` の対話ウィザードで
   「プロバイダ選択 → モデル/effort 選択 → 認証チェック(最後)→ 実行 →
   提出案内」を番号メニューで通す。
2. **Concept owner** — **「公開されている選択肢」の正本は新設
   `packages/cli/src/catalog.ts`**(プロバイダ×モデル shorthand×effort
   候補×スペック文字列テンプレート)。direction で確認: 現状この定義は
   存在せず、agents/llm.ts の MODEL_SHORTHAND・makeAgent の分岐・usage
   文字列に暗黙に散在している。カタログはこれらを一人のオーナーに
   集約する(概念が増えるのではなく減る側)。マッチ実施規則・記録の
   正本は従来どおりマッチ層(変更しない)。
3. **Lifecycle and scope** — ウィザード+カタログ+usage 文字列の
   カタログ由来化まで。web 側・提出の自動化・動的モデル取得は
   スコープ外。
4. **Value hierarchy** — 実行経路の単一性(ウィザードは既存 arena の
   引数を組み立てるだけ、正準デフォルトに自動で乗る) >
   選択肢定義の単一オーナー(effort 継承事故型ドリフトの芽を摘む) >
   初見の使いやすさ > 見栄え(依存ゼロの番号メニューで十分)。
5. **Adopted direction** — (a) `catalog.ts` を単一正準カタログとし、
   ウィザードのメニューはカタログから導出、**llm.ts の MODEL_SHORTHAND は
   カタログからの import に置換**、usage 文字列の agent specs 一覧も
   カタログから生成。makeAgent のスペック文字列パースは自由文字列を
   引き続き許容(カタログは published な選択肢の定義であって制限では
   ない — 手入力・新モデル試用は塞がない)。
   (b) プロバイダメニュー: Claude(claude-cli)/ Codex(codex-cli)/
   Anthropic API / Product CPU(level_1..5)/ ベースライン
   (**random と greedy のみ** — ユーザー明示)。
   (c) 認証チェックは選択の最後にまとめて実施し fail-closed(不足は
   実行コマンド付きで案内、解決まで開始しない)。判定の限界
   (CLI はログイン状態まで確証できない)は正直に表示。
   (d) 実装は readline ベースの番号メニュー+テキスト入力(外部依存
   ゼロ、raw mode / TUI ライブラリ不使用)。意思決定ロジックは I/O
   注入可能な形に分離してテスト。非 TTY は明確なエラー+フラグ版誘導。
   (e) effort 選択は agent 名の `@effort` ラベルに反映(条件ラベル
   自動整合)。seed はデフォルトでランダム生成して表示(記録は既存の
   run.json)。
6. **What disappears / is not protected** — 「対局開始にはスペック文字列
   文法の知識が必須」という前提。ウィザードメニュー上の takeshi /
   center-greedy / chaos(意図的な非掲載 — スペック文字列経由の利用は
   従来通り保護)。**提出自体の自動化(例: gh CLI を使う `laplacebench
   submit`)は本スライスでは守らない** = 終了時の正確な手順印字
   (命名規約 `<github名>--<run-id>` 込みのコピーコマンドと PR 手順)
   まで。将来の follow-on 判断材料として明記。

## Implementation

### 1. catalog.ts(単一正準カタログ)

- `MODEL_SHORTHAND`(opus/sonnet/haiku/fable → full ID)を llm.ts から
  移設。llm.ts は import に置換(挙動不変)。
- `PROVIDERS: ProviderEntry[]`:
  - `claude-cli`: label「Claude (サブスクリプション / claude CLI)」、
    models: opus / sonnet / haiku(+ custom 入力可)、efforts:
    default / low / medium / high / xhigh、spec:
    `claude-cli:<model>[@effort]`、auth: `claude` コマンドの存在
    (バージョン表示。ログイン状態は実行時エラー経路で捕捉される旨を
    注記表示)。
  - `codex-cli`: models: default(空)+ custom、efforts:
    default / low / medium / high、spec: `codex-cli[:<model>][@effort]`、
    auth: `codex` コマンドの存在。
  - `anthropic`: models: opus / sonnet / haiku / fable + custom
    (full ID)、efforts: なし(API アダプタは adaptive thinking 固定)、
    spec: `anthropic:<model>`、auth: `ANTHROPIC_API_KEY` の有無。
  - `product-cpu`: models: level_1..level_5(p95 上限の表示付き)、
    spec: `product-cpu:${PRODUCT_CPU_POLICY}:<level>`。
    `PRODUCT_CPU_POLICY = "cpu-v4"` はカタログ内の定数(将来の
    ポリシー更新はここ1箇所。実行時は既存の hello 検証が fail-closed)。
    auth: `LAPLACE_PRODUCT_REPO` / `LAPLACE_PRODUCT_COMMIT`(env に
    無ければウィザード内でパス/コミットを入力させ、arena へ
    `--product-repo/--product-commit` として渡す)。
  - `baseline`: models: random / greedy のみ。auth: 不要。
- `usageAgentSpecsLine(): string` — cli.ts の usage 文字列の agent
  specs 行をカタログから生成(published 選択肢+「自由文字列も可」の
  注記。takeshi:dN 等は「その他のスペック」として一行言及し、
  スペック文字列経由の利用が保護されていることを usage 上でも保つ)。
- **独立オーナーの解消(インベントリ完全化)**:
  - `packages/cli/README.md` の静的な Agent specs 列挙は**削除**し、
    「published な選択肢は `laplacebench play` のメニューと CLI ヘルプ
    (カタログから生成)を正とする」という非列挙のポインタに置換。
    README がカタログの二人目のオーナーに戻らないようにする。
  - `community/README.md` の arena 例は**使用例であってカタログ定義では
    ない**と分類(変更不要。例示のスペックが catalog に載っている必要は
    ない)。

### 2. wizard.ts(意思決定コアと I/O の分離)

- `WizardIO` インターフェース:
  `{ select(title, options): Promise<number>; input(prompt, def?):
  Promise<string>; print(line): void }`。
- `type WizardResult = WizardPlan | { cancelled: true }` の名前付き
  判別 union を定義し、`runWizardFlow(io, deps): Promise<WizardResult>`
  で一貫使用(実装・テストとも)。純粋な進行ロジック。
  deps は `{ env, checkCommand(cmd): {ok, version?} }`(注入可能)。
  戻り値 `WizardPlan = { specA, specB, games, swap, seed,
  extraArgs(product repo/commit 等), summaryLines }`。
  - チーム A/B それぞれ: プロバイダ選択 → モデル選択(custom は入力)
    → effort 選択(default は @effort 省略)。
  - 対局数/スワップ: 推奨プリセット「2局・スワップ(正準)」+ カスタム。
  - seed: ランダム生成して表示、手入力での上書き可。
  - 認証チェック: 選択済みプロバイダの要件のみをまとめて検査。
    不足 → 解決コマンドを印字し、`再チェック / 中止` の選択を提示
    (fail-closed: 通過するまで実行しない)。product-cpu の env 不足は
    その場で入力を受ける。
- **run-id の所有**: `runPlay()` が run-id を自分で生成して arena に
  `--run-id` として明示的に渡す(arena の戻り値・マッチ意味論は
  変更しない)。生成規則は arena のデフォルト導出と同じサニタイズ。
  これにより終了後の提出案内が**実際の run-id** で印字できる:
  `cp -R runs/<実際のrun-id> community/runs/<github名>--<実際のrun-id>`
  + PR 手順(community/README.md と同文)。印字コマンドはテストで固定。
- **中止パスの定義**: `runWizardFlow` の戻り値を
  `WizardPlan | { cancelled: true }` の判別 union とする。認証チェックの
  「再チェック / 中止」で中止を選ぶと cancelled を返し、`runPlay` は
  arena を**呼ばずに**中止メッセージを印字して終了コード 1。
  scripted-IO テストで「中止後に arena が呼ばれない」ことを固定。
- `runPlay()` — readline 実装の WizardIO で flow を実行し、
  plan なら `arena(argsFromPlan)` を直接呼ぶ(実行経路1本)。
- 非 TTY(`!process.stdin.isTTY`): 明確なエラー+ arena フラグ版の
  使用例を印字して終了コード1。

### 3. cli.ts

- `play` サブコマンド追加(`laplacebench play`)。
- usage 文字列: `play` の一行追加+ agent specs 行を
  `usageAgentSpecsLine()` に置換。

### 4. llm.ts / README

- llm.ts: MODEL_SHORTHAND を catalog から import(挙動不変)。
- packages/cli/README.md: Quickstart の先頭に `npx laplacebench play` を
  追加し、フラグ版は「スクリプト/CI 用」と位置づけ直す。

### 5. Tests (packages/cli/test/wizard.test.ts ほか)

- catalog: 各プロバイダの spec テンプレートが既存 resolver と整合
  (isLlmSpec が LLM 系で true / baseline・product で false、
  product spec が PRODUCT_CPU_SPEC 正規表現に一致、baseline spec が
  makeAgent で解決できる)。usageAgentSpecsLine に published 全
  プロバイダが含まれ、takeshi への言及がある。
- wizard flow(scripted IO): 
  - claude-cli:opus@high vs product-cpu:cpu-v4:level_3 の回答列 →
    期待どおりの WizardPlan(spec 文字列・games/swap・product 引数)。
  - effort=default で @effort が付かない。custom モデル入力経路。
  - baseline(random vs greedy)経路(認証チェックなしで通過)。
  - 認証不足(fake checkCommand が claude 不在を返す)→ 案内印字+
    再チェック要求、通過まで plan が返らない。
  - product-cpu で env 不足 → 入力プロンプト経由で extraArgs に反映。
  - seed: 上書き入力が反映される。
- **中止経路**: 認証チェックで「中止」を選ぶ回答列 → cancelled が
  返り、arena 相当の実行関数(注入)が呼ばれない。
- **提出案内**: 完走後の印字に実際の run-id と `<github名>--` 命名規約が
  含まれる(印字コマンド文字列をテストで固定)。
- **usage ヘルプ統合**: 未知コマンド実行(ヘルプ経路)の出力に
  カタログ生成の agent specs 行・published 全プロバイダ・自由文字列
  許容の注記が含まれ、exit status が従来どおり 1 であることを
  bin ラッパー経由で検証。
- 非 TTY 経路: runPlay が TTY なしでエラーメッセージ+exit code 1
  (io を差し替えたユニットで検証)。
- llm.ts の shorthand 移設回帰: anthropic:opus の解決が従来どおり
  (既存テスト+catalog import の型チェック)。

### 6. Out of scope

- 提出の自動化(`laplacebench submit`)・gh 連携。
- 動的モデル一覧取得・TUI ライブラリ・web 側変更。
- takeshi / center-greedy / chaos のウィザード掲載(スペック文字列は
  従来通り)。
- arena フラグ版の挙動変更。

## Verification

- 全 workspace typecheck + test green。
- 手動: TTY で `play` を一巡(baseline 同士の即時対局で配線確認)、
  非 TTY でエラー誘導を確認。
- ドリフトチェック一致(コア無変更)。
