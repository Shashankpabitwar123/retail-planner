"""One local HTTP workflow at the row cap. Requires the local API on port 8001."""

import csv, io, time, json
from datetime import date, timedelta
from pathlib import Path
import httpx

text = io.StringIO()
w = csv.writer(text)
w.writerow(["date", "product_id", "units_sold"])
start = date(2024, 1, 1)
for pid in range(500):
    for day in range(400):
        w.writerow([start + timedelta(days=day), f"{pid:05}", (pid + day) % 17])
raw = text.getvalue().encode()
c = httpx.Client(
    base_url="http://127.0.0.1:8001", headers={"X-Retail-Client": "web"}, timeout=60
)
c.get("/api/session").raise_for_status()


def wait(jid):
    while True:
        r = c.get("/api/jobs/" + jid)
        r.raise_for_status()
        j = r.json()
        if j["state"] == "completed":
            return j
        if j["state"] in ("failed", "canceled"):
            raise RuntimeError(j.get("error", "Job failed"))
        time.sleep(0.1)


a = time.perf_counter()
r = c.post("/api/uploads?name=synthetic-cap-benchmark.csv", content=raw)
r.raise_for_status()
upload = r.json()
b = time.perf_counter()
try:
    cfg = {
        "mapping": upload["suggested_mapping"],
        "coverage_start": str(start),
        "coverage_end": str(start + timedelta(days=399)),
        "coverage_confirmed": True,
        "gross_sales_confirmed": True,
        "synthetic": True,
    }
    response = c.post("/api/uploads/" + upload["id"] + "/review", json=cfg)
    response.raise_for_status()
    review_id = response.json()["id"]
    review = wait(review_id)
    d = time.perf_counter()
    response = c.post("/api/jobs/" + review_id + "/forecast")
    response.raise_for_status()
    forecast = wait(response.json()["id"])
    e = time.perf_counter()
    report = {
        "rows": 200000,
        "products": 500,
        "bytes": len(raw),
        "upload_and_inspection_seconds": b - a,
        "normalize_queue_persist_and_poll_seconds": d - b,
        "forecast_queue_persist_and_poll_seconds": e - d,
        "total_seconds": e - a,
        "forecasted_products": sum(
            bool(p["forecast"]) for p in forecast["result"]["products"]
        ),
        "scope": "One sequential local HTTP test at configured row cap, with SQLite persistence and 100ms polling. Excludes generation of synthetic input, browser rendering, internet transfer, AI and concurrent users. Not a public-service capacity claim.",
    }
    (Path(__file__).resolve().parents[1] / "evidence/http-benchmark.json").write_text(
        json.dumps(report, indent=2)
    )
    print(json.dumps(report))
finally:
    response = c.delete("/api/uploads/" + upload["id"])
    response.raise_for_status()
