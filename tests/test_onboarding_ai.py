import asyncio
import pytest
from backend import onboarding_ai
from test_api import client, H

RAW = b'date,sku,pieces\n2026-01-01,A,2\n2026-01-02,A,4\n'

@pytest.mark.parametrize('mapping', [None, {'units':'made up'}, {'date':'date','product_id':'sku','units':'date'}, {'date':[], 'product_id':'sku','units':'pieces'}])
def test_invalid_ai_output_is_ignored(monkeypatch, mapping):
    async def fake(*args): return mapping, {}
    monkeypatch.setattr(onboarding_ai, 'structured', fake)
    assert asyncio.run(onboarding_ai.suggest(RAW, 'test')) == {}


def test_auto_hints_cached_and_business_confirmation_retained(tmp_path, monkeypatch):
    calls=[]
    async def fake(*args):
        calls.append(args[3])
        return {'date':'date','product_id':'sku','units':'pieces'}, {}
    monkeypatch.setenv('OPENAI_API_KEY','test')
    monkeypatch.setattr(onboarding_ai,'structured',fake)
    c,store=client(tmp_path)
    uid=c.post('/api/uploads?name=test.csv',headers=H,content=RAW).json()['id']
    payload={'upload_ids':[uid],'answers':{},'use_ai':True}
    for _ in range(2):
        r=c.post('/api/batches/prepare',headers=H,json=payload)
        assert r.status_code==200
        assert r.json()['question']['suggested_value']=='pieces'
    assert len(calls)==1
    assert len(calls[0]['columns'][0]['examples'])<=3
    payload['answers']={'0:column_units':'pieces'}
    r=c.post('/api/batches/prepare',headers=H,json=payload).json()
    assert r['question']['id']=='complete_all'


@pytest.mark.parametrize('failure',[TimeoutError, ValueError])
def test_ai_failure_keeps_normal_question(tmp_path,monkeypatch,failure):
    async def fake(*args): raise failure('unavailable')
    monkeypatch.setenv('OPENAI_API_KEY','test')
    monkeypatch.setattr(onboarding_ai,'structured',fake)
    c,_=client(tmp_path)
    uid=c.post('/api/uploads?name=test.csv',headers=H,content=RAW).json()['id']
    r=c.post('/api/batches/prepare',headers=H,json={'upload_ids':[uid],'use_ai':True}).json()
    assert r['question']['id']=='0:column_units'
    assert 'suggested_value' not in r['question']


def test_date_auto_resolution_requires_one_interpretation():
    assert onboarding_ai.unambiguous_date(b'when\n2026-01-01\n2026-02-13\n','when')
    assert not onboarding_ai.unambiguous_date(b'when\n01/02/2026\n03/04/2026\n','when')
    assert not onboarding_ai.unambiguous_date(b'when\n2026-01-01\ninvalid\n','when')
