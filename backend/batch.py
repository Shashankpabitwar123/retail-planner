"""Guide separate CSVs, then combine checked daily sales conservatively."""
from .guidance import guide
from .domain import normalize, read_csv, DataError, MAX_ROWS
from .merge import combine_reports


def prepare_batch(sources, answers):
    configs = []
    shared = {}
    rows_total = 0
    for i, source in enumerate(sources):
        headers, rows, _ = read_csv(source['raw'])
        rows_total += len(rows)
        if rows_total > MAX_ROWS:
            raise DataError(f'These files contain more than {MAX_ROWS:,} sales records together. Choose fewer products across your files.')
        signature = tuple(headers)
        local = {k.split(':', 1)[1]: v for k, v in answers.items() if k.startswith(f'{i}:')}
        # Reuse column choices only; identical headers do not establish identical date formats.
        local = {**shared.get(signature, {}), **local}
        if answers.get('complete_all') == 'yes':
            local['complete'] = 'yes'
        g = guide(source['raw'], local)
        if g.get('question'):
            q = g['question']
            if q['id'] == 'complete':
                q['id'] = 'complete_all'
                q['title'] = 'Do these files include all sales for their dates?'
                q['detail'] = 'Each file should include complete daily sales for the same store. We will keep missing dates separate.'
            else:
                q['id'] = f"{i}:{q['id']}"
            return {**g, 'file_index': i, 'file_name': source['name'], 'row_count': len(rows)}
        if g.get('blocked'):
            return {**g, 'file_index': i, 'file_name': source['name'], 'row_count': len(rows)}
        shared[signature] = {k: v for k, v in local.items() if k.startswith('column_')}
        configs.append(g['config'])
    reports = []
    seen = set()
    for i, (source, cfg) in enumerate(zip(sources, configs)):
        if source['digest'] in seen:
            continue
        seen.add(source['digest'])
        try:
            report = normalize(source['raw'], cfg)
            if report['global_block'] or any(x.get('blocking') and x.get('row') for x in report['issues']):
                raise DataError('Some sales records need fixing. Correct this file or remove it from this upload.')
            # Monthly exports must contain daily dates, not one monthly total.
            dates = {r['date'] for r in report['canonical'] if r['observation_status'] == 'observed'}
            if len(sources) > 1 and len(dates) == 1:
                if answers.get('daily_records') != 'yes':
                    return {'ready': False, 'config': cfg, 'file_index': i, 'file_name': source['name'], 'row_count': report['rows'], 'question': {'id':'daily_records','title':'Are these daily sales, or monthly totals?','detail':'We need the actual day of each sale. A whole month’s total cannot be treated as one day.','options':[{'value':'yes','label':'Daily sales','hint':'Dates are the actual days items sold.'},{'value':'no','label':'Monthly totals','hint':'I need to export daily sales.'}]}}
            current_keys = {(r['product_id'], r['date']) for r in report['canonical'] if r['observation_status'] != 'unknown'}
            for prior, prior_cfg in reports:
                prior_keys = {(r['product_id'], r['date']) for r in prior['canonical'] if r['observation_status'] != 'unknown'}
                if current_keys & prior_keys and 'transactions' in (cfg['layout'], prior_cfg['layout']):
                    raise DataError('These transaction files share product dates. Use one complete daily-total export for those dates, or remove the overlapping file, so sales are not counted twice.')
            reports.append((report, cfg))
        except DataError as exc:
            return {'ready': False, 'blocked': str(exc), 'config': cfg, 'file_index': i, 'file_name': source['name'], 'row_count': len(rows)}
    combined = reports[0][0]
    for report, _ in reports[1:]:
        raw, cfg = combine_reports(combined, report)
        combined = normalize(raw, cfg)
    raw, cfg = combine_reports(combined, combined)
    return {'ready': True, 'raw': raw, 'config': cfg, 'file_count': len(sources)}
