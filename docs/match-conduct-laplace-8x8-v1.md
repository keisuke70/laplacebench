# Match conduct — laplace-8x8-v1 bench matches

2026-07-24 確定(plan: `docs/plans/2026-07-24-freeze-draw-rules.md`、
direction trace: `docs/interrogation/adjudications/freeze-draw-rules.md`)。
`docs/benchmark-strategy-ja.md` §4-3 の未決事項
「最大手数・同一局面反復ルールの凍結」への回答。対局の**ゲーム内ルール**は
凍結エンジン(`packages/engine/src/core`、本体とバイト一致)が正本、
本書は**対局の実施規則**(マッチ層 = `packages/cli`)の正本。

## 凍結事項(構造 — 以後の変更は新ルールセット扱い)

1. **同一局面反復ルール**: ゲーム進行に関与する全意味状態が3回出現した
   時点で引き分け(`repetition_draw`)。反復判定キーは成分列挙ではなく
   **GameState 全フィールドの網羅分類**による正準直列化
   (`packages/cli/src/engine.ts` の `REPETITION_KEY_FIELDS`)。
   - include: board(Void 含む)・boardSize・capturedPieces・
     eliminatedPlayers・startingPiecesCount・eliminationThreshold・
     currentPlayer・consecutiveTimeouts
   - exclude(時刻・表示・終端メタデータのみ): turnStartedAt・
     turnTimeLimit・gameStartedAt・gameEndedAt・winningTeam・
     lastMoveBy・lastMoveAt・lastMove
   - 列挙を採らなかった理由: 反則没収脱落は駒を盤から消すが
     capturedPieces を増やさない(core `TurnManager`)ため損失数は盤面から
     導出できず、consecutiveTimeouts など盤面に現れない将来関連状態が
     他にもある。分類マップは型網羅(`Record<keyof GameState, ...>`)+
     実行時未知キー throw で将来漏れを機械的に防ぐ。
2. **終局優先順**: 通常終局(center / elimination) > repetition_draw >
   horizon_draw。反復判定は到達した全ての非終端状態(最終許容 ply 後の
   状態を含む)に適用する。
3. **引き分け率の別掲**: summary(`draw_reasons` / `draw_rate`)と
   standings(`D:horizon` / `D:repetition` 列)で horizon_draw と
   repetition_draw を必ず区別して報告する。
4. **アジュディケーション不採用**: 打ち切り時の優勢判定は入れない
   (§4-3 の既定を維持)。

## max_plies = 100(暫定確定 — 段階0.5パイロットを拘束する正準値)

- arena のデフォルト(`CANONICAL_MAX_PLIES`)。診断用途の明示
  オーバーライドは許すが、全 run が `max_plies` を記録する。
- 根拠実測(2026-07-24、seed 付き・再現可能): 互角対戦の自然終局は
  greedy 同士 25–75手(seed 2002)、takeshi:d1 同士 33手(seed 2003)、
  d2 の勝ち実績 59手(anchor-ladder seed 1005)。100 は全実測値を
  約30%マージンでカバーする(100手=各色25手番)。一方 random 同士は
  600手でも自然終局しない(seed 2001)= cap は稀な保険ではなく
  劣化対局の実質的終了装置であり、LLM 対局では費用レバーでもある。
- **見直し条件**: 段階0.5パイロットで LLM 対局の horizon_draw 率が
  高い場合、「100 は短すぎた」シグナルとして v1 本凍結前に見直す。
  v1 本実行前に値を本凍結する。cap が変わった場合、パイロット結果は
  「max_plies=100 と記録された結果」として保持するが v1 の結果としては
  引用しない。
- 過去の anchor-ladder-v1(cap 60/150/300)は遡及変更しない
  (ドキュメントに cap 明記済み)。d2-vs-d3 未解決事項の再測から
  正準 cap 100 を使う。
