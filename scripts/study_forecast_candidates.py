"""Development comparison only. Candidates are not used by the production engine."""
import json,hashlib,statistics,sys
from pathlib import Path
import backend.domain as d
from backend.batch import prepare_batch
p=Path(sys.argv[1]);raw=p.read_bytes()
b=prepare_batch([dict(name=p.name,raw=raw,digest=hashlib.sha256(raw).hexdigest())],{'complete_all':'yes','0:rows':'transactions'})
r=d.normalize(b['raw'],b['config']);old=d.forecast(r)
methods=['seasonal_naive','mean_28','weekday_mean','croston_sba','mean_56','exponential_level']
def candidate(y,m):
 if sum(y)==0:return [0.0]*28
 if m=='recent_weekday_mean':return [statistics.mean(y[-7+i%7::-7][:4]) for i in range(28)]
 if m=='damped_trend':
  previous=statistics.mean(y[-28:-14]);recent=statistics.mean(y[-14:]);slope=(recent-previous)/14
  level=max(0,recent+6.5*slope)
  return [max(0,level+slope*sum(.9**j for j in range(1,h+2))) for h in range(28)]
 return d.predict(y,m)
rows=[]
for p,o in zip(r['products'],old['products']):
 y=p['series'];n=len(y)
 scores={m:statistics.mean(d.metrics(y[c:c+28],candidate(y[:c],m))['mae'] for c in [n-112,n-84,n-56]) for m in methods+['recent_weekday_mean','damped_trend']}
 m=min(scores,key=scores.get);v=d.metrics(y[-28:],candidate(y[:-28],m));a=o['evaluation']['windows'][-1]
 rows.append({'id':p['product_id'],'old_method':o['method'],'new_method':m,'old_mae':a['model']['mae'],'new_mae':v['mae'],'old_eligible':o['inventory_eligible'],'new_eligible':v['wape'] is not None and v['wape']<=.5 and v['mae']<=a['baseline']['mae']+1e-9})
out={'note':'Development dataset already inspected; not independent validation. No threshold changes.','old_mean_product_mae':statistics.mean(x['old_mae'] for x in rows),'new_mean_product_mae':statistics.mean(x['new_mae'] for x in rows),'old_eligible':sum(x['old_eligible'] for x in rows),'new_eligible':sum(x['new_eligible'] for x in rows),'changed_products':sum(x['old_method']!=x['new_method'] for x in rows),'products':rows}
Path('evidence/forecast-candidate-study.json').write_text(json.dumps(out,indent=2));print({k:v for k,v in out.items() if k!='products'})
