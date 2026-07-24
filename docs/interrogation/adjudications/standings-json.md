# work item: standings-json — tier: standard

Slice: community standings の機械可読 JSON 化(単一計算 standingsData +
Markdown 派生化)、`--json-out`、PR 側再生成 + CI 整合ゲート
(fail-closed)、消費契約の文書化。laplace.zone/bench 自動反映の前半
(後半 = laplace-main 側の表示は別スライス)。

Requirement source: ユーザー指示 2026-07-25「そこに追加して…自由に修整して
終わったらdev そしてmainにも反映していいから進めて」+ 先行合意
(community台帳→公開ページ反映の欠けた後半区間を繋ぐ)。

Tier defense: 新しい公開データ契約(standings JSON スキーマ)と CI ゲート
の導入(標準)。エンジン・マッチ規則無変更。金銭・権限・不可逆なし
(bot write 権限は direction で不採用に)。

## Direction dialogue (human-direction-proxy)

```json
{
  "direction_trace_v1": {
    "event": {
      "event_id": "dc2e9dde-49b1-4004-af3f-0993177443cf",
      "work_item_id": "standings-json",
      "session_key": "direction-standings-json",
      "occurred_at": "2026-07-24T18:42:59.251Z",
      "phase": "direction",
      "method": "human_direction_proxy",
      "method_version": "skill:57065644ef2aaebacb2b3a90de7c880b29efcee9066aa29ce4aba8af99b72c25;runner-prompt:36ae571bb41025d0b95c7eabe2326d8d4cc552d35e4d060cf2991bd990e5ede2;schema:fbcf01d4a0fee3d9fecdf88782a9e9f04512c0505e1797843f4fcbe7dce0aa3f;providers:claude;model:claude-fable-5;retrieval:ce7971d6242529f40b6ae48c108d897201caae653b1657cea77522f6b121ae2d",
      "decision": "CHANGE",
      "dialogue_status": "completed",
      "tensions": [
        {
          "id": "T001",
          "families": [
            "value-cost",
            "non-entity",
            "process"
          ],
          "question": "bot コミット(contents: write + skip-ci 機構)は、PR 側再生成+CI 整合検証ゲート、または Pages 公開(派生物を git に置かない)と比べて本当に見合うか。選定理由は参加者の摩擦低減か、履歴 diff 可視性か。",
          "context_refs": [
            "提案3 CI 自動再生成",
            "docs/plans/2026-07-25-play-wizard.md (参加ファネル摩擦低減の優先順位)"
          ],
          "author_position": "REVISE",
          "outcome": "changed",
          "effect": "simplified",
          "requested_evidence": null
        }
      ],
      "duration_ms": 48654,
      "input_tokens": 38722,
      "cached_input_tokens": 3107,
      "output_tokens": 2895,
      "tool_calls": 0,
      "accounting_records": [
        {
          "turn": 1,
          "provider": "claude",
          "mode": "per_turn",
          "prior_raw_total": null,
          "current_raw_total": {
            "input_tokens": 17652,
            "cached_input_tokens": 1434,
            "output_tokens": 2136
          },
          "normalized_delta": {
            "input_tokens": 17652,
            "cached_input_tokens": 1434,
            "output_tokens": 2136
          },
          "reason": null
        },
        {
          "turn": 2,
          "provider": "claude",
          "mode": "per_turn",
          "prior_raw_total": null,
          "current_raw_total": {
            "input_tokens": 21070,
            "cached_input_tokens": 1673,
            "output_tokens": 759
          },
          "normalized_delta": {
            "input_tokens": 21070,
            "cached_input_tokens": 1673,
            "output_tokens": 759
          },
          "reason": null
        }
      ],
      "active_provider": "claude",
      "providers_used": [
        "claude"
      ],
      "fallback_count": 0
    },
    "transcript_hash": "2a65b1178e45a8e3bff04aead546d34dc58885e6d9879a76c8b4aa8c1723714b",
    "decision_context_hash": "ffdab5653e2d0d94d368edb3e89a410c1aa5aeaea3cdbfe2b878d6e427bd1e30",
    "method_version": "skill:57065644ef2aaebacb2b3a90de7c880b29efcee9066aa29ce4aba8af99b72c25;runner-prompt:36ae571bb41025d0b95c7eabe2326d8d4cc552d35e4d060cf2991bd990e5ede2;schema:fbcf01d4a0fee3d9fecdf88782a9e9f04512c0505e1797843f4fcbe7dce0aa3f;providers:claude;model:claude-fable-5;retrieval:ce7971d6242529f40b6ae48c108d897201caae653b1657cea77522f6b121ae2d",
    "turns": 2
  }
}
```

## Plan review (codex-plan-review, session plan-standings-json)

- Q(review/gate-evasion-boundary): paths フィルタが generator/CLI 変更 PR を
  ゲート外に置く fail-open 穴+preview ステップとの重複未決 → 受理、
  フィルタ撤廃+単一整合ステップへ置換(revise, class: B)。
- Q(review/canonical-command): 「再生成2コマンド」が摩擦ゼロ論拠と矛盾+
  位置引数抽出の潜在バグ+欠落エッジ未定義 → 受理、正準1コマンドに統一・
  パース修正・ゼロrun/JSON単独/欠落ゲートを仕様化(revise, class: B)。
- Q(review/byte-contract): 序数比較・丸め規則・プロパティ順・末尾改行の
  未固定 → 受理、golden バイト検証で固定(revise, class: B)。
- Q(review/delivery-mapping): dev→main 要求の位置づけ不在 → 受理、
  bench=main単独+raw URL実確認、dev→mainはPhase B(laplace-main)と明記。
- ラウンド 2・指摘計 4 件で APPROVED(confidence 0.99)

## Impl review (codex-impl-review, session impl-standings-json)

- Q(review/tiebreak-not-exercised): golden fixture が実際には勝率で順序決定
  され三次比較(序数)を検証していなかった → 受理、wins/勝率完全タイの
  B-agent/a-agent(序数と locale で順序が逆転する名前)で固定
  (revise, class: B)。
- Q(review/canonical-command-drift): 定数に npx が無く表面ごとに揺れ →
  受理、定数に統一し README/CI の逐語一致をテスト化。再生成漏れの
  成果物ドリフトも指摘され再生成(revise, class: C)。
- ラウンド 3・指摘計 3 件で APPROVED(confidence 0.99)
