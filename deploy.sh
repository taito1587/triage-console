#!/usr/bin/env bash
# 本番デプロイ(ワンコマンド): フロントをビルド → zip化 → Azure App Service へ配信。
# 前提: az login 済み / .env に AOAI 設定済み。
# 環境変数で上書き可: RG / APP / LOC / SKU
set -euo pipefail
cd "$(dirname "$0")"

RG=${RG:-rg-mfg-triage}
APP=${APP:-mfg-triage-30074}
LOC=${LOC:-japaneast}
SKU=${SKU:-B1}

echo "==> Target: $APP ($RG / $LOC)"

# 1. フロントをビルド
echo "==> build frontend"
(cd frontend && npm install --no-audit --no-fund >/dev/null 2>&1 && npm run build)

# 2. App Service が無ければ作成
if ! az webapp show -g "$RG" -n "$APP" >/dev/null 2>&1; then
  echo "==> create App Service ($SKU)"
  az group create -n "$RG" -l "$LOC" -o none
  az webapp up --name "$APP" -g "$RG" --runtime "PYTHON:3.12" --sku "$SKU" --location "$LOC" -o none || true
fi

# 3. 起動コマンド + アプリ設定(AOAI)
echo "==> configure"
az webapp config set -g "$RG" -n "$APP" \
  --startup-file "python -m uvicorn backend.server:app --host 0.0.0.0 --port 8000" -o none
if [ -f .env ]; then
  set -a; source .env; set +a
  az webapp config appsettings set -g "$RG" -n "$APP" --settings \
    SCM_DO_BUILD_DURING_DEPLOYMENT=true WEBSITES_PORT=8000 \
    AZURE_OPENAI_ENDPOINT="$AZURE_OPENAI_ENDPOINT" \
    AZURE_OPENAI_API_KEY="$AZURE_OPENAI_API_KEY" \
    AZURE_OPENAI_DEPLOYMENT="${AZURE_OPENAI_DEPLOYMENT:-gpt-4o}" \
    AZURE_OPENAI_API_VERSION="${AZURE_OPENAI_API_VERSION:-2024-10-21}" \
    TEAMS_WEBHOOK_URL="${TEAMS_WEBHOOK_URL:-}" \
    TRIAGE_ENGINE="${TRIAGE_ENGINE:-local}" \
    FOUNDRY_PROJECT_ENDPOINT="${FOUNDRY_PROJECT_ENDPOINT:-}" \
    FOUNDRY_MODEL="${FOUNDRY_MODEL:-gpt-4o}" \
    COSMOS_ENDPOINT="${COSMOS_ENDPOINT:-}" \
    COSMOS_KEY="${COSMOS_KEY:-}" \
    COSMOS_DB="${COSMOS_DB:-mta}" \
    COSMOS_CONTAINER="${COSMOS_CONTAINER:-feedback}" -o none
fi

# 4. zip化 (node_modules/.venv/.git 除外) してデプロイ
echo "==> zip & deploy"
rm -f /tmp/mfg-deploy.zip
zip -rq /tmp/mfg-deploy.zip \
  backend \
  requirements.txt \
  data/corpus.json data/sample_events.json data/eval_set.json \
  frontend/dist \
  -x "backend/__pycache__/*"
az webapp deploy -g "$RG" -n "$APP" --src-path /tmp/mfg-deploy.zip --type zip
az webapp restart -g "$RG" -n "$APP" -o none

echo ""
echo "==> Deployed: https://$APP.azurewebsites.net"
