---
name: reconcile-loop
description: 外側制御ループ 1 tick の汎用骨格。desired state（プラン status / 外部指摘 / 台帳）と observed state（コード・テスト・git）を突き合わせ、作業キューを更新し、予算内で最優先スライスを進め、人間判断が要るものをエスカレーションに積む。プロジェクト専用の reconcile スキル（例: linket-reconcile）がある場合はそちらが正本 — このスキルは新プロジェクトへ導入するための骨格とパターン集。
user-invocable: true
metadata:
  tags: loop, reconcile, orchestration, shared
---

# Reconcile Loop（制御ループ 1 tick の汎用骨格）

Kubernetes の reconciliation loop と同型: spec（あるべき状態）と status（観測）を比較し、差分を埋める行動を起こす。
1 回の呼び出し = 1 tick。状態は会話ではなくリポのファイルに置く（fresh context で再開可能にするため）。

**プロジェクト専用の reconcile スキルが存在する場合はそちらに従うこと。** このスキルは (a) 新プロジェクトへループを導入するときの雛形、(b) 各プロジェクト実装が共有すべき不変パターンの正本。

## プロジェクト側が定義するもの（設定）

新プロジェクトで導入するときは、`<project>-reconcile` スキルを作り、次を具体化する:

- **State ファイルのパス**: 作業キュー（例: `docs/loop/queue.md`）とエスカレーション置き場（例: `docs/loop/escalations.md`）。無ければ初回 tick で作る
- **観測ソース**: プラン frontmatter（`grep -l "^status: approved" docs/plans/*.md` 等）、外部フィードバックの取り込み経路（Sheets / issue tracker / レビュー doc）、回帰ゲートのコマンド
- **優先順位規則**: ユーザー指定 > リリーススコープ > 回帰修正 > その他、のようなプロジェクト固有の順序
- **蒸留先の正本**: 規範モデル / 質問バンク / 回帰台帳 / DR など、人間介入を外在化する先。汎用性判定を伴う: プロジェクト非依存のパターンは共有アセット（agent-skills のスキル手順・固定チェック・shared-instructions）が正本、プロジェクト固有の binding・provenance はプロジェクト側。derived copy には正本参照を付ける（置き場所規則の正本: interrogation スキル Record 節）
- **メトリクススクリプト**（任意）: 未蒸留検出・KPI 計算・コミット規律の存在チェック等の機械作業は LLM で grep せずスクリプトに出す
- **Attention event ledger**（任意）: main-session transcript から安定 ID 付き candidate を機械採取し、`avoidable|required|informational` の意味分類だけを LLM が行う。source unavailable は coverage-incomplete として保存し、ゼロ件と混同しない

## Tick の不変骨格

### 1. Sense（観測を集める）

- プラン status・外部指摘・git log（前回 tick 以降の実質変化を機能スライス単位で分類。docs-only はアプリ挙動変化と分ける）・回帰ゲート・working tree の健全性
- **取り込み鮮度検査**: 新規指摘を queue 化する前に、同領域の解決済み項目・DR・直近実装と突き合わせる。後続決定に上書きされている疑いがあれば、実装 item ではなく「stale 疑い・確認して閉じる」item として起票する
- **蒸留走査（必須ステップ — 飛ばした tick は不完全な tick として digest に明記）**: 未蒸留の人間介入ログを走査し、分類（介入対象 × ミス型）して介入ログへ追記。同型 2 回目または prediction miss は**この tick 内で**蒸留先へ振り分けて `distilled` を付ける。未蒸留の滞留が閾値（例: 10 件)を超えたら escalation に積む — 滞留はログ肥大と学習停止を招く
- **人間注意の観測**: provider transcript adapter があれば main user session を走査し、progress probe / continuation nudge / capability correction / repeated requirement の candidate を抽出する。review/runner session を除外し、provider message/item identity（無い場合はtimestamp+message hash）で dedup する。parse error / unsupported source は coverage-incomplete、未完了turnの候補は完了までpendingとする。LLM は context から `avoidable|required|informational` を分類し、raw transcript や秘密値を ledger に写さない

### 2. Reconcile（キューを更新する）

- 新しい指摘・未着手プランを queue に item 化する（重複させない。既存 item は更新）
- 完了 item は evidence（コミット hash・テスト結果・レビュー verdict）を付けて done にする。**エージェントの「やった」という主張は evidence にならない**
- 外部観測と repo 正本ドキュメントがずれていたら、実装せずドキュメント側を最小限で同期する（Docs Sync）。判断が要るものは queue / escalations へ

### 2.5 Hygiene（ルール自体の剪定 — 該当 tick のみ）

- ルールは増やすだけでは精度が下がる（観点が多いほど 1 つあたりの注意が薄まる）。台帳・CLAUDE.md・スキルの肥大は**それ自体を回帰として扱う**
- 発火履歴を証拠に剪定する: 「最近も発火/差し戻しあり→維持」「発火ゼロ＋根因消滅→降格またはアーカイブ」「誤検知多発→パターンを絞るか降格」
- KPI で工程の陳腐化を検出する。north star = **avoidable human-attention events / completed user-owned work unit**。診断軸は decision surprise（`prediction:none`）と execution rescue、必ず capture coverage を併記する。required attention は明示的な価値/優先順位・承認・契約上の signoff に狭く限定し、人間が発見しただけの UI/copy defect を blanket に除外しない。補助: 指摘ゼロレビュー率、手戻り class 比率、スライス検証実働。KPI が陳腐化を示したら該当工程へのメタ尋問を queue に起票する
- 予測 hit が連続しているエスカレーションクラスは、auto 裁定への委任昇格を提案する

### 3. Act（予算内で進める）

- 1 tick で着手するのは**最優先の 1 スライスのみ**（機能スライス単位。マイクロ変更の細切れ禁止）
- 通常の開発規律（リスク階層ゲート・レビュー・回帰ゲート）をすべて適用する。done の条件は evidence ladder
- 残り時間・予算が足りなければ、中途半端に進めず item を in-progress のまま正直に記録して止める

### 4. Escalate（人間の聖域を侵さない）

次は実装せず escalations に積む: 発注側の意図・仕様の曖昧さ / 破壊的操作 / 価値判断の変更（スコープ・優先順位・概念モデル）/ 外部送信の実行（文面ドラフトまでは作ってよい）

積む際は `prediction:`（予測裁定＋確信度）と `counter:`（最強の反対理由）を必ず付ける。人間が裁定したら `prediction: hit | miss` を記録する。miss は同型 2 回を待たない即時の蒸留候補

### 5. Report（tick の終わりに）

- queue / escalations を更新し、tick サマリー（進めた item・evidence・新規 item・エスカレーション）を簡潔に出力する
- 連続実行（/loop）で queue が空かつ新着なしなら、次 tick を長め（30分+）にするか停止を提案する

### 6. Docs-only Commit（夜間自動 tick のみ）

- 既存の未コミット差分（コード・設定・migration・テスト）には触らない。この tick が更新した docs / loop state のみを明示的に stage する。`git add .` は禁止
- stage 対象を `git diff --cached --name-only` で検査してからコミットする。コミットできなければ理由を digest に記録し、コード差分を巻き戻さない

## 起動方法

- 自己ペース連続実行: `/loop /<project>-reconcile`
- 夜間定期実行: `/schedule` または cron で 1 tick + 朝ダイジェスト
- 単発: `/<project>-reconcile`
