---
status: implemented
direction: direction-product-cpu-import
owner: bench
risk_tier: standard
last_updated: 2026-07-24
---

# Import product cpu-v4 baselines and per-move regret

## Direction Brief

1. **Purpose** — 本体で本番rollout済みの cpu-v4(可視5段階、大幅高速化)を
   LaplaceBench のベースラインとして輸入し、それをオラクルに使う
   per-move regret(戦略§2.1「判別の主戦場」指標)を実装する。
   昨日のユーザー発言どおり「CPU側の改善をベンチに持ってきて regret に使う」
   の実行。凍結 TakeshiPolicy では d3=18.5秒/手で不可能だった実用的な
   オラクルが、level_5 の 0.26秒/局面(全合法手スコア)で成立する。
2. **Concept owner** — 本体の Python `cpu_levels.py` + `MinimaxAgent` が
   ポリシーの正本(ベンチは読み取り専用で参照、複製しない)。ベンチの
   マッチ層が対局実施・記録の正本。regret 出力の正本はベンチの run
   ディレクトリ(per-game `regret.json` + run-level summary)。
   凍結ルールエンジン(`packages/engine/src/core`)は無関係のまま
   (ff57443→d316b30 で `packages/game-shared/src/core` diff ゼロを確認済み)。
3. **Lifecycle and scope** — アダプタ仕様の transport 改訂(HTTP→ローカル
   Python ブリッジ)、agent spec `product-cpu:cpu-v4:level_1..5`、
   `laplacebench regret` コマンド、配置確認ラン(anchor-ladder-v2 文書)まで。
   LLM パイロット実行・Elo/BT fit・level_6..13 互換別名の公開はしない。
4. **Value hierarchy** — オラクル/ベースラインの同一性証明(policy_version・
   本体コミット・Python バージョンの fail-closed 検証と全出力への記録) >
   再現性(seed 貫通、環境依存ゼロ) > 実行速度 > 実装の小ささ。
   本体リポジトリと他エージェントの checkout には一切触れない。
5. **Adopted direction** — (a) transport は HTTP ではなく laplacebench 側の
   常駐 Python ブリッジ(stdin/stdout JSONL)。理由: regret オラクルに必須の
   `score_root_moves_for_analysis` が HTTP 非公開、本体 venv に uvicorn が
   無く HTTP は本体変更なしに動かない、対局とオラクルを1契約に統一。
   ブリッジは app.py の解決手順(`get_cpu_level` →
   `MinimaxAgent(profile_name, strict_profile=True)`)を忠実に複製。
   (b) **本体 venv 依存は撤回**(direction での修正): MinimaxAgent 系は
   標準ライブラリのみと検証済みで、ブリッジは素の python3(3.11+)+
   固定スナップショットのコードのみで動く。第三者依存ゼロ。
   (c) 本体参照は明示パス(env `LAPLACE_PRODUCT_REPO` / `--product-repo`)。
   今日の正本は固定スナップショット clone
   `/Users/kei/projects/laplace-main-cpu-v4`(d316b30 detached、本番rollout
   コミット)。(d) 可視5段階のみ公開(level_6..13 は同一 profile の互換別名
   なので重複名を作らない)。(e) 確率的 tier(1–3、実測で確認)には
   ベンチのゲーム seed から導出した seed を `MinimaxAgent(seed=)` に渡して
   再現可能にする(本番は seed=None だが、同一ポリシー分布の draw 固定であり
   seed は全て記録する)。(f) regret はオラクルの辞書式選好
   (selectionClass desc, value desc, formationPressure desc)に忠実に定義する:
   chosen_rank を常に記録し、スカラー regret_value = rank1.value −
   chosen.value は chosen と rank1 の selectionClass が一致するときのみ
   計算(同一 class 内で非負が構成的に保証される)。class 不一致は
   categorical blunder(missed_immediate_win / chose_unsafe)として別系統で
   集計し、スカラーと混ぜない。全出力にオラクル ID(spec 文字列+本体
   コミット+per-position depth)を刻み、オラクル世代を跨ぐ比較を禁止する。
6. **What disappears / is not protected** — アダプタ仕様の「HTTP が既定
   transport」という仮定。本体 venv への依存(素の python3 のみで動く)。
   「product CPU 輸入はスコープ外」境界(follow-on の実行そのもの)。
   仕様書の cpu-v1 例示は歴史的記述になる。旧 takeshi ラダーの再実施は
   しない(takeshi:dN は独立の凍結ベースラインとして残る)。

## 実測済みの前提(2026-07-24、スナップショット d316b30)

- cpu-v4 可視 tier: level_1..5 = practical_tier_1/2/3/5 + practical_expert_v3、
  p95 上限 0.25/0.25/0.5/1.2/1.8 秒。
- 実測レイテンシ(開局): level_1 predict 4ms / level_3 39ms /
  level_5 256ms。level_5 `score_root_moves_for_analysis` = 36 roots を
  264ms(value・rank・selectionClass・unsafe 付き)。
- 決定論性: tier 1–3 は確率的、4–5 は決定論的(開局5回試行)。
  `MinimaxAgent(seed=...)` あり。
- 依存: minimax.py / base.py / weight_profiles.py / cpu_tier_profiles.py /
  cpu_levels.py は stdlib のみ。システム Python 3.14 で動作確認済み。
- 本体 API は agent 生成をリクエスト毎に行う(app.py)。ブリッジも
  呼び出し毎生成で本番挙動に一致させる。

## Implementation

### 1. Python bridge (packages/cli/bridge/product_cpu_bridge.py)

- 起動: `python3 product_cpu_bridge.py --product-repo <path>`。
  `<path>/ai/src` を sys.path に追加して import。
- 起動時に1行 hello を出力(fail-closed: 検証失敗は非0終了):
  `{t:"hello", protocol:"product-cpu-bridge-v1", policy_version,
  product_commit(git -C <path> rev-parse HEAD),
  product_dirty(git status --porcelain 非空), python: sys.version,
  visible_tiers:[{level_id, profile_name, p95_limit_seconds}]}`。
  クライアントは必須フィールド欠落・型不正の hello を reject する。
  可視 tier 全てについて profile 解決を検証
  (`_validate_active_cpu_profiles` 相当を可視 tier に限定して複製)。
- リクエスト(1行 JSON)→ レスポンス(1行 JSON):
  - `{id, op:"move", level_id, seed, state}` →
    `{id, move:{from:[r,c], to:[r,c]}, seed_used, elapsed_ms}`
    (`MinimaxAgent(profile, strict_profile=True, seed=seed).predict(state)`。
    呼び出し毎に新規生成=本番と同じ。predict の stdout ノイズは
    contextlib.redirect_stdout で吸収し、プロトコル出力と混ざらないようにする)
  - `{id, op:"score_roots", level_id, state}` →
    `{id, depth, roots:[{move:{from,to}, value, rank, selectionClass,
    immediateWin, unsafe}], elapsed_ms}`
  - 未知 op・不正 state は `{id, error}` を返す(プロセスは落とさない)。
- state 形式は本体 API の MoveRequest と同じ
  (board: (null|{player,isDead})[][], currentPlayer, boardSize,
  eliminatedPlayers, capturedPieces)。

### 2. TS agent adapter (packages/cli/src/agents/productcpu.ts)

- **非同期ファクトリ + 二段ライフサイクル**(makeAgent は同期のため、
  name/provenance が hello に依存する product-cpu はそのままでは成立しない。
  かつ arena は対局ごとに swap 対応の per-game seed(gameSeed+1/+2)で
  agent を作り直すため、1回のハンドシェイクを使い回すと後続対局の
  seed/役割が壊れる):
  1. **metadata-only preflight**(run.json 書き出し前に1回): product-cpu
     spec が含まれる場合、ブリッジを spawn → hello 検証(下記)→
     provenance を捕捉 → **即 dispose**。検証済み name もここで確定する
     (name は seed に依存しない)。
  2. **per-game 構築**: 対局ループ内で従来どおり per-game seed で
     `await createProductCpuAgent(...)` し、対局ごとに fresh handshake。
     hello 検証は preflight と同一条件で再実施(preflight 後のドリフトも
     fail-closed)。2体目の構築が throw したら1体目を dispose してから
     再 throw。playGame の finally が対局終了・途中失敗の両方で両 agent を
     dispose する。= spawn される全ブリッジに所有者と破棄経路がある。
- hello 検証(fail-closed、いずれも throw):
  - `hello.policy_version` が spec 文字列の policy 部と一致
  - levelId が `hello.visible_tiers` に含まれる
  - **commit pin**: `--product-commit` / env `LAPLACE_PRODUCT_COMMIT` で
    期待コミットを指定し、`hello.product_commit` と不一致なら reject。
    product-cpu ラン実行には pin 必須(未指定はエラー。brief の
    fail-closed 同一性証明を「記録のみ」に緩めない)。
  - **クリーン判定**: hello に `product_dirty`(`git status --porcelain`
    非空)を含め、dirty なら reject(スナップショットは常にクリーン)。
- **ブリッジクライアントのライフサイクル(fail-closed)**:
  - リクエストは id で相関(Map<id, resolver>)。子プロセス exit /
    非JSON行 / stderr はまず全 pending を reject してから診断を投げる。
  - per-request deadline(move: 60s、score_roots: 120s)超過で reject。
  - `Agent` interface に任意の `dispose?()` を追加し、productCpuAgent は
    dispose で子プロセスを SIGTERM。**runner の playGame を try/finally 化**し、
    途中 throw でも両 agent の dispose が必ず走る(現行は finally が無く
    endGame 頼みでプロセスリークする)。
  - テスト注入用に `bridgeCommand` オーバーライド(fake bridge を node で
    差し込める)を受ける。
- `act(input)`: bench GameState → MoveRequest 形式に変換して op:"move"。
  **seed 契約**: 構成時に受ける `agentSeed`(cli.ts が現行 random 系に
  渡しているのと同じ per-team 導出 seed)から、per-move seed =
  `(agentSeed * 1_000_003 + ply) mod 2^31` を導出してブリッジへ渡す。
  応答の `seed_used` を act 戻り値の `meta` に載せ、runner が move イベントに
  `meta` を透過記録する(= 全 ply の実効 seed が events.jsonl から復元可能)。
- name は `product-cpu:${hello.policy_version}:${levelId}`(hello 由来、
  手打ちしない=仕様の「read verbatim, never hand-typed」)。

### 3. Spec resolution + provenance (cli.ts)

- `makeAgent`(async 化): `/^product-cpu:([a-z0-9-]+):(level_\d+)$/` を解決。
  product repo パスは `--product-repo` > env `LAPLACE_PRODUCT_REPO`、
  期待コミットは `--product-commit` > env `LAPLACE_PRODUCT_COMMIT`。
  未指定でスペックが要求されたら明確なエラー。
- run.json provenance(product-cpu agent 使用時、preflight 完了後に
  書くので hello 由来の値が揃っている):
  - 共有ブロック `product_cpu: {policy_version, product_commit, python,
    protocol:"product-cpu-bridge-v1", product_repo, dirty:false}`
  - **per-team**: `teams: {A: {spec, level_id}, B: {...}}`(両チームが異なる
    tier のとき曖昧にならない構造化記録)
- name の一貫性: run.json / game_start / final.json / summary / standings の
  全てで同一の検証済み name が使われることをテストで固定する。
- コロン入り name の扱い(検証済み非問題として明記+テスト):
  run-id 導出は既存の `[^a-zA-Z0-9_-]` 置換でサニタイズされ、run データ・
  summary キー・standings 行では verbatim のまま保持される。
- usage 文字列・README の agent spec 一覧に追記。

### 4. Regret command (packages/cli/src/regret.ts + cli.ts)

- `laplacebench regret <runDir> [--oracle product-cpu:cpu-v4:level_5]
  [--product-repo <path>] [--product-commit <sha>]`(オラクル既定 = level_5)。
- **ライフサイクル**: regret コマンドはオラクル用ブリッジ/クライアントを
  1本所有し、リプレイ〜出力書き込みの全体を try/finally で包む。成功・
  プロトコル失敗・リプレイ不整合(chosen 不在等)・書き込み失敗のいずれでも
  finally で dispose する(子プロセス/stdio ハンドル残留による CLI ハングを
  防ぐ)。fake-bridge テストで「正常完了」「リプレイ途中 throw」の両経路の
  クリーンアップを固定する。
- exportweb.ts の決定論リプレイと同じ手順で events.jsonl を再生:
  move イベント適用前の状態でオラクルに op:"score_roots"、chosen move を
  roots から探して記録し、適用。pass イベントは advanceTurn(regret 対象外)。
  chosen が roots に無い場合はエラー(リプレイ不整合と同義、fail-closed)。
- **regret の定義(オラクルの順序意味論に忠実)**:
  オラクルの選好は `(selectionClass desc, value desc, formationPressure desc)`
  の辞書式順序であり、`value(rank1) − value(chosen)` は class が異なると
  負値や誤誘導になり得る(例: 高 value だが unsafe な手)。よって:
  - `chosen_rank`(順序忠実、常に記録)
  - `regret_value = rank1.value − chosen.value` は
    **chosen.selectionClass == rank1.selectionClass のときのみ**計算
    (同一 class 内では rank が value 降順なので非負が構成的に保証される)。
    class が異なる場合は `regret_value: null`。
  - class 不一致はカテゴリカルな blunder として別記録:
    `missed_immediate_win`(rank1 が class 2、chosen が未満)、
    `chose_unsafe`(safe な手が存在するのに chosen が unsafe)。
  - 集計は「同一 class 手の mean/median/p90 regret_value」+
    「categorical blunder 率」の2系統(混ぜない)。
- 出力:
  - per-game `games/<id>/regret.json`:
    `{oracle:{spec, policy_version, product_commit, python, protocol},
    moves:[{ply, color, team, agent, chosen_rank, n_roots, depth,
    chosen_value, best_value, chosen_class, best_class, regret_value,
    missed_immediate_win, chose_unsafe}],
    per_team:{A:{mean,median,count,blunder_rate}, B:{...}}}`
  - run-level `regret-summary.json`: agent 別
    `{mean_regret, median_regret, p90_regret, same_class_moves,
    missed_win_rate, unsafe_rate, moves, oracle}`。
- regret 数値の意味は「同一オラクル世代内でのみ比較可能」。
  strategy §2.1 の per-move regret の初版実装であり、ラベルの証明/推定
  区分(段階2)は oracle depth の per-position 記録で前倒しの布石だけ打つ。

### 5. Docs

- `docs/product-cpu-adapter-v1-spec.md`: Revision 2026-07-24 節を追加し
  transport を bridge に改訂(HTTP 節は歴史的記述として残し、非公開 API
  依存と venv 制約という改訂理由を明記)。naming 規約は不変。
- `packages/cli/README.md`: agent specs・regret コマンド・product repo
  パスの設定方法。
- `docs/anchor-ladder-v2.md`(§6 の結果記録)。

### 6. 配置確認ラン(anchor-ladder-v2)

- 正準 cap 100・paired seeds で:
  隣接 product tier(L1vsL2, L2vsL3, L3vsL4, L4vsL5)各4局(2 paired seeds)、
  接続対局 takeshi:d2 vs level_1 と takeshi:d2 vs level_5 各2局(1 paired seed)。
- 結果と regret コマンドの実出力(サンプル run に対する regret-summary)を
  `docs/anchor-ladder-v2.md` に記録。単調性が崩れた場合は v1 と同じ規律で
  「要追加サンプル」と正直に記録する(結論を急がない)。

### 7. Tests (packages/cli/test/)

- **fake-bridge テスト(repo 非依存、CI で常時実行)**: プロトコルを話す
  小さな node スクリプトを `bridgeCommand` で注入し、TS クライアントの
  fail-closed ライフサイクルを製品リポジトリ無しで固定する:
  - hello 検証(policy 不一致 / 可視 tier 外 / commit pin 不一致 /
    dirty=true がそれぞれ独立に reject される)
  - リクエスト相関(順不同応答)、非JSON行 → pending 全 reject、
    子プロセス途中 crash → pending 全 reject、per-request timeout、
    dispose が子プロセスを終了させる、product repo 未指定エラー
- `productcpu.test.ts`(実 product repo 必須のテストは
  env `LAPLACE_PRODUCT_REPO` が無ければ **理由を出力して skip**
  — CI には product repo が無い。silent cap にしない):
  - hello 検証: policy_version=cpu-v4、visible_tiers が5件。
  - move op: 開局で合法手が返る。同一 seed・同一局面で同一手(確率的
    tier 1 で2回呼び出し一致=再現性)。
  - score_roots op: rank1 が存在し value が有限、n_roots>0。
  - 実対局1局(product-cpu vs random、cap 短め)で run.json / game_start /
    final.json / summary / standings の name・provenance 一貫性を検証。
- `regret.test.ts`:
  - regret 計算の純関数単体(mock roots fixtures): chosen=rank1 → 0、
    同一 class 劣位 → 正値、**class override**(immediateWin が
    高 value より優先/unsafe 降格)→ regret_value null +
    categorical flag、formationPressure タイブレーク、chosen 不在 → throw。
    同一 class 内の非負性を fixture で証明。
  - (repo あり時)random vs random の短い seeded run に対して regret
    コマンド一式が per-game/summary を生成し、oracle ID が全出力に載る。
- runner の try/finally 化の回帰: act が throw する agent でも dispose が
  呼ばれる(fake agent で検証)。
- コロン入り name: run-id サニタイズはデフォルト導出時のみ、run データ・
  summary キー・standings 行では verbatim 保持をテストで固定。
- 既存回帰(repetition/runner-usage/engine 13本)green 維持。

### 8. Out of scope

- LLM パイロット本番(段階0.5 の実行そのもの)。
- Elo/Bradley-Terry fit、regret の局面フェーズ別分解。
- level_6..13 互換別名の公開、HTTP transport 実装。
- 本体リポジトリ・他エージェント checkout への一切の変更。
- 旧 anchor-ladder-v1(takeshi ラダー)の再実施。

## Verification

- 全 workspace typecheck + test green(product repo 必須テストはローカルで
  実行、skip 経路も確認)。
- `check-upstream-drift.sh /Users/kei/projects/laplace-main-cpu-v4` で
  凍結コアが v4 スナップショットともバイト一致であることを機械確認。
- 配置確認ラン(§6)の完走と anchor-ladder-v2 への記録。
- サンプル run への `laplacebench regret` 実行と出力の目視確認
  (oracle ID・regret 値・rank の妥当性)。
