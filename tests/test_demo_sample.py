"""The public example must support the complete forecast and stock workflow."""
import hashlib
from pathlib import Path
from backend.batch import prepare_batch
from backend.domain import normalize, forecast, inventory


def test_public_example_supports_all_products_and_varied_stock_actions():
    base = Path(__file__).resolve().parents[1]
    raw = (base / 'samples/01-daily.csv').read_bytes()
    assert raw == (base / 'frontend/public/samples/01-daily.csv').read_bytes()
    prepared = prepare_batch([{'raw': raw, 'name': '01-daily.csv', 'digest': hashlib.sha256(raw).hexdigest()}], {})
    assert prepared['ready']  # Known sample needs no clarification questions.
    report = normalize(prepared['raw'], prepared['config'])
    assert report['config']['synthetic']
    assert not report['global_block']
    result = forecast(report)
    assert len(result['products']) == 3
    stocks = {'0007': 30, 'SKU-B': 100, 'SKU-C': 5}
    orders = {}
    for product in result['products']:
        assert len(product['forecast']) == 28
        assert product['inventory_eligible']
        plan = inventory(product['forecast'], dict(stock=stocks[product['product_id']], snapshot_date=result['forecast_start'], lead_days=5, review_days=7, buffer_days=2, pack_size=1, minimum_order=0, mode='historical_replay', confirmed=True, incoming=[]))
        orders[product['product_id']] = plan['suggested_order_units']
        assert len(plan['daily_stock']) > 0
    assert orders['0007'] > 0
    assert orders['SKU-B'] == 0
