---
status: implemented
direction: direction-freeze-draw-rules
owner: bench
risk_tier: standard
last_updated: 2026-07-24
---

# Freeze draw rules for laplace-8x8-v1 bench matches

## Direction Brief

1. **Purpose** — 段階0.5(JSONのみLLMパイロット)を回す前に、対局終了規則の
   未決(docs/benchmark-strategy-ja.md §4-3)を解消する。終了規則が未凍結の
   ままパイロットを走らせると結果が後から無効になり、劣化した対局が
   LLM課金を垂れ流す(実測: random同士は600手でも自然終局しない)。
2. **Concept owner** — 対局終了規則(ply上限・反復引き分け)の正本は
   ベンチのマッチ層(`packages/cli`)であり、凍結ルールエンジン
   (`packages/engine/src/core`、本体とバイト一致義務)ではない。ルールの
   対モデル開示の正本は `packages/cli/rulebook/laplace-8x8-v1.md`。
3. **Lifecycle and scope** — 二段構え。今回**凍結**するのは構造:
   反復引き分けルールの存在と定義、引き分け理由の区別集計
   (`horizon_draw` / `repetition_draw`)、アジュディケーション不採用。
   max_plies=100 は**段階0.5パイロットを拘束する正準値(暫定確定)**であり、
   パイロットで horizon_draw 率が高ければ短すぎたシグナルとして見直し、
   v1 本実行前に本凍結する。cap が変わった場合、パイロット結果は
   「max_plies=100 と記録された結果」として保持するが v1 の結果としては
   引用しない(全 run が max_plies を記録済み)。
4. **Value hierarchy** — 結果の事後有効性(凍結された規則の下での実行) >
   LLM対局の費用抑制(迷走対局の早期終了) > 実験の自由度。
   凍結コアのバイト一致(上流ドリフト監視)は破らない。
5. **Adopted direction** — (a) 正準 max_plies=100。根拠は seed 付き実測:
   互角対戦の自然終局は greedy 同士 25–75手、takeshi:d1 同士 33手、
   d2 の勝ち実績 59手で、100 は全実測値を約30%マージンでカバーする
   (100手=各色25手番)。arena のデフォルトを 100 にし、診断用途の明示
   オーバーライドは許すが run 記録に max_plies を必ず残す(既存挙動)。
   (b) 同一局面反復ルール: 同一局面が3回出現したら `repetition_draw`。
   反復判定キーは成分列挙ではなく**ゲーム進行に関与する全意味状態の
   正準直列化**(board[isDead含む]、currentPlayer、capturedPieces、
   eliminatedPlayers、consecutiveTimeouts。タイムスタンプ・lastMove
   メタデータは除外)。列挙を捨てた理由: 反則没収脱落は駒を盤から
   消すが capturedPieces を増やさない(`TurnManager.ts:29-37`)ため
   損失数は盤面から導出できず、consecutiveTimeouts など盤面に現れない
   将来関連状態が他にもある。成分列挙は同じ穴に落ち続ける。
   (c) 実装は runner(マッチ層)のみ。エンジンコア無変更。
   (d) ルールブックに反復引き分けを追記(モデルへの規則開示は §8
   Match protocol の管轄)。
6. **What disappears / is not protected** — 正準ランについて「cap を実験ごとに
   選ぶ自由」が消える。反復による無限ループ対局(実測で random 同士が該当)が
   消える。打ち切り時の優勢判定(アジュディケーション)は導入**しない**。
   過去の anchor-ladder-v1(cap 60/150/300)は遡及変更しない(ドキュメントに
   cap 明記済みで再現性は保たれる)。d2-vs-d3 未解決事項の再測時から
   正準 cap 100 を使う。

## Implementation

### 1. Repetition key + detection (packages/cli/src/engine.ts, runner.ts)

- `engine.ts` に `repetitionKey(state: GameState): string` を追加。
  **手作業の成分列挙は使わない**(direction で棄却済みの将来漏れリスクを
  再導入するため)。網羅性を機械で強制する:
  - `const REPETITION_KEY_FIELDS: Record<keyof GameState, "include" | "exclude">`
    の分類マップを定義。`GameState` にフィールドが増えると **typecheck が
    落ちる**(Record の網羅性)。
  - 実行時ガード: 実際の state オブジェクトに分類マップ未知のキーが
    あれば **throw**(fail-closed。ベンチのコアは vendored 凍結なので、
    状態形状が変わるのは意図的 sync 時のみ=即時に落とすのが正しい)。
  - キー本体は include フィールドのみを固定順で正準 JSON 直列化。
    ハッシュ化はしない(Map キーとして文字列で十分)。
- フィールド分類(全16フィールド):
  - **include**: `board`(isDead 含む)、`boardSize`、`capturedPieces`、
    `eliminatedPlayers`、`startingPiecesCount`、`eliminationThreshold`、
    `currentPlayer`、`consecutiveTimeouts`(対局中定数の同梱は無害かつ
    「進行関与か」の個別議論を不要にする)
  - **exclude**(時刻・表示・終端メタデータのみ): `turnStartedAt`、
    `turnTimeLimit`、`gameStartedAt`、`gameEndedAt`、`winningTeam`、
    `lastMoveBy`、`lastMoveAt`、`lastMove`
- `runner.ts` のループを再構成し、**到達した全ての非終端状態**(最終許容
  ply 後の状態を含む)が horizon 判定より先に反復判定を通るようにする。
  通常終局は最優先のまま(反復判定は非終端状態にのみ適用し、勝利を
  repetition_draw で上書きしない)。各イテレーションの判定順:
  1. `gameEndedAt` なら通常終局(center / elimination)
  2. 非終端状態のキーを `Map<string, number>` に計上 → 3回目なら
     `repetition_draw` で打ち切り
  3. `ply >= maxPlies` なら `horizon_draw`
  4. それ以外は着手処理
  (現行の `while (!gameEndedAt && ply < maxPlies)` 条件先行のままだと、
  最終許容 ply の着手が生んだ3回目の反復が horizon_draw に誤分類される。
  反復判定を gameEndedAt より先に置くのも誤りで、終端状態に反復判定を
  適用してしまう。)初期局面も1回目として数える。
- `game_end` イベントと `final.json` に既存フィールドで記録される
  (reason の値が増えるだけ)。events.jsonl に
  `{t: "repetition_draw", ply, occurrences: 3}` を1行追記。

### 2. Reason type extension + draw-rate reporting

- `runner.ts` `GameResult.reason` の union に `"repetition_draw"` を追加。
- `metrics.ts`: **`winReasons` は勝者がいる場合のみ集計されるため、引き分けは
  現状どこにも集計されない。** per-pairing summary に `draw_reasons`
  (`{horizon_draw: n, repetition_draw: n}`)と `draw_rate`(分母 = その
  ペアリングの全対局数)を追加する(§4-3「引き分け率別掲」の summary 側実装)。
- `standings.ts`: draws の内訳として `horizonDraws` / `repetitionDraws` 列を
  追加(§4-3 の standings 側実装)。
- reason 消費者インベントリ(全消費者の分類):
  - `packages/cli/src/runner.ts` `GameResult.reason` — **canonical**(union 拡張)
  - `packages/cli/src/metrics.ts` — 更新(上記 draw_reasons/draw_rate)
  - `packages/cli/src/standings.ts` — 更新(draw 内訳列)
  - `packages/cli/src/exportweb.ts` `reason: string` — 汎用文字列受け、
    **verified no change**
  - `packages/cli/src/types.ts` `EndGameInfo.reason: string`(117行) —
    汎用文字列、**verified no change**
  - `packages/cli/src/agents/learning.ts` — reason を文字列として
    表示に流すだけ、**verified no change**
  - `packages/cli/src/cli.ts` — arena 出力で `result.reason` を文字列補間
    表示するだけの汎用消費者、**verified no change**(文言変更なし)
  - `packages/cli/README.md` — **stale 文言。要更新**(下記 §5b)
  - `community/STANDINGS.md` — **生成物。要再生成**(下記 §5b)
  - `packages/cli/rulebook/laplace-8x8-v1.md` §8 — 更新(§4)

### 3. Canonical max_plies=100

- `cli.ts` の `--max-plies` デフォルトを 300 → 100 に変更し、usage 文字列に
  「canonical: 100 (laplace-8x8-v1)」と明記。
- 定数 `CANONICAL_MAX_PLIES = 100` を `runner.ts` に置き、cli.ts が参照。

### 4. Rulebook disclosure (packages/cli/rulebook/laplace-8x8-v1.md)

- §8 Match protocol に追記: 「同一局面(盤面・手番・累積損失・脱落状態を
  含む完全な進行状態)が3回出現した場合、その時点で引き分け」。
  max_plies の一文は既存のまま(値は game start の観測 JSON で伝達済み)。
- ルールブックはルール獲得測定の入力なので、文言は簡潔・非戦略的に保つ
  (最適プレイのヒントを与えない)。

### 5. Match-conduct record (docs/match-conduct-laplace-8x8-v1.md)

- 凍結内容の正本ドキュメントを新設: 構造の凍結(反復ルール定義・
  引き分け区別・アジュディケーション不採用)、max_plies=100 の
  暫定確定ステータスと見直し条件(パイロット horizon_draw 率)、
  v1 前本凍結の手順、根拠実測(seed 2001–2003 の自然終局分布)。

### 5b. Stale docs + generated artifacts

- `packages/cli/README.md`: 「default 300」「No repetition rule yet」の
  stale 文言(83行)を新ルールに更新。
- `community/STANDINGS.md`: `laplacebench standings community/runs/* --out
  community/STANDINGS.md` で再生成(生成元 `community/runs/` はリポジトリに
  tracked なので新列スキーマで再現可能。過去対局の結果値は変わらず、
  列が増えるだけ)。

### 6. Tests (packages/cli/test/)

- `repetition.test.ts`:
  - `repetitionKey` 単体: 同一盤面・同一手番で capturedPieces のみ異なる
    2状態が異なるキーになる(反則没収脱落の証拠シナリオ)。
    consecutiveTimeouts のみ異なる2状態も異なるキー。
  - **網羅性メカニズムのテスト**: 分類マップ未知のキーを持つ state を
    渡すと throw する(実行時ガードの証明。型レベルの網羅性は
    typecheck 自体が証明)。既知2フィールドの個別テストだけに頼らない。
  - runner 統合: 駒を往復させるだけのスクリプト agent 同士で
    `repetition_draw` が ply 上限より先に発火する。
  - **境界回帰テスト**: 3回目の反復が最終許容 ply の着手でちょうど発生する
    ケースで `horizon_draw` ではなく `repetition_draw` になる。
  - **終局優先テスト**: 勝利で終わった対局が repetition_draw に
    上書きされない(通常終局の優先を証明)。
  - random vs random(seed 固定)が cap 100 で `horizon_draw` または
    `repetition_draw` で必ず終わる。
- `metrics`/`standings` テスト: horizon_draw と repetition_draw の両カテゴリが
  summary の `draw_reasons`/`draw_rate` と standings の内訳列に正しく出る。
- **CLI デフォルトテスト**: `cli.ts` の maxPlies 解決を検証可能な形に切り出し
  (または引数パーステスト)、`--max-plies` 省略時に 100 が選ばれること、
  明示オーバーライドが尊重され `game_start` イベント/run 記録に残ることを
  アサート(`playGame` は maxPlies 必須引数のため runner テストでは
  デフォルトを証明できない)。
- 既存テスト(runner-usage 等)の回帰確認。

### 7. Out of scope

- エンジンコア(`packages/engine/src/core`)の変更(バイト一致維持)。
- anchor-ladder-v1 の再実行・遡及修正。
- per-move regret(明日、本体 CPU 改善の輸入とセットで別スライス)。
- v1 本凍結(パイロット結果を見てから)。

## Verification

- `npm run typecheck && npm run test`(全 workspace)green。
- `packages/engine/scripts/check-upstream-drift.sh` が引き続き完全一致を報告
  (コア無変更の機械的証明)。
- 手動: random vs random 2局(seed 付き)を新デフォルトで実行し、
  100 手以内に repetition_draw または horizon_draw で終局し、
  standings に draw 内訳が出ることを確認。
