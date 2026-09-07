"""Liveness endpoint."""

from fastapi import APIRouter
from pydantic import BaseModel

from abc_cook import __version__

router = APIRouter(tags=["health"])


class HealthResponse(BaseModel):
    """Liveness payload."""

    status: str
    version: str


@router.get("/health")
async def health() -> HealthResponse:
    """Report that the API is up.

    Returns:
        Status and the running package version.
    """
    return HealthResponse(status="ok", version=__version__)
