import time
from fastapi.testclient import TestClient
from backend.app import create_app, MAX_BYTES
from test_engine import FIX, CFG

H = {"X-Retail-Client": "web"}


def client(tmp_path):
    app = create_app(tmp_path / "db.sqlite", worker=False)
    c = TestClient(app)
    c.get("/api/session")
    return c, app.state.store


def upload(c):
    r = c.post(
        "/api/uploads?name=test.csv",
        headers=H,
        content=(FIX / "01-daily.csv").read_bytes(),
    )
    assert r.status_code == 200, r.text
    return r.json()


def review(c, store):
    u = upload(c)
    r = c.post(f"/api/uploads/{u['id']}/review", headers=H, json=CFG)
    assert r.status_code == 200, r.text
    store.run_one()
    return u, r.json()["id"]


def test_session_isolation_and_no_global_duplicate_oracle(tmp_path):
    a, s = client(tmp_path)
    b = TestClient(a.app)
    b.get("/api/session")
    u, j = review(a, s)
    assert b.get("/api/jobs/" + j).status_code == 404
    assert not upload(b)["duplicate"]
    assert upload(a)["duplicate"]
    assert b.delete("/api/uploads/" + u["id"], headers=H).status_code == 404


def test_review_forecast_export_and_idempotency(tmp_path):
    c, s = client(tmp_path)
    u, j = review(c, s)
    data = c.get("/api/jobs/" + j).json()
    assert data["state"] == "completed"
    assert "canonical" not in data["result"]
    assert "series" not in data["result"]["products"][0]
    assert (
        c.post("/api/uploads/" + u["id"] + "/review", headers=H, json=CFG).json()["id"]
        == j
    )
    f = c.post("/api/jobs/" + j + "/forecast", headers=H).json()["id"]
    s.run_one()
    result = c.get("/api/jobs/" + f).json()
    assert result["state"] == "completed"
    assert result["result"]["products"][0]["forecast_total"] == 364
    export = c.get("/api/jobs/" + j + "/normalized.csv")
    assert export.status_code == 200
    assert "0007" in export.text


def test_cancel_retry_and_restart_recovery(tmp_path):
    c, s = client(tmp_path)
    u = upload(c)
    j = c.post("/api/uploads/" + u["id"] + "/review", headers=H, json=CFG).json()["id"]
    assert c.post("/api/jobs/" + j + "/cancel", headers=H).status_code == 200
    assert c.get("/api/jobs/" + j).json()["state"] == "canceled"
    c.post("/api/jobs/" + j + "/retry", headers=H)
    with s.db() as db:
        db.execute("UPDATE jobs SET state='running' WHERE id=?", (j,))
    s.recover()
    s.run_one()
    assert c.get("/api/jobs/" + j).json()["state"] == "completed"


def test_delete_removes_source_and_jobs(tmp_path):
    c, s = client(tmp_path)
    u, j = review(c, s)
    assert c.delete("/api/uploads/" + u["id"], headers=H).json()["deleted"]
    assert c.get("/api/jobs/" + j).status_code == 404
    with s.db() as db:
        assert db.execute("SELECT COUNT(*) FROM uploads").fetchone()[0] == 0


def test_expiry_revokes_access_and_cleanup(tmp_path):
    c, s = client(tmp_path)
    u, j = review(c, s)
    with s.db() as db:
        db.execute("UPDATE jobs SET expires=?", (time.time() - 1,))
        db.execute("UPDATE uploads SET expires=?", (time.time() - 1,))
    assert c.get("/api/jobs/" + j).status_code == 404
    s.cleanup()
    with s.db() as db:
        assert db.execute("SELECT COUNT(*) FROM jobs").fetchone()[0] == 0


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


def test_ai_requires_consent_and_completed_context(tmp_path):
    c, s = client(tmp_path)
    u, j = review(c, s)
    assert (
        c.post(
            "/api/jobs/" + j + "/ask", headers=H, json={"question": "What next?"}
        ).status_code
        == 422
    )


def test_settings_reject_truthy_strings_and_invalid_timezones(tmp_path):
    c, s = client(tmp_path)
    u = upload(c)
    for patch in [
        {"coverage_confirmed": "yes"},
        {"timezone": "Not/A_Zone"},
        {"mapping": {"unknown": "date"}},
    ]:
        response = c.post(
            "/api/uploads/" + u["id"] + "/review", headers=H, json={**CFG, **patch}
        )
        assert response.status_code == 422, response.text


def test_inventory_api_validates_and_uses_saved_forecast(tmp_path):
    c, s = client(tmp_path)
    u, j = review(c, s)
    f = c.post("/api/jobs/" + j + "/forecast", headers=H).json()["id"]
    s.run_one()
    config = {
        "product_id": "0007",
        "stock": 25,
        "snapshot_date": "2026-07-16",
        "lead_days": 5,
        "review_days": 7,
        "buffer_days": 2,
        "pack_size": 12,
        "minimum_order": 0,
        "mode": "historical_replay",
        "confirmed": True,
        "incoming": [],
    }
    response = c.post("/api/jobs/" + f + "/inventory", headers=H, json=config)
    assert response.status_code == 200, response.text
    assert response.json()["suggested_order_units"] == 132
    assert response.json()["pre_arrival_unmet_units"] == 35
    assert (
        c.post(
            "/api/jobs/" + f + "/inventory", headers=H, json={**config, "incoming": [3]}
        ).status_code
        == 422
    )


def test_review_can_resume_editing_from_server(tmp_path):
    c, s = client(tmp_path)
    u, j = review(c, s)
    assert c.get("/api/jobs/" + j).json()["settings"]["coverage_start"] == "2026-01-01"
    source = c.get("/api/uploads/" + u["id"]).json()
    assert source["row_count"] == 588
    assert source["suggested_mapping"]["product_id"] == "product_id"
    other = TestClient(c.app)
    other.get("/api/session")
    assert other.get("/api/uploads/" + u["id"]).status_code == 404


def test_health_and_job_cache_use_current_engine_revision(tmp_path,monkeypatch):
    import backend.app as app_module
    from backend.domain import ENGINE_REVISION
    c,store=client(tmp_path)
    assert c.get('/api/health').json()['engine']==ENGINE_REVISION
    _,jid=review(c,store)
    with store.db() as db:
        original=dict(db.execute('SELECT * FROM jobs WHERE id=?',(jid,)).fetchone())
    import json
    monkeypatch.setattr(app_module,'ENGINE_REVISION','future-test-revision')
    newer=store.enqueue(original['owner'],original['upload'],'normalize',json.loads(original['config']))
    assert newer!=jid


def test_job_performance_is_recorded_without_sales_content(tmp_path, capsys):
    import json
    c, store = client(tmp_path)
    u, jid = review(c, store)
    job = c.get('/api/jobs/' + jid).json()
    perf = job['performance']
    assert perf['state'] == 'completed'
    assert perf['input_bytes'] > 0
    assert perf['wall_seconds'] >= perf['stages']['normalize_seconds'] >= 0
    assert perf['memory_after']['process_lifetime_peak_rss_bytes'] > 0
    assert 'raw' not in perf and 'config' not in perf
    records = [json.loads(line) for line in capsys.readouterr().out.splitlines() if 'retail_performance' in line]
    assert any(r.get('job_id') == jid for r in records)
    assert any(r.get('operation') == 'http_request' and r['status'] == 200 for r in records)
    other = TestClient(c.app)
    other.get('/api/session')
    assert other.get('/api/jobs/' + jid).status_code == 404


def test_failed_job_retains_measurements(tmp_path):
    c, store = client(tmp_path)
    u = upload(c)
    with store.db() as db:
        owner = db.execute('SELECT owner FROM uploads WHERE id=?', (u['id'],)).fetchone()['owner']
    jid = store.enqueue(owner, u['id'], 'normalize', {})
    store.run_one()
    job = c.get('/api/jobs/' + jid).json()
    assert job['state'] == 'failed'
    assert job['performance']['state'] == 'failed'
    assert job['performance']['stages']['normalize_seconds'] >= 0
