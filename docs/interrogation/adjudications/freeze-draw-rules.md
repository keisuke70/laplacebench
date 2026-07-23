# work item: freeze-draw-rules — tier: standard

Slice: laplace-8x8-v1 ベンチ対局の終局規則凍結(反復引き分けルール新設 +
正準 max_plies=100 の暫定確定 + 引き分け理由の区別集計)。
docs/benchmark-strategy-ja.md §4-3 の未決事項を解消する。

Requirement source: §4-3「最大手数・同一局面反復ルールを v1 実行前に必ず
凍結(現在は未決)、引き分け率を必ず別掲、アジュディケーションは入れない」+
ユーザー指示 2026-07-24「100手をとりあえずマックスくらいにしておけばいいかな?
…それ以外の部分はその理解で進めて」。

Tier defense: 対局終了規則という新しい通常挙動・契約の導入(標準)。
凍結エンジンコア(packages/engine/src/core)には触れず、マッチ層のみ。
金銭・権限・不可逆 migration なし(重量ではない)。doc-only でも
bounded corrective でもない(軽量ではない)。

## Direction dialogue (human-direction-proxy)

```json
{
  "direction_trace_v1": {
    "event": {
      "event_id": "8cb994fa-3c5d-495a-b10c-887edb980c6c",
      "work_item_id": "freeze-draw-rules",
      "session_key": "direction-freeze-draw-rules",
      "occurred_at": "2026-07-23T17:22:50.875Z",
      "phase": "direction",
      "method": "human_direction_proxy",
      "method_version": "skill:57065644ef2aaebacb2b3a90de7c880b29efcee9066aa29ce4aba8af99b72c25;runner-prompt:36ae571bb41025d0b95c7eabe2326d8d4cc552d35e4d060cf2991bd990e5ede2;schema:fbcf01d4a0fee3d9fecdf88782a9e9f04512c0505e1797843f4fcbe7dce0aa3f;providers:claude;model:claude-fable-5;retrieval:ce7971d6242529f40b6ae48c108d897201caae653b1657cea77522f6b121ae2d",
      "decision": "CHANGE",
      "dialogue_status": "completed",
      "tensions": [
        {
          "id": "T001",
          "families": [
            "concept",
            "time-scope"
          ],
          "question": "「凍結する」と言いつつ「本凍結前に見直す」条件を付けている。段階0.5パイロットは暫定cap扱いで、真の凍結はv1前なのか? パイロット後にcapを変えた場合、パイロット結果の有効性はどう扱うのか。",
          "context_refs": [
            "docs/benchmark-strategy-ja.md §4-3",
            "提案のtradeoff節(監視条件付き凍結)"
          ],
          "author_position": "REVISE",
          "outcome": "changed",
          "effect": "premise-corrected",
          "requested_evidence": null
        },
        {
          "id": "T002",
          "families": [
            "non-entity",
            "concept"
          ],
          "question": "反復判定キーの「各色損失数」は盤面から導出可能ではないか。導出可能なら凍結対象のキー定義を無駄に太らせる冗長要素になる。",
          "context_refs": [
            "提案2(反復判定キー定義)",
            "packages/engine の状態表現"
          ],
          "author_position": "REVISE",
          "outcome": "changed",
          "effect": "complexity-exposed",
          "requested_evidence": null
        }
      ],
      "duration_ms": 65960,
      "input_tokens": 34044,
      "cached_input_tokens": 0,
      "output_tokens": 4105,
      "tool_calls": 0,
      "accounting_records": [
        {
          "turn": 1,
          "provider": "claude",
          "mode": "per_turn",
          "prior_raw_total": null,
          "current_raw_total": {
            "input_tokens": 14832,
            "cached_input_tokens": 0,
            "output_tokens": 2168
          },
          "normalized_delta": {
            "input_tokens": 14832,
            "cached_input_tokens": 0,
            "output_tokens": 2168
          },
          "reason": null
        },
        {
          "turn": 2,
          "provider": "claude",
          "mode": "per_turn",
          "prior_raw_total": null,
          "current_raw_total": {
            "input_tokens": 19212,
            "cached_input_tokens": 0,
            "output_tokens": 1937
          },
          "normalized_delta": {
            "input_tokens": 19212,
            "cached_input_tokens": 0,
            "output_tokens": 1937
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
    "transcript_hash": "aa7cc15091992930f040f767c0ff4a2b5a45108f8aff89f7bfa33f87b9bbd9c8",
    "decision_context_hash": "0dfa02cac43fc3cd930688b7d6bf0fb7f90d5aee0379d0da3b6192e6977eeca3",
    "method_version": "skill:57065644ef2aaebacb2b3a90de7c880b29efcee9066aa29ce4aba8af99b72c25;runner-prompt:36ae571bb41025d0b95c7eabe2326d8d4cc552d35e4d060cf2991bd990e5ede2;schema:fbcf01d4a0fee3d9fecdf88782a9e9f04512c0505e1797843f4fcbe7dce0aa3f;providers:claude;model:claude-fable-5;retrieval:ce7971d6242529f40b6ae48c108d897201caae653b1657cea77522f6b121ae2d",
    "turns": 2
  }
}
```

## Plan review (codex-plan-review, session plan-freeze-draw-rules)

- Q(review/repetition-key-exhaustiveness): プラン§1が反復判定キーを5成分の
  手作業列挙で書いており、direction で確定した「全意味状態の正準直列化」に
  対する忠実性を欠くと指摘 → 弁明せず受理。`Record<keyof GameState,
  "include"|"exclude">` の型網羅マップ+未知キーで throw する実行時ガードに
  改訂(revise, class: B)。briefそのものは覆っていないため
  direction correction は不要。
- Q(review/termination-precedence): 反復判定と通常終局・horizon 判定の
  優先順が2ラウンドかけて確定 → 通常終局 > 反復 > horizon の順に改訂し、
  境界回帰テストと終局優先テストを追加(revise, class: B)。
- その他受理: metrics の draw_reasons/draw_rate 追加(winReasons は勝者
  のみ計上という事実の明示)、reason 消費者インベントリ完全化
  (cli.ts/README/community STANDINGS 再生成)、CLI デフォルトテスト。
- ラウンド 3・指摘計 7 件で APPROVED(confidence 0.99)

## Impl review (codex-impl-review, session impl-freeze-draw-rules)

- Q(review/precedence-not-pinned): 「終局優先テスト」が通常勝利の reason を
  確認するだけで、判定順を入れ替えても通る=不変条件が固定されていないと
  指摘 → 受理。実対局では「終局かつ3回目の反復」状態が構成不可能である
  ことを認めた上で、終了判定を純関数 `classifyTermination` に抽出し、
  全条件同時成立の組合せを単体テストでピン留め(revise, class: B)。
- Q(review/bin-entrypoint-break): テスト用に main() へ入れた
  `require.main === module` ガードが、`bin/laplacebench.js`(dist を
  require するだけ)経由の配布バイナリ実行を無効化していた → 受理。
  `runCli()` を export して bin から明示呼び出しに変更し、ビルド済み
  bin ラッパーを実行するスモークテストを追加(revise, class: A)。
- その他受理(機械的): resolveMaxPlies の文字列全体検証("1.5"/"100junk"
  拒否)、cap 記録の game_start/run.json 両系統テスト。
- ラウンド 3・指摘計 4 件で APPROVED(confidence 0.99)
