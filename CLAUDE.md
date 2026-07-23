<!-- BEGIN SHARED INSTRUCTIONS (auto-synced from agent-skills) -->

## リスク階層ゲート（スライスごとの検証構成）

工程の目的は gate 通過ではなく、品質・不可逆境界を守りながら**人間が作業を前進させるために払う注意を減らすこと**。スライスに着手する前に、ファイル名や「金銭」「権限」という語ではなく **semantic delta × irreversibility × blast radius × evidence strength** でリスク階層を判定し、work item の記録（裁定ログ見出し）に `tier:` として明示する。迷ったら上の階層に倒す。

| 階層 | 判定基準 | ゲート構成 |
|---|---|---|
| 軽量 | UI 文言・表示・doc・機械的変更、または下記 bounded corrective。schema/状態/契約の新設なし | verify + 回帰ゲート + `/codex-impl-review` 1 本（6 項目弁明と tier defense を同梱）。方向づけ対話・プラン・plan review なし |
| 標準 | 新しい通常挙動、schema、状態遷移、API contract を導入・変更するが重量ではない | 方向づけ対話 → プラン → `/codex-plan-review` → `/codex-impl-review`（弁明同梱）。独立の impl 尋問なし |
| 重量 | legacy data semantics、金額計算・配賦・決済/会計状態、認可 enforcement / identity trust、外部契約、cutover、不可逆 migration を変更する | フル: 方向づけ対話 → プラン → `/codex-plan-review` → `/interrogation`（impl checkpoint）→ `/codex-impl-review` |

金額や権限を**表示・読取するだけ**で重量にしない。計算・状態・enforcement・trust・data meaning を変えるなら重量。移行/cutover/不可逆操作は常に重量。

### Bounded corrective（軽量 fast path）

新しい tier ではなく軽量の厳格な allowlist。次を**全て**満たす回帰修正だけが使える。

1. user quote / issue・QA 行 / prior shipped or tested contract が、戻す正しい挙動を一意に示す。
2. schema/migration、authorization enforcement / identity trust、payment/settlement/accounting calculation、legacy data semantics、data mutation/lifecycle、external integration contract、cutover、不可逆操作、新概念を変えない。read-only に見えても legacy 解釈や credential/trust validation を変える修正は重量。
3. blast radius が限定され、失敗を再現する focused regression test がある。
4. impl review に tier defense を渡し、reviewer が diff と突合する。

一つでも unknown、新 contract、禁止 delta、reviewer counterexample があれば標準/重量へ昇格し、その時点で必要な direction/plan を作る。fast path を維持するための互換 shim や silent fallback は足さない。

## 方向づけ対話とプラン（標準・重量スライス）

- **プランを書く前に**`/human-direction-proxy`で方向づけ対話を回す（runner: `run-human-direction-proxy.sh direction-<slug>`）。著者は要求原文／出所、良くしたいこと、対応案と理由、大きいtradeoff・不確実性・消えるものを、人間へ話すように短く説明する。Proxyはprojectの規範・条件付き優先順位とproposalに関連する過去判断を使い、気になる一点を自然に問い、著者の説明・反論・targeted evidenceとの短い往復で`ACCEPT / CHANGE / HUMAN_DECISION`を裁定する。疑問が残る間は`AWAITING_AUTHOR`で対話を続け、必要な証拠もその自然な問いとして求める。証拠要求を独立outcomeにしない。別案の独立導出、固定質問数、repo-wide初手探索、質問への即時降伏は禁止。方向を変えうる差分が消えたら、著者がdirection brief（6フィールド、「消えるもの・守らないもの」を含む）へ固定し、`export-human-direction-trace.mjs`のcompleted traceをwork-item裁定ログへ変更せず追記する
- 正式プランは `docs/plans/YYYY-MM-DD-<slug>.md` に保存する。必須節・frontmatter はテンプレ（`docs/plans/README.md`）に従う: 先頭に `## Direction Brief`、frontmatter に `status:` と `direction: <session-key> | exempt`。会話中の `proposed_plan` やインライン箇条書きは成果物の代替にならない
- `status: draft | approved | implemented | abandoned` のライフサイクル: レビュー APPROVED で `approved`（実装待ちまたは実装中）、実装完了で `implemented`、中止で `abandoned` に、その作業をしたエージェントがその場で更新する。`draft` のまま実装を始めない。「実装中」の専用状態は置かない（working tree・git log で観測できる）。プランを参照する側は frontmatter の status を正とし、夜間 reconcile が `approved` と実装証跡の drift を監査する
- ExitPlanMode・完了報告の前に `/codex-plan-review` を回して APPROVED を得る。レビューは「プランが自分の brief を裏切っていないか + 機械的完全性（inventory・整合・実装可能性）」を見る。手順はスキル定義に従う
- Proxyが`STATE_LOST`を返した場合は、偽って受理・fresh再構築・黙って省略せず、保存stateと残課題を提示する。取得可能な事実で閉じない価値差分だけをdecision card（予測 + 反対理由付き）として人間へ残す。累積token・wall timeは観測値であり、正常生成済みの裁定を無効化するgateにしない。token accounting欠損はtraceへ明示し、state integrity failureと混同しない
- Codex built-in Plan Mode が file write を制限していても、`docs/plans/...` の作成・更新と review 実行は plan-finalization に含まれる必須作業として扱う
- 実装者自身がruntime evidenceからcompleted Direction Briefのconcept / owner / lifecycle / scope / value hierarchy / 採用方向 / 捨てた候補 / 明示的absenceを覆した場合は、軽量・標準・重量を問わず黙ってpatchを続けない。同一work-item裁定ログの明示event IDへ`node .agents/scripts/append-direction-correction.mjs <work-item-file> --event-id <event-id> --source author-runtime --families <comma-list> --effect <effect> --high-risk <true|false> --summary '<sanitized summary>'`でcorrectionを追記し、briefと正式planを更新してplan reviewからやり直す。test・inventory・rollback detail・wordingだけ、またはbriefを維持したcode bugはcorrectionにしない
- 後続の人間裁定がcompleted Direction Briefの同じ方向要素を覆した場合は、active skillに依存せず同helperを`--source human`で実行してからbrief/planを更新する。completed eventが無いSTATE_LOSTへ架空correctionを作らない

## 実装後の検証

実装が終わったら、コミット前に階層に応じて回す。対象判定はファイル数ではなく影響で判断する。

1. **impl 尋問（重量スライスのみ）** — `/interrogation`（impl checkpoint）。対象は**承認済みプラン（= brief の実装）との差分**と実行時にしか観測できないもの。direction/plan で裁定済みの問いは蒸し返さない。規範から裁定できるものは自動裁定、**意思決定が覆ったら brief とプランを更新して plan-review からやり直す**。価値判断はエスカレーション。全 Q&A を裁定ログ `docs/interrogation/adjudications/`（1 work item = 1 ファイル）に記録する（見出しに `tier:`、revise 裁定に `class: A|B|C`）
2. **実装レビュー（全階層）** — `/codex-impl-review`。**実装者が Claude でも Codex でも同じ**（独立性の源泉はランナーが起動する fresh セッション）。軽量・標準スライスでは 6 項目弁明（interrogation スキル参照）をプロンプトに同梱し、レビュアーが弁明と diff を突合する。重量スライスでは尋問の裁定記録を渡し、裁定済みの意思決定は新証拠なしに蒸し返させない。レビュアーは固定チェック（enforcement boundary・fail-closed 反例・複合キー・stale 文言・immutable 発行物 等、スキル定義参照）を毎回評価する。APPROVED 後にコミット・完了報告
   - Codex が実装した場合（`/codex-implement` 委譲）: 呼び出し側はレビュー前に型チェック・テスト・回帰ゲート・実 DB での migration + integration の結果を自分で確認し、受理した指摘は「何が・なぜ駄目か」のリストで `codex exec resume` により実装セッションへ戻す
   - Codex 起点の場合（委譲ではなく Codex 自身が実装セッション）: 上記の caller 検証責務（型チェック・テスト・回帰ゲート・実 DB での migration + integration）は実装セッション自身が負う。sandbox 実行で実 DB・実環境に届かないときは、green の sandbox 結果を代替にせず「実環境検証が未実施」と明示してユーザーまたは実環境に届くセッションへハンドオフする（sandbox green ≠ DB green）

レビューは機能スライス単位でまとめて回す。マイクロ変更ごとに実装→レビューを細切れに繰り返さない。

## コミット規律（意図とやったこと）

すべてのコミットは、subject（何をしたか・命令形 1 行）に加えて本文に次の 2 点をシンプルに書く:

- **意図**: なぜ・どの要求/目的から（要求 No.・プラン・ユーザー指示・修正対象の問題を 1 行で）
- **やったこと**: 概念レベルで何をどう変えたか（1〜2 行。ファイル列挙や diff の写しは書かない）

これは fresh context のエージェント（尋問者・レビュアー・夜間 tick）が `git log` だけで「過去に何をなぜやったか」を再構成するための、エピソード記憶の最小単位。typo 修正級でも意図の 1 行は省略しない。夜間 reconcile が前日 commit のこの規律を監査する。

## Decision Records

`docs/decisions/` には壊れやすい判断・ワークアラウンド・直感に反する実装だけを記録する（テンプレートは `docs/decisions/README.md`）。コードを変更する前に関連 DR を確認する。

<!-- END SHARED INSTRUCTIONS -->
