import json,tempfile,sys
from pathlib import Path
from fastapi.testclient import TestClient
from backend.app import create_app
p=Path(sys.argv[1]);h={'X-Retail-Client':'web'}
with tempfile.TemporaryDirectory() as temp:
 app=create_app(Path(temp)/'benchmark.sqlite',worker=False);c=TestClient(app);c.get('/api/session')
 r=c.post('/api/uploads?name=synthetic-capacity-test.csv',headers=h,content=p.read_bytes());assert r.status_code==200,r.text[:300]
 r=c.post('/api/batches/prepare',headers=h,json={'upload_ids':[r.json()['id']],'answers':{'complete_all':'yes','same_store':'yes','0:rows':'daily'}});assert r.status_code==200,r.text[:300];assert r.json().get('ready'),r.text[:300]
 jid=r.json()['id'];app.state.store.run_one();j=c.get('/api/jobs/'+jid).json();assert j['state']=='completed',j.get('error');normalize_perf=j['performance'];del j
 r=c.post('/api/jobs/'+jid+'/forecast',headers=h);assert r.status_code==200,r.text[:300]
 fid=r.json()['id'];app.state.store.run_one();f=c.get('/api/jobs/'+fid).json();assert f['state']=='completed',f.get('error')
 result={'scope':'Local API test, not live Render benchmark','file_bytes':p.stat().st_size,'input_rows':200000,'normalize':normalize_perf,'forecast':f['performance']}
 Path('evidence/20mb-local-performance.json').write_text(json.dumps(result,indent=2));print('BENCHMARK_COMPLETED')
