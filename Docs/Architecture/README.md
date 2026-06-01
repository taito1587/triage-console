# Manufacturing Triage Agent — アーキテクチャ方針

> Zenn × Microsoft Agent Hackathon 2026 提出作品。
> **Azure 上で実際に動くもの**を 3 日で作り、3 週間のデモ期間中 **$98 以内**で運用する。

## このディレクトリの構成

| ファイル | 内容 |
|---------|------|
| [01-product-and-scope.md](./01-product-and-scope.md) | プロダクト定義 / 提供価値 / 作る・作らないの線引き / 主シナリオ / 画面構成 |
| [02-azure-architecture.md](./02-azure-architecture.md) | Azure サービス構成 / システム構成図 / 技術選定の理由 |
| [03-agent-design.md](./03-agent-design.md) | Foundry Agent Service による 4 エージェント設計 / connected agents / トレース |
| [04-data-model.md](./04-data-model.md) | RAG 対象データ（AI生成）の設計とスキーマ |
| [05-cost-and-plan.md](./05-cost-and-plan.md) | コスト設計（$98/3週間）/ 3日間の実装計画 |
| [06-scoring-strategy.md](./06-scoring-strategy.md) | **入賞戦略**：審査軸への当たり / 採用した加点要素(A:アクション実行, B:画像解析, C:ROI) |

## 一言定義

製造現場で異常やトラブルが発生したとき、AI が **過去トラブル・作業手順・設備仕様・品質記録**を横断して、
**緊急度 / 原因候補Top3 / 最初に確認すべき項目 / 次に誰へ渡すべきか**を返す、現場判断支援エージェント。

## 確定した技術スタック（2026-06-01 ロック）

| 層 | 採用技術 | 固定費 |
|----|---------|-------|
| エージェント基盤 | **Azure AI Foundry Agent Service**（connected agents） | $0（サービス自体は無料） |
| LLM | Azure OpenAI（承認済み） | トークン従量のみ |
| RAG 検索 | Azure AI Search **Free tier**（hybrid: keyword + vector + RRF） | $0 |
| バックエンド | **Python + FastAPI** on Azure Container Apps（min replica = 0） | ほぼ $0 |
| フロントエンド | **TypeScript + React** on Azure Static Web Apps（Free） | $0 |
| データ保存（事例 / FB） | Azure Cosmos DB（無料枠） | $0 |
| デモデータ | AI 生成（手順書 / 過去トラブル / 設備仕様 / 品質記録） | — |

**唯一の変動費 = Azure OpenAI のトークン**。詳細は [05-cost-and-plan.md](./05-cost-and-plan.md)。

## 入賞狙いの加点強化（2026-06-01 決定）

テーマ「業務の課題を AI エージェントで**鮮やかに解決**」に応えるため、コアMVPに加え以下を採用：

- **A. アクション実行** — High 判定時に保全へ **Teams 通知**を Agent が自律実行（"助言"→"解決"）
- **B. マルチモーダル** — 故障部位の **写真を GPT-4o vision で解析**しトリアージに反映
- **C. 業務改革・ROI** — **ダウンタイム削減を定量化**し画面・記事で提示

戦略の全体像は [06-scoring-strategy.md](./06-scoring-strategy.md)。
