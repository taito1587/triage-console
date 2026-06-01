# Manufacturing Triage Agent — 開発/デプロイ ショートカット
# 使い方: make dev / make build / make deploy / make logs

RG  ?= rg-mfg-triage
APP ?= mfg-triage-30074

.PHONY: help setup dev build deploy logs clean

help:
	@echo "make setup   - 依存インストール(venv + npm)"
	@echo "make dev     - ローカル開発(API:8000 + フロント:5173)"
	@echo "make build   - フロントを本番ビルド"
	@echo "make deploy  - Azure App Service へデプロイ"
	@echo "make logs    - 本番ログをtail"

setup:
	python3 -m venv .venv
	. .venv/bin/activate && pip install -r requirements.txt
	cd frontend && npm install

dev:
	bash dev.sh

build:
	cd frontend && npm run build

deploy:
	bash deploy.sh

logs:
	az webapp log tail -g $(RG) -n $(APP)

clean:
	rm -rf frontend/dist /tmp/mfg-deploy.zip
