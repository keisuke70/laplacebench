# work item: token-budget — tier: standard

Slice: 思考予算のトークン建て化。laplace-8x8-v1 マッチ実施規則への
出力トークン封筒の正準化(250k/チーム/局・暫定確定)、壁時計の
バックストップ降格(LLM対局デフォルト1200秒)、予算のプロンプト開示
(プロンプト世代 p2)。

Requirement source: ユーザー指示 2026-07-24「思考予算のトークン建て化を
やろうか」+ 遅延調査結果。戦略 §4-7 の実装。パイロットv1発見2
(opusの時計律速)が実測根拠。

Tier defense: マッチ資源契約とプロンプト(測定入力)の変更(標準)。
エンジンコア無変更。金銭・権限・不可逆なし(重量ではない)。

## Direction dialogue (human-direction-proxy)

```json
{
  "direction_trace_v1": {
    "event": {
      "event_id": "52f6c144-5d7b-4da0-806a-e9c76b160f31",
      "work_item_id": "token-budget",
      "session_key": "direction-token-budget",
      "occurred_at": "2026-07-24T13:34:11.510Z",
      "phase": "direction",
      "method": "human_direction_proxy",
      "method_version": "skill:57065644ef2aaebacb2b3a90de7c880b29efcee9066aa29ce4aba8af99b72c25;runner-prompt:36ae571bb41025d0b95c7eabe2326d8d4cc552d35e4d060cf2991bd990e5ede2;schema:fbcf01d4a0fee3d9fecdf88782a9e9f04512c0505e1797843f4fcbe7dce0aa3f;providers:claude;model:claude-fable-5;retrieval:ce7971d6242529f40b6ae48c108d897201caae653b1657cea77522f6b121ae2d",
      "decision": "ACCEPT",
      "dialogue_status": "completed",
      "tensions": [
        {
          "id": "T001",
          "families": [
            "value-cost",
            "concept"
          ],
          "question": "予算開示(提案3)は、実際の歪みの原因(壁時計300秒)ではなく、拘束しない250k封筒に対する自己配分を根拠にしている。開示はプロンプト世代を切る恒久コストを払うのに、その効果は今回の検証(opus再走)では分離測定されない。開示は予算が絞りとして機能する将来トラックへ先送りし、今回は封筒正準化+timeout降格のみ凍結すべきではないか。",
          "context_refs": [
            "docs/pilot-stage05-v1.md 発見2",
            "docs/benchmark-strategy-ja.md §4-7"
          ],
          "author_position": "DEFEND",
          "outcome": "defended-and-clarified",
          "effect": "premise-corrected",
          "requested_evidence": null
        }
      ],
      "duration_ms": 79635,
      "input_tokens": 41227,
      "cached_input_tokens": 0,
      "output_tokens": 5004,
      "tool_calls": 0,
      "accounting_records": [
        {
          "turn": 1,
          "provider": "claude",
          "mode": "per_turn",
          "prior_raw_total": null,
          "current_raw_total": {
            "input_tokens": 18510,
            "cached_input_tokens": 0,
            "output_tokens": 2478
          },
          "normalized_delta": {
            "input_tokens": 18510,
            "cached_input_tokens": 0,
            "output_tokens": 2478
          },
          "reason": null
        },
        {
          "turn": 2,
          "provider": "claude",
          "mode": "per_turn",
          "prior_raw_total": null,
          "current_raw_total": {
            "input_tokens": 22717,
            "cached_input_tokens": 0,
            "output_tokens": 2526
          },
          "normalized_delta": {
            "input_tokens": 22717,
            "cached_input_tokens": 0,
            "output_tokens": 2526
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
    "transcript_hash": "5ea9c4600ac3cc1364c968c8bdd459ca399f177268bc9d94c13fbb94021e044c",
    "decision_context_hash": "4e4b2817eb7a178ed199b832c4054cdbdacd9662bac9f07d07e165e187438fe0",
    "method_version": "skill:57065644ef2aaebacb2b3a90de7c880b29efcee9066aa29ce4aba8af99b72c25;runner-prompt:36ae571bb41025d0b95c7eabe2326d8d4cc552d35e4d060cf2991bd990e5ede2;schema:fbcf01d4a0fee3d9fecdf88782a9e9f04512c0505e1797843f4fcbe7dce0aa3f;providers:claude;model:claude-fable-5;retrieval:ce7971d6242529f40b6ae48c108d897201caae653b1657cea77522f6b121ae2d",
    "turns": 2
  }
}
```

## Plan review (codex-plan-review, session plan-token-budget)

- Q(review/disclosure-path-inventory): 開示経路の設計が実装不能(llm.tsは
  startGameでシステム文構築、観測構築は3アダプタが個別にengine.observation
  直呼び)→ 受理。prompt.observationFromInput への一本化+llm.tsの構築
  遅延に改訂(revise, class: B)。
- Q(review/250k-reconfirmation-not-operationalized): brief§3(b)の再確認
  条件が検証設計に落ちていない → 受理。測定値・判定閾値・accept/change
  結論の記録先を明文化(revise, class: B)。
- その他受理: stale契約インベントリ(usage文字列・runnerフォールバック
  維持・usage-semantics.md・claude-cli-learn分類)、予算0境界のreject。
- ラウンド 2・指摘計 4 件で APPROVED(confidence 0.97)

## Impl review (codex-impl-review, session impl-token-budget)

- ラウンド1: コード側は妥当と確認。唯一のブロッカーは plan §5 の
  検証ラン成果物(opus 再走の測定値と 250k accept/change 判定)の未記録
  → 検証ラン完走後に転記して解消。ホストスリープで中断された当初の
  game-001 は隔離して開示、逆向きは別シードで再走(revise, class: C)。
- 検証結果(機構的事実): TO 9→0(両局ゼロ)、budget-pass 0(両局)→
  事前登録の判定規則により 250k 再確認(accept)。消費 99.8%/87.6% =
  封筒は opus 級の実効的拘束スケールに正確に位置する。
- ラウンド 2・指摘計 1 件で APPROVED(confidence 0.99)
