---
status: implemented
direction: direction-token-budget
owner: bench
risk_tier: standard
last_updated: 2026-07-24
---

# Token-denominated thinking budget for laplace-8x8-v1 matches

## Direction Brief

1. **Purpose** — 公平性の封筒をトークン建てに一本化する(戦略§4-7)。
   パイロットv1で実測した歪み — opusは盤上の質がsonnet級以上
   (median regret 0/9.7/2.0)なのに300秒壁時計で24回没収され「遅い」が
   「弱い」として測られる — を解消する。調査結果: opusの遅さ =
   スループット21-51tok/s × 思考14.5k tok/手(96%隠れ思考、中盤19k)
   ≈ 290秒/手 ≈ 壁の位置。
2. **Concept owner** — マッチ資源規則の正本はマッチ層
   (`packages/cli`、`docs/match-conduct-laplace-8x8-v1.md`)。
   ルールの対モデル開示の正本は `packages/cli/rulebook/laplace-8x8-v1.md`
   とプロンプト(`packages/cli/src/prompt.ts`)。エンジンコア無変更。
3. **Lifecycle and scope** — max_plies=100 と同じ二段構え:
   封筒の構造(トークン建て・admission 検査・budget 到達 pass の記録・
   開示)を凍結し、**値 250k は暫定確定**。見直し条件は
   (a) パイロットの horizon/budget 消化状況、
   (b) **opus 再走で予算発火が対局の大半を自動パス化する水準か** —
   v1 本凍結前に 250k という値自体を実測で再確認する。
   絞りトラック(思考制限で判別を出す実験)はスコープ外。
4. **Value hierarchy** — 測定の公平性(等トークン封筒) >
   ルール開示の一貫性(拘束が現実化する規則は隠さない) >
   費用抑制(封筒=コスト上限) > 過去プロンプト世代との互換
   (世代ラベルで管理し、互換のための分岐は作らない)。
5. **Adopted direction** — (a) 既存 `--output-token-budget` 機構
   (チーム/局、手番前 admission、超過で以後 skip)を正準化:
   LLM agent を含む対局のデフォルト = **250,000 output tokens/チーム/局**。
   (b) 壁時計をバックストップに降格: LLM 対局のデフォルト
   turn-timeout 300秒 → **1200秒**(没収規則そのものは不変・稀な
   異常時のみ発火)。レイテンシは記録に残す(従来通り)。
   (c) 予算の開示: システムプロンプトに予算と自動パス規則を明記し、
   観測 JSON に `output_token_budget` / `output_tokens_used` を追加。
   ルールブック §8 にも記載。プロンプト世代ラベル
   `p2-token-budget` を導入し run.json / game_start に記録、
   正準ラン比較は同世代内に限定(regret のオラクル世代と同じ規律)。
   (d) **前提の訂正(direction で確定)**: 元提案の「250k は使い切らない
   封筒であって絞りではない」は誤り。timeout 降格後の世界では
   heavy thinker(実測: opus 14.5-19k/手 × 25-50手番 = 360k-950k)に
   対して 250k は実際に発火する拘束である。これは歪みではなく
   §4-7 の「等トークン封筒」という公平性定義そのもの — トークンの
   配分効率はモデル自身の選択として測定対象になる。だからこそ
   拘束の現実化と開示を同一プロンプト世代で1回に束ねる
   (開示なしで拘束だけ現実化する期間 = 隠れルールで測った正準ランを
   作らない)。
   (e) 効果検証は機構的事実2点のみ主張する: opus vs level_3 再走で
   (i) タイムアウト没収の解消(TO数)、(ii) 予算発火の有無と記録
   (token_budget 理由の pass イベント)。「開示がプレイを良くしたか」の
   因果は主張しない(絞りトラックの実験対象)。
6. **What disappears / is not protected** — 「壁時計300秒が実質的な
   強さ測定器になっている」状態。プロンプトの予算非開示。
   パイロット v1 のプロンプト条件との互換(v1 文書の「将来ランと
   混ぜない」注記と世代ラベルで管理)。旧デフォルト(300秒・予算なし)は
   非 LLM 対局(baseline 同士)では従来通り(トークンを消費しない
   agent に封筒は無意味)。

## Implementation

### 1. Canonical defaults (runner.ts + cli.ts)

- `runner.ts` に定数を追加:
  `CANONICAL_OUTPUT_TOKEN_BUDGET = 250_000`、
  `LLM_TURN_TIMEOUT_MS = 1_200_000`、
  `PROMPT_REV = "p2-token-budget"`(定義は prompt.ts、run 記録用に export)。
- `cli.ts` arena のデフォルト解決:
  LLM spec(`claude-cli*` / `codex-cli*` / `anthropic:*`)を含む対局では
  `--output-token-budget` 未指定 → 250k、`--turn-timeout-ms` 未指定 →
  1200秒。明示指定は常に優先(既存どおり run.json に記録)。
  非 LLM 対局は従来デフォルト(300秒・予算なし)のまま。
  判定は spec 文字列ベースの純関数 `isLlmSpec(spec)` に切り出してテスト。
- run.json / game_start に `prompt_rev` を追加記録。
- **stale 契約の同時更新(インベントリ)**:
  - cli.ts usage 文字列の「--turn-timeout-ms N ... (default 300000)」を
    条件付きデフォルト(LLM 対局 1200000 / それ以外 300000、
    budget default 250000)の記述に更新。
  - `runner.ts` の `cfg.turnTimeoutMs ?? 300_000` フォールバックは
    **維持**(GameConfig 直呼び・非 LLM 経路の既定。arena 側で LLM 判定
    して 1200s を解決するのであって、runner の既定は変えない)。
  - `docs/usage-semantics.md` の旧デフォルト記述(300s・予算は任意)を
    新デフォルトと「名目上の等出力トークン封筒(トークナイザ差の
    留保はクロスプロバイダ比較の既存注記どおり)」の記述に更新。
  - `isLlmSpec` は `claude-cli-learn*` も **true**(in-game 部分は同じ
    封筒対象)。事後学習解析の使用量が in-game 台帳・封筒の対象外で
    あることは既存挙動のまま(回帰テストで固定)。

### 2. Budget/残量のスレッディング (types.ts, runner.ts)

- `TurnInput` に `outputTokenBudget?: number` と
  `outputTokensUsed?: number` を追加。runner が act 呼び出し時に
  cfg.outputTokenBudget と当該チームの `st.usage.outputTotalTokens` を
  渡す(admission 検査と同じ値 = 表示と執行の一致)。
- **境界不変条件**: `playGame` は `outputTokenBudget <= 0` を reject
  (throw)。CLI パースは既に 0 以下を拒否しているが、GameConfig 直呼びの
  経路でも「予算0 = 初手から全パス」という無意味な対局を作らせない。
  focused テストを付ける。

### 3. Disclosure — 全アダプタ共有経路 (prompt.ts, engine.ts, agents/*)

- **現状の消費者インベントリ(3経路とも確認済み)**: agents/llm.ts・
  agents/cli.ts(claude-cli / codex-cli の両方)は全て
  `engine.observation(...)` と `prompt.buildInstructions(team)` を直接
  呼んでいる。ただし **llm.ts はシステム文を startGame で構築**しており、
  TurnInput の予算はその時点で存在しない。
- 対策 — 共有ビルダーに一本化し、構築を act 時に遅延:
  - `prompt.ts` に `observationFromInput(input: TurnInput): object` を
    新設(内部で `engine.observation` を呼び、`input.outputTokenBudget` が
    あれば `output_token_budget` / `output_tokens_used` を付加)。
    **3アダプタ全ての観測構築をこのヘルパー1点に置換** —
    開示のパリティを構築で保証し、ビルダー単体テストで固定する。
  - `buildInstructions(team, opts?: {outputTokenBudget?})` に予算文
    「Your team has a total output-token budget of N for the whole game
    (thinking included). When it is exhausted, your remaining turns are
    passed automatically — budget your thinking.」を追加。
  - **llm.ts はシステム文構築を初回 act に遅延**(startGame では
    team/gameId の保存のみ)。cli.ts 系は初回 act で指示文を送る既存構造の
    ままヘルパー呼び出しに切替。Agent インターフェースは変更しない。
- 観測 JSON: 予算未設定の対局ではフィールド自体を省略。
- `rulebook/laplace-8x8-v1.md` §8 に自動パス規則を1項追加
  (max_plies の一文と同格の match protocol 記述)。
- `prompt.ts` に `PROMPT_REV = "p2-token-budget"` を定義。

### 4. Match-conduct record (docs/match-conduct-laplace-8x8-v1.md)

- 「トークン封筒(暫定確定)」節を追加: 構造の凍結内容、250k の
  暫定確定と見直し条件(brief §3 の (a)(b))、壁時計の降格
  (1200秒バックストップ・記録は継続)、プロンプト世代 p2 の導入と
  世代内比較規律、根拠実測(スループット×思考量の分解)。

### 5. Validation run(検証・機構的事実のみ、250k 再確認の運用化)

- opus vs level_3、2局スワップ(新デフォルト、新シード)。
- 記録する測定値(per game): admitted turns(実際に act した手番数)、
  budget-pass turns(token_budget 理由の pass 数)、exhaustion ply
  (最初の budget-pass の ply、無ければ null)、残り手番数、終局理由、
  TO 数。
- **判定規則(brief §3(b) の運用化)**: budget-pass turns >
  admitted turns の対局が過半なら「250k は対局の大半を自動パス化する
  水準」= 値の見直し提案を docs に明記。そうでなければ「250k 暫定確定を
  再確認」と明記。いずれの結論かを **v1 本凍結前の明示的な
  accept/change 判定**として match-conduct 文書に記録する。
- 2局で予算が発火しなかった場合: 機構自体は合成テスト(§6)で固定済み
  なので、「実走では未発火」と正直に記録し「ランで検証済み」とは
  書かない。
- TO 数(前回9)の解消は従来どおり確認。結果は
  `docs/pilot-stage05-v1.md` に追記(プロンプト世代が違うため v1
  グリッドと成績を比較しない)。

### 6. Tests (packages/cli/test/)

- `isLlmSpec` 単体(claude-cli/codex-cli/anthropic/**claude-cli-learn**
  → true、random/takeshi/product-cpu → false)。
- `observationFromInput` 単体: 予算付き入力 → 両フィールド付加、
  予算なし → 省略(3アダプタが同一ヘルパーを使うことは構築で保証、
  各アダプタの呼び出し置換は diff で確認)。
- `buildInstructions` 予算文の有無。
- playGame が `outputTokenBudget <= 0` を reject する境界テスト。
- 事後学習解析の使用量が封筒・in-game 台帳の対象外のまま(回帰)。
- デフォルト解決: LLM spec 含み+未指定 → 250k/1200s が
  run.json / game_start に記録される(arena テスト)。明示指定優先。
  非 LLM 対局は 300s・予算なしのまま(回帰)。
- TurnInput スレッディング: fake LLM agent が
  `input.outputTokenBudget` / `outputTokensUsed` を受け取り、
  2手目では 1手目の消費が反映されている(playGame テスト)。
- prompt: 予算付き観測 JSON に両フィールドが載る/予算なしでは
  載らない。システムプロンプトに予算文が入る。
- 既存の budget admission テスト(runner-usage)の回帰維持。

### 7. Out of scope

- エンジンコア変更・タイムアウト没収規則自体の変更。
- 絞りトラック(予算で判別を出す実験)、フルグリッド再走。
- llm.ts(anthropic API 直)への max_tokens 強制などプロバイダ側の
  ハードキャップ(封筒は admission 方式で統一)。

## Verification

- 全 workspace typecheck + test green。
- 検証ラン(§5)完走と docs への機構的事実の記録。
- `check-upstream-drift.sh` 一致(コア無変更の機械確認)。
