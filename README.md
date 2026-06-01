# 🏭 Manufacturing Triage Agent

> Zenn × Microsoft Agent Hackathon 2026 提出作品

製造現場で異常やトラブルが発生したとき、AI エージェントが
**過去トラブル・作業手順・設備仕様・品質記録**を横断して、
**緊急度 / 原因候補Top3 / 最初に確認すべき項目 / 次に誰へ渡すべきか**を
1 画面で返す、現場判断支援エージェント。

## 何が嬉しいか

単なる検索ではなく「**まず何をするか**」を即提示し、High 判定時には
**保全へ Teams 通知（エスカレーション）をエージェントが自律実行**。
現場フィードバック（実原因・復旧時間）を登録すると次回の判断材料になり、
**使うほど賢くなる**。

## 使用技術（Microsoft / Azure）

- **Azure OpenAI (GPT-4o)** — トリアージ推論 + 画像解析(vision)
- **Azure App Service** — Streamlit アプリのホスティング
- RAG: 小規模コーパスをプロンプトに同梱（手順書/過去トラブル/設備仕様/品質記録）
- (加点) Teams Incoming Webhook によるエスカレーション実行

> 設計上は Azure AI Foundry Agent Service の connected agents（Intake / Retrieval /
> Triage / Learning）+ Azure AI Search を想定。MVP ではコアのトリアージを単一アプリに集約。
> 構想アーキテクチャは [`Docs/Architecture/`](./Docs/Architecture/) を参照。

## 画面

1. 異常入力フォーム（脱チャット / 画像添付可）
2. トリアージ結果カード（緊急度・初動・原因Top3・推奨アクション・類似事例・根拠）
3. フィードバック登録（使うほど賢くなる）
4. ナレッジ集計（原因ランキング・設備別・復旧時間・ROI 試算）

## ローカル実行

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # AOAI の値を記入
streamlit run app.py
```

## Azure へデプロイ

```bash
az login
cp .env.example .env   # AOAI の値を記入
bash deploy.sh         # App Service を作成しデプロイ → URL が出力される
```

## アーキテクチャ / 設計ドキュメント

[`Docs/Architecture/`](./Docs/Architecture/) に方針・構成図(mermaid)・エージェント設計・
コスト設計・入賞戦略をまとめている。
