"""Reconcile every supplied exported prediction with the local deterministic engine."""
import csv,hashlib,json,sys
from datetime import datetime
from pathlib import Path
from backend.batch import prepare_batch
from backend.domain import normalize,forecast
raw=Path(sys.argv[1]).read_bytes()
b=prepare_batch([{'name':'source.csv','raw':raw,'digest':hashlib.sha256(raw).hexdigest()}],{'complete_all':'yes','0:rows':'transactions'})
r=forecast(normalize(b['raw'],b['config']))
expected={(p['product_id'],d['date']):d['units'] for p in r['products'] for d in p['forecast']}
with open(sys.argv[2],newline='') as f:rows=list(csv.DictReader(f))
seen=set()
for row in rows:
 key=(row['Product ID'],datetime.strptime(row['Date'],'%d %b %Y').date().isoformat())
 assert key not in seen;seen.add(key)
 assert abs(float(row['Estimated units sold'])-expected[key])<1e-6,key
assert seen==set(expected)
out={'matched_forecast_rows':len(seen),'products':len(r['products']),'result':'Every supplied prediction matches the local engine. This verifies computation/export consistency, not prediction accuracy.'}
Path('evidence/export-reconciliation.json').write_text(json.dumps(out,indent=2));print(out)
