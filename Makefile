API_DIR := apps/api
WEB_DIR := apps/web

# The venv lives in apps/api/.venv on both platforms; only the bin dir name differs.
ifeq ($(OS),Windows_NT)
	VENV_BIN := .venv\Scripts
	PY := $(VENV_BIN)\python
else
	VENV_BIN := .venv/bin
	PY := $(VENV_BIN)/python
endif
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

types:
	@echo "Not wired yet. M1: emit JSON Schema from abc_cook/schema and generate packages/schema."
	@exit 1

clean:
	cd $(API_DIR) && rm -rf .pytest_cache .mypy_cache .ruff_cache **/__pycache__
