"""Liveness endpoint."""

from fastapi import APIRouter

from abc_cook import __version__
from abc_cook.extract.cache import POSTPROCESS_VERSION
from abc_cook.schema.api import ServerInfo

router = APIRouter(tags=["health"])


@router.get("/health")
async def health() -> ServerInfo:
    """Report that the API is up, and which post-processing version it runs.

    Returns:
        Status, the running package version, and `POSTPROCESS_VERSION` (the stamp a saved
        recipe is compared against to tell whether it may be out of date).
    """
    return ServerInfo(status="ok", version=__version__, postprocess_version=POSTPROCESS_VERSION)
