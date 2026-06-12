# 開発・デプロイ ガイド

## 構成

```
frontend/        React + TypeScript + Mantine (Vite)   … UI
backend/         FastAPI アプリ                          … /api/* + dist配信
  server.py        … エントリ (uvicorn backend.server:app)
  triage_core.py   … トリアージのコアロジック(AOAI呼び出し)
  foundry_engine.py… Azure AI Foundry connected agents
  incident.py      … 自律インシデント・ボード
  evaluation.py    … 品質評価 (Top1/Top3 / groundedness)
  routes_*.py      … APIルーター
data/corpus.json デモコーパス(設備/手順/トラブル/品質)
```

開発時は **Vite(:5173)** と **FastAPI(:8000)** を別プロセスで動かし、
Vite が `/api` を `:8000` にプロキシする。本番は **FastAPI が dist を配信**して1サービスに集約。

```
[開発] ブラウザ:5173 ──/api──▶ :8000 (FastAPI) ──▶ Azure OpenAI
[本番] ブラウザ ─▶ App Service :8000 (FastAPI が dist と /api を両方配信) ─▶ Azure OpenAI
```

## 初回セットアップ

```bash
cp .env.example .env     # AOAI の値を記入(未記入だとトリアージは動かない)
make setup               # venv + npm install
```

## ローカル開発（ホットリロード）

```bash
make dev
```

- フロント: http://localhost:5173 （**ここを開く**。保存で即反映）
- API: http://localhost:8000 （uvicorn --reload。Python保存で再起動）
- Ctrl+C で両方停止

> フロントだけ・APIだけ動かしたい場合:
> `cd frontend && npm run dev` / `python -m uvicorn backend.server:app --reload --port 8000`

## 本番ビルドをローカル確認

```bash
make build                                   # frontend/dist 生成
python -m uvicorn backend.server:app --port 8000     # http://localhost:8000 で本番同等
```

## デプロイ

```bash
make deploy
```

`deploy.sh` が「フロントビルド → AOAI設定反映 → zip化 → App Service へ配信 → 再起動」を一括実行。
完了後 `https://mfg-triage-30074.azurewebsites.net` に反映される（起動に1〜2分）。

- 別のアプリ名/リージョンにする: `APP=xxx LOC=eastus2 make deploy`
- ログ確認: `make logs`

## よくあるハマり

- **トリアージが503**: `.env` の AOAI 値が未設定 / 本番なら App Service のアプリ設定未反映 → `make deploy` で再反映。
- **本番でStreamlit起動に戻る**: 起動コマンドが古い。`deploy.sh` が uvicorn に設定し直す。
- **dist が反映されない**: `make build` を忘れている。`make deploy` は内部でビルドする。
