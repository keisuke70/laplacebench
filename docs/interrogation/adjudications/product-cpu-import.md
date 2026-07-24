# work item: product-cpu-import — tier: standard

Slice: 本体 cpu-v4(可視5段階ラダー、本番rollout済み d316b30)の LaplaceBench
輸入。product-cpu:cpu-v4:level_1..5 ベースライン(ローカルPythonブリッジ
transport)+ per-move regret オフライン解析(オラクル = level_5 root scoring)。
docs/product-cpu-adapter-v1-spec.md が予約していた follow-on の実行。

Requirement source: ユーザー指示 2026-07-24「main側でcpuに大幅な改善が
あったからそれを取り込んで残りの作業して。lvを1-5に再編成しそれぞれ
より強く大幅に速度が速くなってる」+ 前日のユーザー発言「per move regretは
明日やるね多分明日にはcpu側が改善されててそれをこのベンチの方に持ってきて
使えるから」。

Tier defense: 新しいagent transport契約・新metricの導入(標準)。
凍結エンジンコア無変更(game-shared/src/core は ff57443→d316b30 でdiffゼロ
を確認済み)。本体リポジトリへの変更なし(固定スナップショットcloneを参照)。
金銭・権限・不可逆操作なし(重量ではない)。

## Direction dialogue (human-direction-proxy)

```json
{
  "direction_trace_v1": {
    "event": {
      "event_id": "58f6316c-f271-4cad-9c2b-95426d49014b",
      "work_item_id": "product-cpu-import",
      "session_key": "direction-product-cpu-import",
      "occurred_at": "2026-07-24T04:50:54.431Z",
      "phase": "direction",
      "method": "human_direction_proxy",
      "method_version": "skill:57065644ef2aaebacb2b3a90de7c880b29efcee9066aa29ce4aba8af99b72c25;runner-prompt:36ae571bb41025d0b95c7eabe2326d8d4cc552d35e4d060cf2991bd990e5ede2;schema:fbcf01d4a0fee3d9fecdf88782a9e9f04512c0505e1797843f4fcbe7dce0aa3f;providers:claude;model:claude-fable-5;retrieval:ce7971d6242529f40b6ae48c108d897201caae653b1657cea77522f6b121ae2d",
      "decision": "CHANGE",
      "dialogue_status": "completed",
      "tensions": [
        {
          "id": "T001",
          "families": [
            "external-reality",
            "process"
          ],
          "question": "固定スナップショット運用を掲げながら、実行環境だけ別エージェントが使用中の可変な ../laplace-main/ai/venv に依存するのはドリフト制御方針と矛盾しないか。スナップショット clone 側に自前 venv を lock から作るコストは安いのでは。",
          "context_refs": [
            "提案4: 本体参照 — venvは../laplace-main/ai/venvを読み取り専用で再利用",
            "tradeoff: 固定スナップショット運用でドリフトを制御"
          ],
          "author_position": "REVISE",
          "outcome": "changed",
          "effect": "simplified",
          "requested_evidence": null
        }
      ],
      "duration_ms": 49099,
      "input_tokens": 39734,
      "cached_input_tokens": 0,
      "output_tokens": 3277,
      "tool_calls": 0,
      "accounting_records": [
        {
          "turn": 1,
          "provider": "claude",
          "mode": "per_turn",
          "prior_raw_total": null,
          "current_raw_total": {
            "input_tokens": 18027,
            "cached_input_tokens": 0,
            "output_tokens": 2154
          },
          "normalized_delta": {
            "input_tokens": 18027,
            "cached_input_tokens": 0,
            "output_tokens": 2154
          },
          "reason": null
        },
        {
          "turn": 2,
          "provider": "claude",
          "mode": "per_turn",
          "prior_raw_total": null,
          "current_raw_total": {
            "input_tokens": 21707,
            "cached_input_tokens": 0,
            "output_tokens": 1123
          },
          "normalized_delta": {
            "input_tokens": 21707,
            "cached_input_tokens": 0,
            "output_tokens": 1123
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
    "transcript_hash": "8e292ed882b78c05fda96177e22f12f36ab266ae410efcdf85e9fa7d28790e62",
    "decision_context_hash": "aa370206765333d6b171440f255bac5c0c3a99f41fce8cef910dd8d6246c1052",
    "method_version": "skill:57065644ef2aaebacb2b3a90de7c880b29efcee9066aa29ce4aba8af99b72c25;runner-prompt:36ae571bb41025d0b95c7eabe2326d8d4cc552d35e4d060cf2991bd990e5ede2;schema:fbcf01d4a0fee3d9fecdf88782a9e9f04512c0505e1797843f4fcbe7dce0aa3f;providers:claude;model:claude-fable-5;retrieval:ce7971d6242529f40b6ae48c108d897201caae653b1657cea77522f6b121ae2d",
    "turns": 2
  }
}
```

## Plan review (codex-plan-review, session plan-product-cpu-import)

- Q(review/handshake-lifecycle): 同期 makeAgent と hello 依存の name/provenance
  の矛盾、複数対局での per-game seed/swap との整合を指摘 → 受理。
  metadata-only preflight(run.json 前・即 dispose)+ per-game fresh handshake
  の二段ライフサイクルに改訂(revise, class: B)。
- Q(review/commit-pin-fail-closed): brief は fail-closed を約束しながら
  実装は commit を記録するだけだった → 受理。--product-commit /
  LAPLACE_PRODUCT_COMMIT の pin を必須化し、不一致・dirty tree を reject
  (revise, class: B)。
- Q(review/regret-ordering-semantics): value(rank1)−value(chosen) はオラクルの
  辞書式選好(selectionClass 優先)と矛盾し負値・誤誘導になり得る → 受理。
  同一 class 内のみのスカラー + categorical blunder の2系統に再定義し、
  brief §5(f) も書き換え(revise, class: B)。
- その他受理: ブリッジクライアントの fail-closed ライフサイクル明細+
  fake-bridge テスト(repo 非依存で CI 常時実行)、regret コマンドの
  try/finally 所有権、per-move seed の events.jsonl 記録、hello/move
  スキーマの整合(product_dirty / seed_used)、コロン入り name の検証済み
  非問題化。
- ラウンド 4・指摘計 9 件で APPROVED(confidence 0.98)

## Impl review (codex-impl-review, session impl-product-cpu-import)

- Q(review/bridge-not-packaged): package.json の files allowlist に bridge/ が
  無く、公開パッケージでは product-cpu も regret も起動不能だった → 受理。
  files に追加し、同梱をテストで固定(revise, class: A)。
- Q(review/regret-accepts-truncated-games): regret が game_end を要求せず、
  中断対局に黙って regret.json を出せた(finished-run 契約違反)→ 受理。
  game_end 必須化+リプレイ完全性検証(winner・損失数)を exportweb.ts に
  倣って追加、truncated 回帰テスト付き(revise, class: B)。
- その他受理(機械的): perMoveSeed を契約通り mod 2^31 に修正+境界
  テスト、stderr を契約通り即 fail-closed(全 pending reject)に統一+
  fake-bridge stderr モードのテスト。
- ラウンド 2・指摘計 4 件で APPROVED(confidence 0.99)

## Follow-on light slice: stage05-smoke-docs(tier: light)

d2-vs-d3再測(cap 100)クローズ追記 + 段階0.5スモークラン記録
(docs/pilot-stage05-smoke.md)。doc-only、コード無変更、回帰ゲートgreen。
- Q(review/overclaim-guard): n=2から§7失敗モード不発生を主張(pilot doc)、
  1シードからcap仮説を一般棄却(v1追記)の2件の過大表現 → 受理、
  支持される範囲に限定する文言へ修正(revise, class: C)。
- ラウンド 2・指摘計 2 件で APPROVED(confidence 0.99)
