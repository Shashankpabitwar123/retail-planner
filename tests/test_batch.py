import hashlib
from backend.batch import prepare_batch
from backend.domain import normalize
from test_api import client, H
from fastapi.testclient import TestClient


def source(raw, name='sales.csv'):
    return {'raw':raw, 'name':name, 'digest':hashlib.sha256(raw).hexdigest()}


def test_twelve_months_combine_and_duplicates_count_once():
    sources = [source(('date,sku,units_sold\n'+''.join(f'2025-{month:02d}-{d:02d},A,2\n' for d in range(1,29))).encode(), f'{month}.csv') for month in range(1,13)]
    r = prepare_batch(sources, {'complete_all':'yes','same_store':'yes'})
    assert r['ready']
    q = normalize(r['raw'],r['config'])
    assert q['products'][0]['total_units'] == 12*28*2
    assert q['products'][0]['missing_days'] > 0
    r = prepare_batch([sources[0],sources[0]], {'complete_all':'yes','same_store':'yes'})
    assert normalize(r['raw'],r['config'])['products'][0]['total_units'] == 56


def test_different_layouts_and_column_choice_reuse():
    a = source(b'date,sku,pieces\n2025-01-01,A,2\n2025-01-02,A,3\n')
    b = source(b'date,sku,pieces\n2025-02-01,A,4\n2025-02-02,A,5\n')
    r = prepare_batch([a,b], {'complete_all':'yes','same_store':'yes'})
    assert r['question']['id'] == '0:column_units'
    r = prepare_batch([a,b], {'complete_all':'yes','same_store':'yes','0:column_units':'pieces'})
    assert r['ready']
    assert normalize(r['raw'],r['config'])['products'][0]['total_units'] == 14


def test_monthly_totals_need_clarification():
    a = source(b'date,sku,units_sold\n2025-01-01,A,100\n')
    b = source(b'date,sku,units_sold\n2025-02-01,A,120\n')
    assert prepare_batch([a,b],{'complete_all':'yes','same_store':'yes'})['question']['id'] == 'daily_records'


def test_transaction_overlap_is_not_silently_summed():
    a = source(b'date,sku,units_sold,event_id\n2025-01-01,A,2,E1\n2025-01-02,A,3,E2\n')
    b = source(b'date,sku,units_sold,event_id\n2025-01-01,A,2,E1\n2025-01-02,A,4,E3\n')
    r = prepare_batch([a,b],{'complete_all':'yes','same_store':'yes'})
    assert not r['ready'] and 'transaction' in r['blocked']


def test_batch_endpoint_ownership_count_and_processing(tmp_path):
    c, store = client(tmp_path)
    raw = b'date,sku,units_sold\n2025-01-01,A,2\n2025-01-02,A,3\n'
    uid = c.post('/api/uploads?name=a.csv',content=raw,headers=H).json()['id']
    other = TestClient(c.app); other.get('/api/session')
    assert other.post('/api/batches/prepare',headers=H,json={'upload_ids':[uid]}).status_code == 404
    assert c.post('/api/batches/prepare',headers=H,json={'upload_ids':[uid]*13}).status_code == 422
    r = c.post('/api/batches/prepare',headers=H,json={'upload_ids':[uid], 'answers':{'complete_all':'yes','same_store':'yes'}})
    assert r.status_code == 200, r.text
    store.run_one()
    assert c.get('/api/jobs/'+r.json()['id']).json()['state'] == 'completed'
