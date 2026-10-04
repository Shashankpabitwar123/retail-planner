from backend.batch import prepare_batch
from test_batch import source
from test_engine import FIX
from test_api import client,H

A=b'date,sku,units_sold\n2025-01-01,A,2\n2025-01-02,A,3\n'
B=b'date,sku,units_sold\n2025-02-01,A,4\n2025-02-02,A,5\n'


def test_unrelated_catalogs_rejected_even_with_yes_answer():
    result=prepare_batch([source(A),source(B.replace(b',A,',b',RESTAURANT,'))],{'complete_all':'yes','same_store':'yes'})
    assert not result['ready']
    assert 'product IDs do not overlap' in result['blocked']


def test_builtin_sample_and_real_data_rejected():
    result=prepare_batch([source((FIX/'01-daily.csv').read_bytes()),source(A)],{'complete_all':'yes','same_store':'yes'})
    assert not result['ready'] and 'Sample data cannot' in result['blocked']


def test_same_store_question_requires_explicit_yes():
    files=[source(A),source(B)]
    r=prepare_batch(files,{'complete_all':'yes'})
    assert not r['ready'] and r['question']['id']=='same_store'
    r=prepare_batch(files,{'complete_all':'yes','same_store':'no'})
    assert not r['ready'] and 'Analyze unrelated' in r['blocked']
    assert prepare_batch(files,{'complete_all':'yes','same_store':'yes'})['ready']


def test_actual_question_endpoint_does_not_queue_until_confirmed(tmp_path):
    c,store=client(tmp_path)
    ids=[c.post('/api/uploads?name=test.csv',headers=H,content=raw).json()['id'] for raw in (A,B)]
    response=c.post('/api/batches/prepare',headers=H,json={'upload_ids':ids,'answers':{}}).json()
    assert response['question']['id']=='complete_all'
    answers={'complete_all':'yes'}
    response=c.post('/api/batches/prepare',headers=H,json={'upload_ids':ids,'answers':answers}).json()
    assert response['question']['id']=='same_store'
    for choice in ('no','unrecognized'):
        r=c.post('/api/batches/prepare',headers=H,json={'upload_ids':ids,'answers':{**answers,'same_store':choice}}).json()
        assert not r['ready']
    assert not store.run_one()
    r=c.post('/api/batches/prepare',headers=H,json={'upload_ids':ids,'answers':{**answers,'same_store':'yes'}}).json()
    assert r['ready'] and store.run_one()
