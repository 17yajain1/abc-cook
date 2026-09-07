"""The app boots and answers."""

from fastapi.testclient import TestClient

from abc_cook.api.main import create_app


def test_health_returns_ok() -> None:
    with TestClient(create_app()) as client:
        response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"
