# 05. コスト設計と実装計画

## コスト制約

**Azure 利用料の合計を、デモ期間 3 週間で $98 以内に収める。**

3日で作っても、デモ期間中はリソースが起動しっぱなしになる。**固定費**が最大の敵。

## コスト内訳（3週間概算）

| サービス | プラン | 3週間概算 | 方針 |
|---------|-------|----------|------|
| Azure AI Foundry Agent Service | — | **$0** | サービス自体は無料。トークン+ツールのみ課金 |
| Azure AI Search | **Free tier** | **$0** | ★Basic（~$51）は使わない |
| Azure Container Apps | scale-to-zero + 無料付与枠 | ~$0–3 | min replica=0 |
| Azure Static Web Apps | Free | $0 | |
| Cosmos DB | 無料枠 | $0 | 1000 RU/s + 25GB |
| Teams 通知（加点A） | Incoming Webhook | **$0** | 固定費なし |
| **Azure OpenAI** | トークン従量（+vision 加点B） | **~$5–20** | **唯一の変動費** |
| **合計** | | **おおむね $5–25** | 予算に大きく余裕 |

### コストを守るルール

1. **AI Search は Free tier 固定**（Basic にしない）。
2. **Container Apps は min replica = 0**（無負荷時は課金されない）。
3. AOAI のトークンが唯一の変動費 → デモ・テストの呼び出し回数を意識。プロンプトは簡潔に。
4. 使わないリソースはデモ後に削除（提出後の課金を止める）。

## 3日間の実装計画

### Day 1 — 基盤とデータ
- [x] リポジトリ初期化・ディレクトリ構成
- [x] アーキテクチャ方針ドキュメント作成（本ディレクトリ）
- [ ] AI 生成デモデータ作成（4種・主シナリオ整合）
- [ ] Azure リソース provision（AOAI 確認 / AI Search Free / Cosmos / Container Apps 環境）
- [ ] AI Search インデックス作成 + データ投入（埋め込み生成込み）
- [ ] AOAI / Search 疎通確認

### Day 2 — エージェントとコア機能（＋加点A・B を並行）
- [ ] Foundry Agent Service で 4 エージェント（connected agents）構成
- [ ] Triage 構造化出力スキーマの確定と実装
- [ ] **(加点A)** escalation tool（Teams Webhook）を Orchestrator が High 時に自律実行
- [ ] **(加点B)** Intake で画像を GPT-4o vision 解析 → 構造化に反映
- [ ] FastAPI バックエンド（/triage, /feedback, /knowledge）
- [ ] フロント画面1（異常入力フォーム + 画像）+ 画面2（トリアージ結果カード + エスカレーションボタン）
- [ ] 主シナリオが end-to-end で通ることを確認（画像 → トリアージ → Teams通知）

### Day 3 — 仕上げとデプロイ
- [ ] 画面3（根拠詳細 / citation ハイライト）
- [ ] 画面4（フィードバック登録）→ Learning Agent で反映
- [ ] 画面5（ナレッジ集計ビュー / 簡易集計 + **(加点C) ダウンタイム削減 ROI KPI**）
- [ ] Azure デプロイ（Container Apps + Static Web Apps）
- [ ] Foundry トレースを使ったデモ通し・リハーサル
- [ ] **(加点C)** Zenn 記事：課題→ROI→アーキ図→デモGIF→技術的工夫→学び
- [ ] 提出物（成果物URL / Zenn記事 / GitHub / デモ動画）整備
- [ ] （余裕分）D 自律ツール選択の明示 / F 賢くなる実測 / E Foundry評価 / G Responsible AI 記述

## 未確定事項（ユーザー確認待ち）

1. **AOAI 承認済みリージョン**（AI Search / Container Apps を同一リージョンに寄せるため）。想定：Japan East。
2. AI Search **Free tier 採用の最終 OK**（品質よりコスト安全を優先する方針）。

## デプロイ前提ツール

- `azd`（Azure Developer CLI）未インストール → `brew install azd` で導入予定。
- `func`（Functions Core Tools）は当面不要（Functions は使わない構成）。
