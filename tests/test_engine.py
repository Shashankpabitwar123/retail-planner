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


def test_inventory_horizon_boundary_has_actionable_error():
    daily=[{'date':str(date(2026,1,1)+timedelta(days=i)),'units':10} for i in range(28)]
    config=dict(stock=200,lead_days=2,review_days=20,buffer_days=2,pack_size=1,minimum_order=0,confirmed=True,snapshot_date='2026-01-01',mode='historical_replay',incoming=[])
    assert inventory(daily,config)['suggested_order_units']>=0
    inventory(daily,{**config,'review_days':24})
    with pytest.raises(DataError,match='2 delivery \\+ 25 selling \\+ 2 extra = 29 days'):
        inventory(daily,{**config,'review_days':25})


@pytest.mark.parametrize('reverse',[False,True])
def test_positive_transactions_cannot_coexist_with_closed_or_zero_day(reverse):
    for status in ('closed','zero_confirmed','zero_assumed','unknown'):
        rows=[['2026-01-01','A',10,'observed'],['2026-01-01','A',0,status]]
        if reverse:rows.reverse()
        out=io.StringIO();w=csv.writer(out);w.writerow(['date','product_id','units_sold','observation_status']);w.writerows(rows)
        cfg={**CFG,'mapping':{'date':'date','product_id':'product_id','units':'units_sold','date_status':'observation_status'},'layout':'transactions','coverage_start':'2026-01-01','coverage_end':'2026-01-01'}
        result=normalize(out.getvalue().encode(),cfg)
        assert result['products'][0]['status']=='needs_review'
        assert any(i['code']=='invalid_row' for i in result['issues'])


def test_period_error_exposes_total_error_without_hiding_daily_error():
    actual=[0,20]*14; predicted=[10]*28
    result=metrics(actual,predicted)
    assert result['mae']==10
    assert result['period_mae']['14']==0
    assert result['period_mae']['28']==0
    assert result['period_mae']['7']==10


@pytest.mark.parametrize('statuses',[('zero_confirmed','zero_assumed'),('zero_assumed','zero_confirmed'),('zero_assumed','censored_stockout'),('censored_stockout','zero_assumed')])
def test_transaction_status_preserves_uncertainty(statuses):
    out=io.StringIO();w=csv.writer(out);w.writerow(['date','product_id','units_sold','observation_status'])
    for status in statuses:w.writerow(['2026-01-01','A',0,status])
    cfg={**CFG,'mapping':{'date':'date','product_id':'product_id','units':'units_sold','date_status':'observation_status'},'layout':'transactions','coverage_start':'2026-01-01','coverage_end':'2026-01-01'}
    result=normalize(out.getvalue().encode(),cfg)
    assert result['canonical'][0]['observation_status']==('censored_stockout' if 'censored_stockout' in statuses else 'zero_assumed')
