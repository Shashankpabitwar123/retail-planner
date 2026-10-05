"""Reproduce the user-supplied UCI capacity test without uploading customer data."""
import hashlib,json,sys
from pathlib import Path
from collections import Counter
from backend.batch import prepare_batch
from backend.domain import normalize,forecast,inventory,DataError
folder=Path(sys.argv[1]); files=sorted(folder.glob('*.csv'))
results=[];plans=[]
for group in [files[:1],files[1:]]:
 sources=[{'name':p.name,'raw':p.read_bytes(),'digest':hashlib.sha256(p.read_bytes()).hexdigest()} for p in group]
 prepared=prepare_batch(sources,{'complete_all':'yes','same_store':'yes',**{f'{i}:rows':'transactions' for i in range(len(group))}})
 assert prepared.get('ready'),prepared
 report=normalize(prepared['raw'],prepared['config']);f=forecast(report);results.append(f)
 inventory_results={}
 for p in f['products']:
  if not p.get('inventory_eligible'):continue
  cfg={'stock':200,'lead_days':2,'review_days':20,'buffer_days':2,'pack_size':1,'minimum_order':0,'confirmed':True,'snapshot_date':f['forecast_start'],'mode':'historical_replay','incoming':[]}
  inventory_results[p['product_id']]=inventory(p['forecast'],cfg)
 plans.append(inventory_results)
assert results[0]==results[1], 'Single and split forecasts differ'
assert plans[0]==plans[1], 'Single and split restock plans differ'
f=results[0]
out={'products':len(f['products']),'restock_eligible':len(plans[0]),'methods':dict(Counter(p.get('method') for p in f['products'])),'identical_single_and_split_forecasts':True,'identical_single_and_split_restock':True,'settings_tested':{'stock':200,'lead_days':2,'review_days':20,'buffer_days':2},'zero_day_assumption':'Missing product-days filled with zero for this capacity test; availability unknown.','products_detail':[{'id':p['product_id'],'method':p.get('method'),'eligible':p.get('inventory_eligible'),'warning':p.get('forecast_warning'),'evaluation':p.get('evaluation')} for p in f['products']]}
Path('evidence/uci-upload-audit.json').write_text(json.dumps(out,indent=2))
print(json.dumps({k:v for k,v in out.items() if k!='products_detail'},indent=2))
