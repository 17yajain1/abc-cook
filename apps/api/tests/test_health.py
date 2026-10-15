"""The app boots and answers."""

from fastapi.testclient import TestClient

from abc_cook.api.main import create_app
from abc_cook.extract.cache import POSTPROCESS_VERSION


def test_health_returns_ok() -> None:
    with TestClient(create_app()) as client:
        response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_health_reports_the_postprocess_version() -> None:
    """The web app compares a saved recipe's stamp against this (staleness plan B3)."""
    with TestClient(create_app()) as client:
        body = client.get("/health").json()
    assert body["postprocess_version"] == POSTPROCESS_VERSION
