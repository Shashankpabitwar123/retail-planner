import time
from fastapi.testclient import TestClient
from backend.app import create_app, MAX_BYTES
from test_engine import CFG

H = {"X-Retail-Client": "web"}


def client(tmp_path):
    app = create_app(tmp_path / "db.sqlite", worker=False)
    c = TestClient(app)
    c.get("/api/session")
    return c, app.state.store


def test_csrf_and_request_limits(tmp_path):
    c, s = client(tmp_path)
    assert c.post("/api/uploads", content=b"a,b\n1,2").status_code == 403
    assert (
        c.post(
            "/api/uploads",
            headers={**H, "Origin": "https://evil.example"},
            content=b"a,b\n1,2",
        ).status_code
        == 403
    )
    assert (
        c.post(
            "/api/uploads",
            headers={**H, "Content-Length": str(MAX_BYTES + 1)},
            content=b"",
        ).status_code
        == 413
    )
