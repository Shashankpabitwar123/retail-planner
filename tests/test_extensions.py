import copy
from datetime import date, timedelta
import pytest
from backend.domain import normalize, forecast, DataError
from backend.imports import compare, supporting, inventory_rows
from test_engine import CFG
from test_api import client, H


def test_long_history_ranges_are_separate_from_selection_and_final_test():
    start = date(2024, 1, 1)

    def run(final_bump=0):
        rows = ["date,product_id,product_name,units_sold"]
        for i in range(448):
            n = 10 + i % 7 + (final_bump if i >= 420 else 0)
            rows.append(f"{start + timedelta(days=i)},0007,Notebook,{n}")
        return forecast(
            normalize(
                ("\n".join(rows)).encode(),
                {
                    **CFG,
                    "coverage_start": str(start),
                    "coverage_end": str(start + timedelta(days=447)),
                },
            )
        )["products"][0]

    a, b = run(), run(50)
    assert a["selection"] == b["selection"]
    assert a["method"] == b["method"]
    assert a["range"]["calibration_windows"] == 9
    assert a["range"]["evaluation_daily_coverage"] == 1
    assert b["range"]["evaluation_daily_coverage"] == 0
    assert a["range"]["total"]["upper"] == a["forecast_total"]
    assert b["evaluation"]["windows"][0]["model"]["mae"] > 0
    assert len(a["range"]["daily"]) == 28


def test_bulk_inventory_exact_ids_and_incoming_conflicts():
    stocks = supporting(
        b"product_id,available_units,as_of_date,lead_time_days,pack_size,minimum_order_units\n0007,25,2026-07-16,5,12,0\n",
        "inventory",
    )
    incoming = supporting(
        b"incoming_line_id,product_id,due_date,incoming_units,status\nPO1,0007,2026-07-17,24,received\n",
        "incoming",
    )
    plans = inventory_rows(stocks, incoming, [{"product_id": "0007"}])
    assert plans["0007"]["stock"] == 25
    assert plans["0007"]["incoming"][0]["status"] == "received"
    with pytest.raises(DataError):
        inventory_rows(stocks, incoming * 2, [{"product_id": "0007"}])
    with pytest.raises(DataError):
        inventory_rows(stocks, incoming, [{"product_id": "7"}])


def test_health_and_static_production(tmp_path, monkeypatch):
    monkeypatch.setenv("RETAIL_SERVE_FRONTEND", "1")
    c, s = client(tmp_path)
    assert c.get("/api/health").json()["status"] == "ok"
    page = c.get("/")
    assert page.status_code == 200 and "Retail Planner" in page.text
    assert "frame-ancestors 'none'" in page.headers["content-security-policy"]


def test_csv_dialects_and_timezone():
    from backend.domain import read_csv, parse_date

    for sep in [",", ";", "\t", "|"]:
        raw = (
            "\ufeffdate"
            + sep
            + "product_id"
            + sep
            + "units_sold\n2026-01-01"
            + sep
            + "0007"
            + sep
            + "10\n"
        ).encode()
        h, rows, d = read_csv(raw)
        assert rows[0]["product_id"] == "0007"
    _, rows, _ = read_csv(
        b'date,product_id,product_name,units_sold\n2026-01-01,0007,"Line\none",10\n'
    )
    assert rows[0]["product_name"] == "Line\none"
    assert (
        str(parse_date("2026-01-02T01:00:00Z", {"timezone": "America/New_York"}))
        == "2026-01-01"
    )


def test_received_supply_and_current_date_guard():
    from backend.domain import inventory

    values = [
        {"date": str(date(2026, 7, 16) + timedelta(days=i)), "units": 10}
        for i in range(28)
    ]
    cfg = {
        "product_id": "A",
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
    base = inventory(values, cfg)
    assert (
        inventory(
            values,
            {
                **cfg,
                "incoming": [
                    {"id": "P", "date": "2026-07-17", "units": 24, "status": "received"}
                ],
            },
        )["suggested_order_units"]
        == base["suggested_order_units"]
    )
    with pytest.raises(DataError):
        inventory(values, {**cfg, "mode": "current"})
