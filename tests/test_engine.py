import csv
import io
import json
from datetime import date, timedelta
from pathlib import Path
import pytest
from backend.domain import (
    normalize,
    forecast,
    inventory,
    inspect_csv,
    DataError,
    metrics,
)

FIX = Path(__file__).resolve().parent / "fixtures"
CFG = {
    "mapping": {
        "date": "date",
        "product_id": "product_id",
        "product_name": "product_name",
        "units": "units_sold",
    },
    "layout": "daily",
    "date_format": "ISO",
    "number_format": "dot",
    "timezone": "Etc/UTC",
    "coverage_start": "2026-01-01",
    "coverage_end": "2026-07-15",
    "coverage_confirmed": True,
    "gross_sales_confirmed": True,
    "missing_days_zero": False,
    "deduplicate_events": False,
    "store_id": "",
}


def report(name="01-daily.csv", **changes):
    raw = (FIX / name).read_bytes()
    inspect = inspect_csv(raw)
    config = {
        **CFG,
        "mapping": inspect["suggested_mapping"],
        "layout": inspect["suggested_layout"],
        **changes,
    }
    return normalize(raw, config)


def test_supported_layouts_equal():
    daily = report()
    trans = report("02-transactions.csv", missing_days_zero=True)
    wide = report("03-wide-dates.csv")
    strip = lambda r: [
        {k: v for k, v in x.items() if k != "observation_status"}
        for x in r["canonical"]
    ]
    assert strip(daily) == strip(trans) == strip(wide)
    assert len(daily["canonical"]) == 588
    assert sum(p["total_units"] for p in daily["products"]) == 3724
    assert daily["products"][0]["product_id"] == "0007"


def test_missing_never_implicitly_zero():
    raw = (
        (FIX / "01-daily.csv")
        .read_text()
        .replace("2026-01-02,0007,Notebook,11\n", "")
        .encode()
    )
    r = normalize(raw, CFG)
    assert r["eligible_products"] == 2
    assert (
        next(p for p in r["products"] if p["product_id"] == "0007")["status"]
        == "needs_review"
    )
    fixed = normalize(raw, {**CFG, "missing_days_zero": True})
    assert fixed["eligible_products"] == 3
    assert any(
        row["observation_status"] == "zero_confirmed" for row in fixed["canonical"]
    )


@pytest.mark.parametrize(
    "name",
    [
        "07-daily-conflict.csv",
        "09-unclassified-negative.csv",
        "18-fractional-units.csv",
        "19-stockout-history.csv",
        "25-blank-wide-cell.csv",
    ],
)
def test_bad_data_cannot_silently_produce_all_forecasts(name):
    r = report(name)
    assert r["global_block"] or any(
        p["status"] == "needs_review" for p in r["products"]
    )


@pytest.mark.parametrize("name", ["26-duplicate-headers.csv"])
def test_duplicate_header_rejected(name):
    with pytest.raises(DataError):
        inspect_csv((FIX / name).read_bytes())


def test_ambiguous_dates_require_format():
    raw = b"date,product_id,units_sold\n01/02/2026,A,3\n"
    config = {
        **CFG,
        "mapping": {"date": "date", "product_id": "product_id", "units": "units_sold"},
    }
    bad = normalize(raw, config)
    assert bad["eligible_products"] == 0
    good = normalize(raw, {**config, "date_format": "DMY", "missing_days_zero": True})
    row = next(r for r in good["canonical"] if r["date"] == "2026-02-01")
    assert row["units_sold"] == 3


def test_event_dedup_and_conflict():
    mapping = {
        "date": "date",
        "product_id": "product_id",
        "units": "quantity",
        "event_id": "event_id",
        "event_type": "event_type",
    }
    raw = b"event_id,date,product_id,quantity,event_type\ne1,2026-01-01,A,5,sale\ne1,2026-01-01,A,5,sale\n"
    c = {**CFG, "layout": "transactions", "mapping": mapping, "missing_days_zero": True}
    assert normalize(raw, c)["eligible_products"] == 0
    assert (
        normalize(raw, {**c, "deduplicate_events": True})["products"][0]["total_units"]
        == 5
    )
    assert (
        normalize(
            raw.replace(b"A,5,sale\n", b"A,6,sale\n", 1),
            {**c, "deduplicate_events": True},
        )["eligible_products"]
        == 0
    )


def test_identical_rows_without_event_ids_are_retained():
    raw = b"date,product_id,quantity\n2026-01-01,A,5\n2026-01-01,A,5\n"
    r = normalize(
        raw,
        {
            **CFG,
            "layout": "transactions",
            "mapping": {
                "date": "date",
                "product_id": "product_id",
                "units": "quantity",
            },
            "missing_days_zero": True,
        },
    )
    assert r["products"][0]["total_units"] == 10


def test_returns_and_cancellations_excluded_not_net():
    r = report("08-events-with-returns.csv", missing_days_zero=True)
    assert r["products"][0]["total_units"] == 10
    assert r["issue_counts"]["excluded_return"] == 1
    assert r["issue_counts"]["excluded_cancellation"] == 1


def test_short_history_and_all_zero_withheld():
    r = report("11-short-history.csv", coverage_end="2026-01-21")
    assert not r["eligible_products"]
    assert all(not p["forecast"] for p in forecast(r)["products"])
    r = report("12-all-zero.csv", missing_days_zero=True)
    assert not r["eligible_products"]


def test_multi_store_requires_selection():
    with pytest.raises(DataError, match="multiple stores"):
        report("13-multiple-stores.csv")


def test_missing_product_blocks_file():
    with pytest.raises(DataError):
        report("10-missing-product.csv")
    raw = (FIX / "01-daily.csv").read_bytes() + b"2026-01-01,,Missing,5\n"
    r = normalize(raw, CFG)
    assert r["global_block"]
    with pytest.raises(DataError):
        forecast(r)


def test_full_forecast_window_and_evaluation():
    f = forecast(report())
    assert f["forecast_start"] == "2026-07-16"
    assert f["forecast_end"] == "2026-08-12"
    assert all(len(p["forecast"]) == 28 for p in f["products"])
    p = f["products"][0]
    assert p["forecast_total"] == 364
    assert p["evaluation"]["windows"][0]["start"] == "2026-06-18"
    assert p["evaluation"]["windows"][0]["model"]["mae"] == 0
    assert len(p["selection"]) == 6
    assert all(c["windows"] == 3 for c in p["selection"])
    assert p["range"] is None


def test_final_holdout_does_not_select_model():
    r = report()
    before = forecast(r)
    for p in r["products"]:
        p["series"][-28:] = [777] * 28
    after = forecast(r)
    for a, b in zip(before["products"], after["products"]):
        assert a["selection"] == b["selection"]
        assert a["method"] == b["method"]
        assert a["evaluation"] != b["evaluation"]


@pytest.mark.parametrize(
    "days,windows", [(56, 0), (83, 0), (84, 1), (111, 1), (112, 2), (167, 3), (168, 1)]
)
def test_history_thresholds(days, windows):
    start = date(2025, 1, 1)
    raw = (
        "date,product_id,units_sold\n"
        + "\n".join(f"{start + timedelta(days=i)},A,{i % 7 + 1}" for i in range(days))
    ).encode()
    r = normalize(
        raw,
        {
            **CFG,
            "mapping": {
                "date": "date",
                "product_id": "product_id",
                "units": "units_sold",
            },
            "coverage_start": str(start),
            "coverage_end": str(start + timedelta(days=days - 1)),
        },
    )
    p = forecast(r)["products"][0]
    assert (len(p["evaluation"]["windows"]) if p["evaluation"] else 0) == windows
    assert p["inventory_eligible"] == (days >= 84)


def test_zero_actual_error_undefined():
    assert metrics([0] * 28, [2] * 28)["wape"] is None


def inv_config(**kwargs):
    return {
        "stock": 25,
        "snapshot_date": "2026-07-16",
        "lead_days": 5,
        "review_days": 7,
        "buffer_days": 2,
        "pack_size": 12,
        "minimum_order": 0,
        "confirmed": True,
        "mode": "historical_replay",
        "timezone": "Etc/UTC",
        "incoming": [
            {"id": "PO-1", "date": "2026-07-18", "units": 20, "status": "open"}
        ],
        **kwargs,
    }


def daily():
    return [
        {"date": str(date(2026, 7, 16) + timedelta(days=i)), "units": 10}
        for i in range(28)
    ]


def test_inventory_known_answer():
    p = inventory(daily(), inv_config())
    assert p["suggested_order_units"] == 96
    assert p["pre_arrival_unmet_units"] == 5
    assert p["first_shortfall_date"] == "2026-07-20"
    assert p["end_protection_stock_with_order"] == 26


def test_late_receipt_cannot_hide_early_shortfall():
    p = inventory(
        daily(),
        inv_config(
            stock=0,
            lead_days=1,
            buffer_days=0,
            incoming=[{"id": "x", "date": "2026-07-23", "units": 1000}],
        ),
    )
    assert p["suggested_order_units"] >= 60


def test_no_need_means_zero_despite_moq():
    assert (
        inventory(daily(), inv_config(stock=1000, minimum_order=500))[
            "suggested_order_units"
        ]
        == 0
    )


@pytest.mark.parametrize(
    "change",
    [
        {"lead_days": 0},
        {"lead_days": 25},
        {"snapshot_date": "2026-07-15"},
        {"stock": -1},
        {"mode": "current"},
        {"incoming": [{"id": "x", "date": "2026-07-15", "units": 3}]},
    ],
)
def test_invalid_inventory_refused(change):
    with pytest.raises(DataError):
        inventory(daily(), inv_config(**change))


def test_bad_holdout_withholds_inventory_without_reselecting():
    r = report()
    for p in r["products"]:
        p["series"][-28:] = [777] * 28
    output = forecast(r)
    assert all(not p["inventory_eligible"] for p in output["products"])
    assert all("withheld" in p["forecast_warning"] for p in output["products"])
