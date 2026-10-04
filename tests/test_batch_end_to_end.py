"""Independent known totals across multiple uploads and the forecast API."""
import calendar
import csv
import io
from datetime import date
import pytest
from backend.domain import normalize, forecast, DataError
from backend.batch import prepare_batch
from test_batch import source
from test_api import client, H


def monthly_files(count, mixed=False):
    sources, expected = [], []
    for month in range(1, count+1):
        stream = io.StringIO(); w = csv.writer(stream)
        trans = mixed and month % 2 == 0
        w.writerow(['date','sku','units_sold','store_id'] + (['event_id'] if trans else []))
        for day in range(1, calendar.monthrange(2025,month)[1]+1):
            d = date(2025,month,day)
            for pid, amount in [('A', 10+d.weekday()),('B',3)]:
                expected.append((d.isoformat(),pid,amount))
                if trans:
                    for n,qty in enumerate([1,amount-1]):
                        w.writerow([d.strftime('%m/%d/%Y'),pid,qty,'shop-1',f'{d}-{pid}-{n}'])
                else:
                    w.writerow([d.isoformat(),pid,amount,'shop-1'])
        sources.append(source(stream.getvalue().encode(),f'month-{month}.csv'))
    return sources, expected


@pytest.mark.parametrize('count,mixed',[(5,False),(10,False),(10,True)])
def test_real_upload_review_forecast_matches_known_sales(tmp_path,count,mixed):
    c, store = client(tmp_path)
    sources, expected = monthly_files(count,mixed)
    ids=[]
    for s in reversed(sources):
        r=c.post('/api/uploads?name='+s['name'],headers=H,content=s['raw'])
        assert r.status_code==200,r.text
        ids.append(r.json()['id'])
    response=c.post('/api/batches/prepare',headers=H,json={'upload_ids':ids,'answers':{'complete_all':'yes','same_store':'yes'}})
    assert response.status_code==200,response.text
    assert response.json()['ready'],response.text
    jid=response.json()['id']; store.run_one()
    review=c.get('/api/jobs/'+jid).json()
    assert review['state']=='completed',review
    q=review['result']
    assert q['coverage_start']=='2025-01-01'
    assert q['coverage_end']==max(x[0] for x in expected)
    assert q['store_id']=='shop-1'
    for p in q['products']:
        assert p['total_units']==sum(x[2] for x in expected if x[1]==p['product_id'])
        assert p['missing_days']==0
    f=c.post(f'/api/jobs/{jid}/forecast',headers=H)
    assert f.status_code==200,f.text
    store.run_one()
    result=c.get('/api/jobs/'+f.json()['id']).json()
    assert result['state']=='completed',result
    # Baseline: the same known records in a single canonical daily file.
    stream=io.StringIO(); w=csv.writer(stream); w.writerow(['date','sku','units_sold']); w.writerows(expected)
    raw=stream.getvalue().encode()
    from backend.guidance import guide
    baseline=forecast(normalize(raw,guide(raw,{'complete':'yes'})['config']))
    for p,b in zip(result['result']['products'],baseline['products']):
        assert p['forecast']==b['forecast']
        assert p['evaluation']==b['evaluation']
        assert p['inventory_eligible']==b['inventory_eligible']


def test_conflicting_daily_overlap_and_different_stores_are_rejected():
    sources,_=monthly_files(5)
    conflicting=source(sources[0]['raw'].replace(b',A,12,',b',A,99,'),'conflict.csv')
    with pytest.raises(DataError,match='Different sales'):
        prepare_batch(sources+[conflicting],{'complete_all':'yes','same_store':'yes'})
    sources[1]=source(sources[1]['raw'].replace(b'shop-1',b'shop-2'))
    result=prepare_batch(sources,{'complete_all':'yes','same_store':'yes'})
    assert not result['ready'] and 'different stores' in result['blocked']


def test_removed_month_is_unknown_not_zero():
    sources,_=monthly_files(5)
    r=prepare_batch([sources[0],*sources[2:]],{'complete_all':'yes','same_store':'yes'})
    q=normalize(r['raw'],r['config'])
    assert all(p['missing_days']==28 for p in q['products'])
    assert not q['eligible_products']
