import pytest
from backend.guidance import guide
from backend.domain import normalize, DataError
from test_engine import FIX
from test_api import client, upload, H


@pytest.mark.parametrize(
    "file", ["01-daily.csv", "02-transactions.csv", "03-wide-dates.csv"]
)
def test_known_examples_need_no_setup_and_reconcile(file):
    raw = (FIX / file).read_bytes()
    g = guide(raw, {})
    assert g["ready"] and g["config"]["synthetic"]
    q = normalize(raw, g["config"])
    assert (
        q["eligible_products"] == (2 if file == "02-transactions.csv" else 3)
        and not q["global_block"]
    )
    assert sum(p["total_units"] for p in q["products"]) == 3724


def test_real_file_only_asks_uninferable_business_confirmation():
    raw = (FIX / "01-daily.csv").read_bytes().replace(b"Notebook", b"Pencils")
    g = guide(raw, {})
    assert g["question"]["id"] == "complete"
    assert not g["config"]["coverage_confirmed"]
    g = guide(raw, {"complete": "yes"})
    assert g["ready"] and not g["config"]["synthetic"]
    assert normalize(raw, g["config"])["eligible_products"] == 3
    assert guide(raw, {"complete": "unsure"})["blocked"]


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


def test_gaps_never_become_zero_during_detection():
    raw = (FIX / "05-missing-period.csv").read_bytes()
    g = guide(raw, {"complete": "yes"})
    assert g["ready"] and not g["config"]["missing_days_zero"]
    assert any(p["missing_days"] for p in normalize(raw, g["config"])["products"])


def test_bad_answers_and_owner_isolation(tmp_path):
    from fastapi.testclient import TestClient

    c, s = client(tmp_path)
    u = upload(c)
    route = f"/api/uploads/{u['id']}/guide"
    assert c.post(route, headers=H, json={"answers": {}}).json()["ready"]
    assert (
        c.post(route, headers=H, json={"answers": {"complete": True}}).status_code
        == 422
    )
    other = TestClient(c.app)
    other.get("/api/session")
    assert other.post(route, headers=H, json={"answers": {}}).status_code == 404


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
