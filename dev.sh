#!/usr/bin/env bash
# ローカル開発: FastAPI(:8000, reload) と Vite(:5173, /api を :8000 にプロキシ) を同時起動。
# ブラウザで http://localhost:5173 を開く。Ctrl+C で両方停止。
set -euo pipefail
cd "$(dirname "$0")"

# --- backend 準備 ---
if [ ! -d .venv ]; then python3 -m venv .venv; fi
# shellcheck disable=SC1091
source .venv/bin/activate
pip install -q -r requirements.txt

if [ ! -f .env ]; then
  echo "⚠️  .env がありません。cp .env.example .env して AOAI を設定してください。" >&2
fi

# --- frontend 準備 ---
if [ ! -d frontend/node_modules ]; then (cd frontend && npm install); fi

# --- 起動 ---
echo "▶ FastAPI  : http://localhost:8000  (API)"
echo "▶ Frontend : http://localhost:5173  (ここを開く)"
python -m uvicorn server:app --reload --port 8000 &
API_PID=$!
trap 'kill $API_PID 2>/dev/null || true' EXIT INT TERM
cd frontend && npm run dev
