# Forecast and data audit — 5 October 2026

The supplied export contains 2,240 predictions for 80 products. There are no missing export values, duplicate product/date rows, or negative predictions. Processing/export correctness is separate from forecast accuracy.

## Findings and changes

- **High: assumptions presented as observations.** The earlier capacity-test CSV inserted 9,464 zero-sales rows and labelled them `zero_confirmed`. Availability was not verified. Corrected files use `zero_assumed`; these remain usable for exploratory forecasts but cannot qualify for stock advice. No quantity or date was changed. Each of the 80 products contains assumed days, so the corrected pack has zero products eligible for operational restocking. This is an honest data limitation, not a new processing failure.
- **High: contradictory transaction statuses.** Positive sales could coexist with a zero/closed-day record for the same product/date. Validation now rejects the contradiction in either row order, rather than converting it into trusted demand. Unknown and observed records cannot silently mix either.
- **High: invoice proxy lost on merge.** Combining reports could replace an exploratory invoice-quantity classification with confirmed sales. Merging now preserves that classification, and the forecast engine withholds stock advice for unverified invoice proxies.
- **Medium: insufficient diagnostic export.** Data check now offers a one-row-per-product forecast-check CSV containing model, test dates, actual/predicted totals, daily error, baseline error, 7/14-day total errors, assumptions and restock status. The forecast's existing collapsed test details show the period checks. Backups retain these fields.
- **Model limitation: 77 of 80 original forecasts failed existing stock rules.** The rules require daily WAPE <=50% and daily MAE no worse than repeating last week. These are app policy thresholds, not a universal guarantee of suitability. Weekly/fortnightly total errors are additional diagnostics, not authorization to relax the rules or ignore delivery timing.

## Source quality

The workbook has 541,909 rows, including 5,268 exact duplicate rows, 10,624 negative-quantity rows, 9,288 cancellation rows, 2,515 zero-price rows and 135,080 missing customer IDs. These categories overlap. Customer IDs are not needed for per-product forecasts. Source repetitions are not automatically deleted: without invoice-line identity, equal rows could be valid separate lines. Existing prepared data exclude nonpositive quantities/prices and cancellation invoices, retain positive source lines and standardize product labels. That produces an invoice-unit proxy, not proof of completed sales, product availability or lost demand.

## Forecasting experiment

Tested a four-week weekday average and an explicitly defined damped linear extrapolation in addition to the existing six candidates. Per-product selection used three earlier 28-day periods; the later test was kept out of that selection. However, this dataset has already been inspected during development, so it is not an independent validation dataset for the proposed system change.

Mean product-level daily MAE worsened from **53.30 to 54.60 units**, despite the pass count changing from 3 to 4. These extra models were **not shipped**. No forecasts were adjusted to look less flat, and the reliability thresholds were not weakened.

## Verification and limits

- Original single-file and three-part inputs previously produced identical forecasts and nonempty restock plans for 3 qualifying products.
- Corrected single-file and three-part inputs produce identical forecasts and consistently withhold stock advice due to assumed days. Their empty plan equality is not evidence of operational restock accuracy.
- Daily graph/table parity, missing-stock handling, mixed-success restock lists, date boundaries, backup restoration, contradiction handling and assumption retention have regression tests.
- No source evidence can establish that missing invoice days were genuinely zero sales. Actual product availability, stockouts and complete gross-sales records are needed before operational use.
- The study does not establish future prediction accuracy or current-store suitability for 2010–2011 invoices. Independent data and repeated chronological evaluation are needed before claiming a better model.

## Reproduce

From the repository, use its Python environment with `PYTHONPATH=.` and upload limits matching the deployed 10 MiB / 100,000 rows / 1,500,000 cells / 100,000 product-days configuration:

- `scripts/audit_forecast_report.py WORKBOOK FORECAST_CSV` (pandas/openpyxl required)
- `scripts/verify_exported_forecast.py ORIGINAL_PREPARED_CSV FORECAST_CSV`
- `scripts/study_forecast_candidates.py ORIGINAL_PREPARED_CSV`
- `scripts/audit_uci_uploads.py CORRECTED_FILES_DIRECTORY`

Machine-readable evidence sits beside this report. The companion notebook points to these same checks. User data and workbook contents are not included in the repository.
