"""Profile source invoices and a user-exported forecast; requires pandas/openpyxl."""
import argparse,hashlib,json
from pathlib import Path
import pandas as pd
parser=argparse.ArgumentParser();parser.add_argument('workbook');parser.add_argument('forecast');parser.add_argument('--output',default='evidence/source-quality-audit.json');args=parser.parse_args()
d=pd.read_excel(args.workbook,dtype={'InvoiceNo':str,'StockCode':str})
r=pd.read_csv(args.forecast,dtype={'Product ID':str})
out={'source_sha256':hashlib.sha256(Path(args.workbook).read_bytes()).hexdigest(),'report_sha256':hashlib.sha256(Path(args.forecast).read_bytes()).hexdigest(),'source_rows':len(d),'exact_duplicate_rows':int(d.duplicated().sum()),'negative_quantity_rows':int((d.Quantity<0).sum()),'cancellation_rows':int(d.InvoiceNo.str.startswith('C').sum()),'zero_price_rows':int((d.UnitPrice==0).sum()),'missing_customer_ids':int(d.CustomerID.isna().sum()),'report_rows':len(r),'report_products':int(r['Product ID'].nunique()),'report_duplicate_product_dates':int(r.duplicated(['Product ID','Date']).sum()),'report_missing_values':r.isna().sum().to_dict(),'report_negative_predictions':int((r['Estimated units sold']<0).sum()),'reliability':r.drop_duplicates('Product ID').Reliability.value_counts().to_dict()}
Path(args.output).write_text(json.dumps(out,indent=2));print(json.dumps(out,indent=2))
