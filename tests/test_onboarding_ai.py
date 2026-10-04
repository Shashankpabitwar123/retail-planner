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

RESTAURANT = b'Date,Dish Name,Price,Dine In,Parcel,Total Customers,Total Sales\n2026-01-01,Soup,20,52,5,57,1140\n2026-01-02,Soup,12,10,12,22,264\n2026-01-03,Soup,12,23,0,23,276\n'


def test_channel_suggestion_replaced_only_with_supported_total(monkeypatch):
    async def fake(*args):
        assert args[3]['quantity_checks']['sum_relationships']
        return {'date':'Date','product_id':'Dish Name','units':'Dine In'}, {}
    monkeypatch.setattr(onboarding_ai,'structured',fake)
    mapping=asyncio.run(onboarding_ai.suggest(RESTAURANT,'test'))
    assert mapping['units']=='Total Customers'
    from backend.guidance import guide
    prepared=guide(RESTAURANT,{})
    result=onboarding_ai.apply_hint(prepared,mapping,RESTAURANT)
    assert result['question']['suggested_value']=='Total Customers'
    assert guide(RESTAURANT,{'column_units':'Total Customers'})['question']['id']=='quantity_meaning'


def test_inconsistent_total_and_partial_channel_not_highlighted():
    raw=RESTAURANT.replace(b'23,0,23,276',b'23,0,24,276')
    evidence=onboarding_ai.quantity_evidence(raw)
    assert onboarding_ai.validated_quantity('Dine In',evidence)==''
    assert onboarding_ai.validated_quantity('Total Customers',evidence)==''


def test_zero_coincidences_do_not_prove_total():
    raw=b'Price,Dine In,Parcel,Total Customers,Total Sales\n0,0,0,0,0\n0,0,0,0,0\n'
    assert onboarding_ai.quantity_evidence(raw)=={'sum_relationships':[], 'revenue_relationships':[]}
