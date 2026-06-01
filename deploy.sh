#!/usr/bin/env bash
# Manufacturing Triage Agent — Azure App Service デプロイ
# 前提: az login 済み / .env に AOAI 設定済み
set -euo pipefail

# .env を読み込み(環境変数化)
set -a; source .env; set +a

RG=${RG:-rg-mfg-triage}
LOC=${LOC:-japaneast}
APP=${APP:-mfg-triage-$RANDOM}
SKU=${SKU:-B1}

echo "==> Resource group: $RG ($LOC) / App: $APP / SKU: $SKU"

az group create -n "$RG" -l "$LOC" -o none

# ソースからビルド&デプロイ(App Service Linux / Python)
az webapp up --name "$APP" -g "$RG" --runtime "PYTHON:3.12" --sku "$SKU" --location "$LOC" -o none

# Streamlit 起動コマンド (App Service は 8000 を期待)
az webapp config set -g "$RG" -n "$APP" \
  --startup-file "python -m streamlit run app.py --server.port 8000 --server.address 0.0.0.0 --server.enableCORS false --server.enableXsrfProtection false --browser.gatherUsageStats false" \
  -o none

# アプリ設定 (ビルド有効化 + ポート + AOAI)
az webapp config appsettings set -g "$RG" -n "$APP" --settings \
  SCM_DO_BUILD_DURING_DEPLOYMENT=true \
  WEBSITES_PORT=8000 \
  AZURE_OPENAI_ENDPOINT="$AZURE_OPENAI_ENDPOINT" \
  AZURE_OPENAI_API_KEY="$AZURE_OPENAI_API_KEY" \
  AZURE_OPENAI_DEPLOYMENT="$AZURE_OPENAI_DEPLOYMENT" \
  AZURE_OPENAI_API_VERSION="$AZURE_OPENAI_API_VERSION" \
  TEAMS_WEBHOOK_URL="${TEAMS_WEBHOOK_URL:-}" \
  -o none

az webapp restart -g "$RG" -n "$APP" -o none

echo ""
echo "==> Deployed. URL: https://$APP.azurewebsites.net"
echo "    (初回はコンテナ起動に1-2分かかることがあります)"
