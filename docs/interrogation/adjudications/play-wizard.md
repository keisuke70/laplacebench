# work item: play-wizard — tier: standard

Slice: 対話ウィザード `laplacebench play`(プロバイダ→モデル/effort→
認証チェック→実行→提出案内)+ 選択肢の単一正準カタログ catalog.ts
(MODEL_SHORTHAND 移設・usage 文字列生成の一元化)。

Requirement source: ユーザー指示 2026-07-25「対局の時にサポートしてるAIを
それぞれ選べて、公開されてるモデルとeffortを選べて、サブスクが最後に
聞かれる」「ターミナルでいい」「ベースラインのtakeshiは除いてrandom
greedyだけでいい」。参加ファネル(public-platform-strategy-ja.md)の
「回す」摩擦低減。

Tier defense: 新しい UX 契約+カタログという概念集約(標準)。
エンジン・マッチ規則・記録スキーマは無変更。金銭・権限・不可逆なし。

## Direction dialogue (human-direction-proxy)

```json
{
  "direction_trace_v1": {
    "event": {
      "event_id": "e5c3c7f3-98a1-4117-ac7e-5ec5938594e5",
      "work_item_id": "play-wizard",
      "session_key": "direction-play-wizard",
      "occurred_at": "2026-07-24T18:10:03.477Z",
      "phase": "direction",
      "method": "human_direction_proxy",
      "method_version": "skill:57065644ef2aaebacb2b3a90de7c880b29efcee9066aa29ce4aba8af99b72c25;runner-prompt:36ae571bb41025d0b95c7eabe2326d8d4cc552d35e4d060cf2991bd990e5ede2;schema:fbcf01d4a0fee3d9fecdf88782a9e9f04512c0505e1797843f4fcbe7dce0aa3f;providers:claude;model:claude-fable-5;retrieval:ce7971d6242529f40b6ae48c108d897201caae653b1657cea77522f6b121ae2d",
      "decision": "ACCEPT",
      "dialogue_status": "completed",
      "tensions": [
        {
          "id": "T001",
          "families": [
            "concept",
            "recurrence"
          ],
          "question": "ウィザードのプロバイダ/モデル/effort メニューは spec パーサ・resolver の正準カタログから導出されるか、それとも第二の静的リスト(ドリフトの二人目オーナー)になるか",
          "context_refs": [
            "proposal item 3",
            "proposal item 6",
            "effort継承事故の再発防止"
          ],
          "author_position": "REVISE",
          "outcome": "changed",
          "effect": "simplified",
          "requested_evidence": null
        },
        {
          "id": "T002",
          "families": [
            "process",
            "value-cost"
          ],
          "question": "目的が参加ファネル「回す→提出する」なのに、ウィザードは実行までで提出は手順案内止まり — 提出側の摩擦は意図的スコープ外か、案内で十分か",
          "context_refs": [
            "docs/public-platform-strategy-ja.md 参加ファネル",
            "proposal item 1 終了時案内"
          ],
          "author_position": "DEFEND",
          "outcome": "defended-and-clarified",
          "effect": "no-change",
          "requested_evidence": null
        }
      ],
      "duration_ms": 48389,
      "input_tokens": 40724,
      "cached_input_tokens": 0,
      "output_tokens": 2645,
      "tool_calls": 0,
      "accounting_records": [
        {
          "turn": 1,
          "provider": "claude",
          "mode": "per_turn",
          "prior_raw_total": null,
          "current_raw_total": {
            "input_tokens": 18651,
            "cached_input_tokens": 0,
            "output_tokens": 1654
          },
          "normalized_delta": {
            "input_tokens": 18651,
            "cached_input_tokens": 0,
            "output_tokens": 1654
          },
          "reason": null
        },
        {
          "turn": 2,
          "provider": "claude",
          "mode": "per_turn",
          "prior_raw_total": null,
          "current_raw_total": {
            "input_tokens": 22073,
            "cached_input_tokens": 0,
            "output_tokens": 991
          },
          "normalized_delta": {
            "input_tokens": 22073,
            "cached_input_tokens": 0,
            "output_tokens": 991
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
    "transcript_hash": "32953c829bd3a3f434006700191f086e01c8621e7f24c75853f7b45739234b67",
    "decision_context_hash": "323bb8b453204902bac4e02101e3eec4ce7efe0d5b071fa1b191b9b948355c07",
    "method_version": "skill:57065644ef2aaebacb2b3a90de7c880b29efcee9066aa29ce4aba8af99b72c25;runner-prompt:36ae571bb41025d0b95c7eabe2326d8d4cc552d35e4d060cf2991bd990e5ede2;schema:fbcf01d4a0fee3d9fecdf88782a9e9f04512c0505e1797843f4fcbe7dce0aa3f;providers:claude;model:claude-fable-5;retrieval:ce7971d6242529f40b6ae48c108d897201caae653b1657cea77522f6b121ae2d",
    "turns": 2
  }
}
```

## Plan review (codex-plan-review, session plan-play-wizard)

- Q(review/readme-second-owner): README の静的 Agent specs 列挙が
  カタログの独立オーナーとして残る矛盾 → 受理、README は非列挙ポインタに
  置換し community/README は使用例と分類(revise, class: B)。
- Q(review/runid-plumbing): 提出案内が run-id を取得できない設計穴+
  命名プレースホルダ不一致 → 受理、runPlay が --run-id を所有
  (revise, class: B)。
- Q(review/abort-undefined): 中止パスの型・挙動未定義 → 受理、
  WizardResult 判別 union+arena 不呼び出し+exit 1 をテスト固定
  (revise, class: B)。
- その他受理: usage ヘルプ統合テスト(bin 経由)、シグネチャ一貫性。
- ラウンド 3・指摘計 5 件で APPROVED(confidence 0.99)

## Impl review (codex-impl-review, session impl-play-wizard)

- Q(review/numeric-input-validation): parseInt||fallback が seed=0 を黙って
  乱数に置換し、"2abc"/-1 の games を arena に流し得た → 受理、
  promptInteger(全文一致+safe integer+述語、再プロンプト)に置換し
  回帰テストで固定(revise, class: B)。
- ラウンド 2・指摘計 1 件で APPROVED(confidence 0.99)
