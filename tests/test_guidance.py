import pytest
from backend.guidance import guide
from backend.domain import normalize, DataError
from test_api import client, H


def test_ambiguous_dates_are_one_plain_question_not_silently_us():
    raw = b"Sale Date,SKU,Quantity Sold\n01/02/2026,A,2\n02/03/2026,A,4\n"
    g = guide(raw, {})
    assert g["question"]["id"] == "dates" and len(g["question"]["options"]) == 2
    g = guide(raw, {"dates": "DMY", "complete": "yes"})
    assert g["ready"] and g["config"]["coverage_start"] == "2026-02-01"


def test_date_detection_uses_all_rows_and_handles_semicolon_headers():
    raw = b"Sale Date;SKU;Quantity Sold\n01/02/2026;A;2\n14/02/2026;A;4\n"
    g = guide(raw, {"complete": "yes"})
    assert g["ready"] and g["config"]["date_format"] == "DMY"


def test_unknown_column_question_preserves_other_detected_columns():
    raw = b"date,sku,pieces\n2026-01-01,0007,2\n"
    g = guide(raw, {})
    assert g["question"]["id"] == "column_units"
    g = guide(raw, {"column_units": "pieces", "complete": "yes"})
    assert g["ready"] and g["config"]["mapping"]["product_id"] == "sku"
    with pytest.raises(DataError):
        guide(raw, {"column_units": "invented"})


def test_multiple_stores_use_selected_store_date_range():
    raw = b"date,sku,units_sold,store_id\n2026-01-01,A,2,East\n2026-02-01,A,3,West\n"
    assert guide(raw, {})["question"]["id"] == "store"
    g = guide(raw, {"store": "West", "complete": "yes"})
    assert g["ready"] and g["config"]["coverage_start"] == "2026-02-01"


def test_timestamps_ask_for_store_timezone():
    raw = b"date,sku,units_sold\n2026-01-01T01:00:00Z,A,2\n"
    assert guide(raw, {})["question"]["id"] == "timezone"
    g = guide(raw, {"timezone": "America/New_York", "complete": "yes"})
    assert g["config"]["coverage_start"] == "2025-12-31"


def test_repeated_product_day_asks_how_to_aggregate():
    raw = b"date,sku,units_sold\n2026-01-01,A,2\n2026-01-01,A,3\n"
    assert guide(raw, {})["question"]["id"] == "rows"
    assert (
        guide(raw, {"rows": "transactions", "complete": "yes"})["config"]["layout"]
        == "transactions"
    )


def test_money_column_requires_quantity_choice():
    raw = b"Date,Dish Name,Total Customers,Total Sales\n10/1/2023,eggs,5,100\n"
    answers = {"column_product_id": "Dish Name", "column_units": "Total Sales"}
    assert "Total Sales" not in [o["value"] for o in guide(raw, {})["question"]["options"]]
    with pytest.raises(DataError):
        guide(raw, answers)


def test_dish_names_detected_but_customer_counts_need_confirmation():
    raw = b"date,Dish Name,Total Customers,Price\n2026-01-01,Sandwich,50,4\n2026-01-02,Sandwich,60,4\n"
    first = guide(raw, {})
    assert first['config']['mapping']['product_id'] == 'Dish Name'
    assert first['question']['id'] == 'column_units'
    answers = {'column_units': 'Total Customers'}
    assert guide(raw, answers)['question']['id'] == 'quantity_meaning'
    assert guide(raw, {**answers, 'quantity_meaning': 'people'})['blocked']
    assert guide(raw, {**answers, 'quantity_meaning': 'unsure'})['blocked']
    assert guide(raw, {**answers, 'quantity_meaning': 'items', 'complete': 'yes'})['ready']
