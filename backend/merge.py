"""Combine reviewed daily observations without summing overlapping exports."""
import csv
import io
from .domain import DataError


def combine_reports(old, new):
    for report in (old, new):
        cfg = report['config']
        if report.get('global_block') or any(i.get('blocking') and i.get('row') for i in report.get('issues', [])):
            raise DataError('Fix the file’s data errors before combining it.')
        if cfg.get('coverage_upload_id') or cfg.get('coverage_rows'):
            raise DataError('This analysis uses separate product active dates. Upload a complete replacement file instead.')
    if old.get('store_id') != new.get('store_id'):
        raise DataError('These files refer to different stores. Choose sales from the same store.')
    if old['config'].get('timezone') != new['config'].get('timezone'):
        raise DataError('Use the same store time zone for both files.')
    records = {}
    names = {}
    for report in (old, new):
        for row in report['canonical']:
            pid = row['product_id']
            if pid in names and names[pid] != row['product_name']:
                raise DataError('A product ID has different names across these files. Correct the names or upload one complete replacement file.')
            names[pid] = row['product_name']
            if row['observation_status'] == 'unknown':
                continue
            key = (pid, row['date'])
            prior = records.get(key)
            if prior and (prior['units_sold'] != row['units_sold'] or prior['observation_status'] != row['observation_status']):
                raise DataError(f"Different sales records for {row['product_name']} on {row['date']}. Export one complete, corrected file and choose Replace with complete file. Nothing was combined.")
            records[key] = row
    if not records:
        raise DataError('There are no known sales records to combine.')
    stream = io.StringIO()
    writer = csv.DictWriter(stream, fieldnames=['date','product_id','product_name','units_sold','observation_status'])
    writer.writeheader()
    writer.writerows(records[k] for k in sorted(records))
    config = dict(mapping={'date':'date','product_id':'product_id','product_name':'product_name','units':'units_sold','date_status':'observation_status'},layout='daily',date_format='ISO',number_format='dot',timezone=old['config'].get('timezone','Etc/UTC'),store_id=old['config'].get('store_id',''),coverage_start=min(old['coverage_start'],new['coverage_start']),coverage_end=max(old['coverage_end'],new['coverage_end']),coverage_confirmed=True,gross_sales_confirmed=True,missing_days_zero=False,synthetic=bool(old['config'].get('synthetic') or new['config'].get('synthetic')))
    return stream.getvalue().encode(), config
