# 🏭 Manufacturing Triage Agent

> Zenn × Microsoft Agent Hackathon 2026 応募作品

製造現場の異常入力に対し、AIエージェントが**過去トラブル・手順書・設備仕様・品質記録**を横断して、
**緊急度 / 原因候補Top3 / 初動確認 / 次アクション（誰へ）** を1画面で返す現場判断支援エージェント。
High判定時は**保全へTeams通知を自律実行**、現場フィードバックで**使うほど賢くなる**。

🔗 **デモ**: https://mfg-triage-30074.azurewebsites.net

## 技術スタック

- **Azure OpenAI (GPT-4o)** — トリアージ推論 + 画像解析(vision)
- **FastAPI**（`server.py`）— `/api/*` とフロントを単一 App Service で配信
- **React + TypeScript + Mantine + Tabler Icons**（`frontend/`）
- **Azure App Service** — ホスティング（HTTPS自動）
- RAG: 小規模コーパス（`data/corpus.json`）をプロンプト同梱

## クイックスタート

```bash
cp .env.example .env     # Azure OpenAI の値を記入
make setup               # venv + npm install

make dev                 # ローカル開発 → http://localhost:5173
make deploy              # Azure へデプロイ（ビルド〜配信を一括）
make logs                # 本番ログ
```

> `./dev.sh` / `./deploy.sh` を直接叩いてもOK。詳細・構成図・ハマり所は [DEV.md](./DEV.md)。

## 構成

```
frontend/        React + Mantine (Vite)        … UI
server.py        FastAPI                       … /api/* + dist配信
triage_core.py   トリアージのコアロジック         … AOAI呼び出し（server/app共有）
data/corpus.json デモコーパス
app.py           Streamlit版(予備)
Docs/Architecture/  設計方針・構成図・入賞戦略
```

## ドキュメント

- [DEV.md](./DEV.md) — 開発・デプロイ手順
- [Docs/Architecture/](./Docs/Architecture/) — 設計方針・アーキ図・エージェント設計・コスト・入賞戦略
