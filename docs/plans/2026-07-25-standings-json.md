---
status: implemented
direction: direction-standings-json
owner: bench
risk_tier: standard
last_updated: 2026-07-25
---

# Machine-readable community standings + PR-side regeneration gate

## Direction Brief

1. **Purpose** — 「みんなが試して更新できる」動線の欠けた後半区間
   (community 台帳 → laplace.zone/bench)を繋ぐ前半。standings を
   機械可読 JSON にし、公開ページがビルド・デプロイなしで直接消費できる
   状態を作る(laplacebench は PUBLIC、raw.githubusercontent.com は
   CORS 許可 — 確認済み)。
2. **Concept owner** — standings の計算は `standingsData` 一箇所が正本。
   Markdown / JSON はその整形。community 台帳の正本は従来どおり
   `community/runs/*`(リプレイ検証済みイベントログ)。
3. **Lifecycle and scope** — ベンチ側のみ(表示 = laplace-main 側は
   別スライス)。official レーン(✓公式)は lane フィールドで布石のみ、
   本スライスでは community のみ。
4. **Value hierarchy** — main の自己整合(runs と standings の恒常一致) >
   提出 PR の透明性(diff に順位変動が見える) > 提出者の手間の最小化 >
   自動化機構の少なさ(常設 write 権限を持たない)。
5. **Adopted direction** — **(direction で CHANGE)** bot 事後コミット案を
   棄却し、**PR 側再生成 + CI 整合ゲート**を採用。理由: 提出者は既に
   clone + CLI 実行済みで 1 コマンドの追加負担は実質ゼロ、PR diff に
   順位の動きが見えるのは台帳として実質的価値、main は常に自己整合、
   contents:write・無限ループ対策・[skip ci] が全部不要。
   JSON スキーマ: `{schema: "laplace-bench-standings-v1",
   lane: "community", game_count, run_count, rows: [{agent, games, wins,
   draws, losses, center_wins, elim_wins, horizon_draws,
   repetition_draws, err_per_turn}]}`。決定論的(タイムスタンプなし、
   ソートは wins desc → 勝率 desc → agent 名 asc の全順序)。
6. **What disappears / is not protected** — 「マージ後に standings を
   手動再生成する」運用(PR 内での再生成に置換)。standings 計算の
   Markdown 専用実装。bot コミット案・GitHub Pages 案(検討の上不採用)。

## Implementation

1. **standings.ts**: `standingsData(runDirs): StandingsData`。
   **バイト契約を明示**: ソートは wins desc → 勝率 desc → agent 名の
   **コードユニット序数比較 asc**(localeCompare 不使用 — 環境非依存)。
   `err_per_turn` は turns=0 なら null、それ以外は
   `Math.round(errors / turns * 1000) / 1000` の JSON 数値
   (IEEE754 の最短表現は JS 仕様で決定論)。JSON はプロパティ挿入順を
   スキーマ記載順に固定し、2-space インデント+**末尾改行ちょうど1つ**。
   `standingsMarkdown` は standingsData からの整形に書き換え。
   `standingsJson(runDirs): string`。**ゼロ run**: game_count 0 /
   run_count 0 / rows [] を正常出力。
2. **cli.ts**: `standings` に `--json-out <path>` を追加。
   **正準コマンドは1つ**(direction の摩擦ゼロ論拠と整合):
   `laplacebench standings community/runs/* --out community/STANDINGS.md --json-out community/standings.json`
   — README・wizard 案内・生成 Markdown の Regenerate 行・CI の失敗
   メッセージ全てでこの同一コマンドを使う。
   **位置引数抽出の修正**: 現行の `rest.filter(!--)` はオプションの
   **値**(例: `--out` の直後のパス)を run ディレクトリとして拾う
   潜在バグがある — 消費済みオプション値を除外する形に修正し、
   `--json-out` 単独指定も動くようにする。usage 文字列更新。
3. **成果物の再生成**: `community/STANDINGS.md`(全順序ソートで並びが
   変わる可能性あり・Regenerate 行を正準コマンドに更新)+ 新規
   `community/standings.json` をコミット。
4. **CI 整合ゲート(fail-closed の境界込み)**:
   `.github/workflows/community-verify.yml` の**制限的 paths フィルタを
   撤廃**(generator/CLI 変更の PR が成果物再生成を忘れてもゲートを
   すり抜けないように。replay 検証は毎 PR 実行でも数秒)。
   既存の「Standings preview」ステップ(line 30)は**単一の整合
   ステップに置換**: md+json を一時パスへ一度だけ生成し、コミット済みと
   バイト `diff`。**standings.json が存在しない場合も fail**。
   不一致時は正準コマンド(1つ)を明示して fail。replay 検証は保持。
5. **文書/導線**: community/README.md の提出手順に正準コマンドを追加し、
   「standings.json は raw URL で公開消費される。スキーマ変更は schema
   フィールドの版上げで行う」という消費契約を明記。wizard の
   submissionGuidance にも同じ1行を追加(テスト更新)。
6. **Tests**: **golden シリアライズ検証**(プロパティ順・数値/null
   表現・インデント・末尾改行1つをバイト固定した期待文字列と比較。
   wins/勝率タイ+丸め境界の fixture 含む)、決定論(2回呼び出し
   バイト一致+タイ時の序数 agent 名順)、markdown が data 由来で数値
   整合、`--json-out` 単独/`--out` 併用/ゼロ run(rows [])の CLI 経路、
   位置引数修正(オプション値が run dir に混入しない)、
   submissionGuidance の追加行、既存回帰(productcpu.test.ts の
   standings 利用含む)green。

## Delivery(要求の dev→main の位置づけ)

- 本スライス(ベンチ側)は laplacebench **main のみ**(このリポジトリは
  単一ブランチ運用)。push 後、
  `https://raw.githubusercontent.com/keisuke70/laplacebench/main/community/standings.json`
  を実 fetch してスキーマどおり配信されることを確認する。
- ユーザー要求の「dev そして main に反映」は **laplace-main 側の表示
  スライス(Phase B、別プラン)**に適用: branch → PR to dev → merge →
  dev 検証 → main へ promote(Vercel デプロイ)。

## Out of scope

- laplace-main 側の表示(別スライス)・official レーンの実体・
  提出自動化。

## Verification

- 全 workspace typecheck + test green。
- 再生成した community/standings.json が CI ゲートの diff 比較を
  ローカルで通る(冪等性の実確認)。
