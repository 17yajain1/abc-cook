"""FastAPI application factory."""

import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from abc_cook import __version__
from abc_cook.api.routes import health, recipes

DEFAULT_CORS_ORIGINS = "http://localhost:5173,http://127.0.0.1:5173"

# Private-network origins on the Vite dev port. Lets a phone on the same wifi hit the
# API without the owner hand-listing their LAN IP every time it changes (ROADMAP M2 is
# tested on a real phone). Only applied when APP_ENV is unset or "local".
LAN_ORIGIN_REGEX = r"http://(?:10|127|192\.168)(?:\.\d{1,3}){2,3}:5173"


def _cors_origins() -> list[str]:
    """Read allowed origins from the environment.

    Returns:
        Origins, defaulting to the local Vite dev server.
    """
    raw = os.environ.get("CORS_ORIGINS", DEFAULT_CORS_ORIGINS)
    return [origin.strip() for origin in raw.split(",") if origin.strip()]


def _is_local() -> bool:
    """Whether this process is running in local development."""
    return os.environ.get("APP_ENV", "local") == "local"


def create_app() -> FastAPI:
    """Build the ABC Cook API application.

    Returns:
        A configured FastAPI instance.
    """
    app = FastAPI(title="ABC Cook API", version=__version__)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=_cors_origins(),
        allow_origin_regex=LAN_ORIGIN_REGEX if _is_local() else None,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(health.router)
    app.include_router(recipes.router)
    return app


app = create_app()
