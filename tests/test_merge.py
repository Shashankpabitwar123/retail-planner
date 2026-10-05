from copy import deepcopy
import pytest
from backend.merge import combine_reports
from backend.domain import normalize, DataError
from test_engine import report
from test_api import client, review, H
from fastapi.testclient import TestClient


def test_overlap_is_counted_once_and_conflicts_rejected():
    old = report()
    raw, config = combine_reports(old, old)
    merged = normalize(raw, config)
    assert sum(p['total_units'] for p in merged['products']) == 3724
    newer = deepcopy(old)
    newer['canonical'][0]['units_sold'] += 1
    with pytest.raises(DataError, match='Different sales'):
        combine_reports(old, newer)


def test_missing_days_are_filled_only_by_known_observations():
    old = report()
    newer = deepcopy(old)
    old['canonical'][0]['observation_status'] = 'unknown'
    old['canonical'][0]['units_sold'] = None
    raw, cfg = combine_reports(old, newer)
    merged = normalize(raw, cfg)
    assert sum(p['total_units'] for p in merged['products']) == 3724
    assert cfg['missing_days_zero'] is False


def test_extend_history_without_inventing_gap_sales():
    old = report()
    new = deepcopy(old)
    new['canonical'] = [{**old['canonical'][0], 'date':'2026-07-17', 'units_sold':10}]
    new['coverage_start'] = new['coverage_end'] = '2026-07-17'
    raw, cfg = combine_reports(old, new)
    merged = normalize(raw, cfg)
    assert merged['coverage_end'] == '2026-07-17'
    assert sum(p['missing_days'] for p in merged['products']) > 0


def test_combine_endpoint_is_owner_scoped_and_rechecked(tmp_path):
    c, store = client(tmp_path)
    _, jid = review(c, store)
    other = TestClient(c.app)
    other.get('/api/session')
    assert other.post(f'/api/jobs/{jid}/combine', headers=H, json={'new_review_id':jid}).status_code == 404
    r = c.post(f'/api/jobs/{jid}/combine', headers=H, json={'new_review_id':jid})
    assert r.status_code == 200, r.text
    store.run_one()
    job = c.get('/api/jobs/' + r.json()['id']).json()
    assert job['state'] == 'completed'
    assert sum(p['total_units'] for p in job['result']['products']) == 3724


def test_invoice_proxy_basis_survives_merging_and_blocks_stock_advice():
    from backend.domain import forecast
    original=report()
    original['config'].update(quantity_basis='positive_invoice_units_proxy',demo_proxy_confirmed=True,gross_sales_confirmed=False)
    raw,cfg=combine_reports(original,original)
    assert cfg['quantity_basis']=='positive_invoice_units_proxy'
    assert cfg['gross_sales_confirmed'] is False
    result=forecast(normalize(raw,cfg))
    assert all(not p.get('inventory_eligible') for p in result['products'])
    assert all('invoice quantities' in p['forecast_warning'] for p in result['products'] if p['forecast'])
