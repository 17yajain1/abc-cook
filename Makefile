API_DIR := apps/api
WEB_DIR := apps/web
SCHEMA_DIR := packages/schema

# The venv lives in apps/api/.venv on both platforms; only the bin dir name differs.
# Forward slashes throughout: Windows accepts them, and this stays correct whether
# make's shell ends up being cmd or an sh (Git Bash) that would eat backslashes.
ifeq ($(OS),Windows_NT)
	VENV_BIN := .venv/Scripts
else
	VENV_BIN := .venv/bin
endif
PY := $(VENV_BIN)/python
API_PORT ?= 8000

.PHONY: help install dev api web lint test types clean

help:
	@echo "install  create the api venv, install both apps' dependencies"
	@echo "dev      run the api and the web dev server together"
	@echo "api      run the api alone on :$(API_PORT)"
	@echo "web      run the web dev server alone, exposed on the local network"
	@echo "lint     ruff + mypy on the api, oxlint on the web"
	@echo "test     pytest (llm-marked tests excluded)"
	@echo "types    regenerate packages/schema from the Pydantic JSON Schema"
	@echo "clean    remove caches and build output"

install:
	cd $(API_DIR) && python -m venv .venv
	cd $(API_DIR) && $(PY) -m pip install --upgrade pip
	cd $(API_DIR) && $(PY) -m pip install -e ".[dev]"
	cd $(SCHEMA_DIR) && npm install
	cd $(WEB_DIR) && npm install

# Both servers, in parallel. Ctrl-C stops both.
dev:
	@$(MAKE) -j2 api web

api:
	cd $(API_DIR) && $(PY) -m uvicorn abc_cook.api.main:app --reload --host 0.0.0.0 --port $(API_PORT)

# --host binds on the LAN so the PWA is reachable from a phone (ROADMAP M0 exit).
web:
	cd $(WEB_DIR) && npm run dev -- --host

lint:
	cd $(API_DIR) && $(VENV_BIN)/ruff check .
	cd $(API_DIR) && $(VENV_BIN)/mypy
	cd $(WEB_DIR) && npm run lint

test:
	cd $(API_DIR) && $(VENV_BIN)/pytest -m "not llm"
	cd $(WEB_DIR) && npm test

# Pydantic models -> JSON Schema -> packages/schema/index.ts, plus the frozen
# RecipePlanResponse fixtures the web unit tests run against. All committed so the web
# build never needs Python. Re-run after any abc_cook/schema or scheduler change.
types:
	cd $(API_DIR) && $(PY) scripts/export_schema.py
	cd $(SCHEMA_DIR) && npm run build
	cd $(API_DIR) && $(PY) scripts/export_web_fixtures.py

clean:
	cd $(API_DIR) && rm -rf .pytest_cache .mypy_cache .ruff_cache **/__pycache__
