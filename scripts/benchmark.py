"""Bounded synthetic engine benchmark, not an end-to-end throughput claim."""

import io, csv, json, platform, time, resource, sys
from pathlib import Path
from datetime import date, timedelta

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backend.domain import normalize, forecast

out = []
for products, days in [(3, 196), (100, 196), (500, 400)]:
    text = io.StringIO()
    w = csv.writer(text)
    w.writerow(["date", "product_id", "units_sold"])
    start = date(2024, 1, 1)
    for pid in range(products):
        for day in range(days):
            w.writerow([start + timedelta(days=day), f"{pid:05}", (pid + day) % 17])
    raw = text.getvalue().encode()
    config = {
        "mapping": {"date": "date", "product_id": "product_id", "units": "units_sold"},
        "coverage_start": str(start),
        "coverage_end": str(start + timedelta(days=days - 1)),
        "coverage_confirmed": True,
        "gross_sales_confirmed": True,
    }
    times = []
    for _ in range(3):
        a = time.perf_counter()
        r = normalize(raw, config)
        b = time.perf_counter()
        f = forecast(r)
        c = time.perf_counter()
        times.append(
            {
                "normalize_seconds": b - a,
                "forecast_seconds": c - b,
                "total_seconds": c - a,
            }
        )
    out.append(
        {
            "source_rows": products * days,
            "products": products,
            "bytes": len(raw),
            "repetitions": times,
        }
    )
report = {
    "environment": {
        "platform": platform.platform(),
        "processor": platform.machine(),
        "python": platform.python_version(),
    },
    "scope": "In-process CSV normalization and all product forecasts on generated synthetic data. Excludes HTTP upload, browser, SQLite writes, network and AI. Sequential runs in one process. Not a production concurrency or millions-of-rows claim.",
    "max_rss_native_units": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
    "runs": out,
}
path = Path(__file__).resolve().parents[1] / "evidence/engine-benchmark.json"
path.write_text(json.dumps(report, indent=2))
print(json.dumps(out))
